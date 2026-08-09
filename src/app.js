import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonStore } from "./domain/store.js";
import { AnswerOrchestrator } from "./services/answer-orchestrator.js";
import { LlmWikiClient } from "./services/llm-wiki-client.js";
import { KnowledgeAnswerLoopService } from "./services/knowledge-answer-loop-service.js";
import { KnowledgeLifecycleService } from "./services/knowledge-lifecycle-service.js";
import { KnowledgeScanService } from "./services/knowledge-scan-service.js";
import { KnowledgeSyncService } from "./services/knowledge-sync-service.js";
import { RagflowClient } from "./services/ragflow-client.js";
import { RagflowLifecycleProbeService } from "./services/ragflow-lifecycle-probe-service.js";
import { RagflowKnowledgeService } from "./services/ragflow-knowledge-service.js";
import { DEFAULT_REPLY_POLICY } from "./services/reply-policy-service.js";
import { createIntegrationRoutes } from "./routes/integration-routes.js";
import { createHandoffRoutes } from "./routes/handoff-routes.js";
import { createKnowledgeRoutes } from "./routes/knowledge-routes.js";
import { createMaterialRoutes } from "./routes/material-routes.js";
import { createWechatKfRoutes } from "./routes/wechat-kf-routes.js";
import { WechatKfClient } from "./services/wechat-kf-client.js";
import { WechatKfPlatform } from "./services/wechat-kf-platform.js";

