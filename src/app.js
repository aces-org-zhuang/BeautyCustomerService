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
import { hashId } from "./domain/ids.js";
import { acknowledgeKnowledgeAlert } from "./services/knowledge-alert-service.js";
import { claimTicket, createFeedbackCandidate, resolveTicket } from "./services/handoff-service.js";
import { evaluateCandidate, publishCandidate, reviewCandidate } from "./services/knowledge-governance-service.js";
import { createLocalBlocksForBatch, createMaterialBatch, distillMaterialBatch, refreshRagflowBlocks, startRagflowStagingParse } from "./services/material-batch-service.js";
import { createMaterial, distillMaterial } from "./services/material-service.js";
import { DEFAULT_REPLY_POLICY } from "./services/reply-policy-service.js";

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

function toKnowledgeArtifact(candidate) {
  const publicationDecision = candidate.publication_decision || { publication_decision: "block", reason: "unknown" };
  const llmWikiArtifact = candidate.llm_wiki_artifact || { path: `wiki/review/${candidate.id}.md`, status: "draft_review" };
  const ragflowSync = candidate.ragflow_sync || {
    target: "RAGFlow production KB",
    status: candidate.ragflow_sync_allowed ? "ready" : "blocked",
    reason: publicationDecision.reason || "review_and_evaluation_required",
  };
  return {
    id: candidate.id,
    batch_id: candidate.batch_id || null,
    material_id: candidate.material_id || null,
    question: candidate.question,
    answer: candidate.answer,
    source_refs: candidate.source_refs || [],
    source_excerpt: candidate.source_excerpt || "",
    risk_label: candidate.risk_label || "normal",
    risk_labels: candidate.risk_labels || [],
    confidence_basis: candidate.confidence_basis || "",
    created_from: candidate.created_from,
    handoff_reason: candidate.handoff_reason,
    governance_target: candidate.governance_target || "llm_wiki",
    llm_wiki_artifact: llmWikiArtifact,
    review_status: candidate.review_status,
    evaluation_status: candidate.evaluation_status,
    ragflow_sync_allowed: Boolean(candidate.ragflow_sync_allowed),
    ragflow_sync: ragflowSync,
    publication_decision: publicationDecision,
    created_at: candidate.created_at,
    published_at: candidate.published_at || null,
  };
}

