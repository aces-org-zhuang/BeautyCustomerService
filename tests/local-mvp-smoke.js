import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

const dir = await mkdtemp(join(tmpdir(), "bcs-smoke-"));
const server = createServer(createApp({ dataFile: join(dir, "store.json"), useRagflow: true, enableLocalTestKnowledge: true, ragflowDatasetIds: [], ragflowDatasetNames: [], ragflowBaseUrl: "http://127.0.0.1:9380", ragflowApiKey: "", llmWikiBaseUrl: "http://127.0.0.1:19828", llmWikiApiToken: "", llmWikiCandidatePath: "" }));

try {
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  await request(baseUrl, "/health");
  const operatorPage = await request(baseUrl, "/operator", { headers: { Accept: "text/html" } });
  if (!operatorPage.includes("本地客服工作台")) throw new Error("/operator did not return operator UI");
  if (!operatorPage.includes("闭环特性全景")) throw new Error("/operator did not show feature panorama");
  if (!operatorPage.includes("材料蒸馏")) throw new Error("/operator did not show material distillation UI");
  if (!operatorPage.includes("材料包 Staging")) throw new Error("/operator did not show material batch staging UI");
  if (!operatorPage.includes("type=\"file\"")) throw new Error("/operator did not expose material file upload control");
  if (!operatorPage.includes("话术策略")) throw new Error("/operator did not show reply policy UI");
  if (!operatorPage.includes("干皮适合做补水护理吗？")) throw new Error("/operator did not default to a supported local knowledge question");
  await request(baseUrl, "/dev/reset", { method: "POST", body: "{}" });
  const initialFeatures = await request(baseUrl, "/runtime/features");
  if (!initialFeatures.pipeline.some((item) => item.id === "ragflow")) throw new Error("feature overview did not include RAGFlow");
  if (!initialFeatures.pipeline.some((item) => item.id === "llm_wiki")) throw new Error("feature overview did not include LLM Wiki");
  const health = await request(baseUrl, "/integrations/health");
  if (health.ragflow.status !== "unconfigured") throw new Error("RAGFlow should not report ready without credentials");
  const syncBlocked = await fetch(`${baseUrl}/knowledge/sync/llm-wiki-to-ragflow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(async (response) => ({ status: response.status, body: await response.json() }));
  if (syncBlocked.status !== 409 || syncBlocked.body.status !== "unconfigured") throw new Error("llm_wiki to RAGFlow sync should be blocked without real configuration");
  const localKnowledge = await request(baseUrl, "/knowledge/local-test");
  if (localKnowledge.knowledge.length < 5) throw new Error("local test knowledge was not loaded");
  const policy = await request(baseUrl, "/reply-policy");
  if (policy.policy.profile !== "warm_professional") throw new Error("default reply policy was not loaded");
  const material = await request(baseUrl, "/materials", {
    method: "POST",
    body: JSON.stringify({ title: "补水护理材料", body: "补水护理适合皮肤干燥、起皮、妆前卡粉的人群。如果顾客有明显刺痛、泛红，建议先让美容师看一下。护理后当天注意保湿和防晒，避免刷酸和强清洁。" }),
  });
  const distillation = await request(baseUrl, `/materials/${material.material.id}/distill`, { method: "POST", body: "{}" });
  const reusedDistillation = await request(baseUrl, `/materials/${material.material.id}/distill`, { method: "POST", body: "{}" });
  if (distillation.distillation.faq_candidates.length === 0) throw new Error("material distillation did not create candidates");
  if (!distillation.distillation.source_material.sections?.[0]?.source_ref.includes("#")) throw new Error("material distillation did not create section source refs");
  if (!distillation.distillation.faq_candidates[0].source_excerpt) throw new Error("material candidate did not preserve source excerpt");
  if (!distillation.distillation.risk_findings.some((item) => item.severity && item.evidence && item.source_ref)) throw new Error("risk findings did not preserve severity/evidence/source_ref");
  if (distillation.distillation.faq_candidates[0].governance_target !== "pending_llm_wiki") throw new Error("distilled candidate should be pending llm wiki");
  if (!reusedDistillation.reused) throw new Error("material distillation should reuse the current material version by default");
  const materialBatch = await request(baseUrl, "/materials/import", {
    method: "POST",
    body: JSON.stringify({ title: "补水护理资料包", assets: [{ filename: "补水护理.md", mime_type: "text/markdown", content: "补水护理适合干皮、起皮和妆前卡粉。护理后注意保湿和防晒，避免刷酸。" }] }),
  });
  if (materialBatch.blocks.length === 0) throw new Error("material batch import did not create blocks");
  const batchDistillation = await request(baseUrl, `/materials/batches/${materialBatch.batch.id}/distill`, { method: "POST", body: "{}" });
  if (batchDistillation.distillation.source !== "local_blocks") throw new Error("material batch distillation should use local blocks in smoke");
  const batches = await request(baseUrl, "/materials/batches");
  if (batches.batches.length !== 1 || batches.blocks.length === 0) throw new Error("material batches endpoint did not expose imported batch and blocks");
  const answer = await request(baseUrl, "/dev/fake-wechat/messages", {
    method: "POST",
    body: JSON.stringify({ msgid: "msg_001", open_kfid: "wk_test_001", external_userid: "wm_test_001", text: { content: "干皮适合做补水护理吗？" } }),
  });
  const outbox = await request(baseUrl, "/outbox");
  if (outbox.messages.length !== 1) throw new Error("supported local knowledge did not create an automatic reply");
  if (!outbox.messages[0].content.includes("补水")) throw new Error("automatic reply did not use local test knowledge");
  const handoff = await request(baseUrl, "/dev/fake-wechat/messages", {
    method: "POST",
    body: JSON.stringify({ msgid: "msg_002", open_kfid: "wk_test_001", external_userid: "wm_test_002", text: { content: "这个项目能永久治好痘痘吗？" } }),
  });
  const tickets = await request(baseUrl, "/handoff/tickets");
  const decisionLogs = await request(baseUrl, "/decision-logs");
  const ticket = tickets.tickets[0];
  await request(baseUrl, `/handoff/tickets/${ticket.id}/claim`, { method: "POST", body: JSON.stringify({ operator_id: "operator_001", expected_version: 0 }) });
  const resolved = await request(baseUrl, `/handoff/tickets/${ticket.id}/resolve`, { method: "POST", body: JSON.stringify({ operator_id: "operator_001", answer_text: "不能承诺永久治好，需要人工评估。" }) });
  const candidates = await request(baseUrl, "/knowledge/feedback-candidates");
  const artifacts = await request(baseUrl, "/knowledge/artifacts");
  if (resolved.ticket.status !== "resolved") throw new Error("ticket was not resolved");
  if (decisionLogs.logs.length < 2) throw new Error("decision logs were not recorded");
  if (!ticket.operator_payload.handoff_reason) throw new Error("ticket did not include handoff reason");
  const candidate = candidates.candidates.find((item) => item.created_from === "human_feedback");
  const candidateArtifact = artifacts.artifacts.find((item) => item.id === candidate?.id);
  if (!candidate) throw new Error("human feedback candidate was not created");
  if (candidateArtifact.governance_target !== "pending_llm_wiki") throw new Error("candidate should be pending llm_wiki before real write");
  if (candidateArtifact.ragflow_sync.status !== "blocked") throw new Error("candidate was not blocked from RAGFlow sync");
  await request(baseUrl, `/knowledge/feedback-candidates/${candidate.id}/review`, { method: "POST", body: JSON.stringify({ decision: "approve", reviewer_id: "reviewer_001" }) });
  await request(baseUrl, `/knowledge/feedback-candidates/${candidate.id}/evaluate`, { method: "POST", body: JSON.stringify({ result: "pass" }) });
  const published = await request(baseUrl, `/knowledge/feedback-candidates/${candidate.id}/publish-local`, { method: "POST", body: "{}" });
  if (!published.ok || published.published.publication_target !== "local_published_knowledge") throw new Error("candidate was not published to local knowledge");
  const publishedKnowledge = await request(baseUrl, "/knowledge/published");
  if (publishedKnowledge.knowledge.length !== 1) throw new Error("published local knowledge was not stored");
  const learnedAnswer = await request(baseUrl, "/dev/fake-wechat/messages", {
    method: "POST",
    body: JSON.stringify({ msgid: "msg_003", open_kfid: "wk_test_001", external_userid: "wm_test_003", text: { content: "这个项目能永久治好痘痘吗？" } }),
  });
  if (learnedAnswer.result.decision !== "handoff") throw new Error("high risk learned question should remain handoff");

  console.log(JSON.stringify({
    ok: true,
    operatorUi: operatorPage.includes("LLM Wiki 反哺候选"),
    featureOverview: initialFeatures.pipeline.map((item) => item.id),
    localKnowledgeCount: localKnowledge.knowledge.length,
    materialCount: (await request(baseUrl, "/materials")).materials.length,
    materialBatchCount: batches.batches.length,
    materialBlockCount: batches.blocks.length,
    distillationCandidates: distillation.distillation.faq_candidates.length,
    batchDistillationCandidates: batchDistillation.distillation.faq_candidates.length,
    sourceSections: distillation.distillation.source_material.sections.length,
    distillationReused: reusedDistillation.reused,
    answerDecision: answer.result.decision,
    autoReplyCount: outbox.messages.length,
    handoffDecision: handoff.result.decision,
    ticketStatus: resolved.ticket.status,
    decisionLogCount: decisionLogs.logs.length,
    handoffReason: ticket.operator_payload.handoff_reason,
    candidateCount: candidates.candidates.length,
    humanFeedbackCandidateId: candidate.id,
    publishedKnowledgeCount: publishedKnowledge.knowledge.length,
    llmWikiTarget: candidateArtifact.governance_target,
    ragflowSyncStatus: candidateArtifact.ragflow_sync.status,
    publicationDecision: candidate.publication_decision.publication_decision,
  }, null, 2));
} finally {
  server.close();
  await rm(dir, { recursive: true, force: true });
}