const uiDir = join(dirname(fileURLToPath(import.meta.url)), "ui");
const staticRoutes = new Map([
  ["/ui/operator.js", { fileName: "operator.js", contentType: "text/javascript; charset=utf-8" }],
  ["/ui/styles.css", { fileName: "styles.css", contentType: "text/css; charset=utf-8" }],
]);

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function buildFeatureOverview(config, state) {
  const ticketsByStatus = countBy(state.handoffTickets, (ticket) => ticket.status);
  const candidatesByDecision = countBy(state.feedbackCandidates, (candidate) => candidate.publication_decision?.publication_decision || "unknown");
  const ragflowConfigured = Boolean(config.ragflowApiKey && (config.ragflowDatasetIds.length > 0 || config.ragflowDatasetNames.length > 0));
  const ragflowLiveConfigured = Boolean(config.useRagflow && ragflowConfigured);
  const localKnowledgeEnabled = Boolean(config.enableLocalTestKnowledge);
  const wechatCallbackConfigured = Boolean(config.wechatCorpId && config.wechatKfCallbackToken && config.wechatKfEncodingAesKey);
  const wechatApiConfigured = Boolean(config.wechatCorpId && config.wechatKfSecret);
  return {
    ok: true,
    mode: "local-mvp",
    pipeline: [
      { id: "fake_wechat", label: "FakeWeChat", status: "active", detail: "本地消息入口保留用于回归验证" },
      { id: "wechat_kf", label: "WeChat KF", status: config.wechatKfEnabled ? wechatCallbackConfigured ? "callback_configurable" : "enabled_missing_config" : "disabled", detail: config.wechatKfEnabled ? "真实微信客服 callback 路由已启用" : "真实微信客服 callback 默认关闭" },
      { id: "ragflow", label: "RAGFlow", status: ragflowLiveConfigured ? "real_enabled" : ragflowConfigured ? "configured_disabled" : "unconfigured", detail: ragflowLiveConfigured ? "真实 RAGFlow retrieval 已启用" : ragflowConfigured ? "RAGFlow 凭据和 dataset 已配置；设置 BCS_USE_RAGFLOW=1 后用于自动回复" : "缺少 RAGFLOW_API_KEY 或 RAGFLOW_DATASET_IDS/RAGFLOW_DATASET_NAMES，不执行伪检索" },
      { id: "handoff", label: "Human Handoff", status: "active", detail: "低置信或高风险问题转人工工单" },
      { id: "local_test_knowledge", label: "Local Test Knowledge", status: localKnowledgeEnabled ? "mock_enabled" : "disabled", detail: localKnowledgeEnabled ? "显式启用的本地测试知识，不代表生产 KB" : "默认关闭，避免伪装成真实知识库" },
      { id: "llm_wiki", label: "LLM Wiki", status: config.llmWikiCandidatePath ? "real_configurable" : "unconfigured", detail: config.llmWikiCandidatePath ? "可读取真实 llm_wiki candidate path" : "缺少 LLM_WIKI_CANDIDATE_PATH，不生成伪 artifact" },
      { id: "evaluation", label: "Evaluation Gate", status: "policy_only", detail: "当前仅本地发布策略；Ragas runner 未接入主仓" },
      { id: "ragflow_sync", label: "RAGFlow Sync", status: ragflowConfigured ? "real_configurable" : "unconfigured", detail: "仅通过真实 llm_wiki + RAGFlow 配置触发同步" },
    ],
    integrations: {
      wechat: {
        mode: config.wechatKfEnabled ? "wechat_kf_demo" : "fake_local",
        callback_path: config.wechatKfCallbackPath,
        callback_configured: wechatCallbackConfigured,
        api_configured: wechatApiConfigured,
        send_enabled: Boolean(config.wechatKfSendEnabled),
        blocked_prerequisites: [
          ...(wechatCallbackConfigured ? [] : ["WECHAT_CORP_ID", "WECHAT_KF_CALLBACK_TOKEN", "WECHAT_KF_ENCODING_AES_KEY"]),
          ...(wechatApiConfigured ? [] : ["WECHAT_KF_SECRET"]),
          ...(config.wechatKfSendEnabled ? [] : ["WECHAT_KF_SEND_ENABLED=1"]),
          "add_contact_way/live customer service link",
        ],
      },
      ragflow: {
        owner: "production RAG/KB",
        mode: ragflowLiveConfigured ? "live_enabled" : ragflowConfigured ? "configured_disabled" : "unconfigured",
        retrieval_enabled: config.useRagflow,
        base_url: config.ragflowBaseUrl,
        api_key_configured: Boolean(config.ragflowApiKey),
        dataset_ids_configured: config.ragflowDatasetIds.length,
        dataset_names_configured: config.ragflowDatasetNames,
      },
      llm_wiki: {
        owner: "knowledge governance workbench",
        mode: config.llmWikiCandidatePath ? "real_configurable" : "unconfigured",
        base_url: config.llmWikiBaseUrl,
        token_configured: Boolean(config.llmWikiApiToken),
        candidate_path_configured: Boolean(config.llmWikiCandidatePath),
      },
      evaluation: {
        owner: "Ragas/evaluation gate",
        mode: "local_policy_gate",
        publish_requires: ["llm_wiki approval", "evaluation pass", "source refs"],
      },
    },
    metrics: {
      conversations: state.conversations.length,
      events: state.events.length,
      outbox: state.outbox.length,
      decision_logs: state.decisionLogs.length,
      tickets: state.handoffTickets.length,
      tickets_by_status: ticketsByStatus,
      feedback_candidates: state.feedbackCandidates.length,
      candidates_by_publication_decision: candidatesByDecision,
      published_knowledge: state.publishedKnowledge.length,
      materials: state.materials.length,
      material_batches: state.materialBatches.length,
      material_assets: state.materialAssets.length,
      material_blocks: state.materialBlocks.length,
      distillations: state.distillations.length,
    },
  };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readMaterialImportRequest(request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) return readJson(request);
  const webRequest = new Request("http://localhost/materials/import", {
    method: request.method,
    headers: request.headers,
    body: request,
    duplex: "half",
  });
  const form = await webRequest.formData();
  const assets = [];
  for (const [name, value] of form.entries()) {
    if (!(value instanceof File)) continue;
    const bytes = new Uint8Array(await value.arrayBuffer());
    const isTextAsset = value.type.startsWith("text/") || value.name.endsWith(".md") || value.name.endsWith(".txt");
    assets.push({
      filename: value.name || name,
      mime_type: value.type || "application/octet-stream",
      content: isTextAsset ? Buffer.from(bytes).toString("utf8") : "",
      content_base64: Buffer.from(bytes).toString("base64"),
    });
  }
  return {
    title: form.get("title") || "未命名材料包",
    source_note: form.get("source_note") || "operator_file_upload",
    operator_id: form.get("operator_id") || "operator_local",
    assets,
  };
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

async function sendFile(response, statusCode, fileName, contentType) {
  const content = await readFile(join(uiDir, fileName));
  response.writeHead(statusCode, { "Content-Type": contentType, "Cache-Control": "no-store" });
  response.end(content);
}

function notFound(response) {
  sendJson(response, 404, { ok: false, error: "not_found" });
}

function normalizeConfig(config) {
  return {
    ragflowBaseUrl: "http://127.0.0.1:9380",
    ragflowApiKey: "",
    ragflowDatasetIds: [],
    ragflowDatasetNames: ["beauty-faq"],
    ragflowStagingDatasetName: "beauty-material-staging",
    ragflowStagingChunkMethod: "naive",
    ragflowStagingChunkTokenNum: 128,
    ragflowStagingDelimiter: "\n",
    useRagflow: false,
    enableLocalTestKnowledge: false,
    enableDemoPublishedKnowledge: false,
    llmWikiBaseUrl: "http://127.0.0.1:19828",
    llmWikiApiToken: "",
    llmWikiCandidatePath: "",
    wechatKfEnabled: false,
    wechatKfSendEnabled: false,
    wechatCorpId: "",
    wechatKfSecret: "",
    wechatKfCallbackToken: "",
    wechatKfEncodingAesKey: "",
    wechatKfCallbackPath: "/api/wechat/kf/callback",
    wechatKfApiBaseUrl: "https://qyapi.weixin.qq.com",
    wechatKfSyncLimit: 100,
    wechatKfAccessTokenCacheTtlSeconds: 6600,
    ...config,
  };
}

export function createApp(inputConfig) {
  const config = normalizeConfig(inputConfig);
  const store = new JsonStore(config.dataFile);
  const knowledgeService = new RagflowKnowledgeService(config);
  const ragflowClient = new RagflowClient({ baseUrl: config.ragflowBaseUrl, apiKey: config.ragflowApiKey });
  const ragflowLifecycleProbeService = new RagflowLifecycleProbeService({ ragflowClient });
  const llmWikiClient = new LlmWikiClient({ baseUrl: config.llmWikiBaseUrl, token: config.llmWikiApiToken });
  const knowledgeLifecycleService = new KnowledgeLifecycleService({ llmWikiClient });
  const knowledgeSyncService = new KnowledgeSyncService({ ragflowClient, llmWikiClient });
  const knowledgeAnswerLoopService = new KnowledgeAnswerLoopService({ llmWikiClient, knowledgeSyncService, knowledgeService, ragflowClient });
  const knowledgeScanService = new KnowledgeScanService({ llmWikiClient, knowledgeAnswerLoopService });
  const wechatKfClient = new WechatKfClient({ baseUrl: config.wechatKfApiBaseUrl, corpId: config.wechatCorpId, secret: config.wechatKfSecret, fetchImpl: config.fetchImpl, tokenTtlSeconds: config.wechatKfAccessTokenCacheTtlSeconds });
  let orchestrator;
  const wechatKfPlatform = new WechatKfPlatform({ client: wechatKfClient, orchestrator: null, sendEnabled: config.wechatKfSendEnabled, syncLimit: config.wechatKfSyncLimit });
  orchestrator = new AnswerOrchestrator({ store, knowledgeService, outboundSender: wechatKfPlatform.createOutboundSender() });
  wechatKfPlatform.orchestrator = orchestrator;
  const handleIntegrationRoutes = createIntegrationRoutes({ config, store, ragflowClient, llmWikiClient, ragflowLifecycleProbeService, sendJson, readJson });
  const handleHandoffRoutes = createHandoffRoutes({ store, sendJson, readJson });
  const handleKnowledgeRoutes = createKnowledgeRoutes({ config, store, knowledgeService, knowledgeLifecycleService, knowledgeSyncService, knowledgeAnswerLoopService, knowledgeScanService, ragflowClient, sendJson, readJson });
  const handleMaterialRoutes = createMaterialRoutes({ config, store, ragflowClient, knowledgeLifecycleService, sendJson, readJson, readMaterialImportRequest });
  const handleWechatKfRoutes = createWechatKfRoutes({ config, wechatKfPlatform });

  return async function app(request, response) {
    const url = new URL(request.url, "http://localhost");

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, service: "beauty-customer-service", mode: "local-mvp" });
        return;
      }

      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/operator")) {
        await sendFile(response, 200, "operator.html", "text/html; charset=utf-8");
        return;
      }

      if (request.method === "GET" && url.pathname === "/favicon.ico") {
        response.writeHead(204, { "Cache-Control": "no-store" });
        response.end();
        return;
      }

      const staticRoute = staticRoutes.get(url.pathname);
      if (request.method === "GET" && staticRoute) {
        await sendFile(response, 200, staticRoute.fileName, staticRoute.contentType);
        return;
      }

      if (request.method === "POST" && url.pathname === "/dev/reset") {
        await store.reset();
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/dev/fake-wechat/messages") {
        const body = await readJson(request);
        const localOrchestrator = new AnswerOrchestrator({ store, knowledgeService });
        const result = await localOrchestrator.processFakeWeChatMessage(body);
        sendJson(response, 200, { ok: true, result });
        return;
      }

      if (await handleWechatKfRoutes({ request, response, url })) {
        return;
      }

      if (request.method === "GET" && url.pathname === "/outbox") {
        const state = await store.load();
        sendJson(response, 200, { ok: true, messages: state.outbox });
        return;
      }

      if (request.method === "GET" && url.pathname === "/decision-logs") {
        const state = await store.load();
        sendJson(response, 200, { ok: true, logs: state.decisionLogs });
        return;
      }

      if (request.method === "GET" && url.pathname === "/reply-policy") {
        const state = await store.load();
        sendJson(response, 200, { ok: true, policy: { ...DEFAULT_REPLY_POLICY, ...(state.replyPolicy || {}) } });
        return;
      }

      if (request.method === "POST" && url.pathname === "/reply-policy") {
        const body = await readJson(request);
        const result = await store.update((state) => {
          state.replyPolicy = { ...DEFAULT_REPLY_POLICY, ...body };
          return { ok: true, policy: state.replyPolicy };
        });
        sendJson(response, 200, result);
        return;
      }

      if (await handleMaterialRoutes({ request, response, url })) {
        return;
      }

      if (request.method === "GET" && url.pathname === "/runtime/features") {
        const state = await store.load();
        sendJson(response, 200, buildFeatureOverview(config, state));
        return;
      }

      if (await handleIntegrationRoutes({ request, response, url })) {
        return;
      }

      if (await handleHandoffRoutes({ request, response, url })) {
        return;
      }

      if (await handleKnowledgeRoutes({ request, response, url })) {
        return;
      }

      notFound(response);
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
  };
}