function buildFeatureOverview(config, state) {
  const ticketsByStatus = countBy(state.handoffTickets, (ticket) => ticket.status);
  const candidatesByDecision = countBy(state.feedbackCandidates, (candidate) => candidate.publication_decision?.publication_decision || "unknown");
  const ragflowConfigured = Boolean(config.ragflowApiKey && (config.ragflowDatasetIds.length > 0 || config.ragflowDatasetNames.length > 0));
  const ragflowLiveConfigured = Boolean(config.useRagflow && ragflowConfigured);
  const localKnowledgeEnabled = Boolean(config.enableLocalTestKnowledge);
  return {
    ok: true,
    mode: "local-mvp",
    pipeline: [
      { id: "fake_wechat", label: "FakeWeChat", status: "active", detail: "本地消息入口，真实微信 callback/sync_msg 挂起" },
      { id: "ragflow", label: "RAGFlow", status: ragflowLiveConfigured ? "real_enabled" : ragflowConfigured ? "configured_disabled" : "unconfigured", detail: ragflowLiveConfigured ? "真实 RAGFlow retrieval 已启用" : ragflowConfigured ? "RAGFlow 凭据和 dataset 已配置；设置 BCS_USE_RAGFLOW=1 后用于自动回复" : "缺少 RAGFLOW_API_KEY 或 RAGFLOW_DATASET_IDS/RAGFLOW_DATASET_NAMES，不执行伪检索" },
      { id: "handoff", label: "Human Handoff", status: "active", detail: "低置信或高风险问题转人工工单" },
      { id: "local_test_knowledge", label: "Local Test Knowledge", status: localKnowledgeEnabled ? "mock_enabled" : "disabled", detail: localKnowledgeEnabled ? "显式启用的本地测试知识，不代表生产 KB" : "默认关闭，避免伪装成真实知识库" },
      { id: "llm_wiki", label: "LLM Wiki", status: config.llmWikiCandidatePath ? "real_configurable" : "unconfigured", detail: config.llmWikiCandidatePath ? "可读取真实 llm_wiki candidate path" : "缺少 LLM_WIKI_CANDIDATE_PATH，不生成伪 artifact" },
      { id: "evaluation", label: "Evaluation Gate", status: "policy_only", detail: "当前仅本地发布策略；Ragas runner 未接入主仓" },
      { id: "ragflow_sync", label: "RAGFlow Sync", status: ragflowConfigured ? "real_configurable" : "unconfigured", detail: "仅通过真实 llm_wiki + RAGFlow 配置触发同步" },
    ],
    integrations: {
      wechat: {
        mode: "fake_local",
        blocked_prerequisites: ["callback domain save", "WECHAT_KF_SECRET", "real sync_msg", "real send_msg", "add_contact_way"],
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
    llmWikiBaseUrl: "http://127.0.0.1:19828",
    llmWikiApiToken: "",
    llmWikiCandidatePath: "",
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
  const knowledgeAnswerLoopService = new KnowledgeAnswerLoopService({ llmWikiClient, knowledgeSyncService, knowledgeService });
  const knowledgeScanService = new KnowledgeScanService({ llmWikiClient, knowledgeAnswerLoopService });
  const orchestrator = new AnswerOrchestrator({ store, knowledgeService });

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
        const result = await orchestrator.processFakeWeChatMessage(body);
        sendJson(response, 200, { ok: true, result });
        return;
      }

      if (request.method === "GET" && url.pathname === "/handoff/tickets") {
        const state = await store.load();
        sendJson(response, 200, { ok: true, tickets: state.handoffTickets });
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

      if (request.method === "GET" && url.pathname === "/materials") {
        const state = await store.load();
        sendJson(response, 200, { ok: true, materials: state.materials });
        return;
      }

      if (request.method === "POST" && url.pathname === "/materials") {
        const body = await readJson(request);
        const result = await store.update((state) => {
          const created = createMaterial({ title: body.title, body: body.body, type: body.type, sourceNote: body.source_note });
          if (created.ok) state.materials.push(created.material);
          return created;
        });
        sendJson(response, result.ok ? 200 : 409, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/materials/batches") {
        const state = await store.load();
        sendJson(response, 200, { ok: true, batches: state.materialBatches, assets: state.materialAssets, blocks: state.materialBlocks });
        return;
      }

      if (request.method === "POST" && url.pathname === "/materials/import") {
        const body = await readMaterialImportRequest(request);
        const result = await store.update((state) => {
          const created = createMaterialBatch({ title: body.title, sourceNote: body.source_note, operatorId: body.operator_id, assets: body.assets || [] });
          if (!created.ok) return created;
          const localBlocks = createLocalBlocksForBatch(created.batch, created.assets);
          created.batch.block_ids = localBlocks.map((block) => block.id);
          state.materialBatches.push(created.batch);
          state.materialAssets.push(...created.assets);
          state.materialBlocks.push(...localBlocks);
          return { ...created, blocks: localBlocks };
        });
        sendJson(response, result.ok ? 200 : 409, result);
        return;
      }

      const batchParseMatch = url.pathname.match(/^\/materials\/batches\/([^/]+)\/parse$/);
      if (request.method === "POST" && batchParseMatch) {
        const body = await readJson(request);
        const state = await store.load();
        const batch = state.materialBatches.find((item) => item.id === batchParseMatch[1]);
        if (!batch) {
          sendJson(response, 404, { ok: false, reason: "material_batch_not_found" });
          return;
        }
        const assets = state.materialAssets.filter((item) => item.batch_id === batch.id);
        const parsed = await startRagflowStagingParse({
          ragflowClient,
          batch,
          assets,
          datasetName: body.dataset_name || config.ragflowStagingDatasetName,
          chunkMethod: body.chunk_method || config.ragflowStagingChunkMethod,
          parserConfig: body.parser_config || {
            chunk_token_num: config.ragflowStagingChunkTokenNum,
            delimiter: config.ragflowStagingDelimiter,
            raptor: { use_raptor: false },
            graphrag: { use_graphrag: false },
            parent_child: { use_parent_child: false, children_delimiter: "\n" },
          },
          waitForParse: Boolean(body.wait_for_parse),
        }).catch((error) => ({ ok: false, status: "failed", reason: error.message }));
        if (parsed.ok) {
          await store.save({
            ...state,
            materialBatches: state.materialBatches.map((item) => item.id === batch.id ? parsed.batch : item),
            materialAssets: state.materialAssets.map((item) => parsed.assets.find((asset) => asset.id === item.id) || item),
            materialParseJobs: [...state.materialParseJobs, parsed.job],
          });
        }
        sendJson(response, parsed.ok ? 200 : 409, parsed);
        return;
      }

      const batchRefreshMatch = url.pathname.match(/^\/materials\/batches\/([^/]+)\/refresh-blocks$/);
      if (request.method === "POST" && batchRefreshMatch) {
        const state = await store.load();
        const batch = state.materialBatches.find((item) => item.id === batchRefreshMatch[1]);
        if (!batch) {
          sendJson(response, 404, { ok: false, reason: "material_batch_not_found" });
          return;
        }
        const assets = state.materialAssets.filter((item) => item.batch_id === batch.id);
        const refreshed = await refreshRagflowBlocks({ ragflowClient, batch, assets }).catch((error) => ({ ok: false, status: "failed", reason: error.message }));
        if (refreshed.ok) {
          const existingBlockIds = new Set(state.materialBlocks.map((block) => block.id));
          await store.save({
            ...state,
            materialBatches: state.materialBatches.map((item) => item.id === batch.id ? refreshed.batch : item),
            materialAssets: state.materialAssets.map((item) => refreshed.assets.find((asset) => asset.id === item.id) || item),
            materialBlocks: [...state.materialBlocks, ...refreshed.blocks.filter((block) => !existingBlockIds.has(block.id))],
          });
        }
        sendJson(response, refreshed.ok ? 200 : 409, refreshed);
        return;
      }

      const batchDistillMatch = url.pathname.match(/^\/materials\/batches\/([^/]+)\/distill$/);
      if (request.method === "POST" && batchDistillMatch) {
        const result = await store.update((state) => {
          const batch = state.materialBatches.find((item) => item.id === batchDistillMatch[1]);
          const blocks = state.materialBlocks.filter((item) => item.batch_id === batchDistillMatch[1]);
          const distilled = distillMaterialBatch(batch, blocks);
          if (distilled.ok) {
            state.distillations.push(distilled.distillation);
            for (const candidate of distilled.distillation.faq_candidates) {
              const existingCandidate = state.feedbackCandidates.find((item) => item.id === candidate.id);
              if (existingCandidate) Object.assign(existingCandidate, candidate);
              else state.feedbackCandidates.push(candidate);
            }
          }
          return distilled;
        });
        sendJson(response, result.ok ? 200 : 409, result);
        return;
      }

      const materialMatch = url.pathname.match(/^\/materials\/([^/]+)$/);
      if (request.method === "GET" && materialMatch) {
        const state = await store.load();
        const material = state.materials.find((item) => item.id === materialMatch[1]);
        sendJson(response, material ? 200 : 404, material ? { ok: true, material } : { ok: false, reason: "material_not_found" });
        return;
      }

      const distillMatch = url.pathname.match(/^\/materials\/([^/]+)\/distill$/);
      if (request.method === "POST" && distillMatch) {
        const body = await readJson(request);
        const result = await store.update((state) => {
          const material = state.materials.find((item) => item.id === distillMatch[1]);
          if (!material) return { ok: false, reason: "material_not_found" };
          const materialVersion = hashId("material_version", `${material.id}:${material.title}:${material.body}`);
          const existing = state.distillations.find((item) => item.material_id === material.id && item.material_version === materialVersion);
          if (existing && !body.force) return { ok: true, distillation: existing, reused: true };
          const distilled = distillMaterial(material);
          if (distilled.ok) {
            state.distillations.push(distilled.distillation);
            for (const candidate of distilled.distillation.faq_candidates) {
              const existingCandidate = state.feedbackCandidates.find((item) => item.id === candidate.id);
              if (existingCandidate) Object.assign(existingCandidate, candidate);
              else state.feedbackCandidates.push(candidate);
            }
          }
          return distilled;
        });
        sendJson(response, result.ok ? 200 : 409, result);
        return;
      }

      const distillationsMatch = url.pathname.match(/^\/materials\/([^/]+)\/distillations$/);
      if (request.method === "GET" && distillationsMatch) {
        const state = await store.load();
        sendJson(response, 200, { ok: true, distillations: state.distillations.filter((item) => item.material_id === distillationsMatch[1]) });
        return;
      }

      const publishMaterialMatch = url.pathname.match(/^\/materials\/([^/]+)\/publish-to-llm-wiki$/);
      if (request.method === "POST" && publishMaterialMatch) {
        const body = await readJson(request);
        const result = await store.update(async (state) => {
          const distillations = state.distillations.filter((item) => item.material_id === publishMaterialMatch[1]);
          const distillation = body.distillation_id ? distillations.find((item) => item.id === body.distillation_id) : distillations.at(-1);
          if (!distillation) return { ok: false, reason: "distillation_not_found" };
          const published = await knowledgeLifecycleService.publishDistillationToLlmWiki(distillation);
          if (!published.ok) return published;
          for (const writtenCandidate of distillation.faq_candidates || []) {
            const candidate = state.feedbackCandidates.find((item) => item.id === writtenCandidate.id);
            if (candidate) Object.assign(candidate, writtenCandidate);
          }
          return published;
        }).catch((error) => ({ ok: false, status: "failed", reason: error.message }));
        sendJson(response, result.ok ? 200 : 409, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/runtime/features") {
        const state = await store.load();
        sendJson(response, 200, buildFeatureOverview(config, state));
        return;
      }

      if (request.method === "GET" && url.pathname === "/integrations/health") {
        const [ragflow, llmWiki, ragflowDatasets] = await Promise.all([
          ragflowClient.health(),
          llmWikiClient.health(),
          ragflowClient.resolveDatasetIds({ datasetIds: config.ragflowDatasetIds, datasetNames: config.ragflowDatasetNames }).catch((error) => ({ ok: false, reason: error.message })),
        ]);
        sendJson(response, 200, { ok: true, ragflow, ragflow_datasets: ragflowDatasets, llm_wiki: llmWiki, local_test_knowledge: { enabled: config.enableLocalTestKnowledge } });
        return;
      }

      if (request.method === "POST" && url.pathname === "/integrations/ragflow/lifecycle-probe") {
        const body = await readJson(request);
        const result = await store.update((state) => ragflowLifecycleProbeService.probeDocumentLifecycle({
          datasetName: body.dataset_name || `bcs_lifecycle_probe_${Date.now()}`,
          question: body.question || "bcs lifecycle probe",
          state,
        }));
        sendJson(response, result.ok ? 200 : 409, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/integrations/ragflow/lifecycle-probes") {
        const state = await store.load();
        sendJson(response, 200, { ok: true, checks: state.ragflowLifecycleChecks });
        return;
      }

      const claimMatch = url.pathname.match(/^\/handoff\/tickets\/([^/]+)\/claim$/);
      if (request.method === "POST" && claimMatch) {
        const body = await readJson(request);
        const result = await store.update((state) => {
          const ticket = state.handoffTickets.find((item) => item.id === claimMatch[1]);
          if (!ticket) return { ok: false, reason: "ticket_not_found" };
          return claimTicket(ticket, body.operator_id || "operator_local", body.expected_version ?? ticket.assignment_version);
        });
        sendJson(response, result.ok ? 200 : 409, result);
        return;
      }

      const resolveMatch = url.pathname.match(/^\/handoff\/tickets\/([^/]+)\/resolve$/);
      if (request.method === "POST" && resolveMatch) {
        const body = await readJson(request);
        const result = await store.update((state) => {
          const ticket = state.handoffTickets.find((item) => item.id === resolveMatch[1]);
          if (!ticket) return { ok: false, reason: "ticket_not_found" };
          const resolved = resolveTicket(ticket, { operatorId: body.operator_id || "operator_local", answerText: body.answer_text || "" });
          if (!resolved.ok) return resolved;
          const candidate = createFeedbackCandidate(ticket, body.answer_text || "");
          state.feedbackCandidates.push(candidate);
          const conversation = state.conversations.find((item) => item.id === ticket.conversation_id);
          if (conversation) {
            conversation.state = "resolved";
            conversation.updated_at = ticket.updated_at;
          }
          return { ok: true, ticket, candidate };
        });
        sendJson(response, result.ok ? 200 : 409, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/knowledge/feedback-candidates") {
        const state = await store.load();
        sendJson(response, 200, { ok: true, candidates: state.feedbackCandidates });
        return;
      }

      if (request.method === "GET" && url.pathname === "/knowledge/published") {
        const state = await store.load();
        sendJson(response, 200, { ok: true, knowledge: state.publishedKnowledge });
        return;
      }

      if (request.method === "GET" && url.pathname === "/knowledge/local-test") {
        sendJson(response, 200, { ok: true, knowledge: knowledgeService.listLocalKnowledge() });
        return;
      }

      const reviewMatch = url.pathname.match(/^\/knowledge\/feedback-candidates\/([^/]+)\/review$/);
      if (request.method === "POST" && reviewMatch) {
        const body = await readJson(request);
        const result = await store.update((state) => {
          const candidate = state.feedbackCandidates.find((item) => item.id === reviewMatch[1]);
          return reviewCandidate(candidate, { decision: body.decision, reviewerId: body.reviewer_id || "reviewer_local" });
        });
        sendJson(response, result.ok ? 200 : 409, result);
        return;
      }

      const evaluateMatch = url.pathname.match(/^\/knowledge\/feedback-candidates\/([^/]+)\/evaluate$/);
      if (request.method === "POST" && evaluateMatch) {
        const body = await readJson(request);
        const result = await store.update((state) => {
          const candidate = state.feedbackCandidates.find((item) => item.id === evaluateMatch[1]);
          return evaluateCandidate(candidate, { result: body.result || "pass" });
        });
        sendJson(response, result.ok ? 200 : 409, result);
        return;
      }

      const publishMatch = url.pathname.match(/^\/knowledge\/feedback-candidates\/([^/]+)\/publish-local$/);
      if (request.method === "POST" && publishMatch) {
        const result = await store.update((state) => {
          const candidate = state.feedbackCandidates.find((item) => item.id === publishMatch[1]);
          return publishCandidate(state, candidate);
        });
        sendJson(response, result.ok ? 200 : 409, result);
        return;
      }

      const publishCandidateToLlmWikiMatch = url.pathname.match(/^\/knowledge\/feedback-candidates\/([^/]+)\/publish-to-llm-wiki$/);
      if (request.method === "POST" && publishCandidateToLlmWikiMatch) {
        const result = await store.update((state) => {
          const candidate = state.feedbackCandidates.find((item) => item.id === publishCandidateToLlmWikiMatch[1]);
          return knowledgeLifecycleService.publishCandidateToLlmWiki(candidate);
        }).catch((error) => ({ ok: false, status: "failed", reason: error.message }));
        sendJson(response, result.ok ? 200 : 409, result);
        return;
      }

      const refreshCandidateMatch = url.pathname.match(/^\/knowledge\/feedback-candidates\/([^/]+)\/refresh-llm-wiki-status$/);
      if (request.method === "POST" && refreshCandidateMatch) {
        const result = await store.update((state) => {
          const candidate = state.feedbackCandidates.find((item) => item.id === refreshCandidateMatch[1]);
          return knowledgeLifecycleService.refreshCandidateFromLlmWiki(candidate);
        }).catch((error) => ({ ok: false, status: "failed", reason: error.message }));
        sendJson(response, result.ok ? 200 : 409, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/knowledge/sync/llm-wiki-to-ragflow") {
        const body = await readJson(request);
        const requestedDatasetNames = body.dataset_name ? [body.dataset_name] : config.ragflowDatasetNames;
        const resolvedDataset = body.dataset_id
          ? { ok: true, datasetIds: [body.dataset_id] }
          : await ragflowClient.resolveDatasetIds({ datasetIds: config.ragflowDatasetIds, datasetNames: requestedDatasetNames }).catch((error) => ({ ok: false, reason: error.message }));
        if (!resolvedDataset.ok && !body.create_dataset) {
          sendJson(response, 409, { ok: false, status: "unconfigured", reason: resolvedDataset.reason || "ragflow_dataset_not_resolved" });
          return;
        }
        const result = await store.update((state) => knowledgeSyncService.syncApprovedCandidate({
          candidatePath: body.candidate_path || config.llmWikiCandidatePath,
          datasetId: resolvedDataset?.ok ? resolvedDataset.datasetIds[0] : null,
          datasetName: body.dataset_name,
          waitForParse: Boolean(body.wait_for_parse),
          force: Boolean(body.force),
          state,
        })).catch((error) => ({ ok: false, status: "failed", reason: error.message }));
        sendJson(response, result.ok ? 200 : 409, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/knowledge/sync-jobs") {
        const state = await store.load();
        sendJson(response, 200, { ok: true, jobs: state.knowledgeSyncJobs });
        return;
      }

      if (request.method === "POST" && url.pathname === "/knowledge/answer-loop/sync-and-verify") {
        const body = await readJson(request);
        const requestedDatasetNames = body.dataset_name ? [body.dataset_name] : config.ragflowDatasetNames;
        const resolvedDataset = body.dataset_id
          ? { ok: true, datasetIds: [body.dataset_id] }
          : await ragflowClient.resolveDatasetIds({ datasetIds: config.ragflowDatasetIds, datasetNames: requestedDatasetNames }).catch((error) => ({ ok: false, reason: error.message }));
        if (!resolvedDataset.ok && !body.create_dataset) {
          const result = await store.update((state) => knowledgeAnswerLoopService.recordBlocked({
            state,
            candidatePath: body.candidate_path || config.llmWikiCandidatePath,
            question: body.question || null,
            expectedAnswer: body.expected_answer || null,
            reason: resolvedDataset.reason || "ragflow_dataset_not_resolved",
          }));
          sendJson(response, 409, result);
          return;
        }
        const result = await store.update((state) => knowledgeAnswerLoopService.syncAndVerify({
          candidatePath: body.candidate_path || config.llmWikiCandidatePath,
          datasetId: resolvedDataset?.ok ? resolvedDataset.datasetIds[0] : null,
          datasetName: body.dataset_name,
          question: body.question,
          expectedAnswer: body.expected_answer,
          waitForParse: Boolean(body.wait_for_parse),
          force: Boolean(body.force),
          state,
        })).catch((error) => ({ ok: false, status: "answer_failed", reason: error.message }));
        sendJson(response, result.ok ? 200 : 409, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/knowledge/answer-loop/checks") {
        const state = await store.load();
        sendJson(response, 200, { ok: true, checks: state.knowledgeAnswerChecks });
        return;
      }

      if (request.method === "GET" && url.pathname === "/knowledge/documents") {
        const state = await store.load();
        sendJson(response, 200, { ok: true, documents: state.knowledgeDocuments });
        return;
      }

      if (request.method === "POST" && url.pathname === "/knowledge/answer-loop/scan-approved") {
        const body = await readJson(request);
        const result = await store.update((state) => knowledgeScanService.scanApproved({
          scanRoot: body.scan_root || "wiki/approved-answers",
          autoSync: Boolean(body.auto_sync),
          autoWithdraw: body.auto_withdraw !== false,
          state,
        })).catch((error) => ({ ok: false, status: "failed", reason: error.message }));
        sendJson(response, result.ok ? 200 : 409, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/knowledge/answer-loop/scan-runs") {
        const state = await store.load();
        sendJson(response, 200, { ok: true, runs: state.knowledgeScanRuns });
        return;
      }

      const scanRunMatch = url.pathname.match(/^\/knowledge\/answer-loop\/scan-runs\/([^/]+)$/);
      if (request.method === "GET" && scanRunMatch) {
        const state = await store.load();
        const run = state.knowledgeScanRuns.find((item) => item.id === scanRunMatch[1]);
        sendJson(response, run ? 200 : 404, run ? { ok: true, run } : { ok: false, reason: "scan_run_not_found" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/knowledge/alerts") {
        const state = await store.load();
        sendJson(response, 200, { ok: true, alerts: state.knowledgeAlerts });
        return;
      }

      const acknowledgeAlertMatch = url.pathname.match(/^\/knowledge\/alerts\/([^/]+)\/acknowledge$/);
      if (request.method === "POST" && acknowledgeAlertMatch) {
        const body = await readJson(request);
        const result = await store.update((state) => acknowledgeKnowledgeAlert(state, acknowledgeAlertMatch[1], body.actor || "operator_local"));
        sendJson(response, result.ok ? 200 : 404, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/knowledge/answer-loop/withdraw") {
        const body = await readJson(request);
        const result = await store.update((state) => knowledgeAnswerLoopService.withdraw({
          sourcePath: body.source_path || body.candidate_path || null,
          documentId: body.document_id || null,
          reason: body.reason || "withdrawn",
          question: body.question || null,
          state,
        })).catch((error) => ({ ok: false, status: "sync_blocked", reason: error.message }));
        sendJson(response, result.ok ? 200 : 409, result);
        return;
      }

      const answerCheckMatch = url.pathname.match(/^\/knowledge\/answer-loop\/checks\/([^/]+)$/);
      if (request.method === "GET" && answerCheckMatch) {
        const state = await store.load();
        const check = state.knowledgeAnswerChecks.find((item) => item.id === answerCheckMatch[1]);
        sendJson(response, check ? 200 : 404, check ? { ok: true, check } : { ok: false, reason: "answer_check_not_found" });
        return;
      }

      const syncJobMatch = url.pathname.match(/^\/knowledge\/sync-jobs\/([^/]+)$/);
      if (request.method === "GET" && syncJobMatch) {
        const state = await store.load();
        const job = state.knowledgeSyncJobs.find((item) => item.id === syncJobMatch[1]);
        sendJson(response, job ? 200 : 404, job ? { ok: true, job } : { ok: false, reason: "sync_job_not_found" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/knowledge/artifacts") {
        const state = await store.load();
        sendJson(response, 200, { ok: true, artifacts: state.feedbackCandidates.map(toKnowledgeArtifact) });
        return;
      }

      notFound(response);
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
  };
}
