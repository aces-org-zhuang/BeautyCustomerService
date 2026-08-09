import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonStore } from "../src/domain/store.js";
import { AnswerOrchestrator } from "../src/services/answer-orchestrator.js";
import { RagflowKnowledgeService } from "../src/services/ragflow-knowledge-service.js";
import { claimTicket, createFeedbackCandidate, resolveTicket } from "../src/services/handoff-service.js";
import { evaluateCandidate, publishCandidate, reviewCandidate } from "../src/services/knowledge-governance-service.js";
import { createLocalBlocksForBatch, createMaterialBatch, distillMaterialBatch } from "../src/services/material-batch-service.js";
import { createMaterial, distillMaterial } from "../src/services/material-service.js";
import { KnowledgeLifecycleService } from "../src/services/knowledge-lifecycle-service.js";
import { KnowledgeSyncService } from "../src/services/knowledge-sync-service.js";
import { KnowledgeAnswerLoopService } from "../src/services/knowledge-answer-loop-service.js";
import { LlmWikiClient } from "../src/services/llm-wiki-client.js";
import { RagflowClient } from "../src/services/ragflow-client.js";
import { RagflowLifecycleProbeService } from "../src/services/ragflow-lifecycle-probe-service.js";
import { upsertActiveKnowledgeDocument, withdrawKnowledgeDocument } from "../src/services/knowledge-document-registry.js";
import { KnowledgeScanService } from "../src/services/knowledge-scan-service.js";

test("JsonStore serializes concurrent updates without losing writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bcs-test-"));
  try {
    const store = new JsonStore(join(dir, "store.json"));
    await Promise.all(Array.from({ length: 12 }, (_, index) => store.update(async (state) => {
      await new Promise((resolve) => setTimeout(resolve, index % 3));
      state.decisionLogs.push({ id: `log_${index}` });
      return index;
    })));

    const state = await store.load();
    assert.equal(state.decisionLogs.length, 12);
    assert.equal(new Set(state.decisionLogs.map((item) => item.id)).size, 12);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local MVP answers supported question and creates handoff feedback candidate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bcs-test-"));
  try {
    const store = new JsonStore(join(dir, "store.json"));
    const orchestrator = new AnswerOrchestrator({
      store,
      knowledgeService: new RagflowKnowledgeService({ useRagflow: false, enableLocalTestKnowledge: true }),
    });

    const answer = await orchestrator.processFakeWeChatMessage({
      msgid: "msg_001",
      open_kfid: "wk_test_001",
      external_userid: "wm_test_001",
      text: { content: "小气泡适合油性肌吗？" },
    });
    assert.equal(answer.decision, "answer");
    assert.equal(answer.outbound.intent, "ai_answer");

    const handoff = await orchestrator.processFakeWeChatMessage({
      msgid: "msg_002",
      open_kfid: "wk_test_001",
      external_userid: "wm_test_002",
      text: { content: "这个项目能永久治好痘痘吗？" },
    });
    assert.equal(handoff.decision, "handoff");
    assert.equal(handoff.ticket.reason, "unsupported");

    const state = await store.load();
    const ticket = state.handoffTickets[0];
    assert.equal(claimTicket(ticket, "operator_001", 0).ok, true);
    assert.equal(resolveTicket(ticket, { operatorId: "operator_001", answerText: "不能承诺永久治好，需要人工评估。" }).ok, true);
    const candidate = createFeedbackCandidate(ticket, "不能承诺永久治好，需要人工评估。");
    assert.equal(candidate.review_status, "review");
    assert.equal(candidate.governance_target, "pending_llm_wiki");
    assert.equal(candidate.publication_decision.publication_decision, "block");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("knowledge provider does not use local fixtures unless explicitly enabled", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bcs-test-"));
  try {
    const store = new JsonStore(join(dir, "store.json"));
    const orchestrator = new AnswerOrchestrator({
      store,
      knowledgeService: new RagflowKnowledgeService({ useRagflow: false, enableLocalTestKnowledge: false }),
    });

    const result = await orchestrator.processFakeWeChatMessage({
      msgid: "msg_no_mock_001",
      open_kfid: "wk_test_001",
      external_userid: "wm_test_003",
      text: { content: "小气泡适合油性肌吗？" },
    });

    assert.equal(result.decision, "handoff");
    assert.equal(result.ticket.reason, "knowledge_provider_not_configured");
    const state = await store.load();
    assert.equal(state.outbox[0].intent, "handoff_ack");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reviewed and evaluated feedback candidate publishes to local knowledge", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bcs-test-"));
  try {
    const store = new JsonStore(join(dir, "store.json"));
    const orchestrator = new AnswerOrchestrator({
      store,
      knowledgeService: new RagflowKnowledgeService({ useRagflow: false, enableLocalTestKnowledge: false }),
    });

    const handoff = await orchestrator.processFakeWeChatMessage({
      msgid: "msg_publish_001",
      open_kfid: "wk_test_001",
      external_userid: "wm_test_004",
      text: { content: "护理后可以化妆吗？" },
    });
    let state = await store.load();
    let ticket = state.handoffTickets.find((item) => item.id === handoff.ticket.id);
    assert.equal(claimTicket(ticket, "operator_001", 0).ok, true);
    assert.equal(resolveTicket(ticket, { operatorId: "operator_001", answerText: "建议根据皮肤状态决定，短期内优先做好保湿和防晒。" }).ok, true);
    const candidate = createFeedbackCandidate(ticket, "建议根据皮肤状态决定，短期内优先做好保湿和防晒。");
    state.feedbackCandidates.push(candidate);
    await store.save(state);

    state = await store.load();
    const storedCandidate = state.feedbackCandidates[0];
    assert.equal(publishCandidate(state, storedCandidate).ok, false);
    assert.equal(reviewCandidate(storedCandidate, { decision: "approve", reviewerId: "reviewer_001" }).ok, true);
    assert.equal(evaluateCandidate(storedCandidate, { result: "pass" }).ok, true);
    const published = publishCandidate(state, storedCandidate);
    assert.equal(published.ok, true);
    await store.save(state);

    const answer = await orchestrator.processFakeWeChatMessage({
      msgid: "msg_publish_002",
      open_kfid: "wk_test_001",
      external_userid: "wm_test_004",
      text: { content: "护理后可以化妆吗？" },
    });
    assert.equal(answer.decision, "answer");
    assert.match(answer.outbound.content, /建议根据皮肤状态决定/);
    const finalState = await store.load();
    assert.equal(finalState.decisionLogs.at(-1).factual_answer, "建议根据皮肤状态决定，短期内优先做好保湿和防晒。");
    assert.match(finalState.decisionLogs.at(-1).final_reply, /亲/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("material distillation creates review-only pending LLM Wiki candidates", () => {
  const created = createMaterial({
    title: "补水护理材料",
    body: "补水护理适合皮肤干燥、起皮、妆前卡粉的人群。如果顾客有明显刺痛、泛红，建议先让美容师看一下。护理后当天注意保湿和防晒，避免刷酸和强清洁。",
  });
  assert.equal(created.ok, true);
  const distilled = distillMaterial(created.material);
  assert.equal(distilled.ok, true);
  assert.equal(distilled.distillation.distiller, "local_rule_distiller");
  assert.ok(distilled.distillation.source_material.path.startsWith("wiki/sources/"));
  assert.ok(distilled.distillation.source_material.sections.length >= 2);
  assert.match(distilled.distillation.source_material.sections[0].source_ref, /wiki\/sources\/.+#/);
  assert.ok(distilled.distillation.faq_candidates.length >= 1);
  assert.equal(distilled.distillation.faq_candidates[0].governance_target, "pending_llm_wiki");
  assert.equal(distilled.distillation.faq_candidates[0].review_status, "review");
  assert.equal(distilled.distillation.faq_candidates[0].publication_decision.publication_decision, "block");
  assert.match(distilled.distillation.faq_candidates[0].source_refs[0], /wiki\/sources\/.+#/);
  assert.ok(distilled.distillation.faq_candidates[0].source_excerpt);
  assert.equal(distilled.distillation.faq_candidates[0].confidence_basis, "local_rule_source_match");
  assert.ok(distilled.distillation.risk_findings.some((item) => item.label === "sensitive_skin" && item.severity === "medium" && item.evidence && item.source_ref));
});

test("material distillation endpoint reuses current material version by default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bcs-test-"));
  const server = (await import("node:http")).createServer((await import("../src/app.js")).createApp({ dataFile: join(dir, "store.json") }));
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const postJson = async (path, body) => {
      const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      assert.equal(response.ok, true);
      return response.json();
    };

    const created = await postJson("/materials", { title: "补水护理材料", body: "补水护理适合干皮。护理后注意保湿和防晒。" });
    const first = await postJson(`/materials/${created.material.id}/distill`, {});
    const second = await postJson(`/materials/${created.material.id}/distill`, {});
    const forced = await postJson(`/materials/${created.material.id}/distill`, { force: true });
    assert.equal(second.reused, true);
    assert.equal(second.distillation.id, first.distillation.id);
    assert.equal(forced.reused, undefined);

    const candidates = await fetch(`${baseUrl}/knowledge/feedback-candidates`).then((response) => response.json());
    const uniqueIds = new Set(candidates.candidates.map((item) => item.id));
    assert.equal(candidates.candidates.length, uniqueIds.size);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("material batch import creates local blocks and pending candidates", () => {
  const created = createMaterialBatch({
    title: "补水护理资料包",
    assets: [{ filename: "补水护理.md", mime_type: "text/markdown", content: "# 补水护理\n\n补水护理适合干皮、起皮和妆前卡粉。\n\n护理后注意保湿和防晒，避免刷酸。" }],
  });
  assert.equal(created.ok, true);
  const blocks = createLocalBlocksForBatch(created.batch, created.assets);
  assert.ok(blocks.length >= 2);
  assert.match(blocks[0].source_ref, /^asset:\/\//);
  const distilled = distillMaterialBatch(created.batch, blocks);
  assert.equal(distilled.ok, true);
  assert.equal(distilled.distillation.batch_id, created.batch.id);
  assert.equal(distilled.distillation.source, "local_blocks");
  assert.ok(distilled.distillation.faq_candidates.length >= 1);
  assert.equal(distilled.distillation.faq_candidates[0].governance_target, "pending_llm_wiki");
  assert.match(distilled.distillation.faq_candidates[0].source_refs[0], /^asset:\/\//);
  assert.equal(distilled.distillation.faq_candidates[0].publication_decision.publication_decision, "block");
});

test("material batch API imports and distills extracted markdown", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bcs-test-"));
  const server = (await import("node:http")).createServer((await import("../src/app.js")).createApp({ dataFile: join(dir, "store.json") }));
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const postJson = async (path, body) => {
      const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      assert.equal(response.ok, true);
      return response.json();
    };

    const imported = await postJson("/materials/import", {
      title: "补水护理资料包",
      assets: [{ filename: "补水护理.md", mime_type: "text/markdown", content: "补水护理适合干皮。护理后注意保湿和防晒。" }],
    });
    assert.equal(imported.blocks.length >= 1, true);
    const distilled = await postJson(`/materials/batches/${imported.batch.id}/distill`, {});
    assert.equal(distilled.distillation.source, "local_blocks");
    const artifacts = await fetch(`${baseUrl}/knowledge/artifacts`).then((response) => response.json());
    const candidate = artifacts.artifacts.find((item) => item.batch_id === imported.batch.id || item.source_refs?.[0]?.startsWith("asset://"));
    assert.ok(candidate);
    assert.equal(candidate.governance_target, "pending_llm_wiki");
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("material import accepts multipart files and records binary assets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bcs-test-"));
  const server = (await import("node:http")).createServer((await import("../src/app.js")).createApp({ dataFile: join(dir, "store.json") }));
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const form = new FormData();
    form.append("title", "文件材料包");
    form.append("files", new Blob(["补水护理适合干皮。"], { type: "text/markdown" }), "material.md");
    form.append("files", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "material.docx");
    const response = await fetch(`${baseUrl}/materials/import`, { method: "POST", body: form });
    assert.equal(response.ok, true);
    const imported = await response.json();
    assert.equal(imported.assets.length, 2);
    assert.equal(imported.assets.find((asset) => asset.filename === "material.docx").extraction_status, "uploaded_binary");
    assert.ok(imported.blocks.some((block) => block.source_ref.startsWith("asset://")));
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("RAGFlow decision takes precedence over local published fallback when enabled", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bcs-test-"));
  try {
    const store = new JsonStore(join(dir, "store.json"));
    await store.save({
      conversations: [],
      events: [],
      outbox: [],
      handoffTickets: [],
      feedbackCandidates: [],
      decisionLogs: [],
      materials: [],
      distillations: [],
      replyPolicy: null,
      publishedKnowledge: [{
        id: "published_local_001",
        question: "本地答案问题",
        answer: "本地 fallback 答案",
        source_refs: ["local_source"],
        match: ["本地答案问题"],
        confidence: 0.9,
      }],
    });
    const knowledgeService = {
      config: { autoAnswerConfidence: 0.3 },
      async answer() {
        return {
          decision: "answer",
          support_status: "supported",
          confidence: 0.8,
          answer_text: "RAGFlow 生产答案",
          source_refs: ["ragflow_doc"],
          handoff_reason: null,
        };
      },
    };
    const orchestrator = new AnswerOrchestrator({ store, knowledgeService });
    const result = await orchestrator.processFakeWeChatMessage({
      msgid: "msg_rag_first_001",
      open_kfid: "wk_test_001",
      external_userid: "wm_rag_first",
      text: { content: "本地答案问题" },
    });
    assert.equal(result.decision, "answer");
    assert.match(result.outbound.content, /RAGFlow 生产答案/);
    assert.doesNotMatch(result.outbound.content, /本地 fallback 答案/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("handoff records traceable reason and confidence threshold", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bcs-test-"));
  try {
    const store = new JsonStore(join(dir, "store.json"));
    const knowledgeService = {
      config: { autoAnswerConfidence: 0.72 },
      async answer() {
        return {
          decision: "answer",
          support_status: "supported",
          confidence: 0.33,
          answer_text: "低置信答案",
          source_refs: ["doc_001"],
          handoff_reason: null,
        };
      },
    };
    const orchestrator = new AnswerOrchestrator({ store, knowledgeService });
    const result = await orchestrator.processFakeWeChatMessage({
      msgid: "msg_trace_001",
      open_kfid: "wk_test_001",
      external_userid: "wm_test_trace",
      text: { content: "这个问题需要追踪吗？" },
    });

    assert.equal(result.decision, "handoff");
    assert.equal(result.ticket.reason, "low_confidence");
    assert.equal(result.ticket.operator_payload.confidence, 0.33);
    assert.equal(result.ticket.operator_payload.auto_answer_threshold, 0.72);
    const state = await store.load();
    assert.equal(state.decisionLogs.length, 1);
    assert.equal(state.decisionLogs[0].handoff_reason, "low_confidence");
    assert.equal(state.decisionLogs[0].source_refs[0], "doc_001");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("knowledge sync records idempotent jobs and skips duplicate uploads", async () => {
  const candidateMarkdown = [
    "---",
    "type: faq_candidate",
    "review_status: approved",
    "evaluation_status: pass",
    "question: \"补水护理适合干皮吗？\"",
    "sources:",
    "  - wiki/sources/source-001.md",
    "---",
    "Answer: 适合干燥和起皮人群，需结合当日皮肤状态。",
  ].join("\n");
  const reads = new Map([
    ["wiki/queries/candidate.md", candidateMarkdown],
    ["wiki/sources/source-001.md", "补水护理适合干燥、起皮和妆前卡粉的人群。"],
  ]);
  const ragflowCalls = { uploads: 0, parses: 0 };
  const service = new KnowledgeSyncService({
    llmWikiClient: {
      configured: true,
      async readFile(path) {
        return reads.get(path);
      },
    },
    ragflowClient: {
      configured: true,
      async uploadDocument() {
        ragflowCalls.uploads += 1;
        return "doc_001";
      },
      async parseDocument() {
        ragflowCalls.parses += 1;
      },
    },
  });
  const state = { knowledgeSyncJobs: [] };

  const first = await service.syncApprovedCandidate({ candidatePath: "wiki/queries/candidate.md", datasetId: "dataset_001", state });
  const duplicate = await service.syncApprovedCandidate({ candidatePath: "wiki/queries/candidate.md", datasetId: "dataset_001", state });

  assert.equal(first.ok, true);
  assert.equal(first.status, "sync_started");
  assert.equal(duplicate.status, "skipped_duplicate");
  assert.equal(ragflowCalls.uploads, 1);
  assert.equal(ragflowCalls.parses, 1);
  assert.equal(state.knowledgeSyncJobs.length, 1);
  assert.equal(state.knowledgeSyncJobs[0].document_id, "doc_001");
  assert.equal(state.knowledgeSyncJobs[0].source_refs[0], "wiki/sources/source-001.md");
});

test("knowledge answer loop records synced answer verification", async () => {
  const candidateMarkdown = [
    "---",
    "type: faq_candidate",
    "review_status: approved",
    "evaluation_status: pass",
    "question: \"补水护理适合干皮吗？\"",
    "sources:",
    "  - wiki/sources/source-001.md",
    "---",
    "Answer: 适合干燥和起皮人群，需结合当日皮肤状态。",
  ].join("\n");
  const reads = new Map([
    ["wiki/approved-answers/candidate.md", candidateMarkdown],
    ["wiki/sources/source-001.md", "补水护理适合干燥、起皮和妆前卡粉的人群。"],
  ]);
  const knowledgeSyncService = new KnowledgeSyncService({
    llmWikiClient: {
      configured: true,
      async readFile(path) {
        return reads.get(path);
      },
    },
    ragflowClient: {
      configured: true,
      async uploadDocument() {
        return "doc_answer_loop_001";
      },
      async parseDocument() {},
    },
  });
  const service = new KnowledgeAnswerLoopService({
    llmWikiClient: {
      async readFile(path) {
        return reads.get(path);
      },
    },
    knowledgeSyncService,
    knowledgeService: {
      async answer() {
        return { decision: "answer", answer_text: "适合干燥和起皮人群，需结合当日皮肤状态。", source_refs: ["doc_answer_loop_001"] };
      },
    },
  });
  const state = { knowledgeSyncJobs: [], knowledgeAnswerChecks: [] };

  const result = await service.syncAndVerify({ candidatePath: "wiki/approved-answers/candidate.md", datasetId: "dataset_001", expectedAnswer: "适合干燥", state });

  assert.equal(result.ok, true);
  assert.equal(result.status, "answer_changed");
  assert.equal(state.knowledgeAnswerChecks.length, 1);
  assert.equal(state.knowledgeAnswerChecks[0].document_id, "doc_answer_loop_001");
  assert.equal(state.knowledgeAnswerChecks[0].answer_check_status, "answer_changed");
  assert.equal(state.knowledgeDocuments[0].document_id, "doc_answer_loop_001");
  assert.equal(state.knowledgeDocuments[0].lifecycle_status, "active");
});

test("knowledge document registry supersedes old document for the same source path", () => {
  const state = { knowledgeDocuments: [] };
  const first = upsertActiveKnowledgeDocument(state, { sourcePath: "wiki/approved-answers/candidate.md", sourceHash: "hash_1", datasetId: "dataset_001", documentId: "doc_old" });
  const second = upsertActiveKnowledgeDocument(state, { sourcePath: "wiki/approved-answers/candidate.md", sourceHash: "hash_2", datasetId: "dataset_001", documentId: "doc_new" });

  assert.equal(first.lifecycle_status, "superseded");
  assert.equal(first.superseded_by, "doc_new");
  assert.equal(second.lifecycle_status, "active");
});

test("RAGFlow retrieval filters inactive registered documents", async () => {
  const service = new RagflowKnowledgeService({ ragflowBaseUrl: "http://ragflow.test", ragflowApiKey: "token", ragflowDatasetIds: ["dataset_001"], ragflowDatasetNames: [], useRagflow: true, enableLocalTestKnowledge: false });
  service.ragflowClient = {
    async resolveDatasetIds() {
      return { ok: true, datasetIds: ["dataset_001"] };
    },
    async retrieve() {
      return { ok: true, chunks: [{ document_id: "doc_inactive", content: "Answer: 旧答案", similarity: 0.9 }] };
    },
  };
  const state = { knowledgeDocuments: [] };
  upsertActiveKnowledgeDocument(state, { sourcePath: "wiki/approved-answers/candidate.md", sourceHash: "hash_1", datasetId: "dataset_001", documentId: "doc_inactive" });
  withdrawKnowledgeDocument(state, { documentId: "doc_inactive", reason: "rejected" });

  const result = await service.answer("补水护理适合干皮吗？", state);

  assert.equal(result.decision, "handoff");
  assert.equal(result.handoff_reason, "low_confidence");
});

test("answer loop withdraw endpoint marks registered document inactive", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bcs-test-"));
  const server = (await import("node:http")).createServer((await import("../src/app.js")).createApp({ dataFile: join(dir, "store.json") }));
  try {
    const store = new JsonStore(join(dir, "store.json"));
    const state = await store.load();
    upsertActiveKnowledgeDocument(state, { sourcePath: "wiki/approved-answers/candidate.md", sourceHash: "hash_1", datasetId: "dataset_001", documentId: "doc_001" });
    await store.save(state);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/knowledge/answer-loop/withdraw`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document_id: "doc_001", reason: "rejected" }) });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "withdrawn");

    const docs = await fetch(`${baseUrl}/knowledge/documents`).then((item) => item.json());
    assert.equal(docs.documents[0].lifecycle_status, "inactive");
    assert.equal(docs.documents[0].answer_status, "withdrawn");
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("knowledge scan classifies added modified deleted downgraded unchanged and blocked findings", async () => {
  const approvedOld = [
    "---",
    "type: faq_candidate",
    "review_status: approved",
    "evaluation_status: pass",
    "question: \"旧问题？\"",
    "sources:",
    "  - wiki/sources/source.md",
    "---",
    "Answer: 旧答案",
  ].join("\n");
  const approvedNew = approvedOld.replace("旧答案", "新答案");
  const downgraded = approvedOld.replace("review_status: approved", "review_status: rejected");
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const reads = new Map([
    ["wiki/approved-answers/added.md", approvedNew],
    ["wiki/approved-answers/modified.md", approvedNew],
    ["wiki/approved-answers/downgraded.md", downgraded],
    ["wiki/approved-answers/unchanged.md", approvedOld],
  ]);
  const state = { knowledgeDocuments: [], knowledgeScanRuns: [] };
  upsertActiveKnowledgeDocument(state, { sourcePath: "wiki/approved-answers/modified.md", sourceHash: hash(approvedOld), datasetId: "dataset_001", documentId: "doc_modified" });
  upsertActiveKnowledgeDocument(state, { sourcePath: "wiki/approved-answers/deleted.md", sourceHash: hash(approvedOld), datasetId: "dataset_001", documentId: "doc_deleted" });
  upsertActiveKnowledgeDocument(state, { sourcePath: "wiki/approved-answers/downgraded.md", sourceHash: hash(approvedOld), datasetId: "dataset_001", documentId: "doc_downgraded" });
  upsertActiveKnowledgeDocument(state, { sourcePath: "wiki/approved-answers/unchanged.md", sourceHash: hash(approvedOld), datasetId: "dataset_001", documentId: "doc_unchanged" });
  const service = new KnowledgeScanService({
    llmWikiClient: {
      async listMarkdownFiles() {
        return [
          "wiki/approved-answers/added.md",
          "wiki/approved-answers/modified.md",
          "wiki/approved-answers/downgraded.md",
          "wiki/approved-answers/unchanged.md",
          "wiki/approved-answers/blocked.md",
        ];
      },
      async readFile(path) {
        if (path.endsWith("blocked.md")) throw new Error("read_failed");
        return reads.get(path);
      },
    },
  });

  const result = await service.scanApproved({ scanRoot: "wiki/approved-answers", state });

  assert.equal(result.ok, true);
  assert.equal(result.run.added, 1);
  assert.equal(result.run.modified, 1);
  assert.equal(result.run.deleted, 1);
  assert.equal(result.run.downgraded, 1);
  assert.equal(result.run.unchanged, 1);
  assert.equal(result.run.blocked, 1);
  assert.equal(state.knowledgeDocuments.find((item) => item.document_id === "doc_deleted").lifecycle_status, "inactive");
  assert.equal(state.knowledgeDocuments.find((item) => item.document_id === "doc_downgraded").lifecycle_status, "inactive");
});

test("knowledge scan auto syncs added and modified findings only", async () => {
  const approvedOld = [
    "---",
    "type: faq_candidate",
    "review_status: approved",
    "evaluation_status: pass",
    "question: \"旧问题？\"",
    "sources:",
    "  - wiki/sources/source.md",
    "---",
    "Answer: 旧答案",
  ].join("\n");
  const approvedNew = approvedOld.replace("旧答案", "新答案");
  const downgraded = approvedOld.replace("review_status: approved", "review_status: rejected");
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const reads = new Map([
    ["wiki/approved-answers/added.md", approvedNew],
    ["wiki/approved-answers/modified.md", approvedNew],
    ["wiki/approved-answers/downgraded.md", downgraded],
    ["wiki/approved-answers/unchanged.md", approvedOld],
  ]);
  const state = { knowledgeDocuments: [], knowledgeScanRuns: [], knowledgeAnswerChecks: [] };
  upsertActiveKnowledgeDocument(state, { sourcePath: "wiki/approved-answers/modified.md", sourceHash: hash(approvedOld), datasetId: "dataset_001", documentId: "doc_modified" });
  upsertActiveKnowledgeDocument(state, { sourcePath: "wiki/approved-answers/downgraded.md", sourceHash: hash(approvedOld), datasetId: "dataset_001", documentId: "doc_downgraded" });
  upsertActiveKnowledgeDocument(state, { sourcePath: "wiki/approved-answers/unchanged.md", sourceHash: hash(approvedOld), datasetId: "dataset_001", documentId: "doc_unchanged" });
  const synced = [];
  const service = new KnowledgeScanService({
    llmWikiClient: {
      async listMarkdownFiles() {
        return ["wiki/approved-answers/added.md", "wiki/approved-answers/modified.md", "wiki/approved-answers/downgraded.md", "wiki/approved-answers/unchanged.md"];
      },
      async readFile(path) {
        return reads.get(path);
      },
    },
    knowledgeAnswerLoopService: {
      async syncAndVerify({ candidatePath }) {
        synced.push(candidatePath);
        return { ok: true, status: "answer_changed" };
      },
    },
  });

  const result = await service.scanApproved({ scanRoot: "wiki/approved-answers", autoSync: true, state });

  assert.equal(result.ok, true);
  assert.deepEqual(synced.sort(), ["wiki/approved-answers/added.md", "wiki/approved-answers/modified.md"]);
  assert.equal(state.knowledgeDocuments.find((item) => item.document_id === "doc_downgraded").lifecycle_status, "inactive");
});

test("knowledge scan creates alert for blocked findings and can acknowledge it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bcs-test-"));
  const server = (await import("node:http")).createServer((await import("../src/app.js")).createApp({ dataFile: join(dir, "store.json"), llmWikiBaseUrl: "http://llm-wiki.test" }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/api/v1/projects")) {
      return new Response(JSON.stringify({ ok: true, currentProject: { id: "project_001", path: join(dir, "missing-project") } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(url, options);
  };
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/knowledge/answer-loop/scan-approved`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scan_root: "wiki/approved-answers" }) });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.run.status, "failed");

    const alerts = await fetch(`${baseUrl}/knowledge/alerts`).then((item) => item.json());
    assert.equal(alerts.alerts.length, 1);
    assert.equal(alerts.alerts[0].status, "open");

    const ack = await fetch(`${baseUrl}/knowledge/alerts/${alerts.alerts[0].id}/acknowledge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actor: "operator_001" }) }).then((item) => item.json());
    assert.equal(ack.ok, true);
    assert.equal(ack.alert.status, "acknowledged");
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("scan-approved endpoint records scan run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bcs-test-"));
  const projectDir = join(dir, "llm-wiki-project");
  await (await import("node:fs/promises")).mkdir(join(projectDir, "wiki", "approved-answers"), { recursive: true });
  await (await import("node:fs/promises")).writeFile(join(projectDir, "wiki", "approved-answers", "candidate.md"), [
    "---",
    "type: faq_candidate",
    "review_status: approved",
    "evaluation_status: pass",
    "question: \"补水护理适合干皮吗？\"",
    "sources:",
    "  - wiki/sources/source.md",
    "---",
    "Answer: 适合干燥和起皮人群。",
  ].join("\n"), "utf8");
  const server = (await import("node:http")).createServer((await import("../src/app.js")).createApp({ dataFile: join(dir, "store.json"), llmWikiBaseUrl: "http://llm-wiki.test" }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/api/v1/projects")) {
      return new Response(JSON.stringify({ ok: true, currentProject: { id: "project_001", path: projectDir } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).includes("/api/v1/projects/current/files/content")) {
      const path = decodeURIComponent(String(url).split("path=")[1]);
      const content = await (await import("node:fs/promises")).readFile(join(projectDir, path), "utf8");
      return new Response(JSON.stringify({ ok: true, content }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(url, options);
  };
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/knowledge/answer-loop/scan-approved`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scan_root: "wiki/approved-answers" }) });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.run.added, 1);

    const runs = await fetch(`${baseUrl}/knowledge/answer-loop/scan-runs`).then((item) => item.json());
    assert.equal(runs.runs.length, 1);
    assert.equal(runs.runs[0].findings[0].change_type, "added");
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("RagflowClient deleteDocument sends dataset document delete request", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method, body: options.body });
    return new Response(JSON.stringify({ code: 0, data: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const client = new RagflowClient({ baseUrl: "http://ragflow.test", apiKey: "token" });
    await client.deleteDocument("dataset_001", "doc_001");

    assert.equal(calls[0].url, "http://ragflow.test/api/v1/datasets/dataset_001/documents");
    assert.equal(calls[0].method, "DELETE");
    assert.deepEqual(JSON.parse(calls[0].body), { ids: ["doc_001"] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RAGFlow lifecycle probe records supported delete and retrieval clearing", async () => {
  const state = { ragflowLifecycleChecks: [] };
  const calls = [];
  const service = new RagflowLifecycleProbeService({
    ragflowClient: {
      configured: true,
      async createDataset(name) {
        calls.push(["createDataset", name]);
        return "dataset_probe_001";
      },
      async uploadDocument(datasetId) {
        calls.push(["uploadDocument", datasetId]);
        return "doc_probe_001";
      },
      async parseDocument(datasetId, documentId) {
        calls.push(["parseDocument", datasetId, documentId]);
      },
      async deleteDocument(datasetId, documentId) {
        calls.push(["deleteDocument", datasetId, documentId]);
      },
      async getDocument() {
        return null;
      },
      async retrieve() {
        return { ok: true, chunks: [] };
      },
    },
  });

  const result = await service.probeDocumentLifecycle({ datasetName: "probe_dataset", question: "probe question", state });

  assert.equal(result.ok, true);
  assert.equal(result.status, "lifecycle_supported");
  assert.equal(state.ragflowLifecycleChecks.length, 1);
  assert.equal(state.ragflowLifecycleChecks[0].delete_supported, true);
  assert.equal(calls.at(-1)[0], "deleteDocument");
});

test("RAGFlow lifecycle probe records blocked when client is unconfigured", async () => {
  const state = { ragflowLifecycleChecks: [] };
  const service = new RagflowLifecycleProbeService({ ragflowClient: { configured: false } });

  const result = await service.probeDocumentLifecycle({ datasetName: "probe_dataset", state });

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.check.failure_reason, "missing_ragflow_api_key");
  assert.equal(state.ragflowLifecycleChecks.length, 1);
});

test("answer loop endpoint records blocked check when dataset is unresolved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bcs-test-"));
  const server = (await import("node:http")).createServer((await import("../src/app.js")).createApp({
    dataFile: join(dir, "store.json"),
    ragflowBaseUrl: "http://ragflow.test",
    ragflowApiKey: "token",
    ragflowDatasetNames: ["missing-dataset"],
    llmWikiCandidatePath: "wiki/approved-answers/candidate.md",
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/api/v1/datasets")) {
      return new Response(JSON.stringify({ code: 0, data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(url, options);
  };
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/knowledge/answer-loop/sync-and-verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "补水护理适合干皮吗？" }) });
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.status, "sync_blocked");
    assert.equal(body.check.failure_reason, "ragflow_dataset_names_not_found");

    const checks = await fetch(`${baseUrl}/knowledge/answer-loop/checks`).then((item) => item.json());
    assert.equal(checks.checks.length, 1);
    assert.equal(checks.checks[0].answer_check_status, "sync_blocked");
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("knowledge lifecycle writes distillation artifacts and refreshes candidate state from LLM Wiki", async () => {
  const material = createMaterial({ title: "补水护理材料", body: "补水护理适合干皮。护理后注意保湿和防晒。" }).material;
  const distillation = distillMaterial(material).distillation;
  const written = new Map();
  const service = new KnowledgeLifecycleService({
    llmWikiClient: {
      configured: true,
      async writeFile(path, content) {
        written.set(path, content);
        return { ok: true, path };
      },
      async readFile(path) {
        return written.get(path)
          .replace("review_status: review", "review_status: approved")
          .replace("evaluation_status: pending", "evaluation_status: pass");
      },
    },
  });

  const published = await service.publishDistillationToLlmWiki(distillation);
  assert.equal(published.ok, true);
  assert.ok(written.has(distillation.source_material.path));
  assert.equal(distillation.faq_candidates[0].governance_target, "llm_wiki");
  assert.equal(distillation.faq_candidates[0].llm_wiki_artifact.status, "written");

  const refreshed = await service.refreshCandidateFromLlmWiki(distillation.faq_candidates[0]);
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.candidate.review_status, "approved");
  assert.equal(refreshed.candidate.evaluation_status, "pass");
  assert.equal(refreshed.candidate.publication_decision.publication_decision, "publish");
});

test("knowledge lifecycle writes a human feedback candidate to LLM Wiki", async () => {
  const ticket = {
    id: "ticket_001",
    conversation_id: "conv_001",
    reason: "low_confidence",
    payload_ref: "payload_001",
    operator_payload: {
      original_user_message: "护理后可以化妆吗？",
      source_refs: ["conversation/conv_001", "payload_001"],
    },
  };
  const candidate = createFeedbackCandidate(ticket, "建议先做好保湿和防晒，再根据皮肤状态决定。");
  const written = new Map();
  const service = new KnowledgeLifecycleService({
    llmWikiClient: {
      configured: true,
      async writeFile(path, content) {
        written.set(path, content);
        return { ok: true, path };
      },
    },
  });

  const result = await service.publishCandidateToLlmWiki(candidate);
  assert.equal(result.ok, true);
  assert.equal(candidate.governance_target, "llm_wiki");
  assert.equal(candidate.llm_wiki_artifact.status, "written");
  assert.ok(written.get(candidate.llm_wiki_artifact.path).includes("type: faq_candidate"));
  assert.ok(written.get(candidate.llm_wiki_artifact.path).includes("sources:"));
});

test("LLM Wiki client falls back to project file write and rescan when HTTP write is not allowed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "llm-wiki-project-"));
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    if (String(url).endsWith("/api/v1/projects/current/files/content") && options.method === "PUT") {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).endsWith("/api/v1/projects")) {
      return new Response(JSON.stringify({ ok: true, currentProject: { id: "project_001", path: dir } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).endsWith("/api/v1/projects/current/sources/rescan") && options.method === "POST") {
      return new Response(JSON.stringify({ ok: true, projectId: "project_001" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: false, error: "unexpected" }), { status: 500, headers: { "Content-Type": "application/json" } });
  };
  try {
    const client = new LlmWikiClient({ baseUrl: "http://llm-wiki.test", token: "token" });
    const result = await client.writeFile("wiki/review/probe.md", "# probe");
    assert.equal(result.method, "project_file_rescan");
    assert.equal(await readFile(join(dir, "wiki", "review", "probe.md"), "utf8"), "# probe");
    assert.equal(calls.at(-1).url, "http://llm-wiki.test/api/v1/projects/current/sources/rescan");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("LLM Wiki client fallback rejects paths outside current project", async () => {
  const dir = await mkdtemp(join(tmpdir(), "llm-wiki-project-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/api/v1/projects/current/files/content") && options.method === "PUT") {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).endsWith("/api/v1/projects")) {
      return new Response(JSON.stringify({ ok: true, currentProject: { id: "project_001", path: dir } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const client = new LlmWikiClient({ baseUrl: "http://llm-wiki.test", token: "token" });
    await assert.rejects(() => client.writeFile("../escape.md", "# bad"), /llm_wiki_path_escapes_project/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("feedback candidate publish-to-llm-wiki endpoint updates local artifact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bcs-test-"));
  const writes = new Map();
  const server = (await import("node:http")).createServer((await import("../src/app.js")).createApp({
    dataFile: join(dir, "store.json"),
    llmWikiBaseUrl: "http://llm-wiki.test",
    llmWikiApiToken: "token",
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("/api/v1/projects/current/files/content") && options.method === "PUT") {
      const body = JSON.parse(options.body);
      writes.set(body.path, body.content);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(url, options);
  };
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const postJson = async (path, body) => {
      const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      assert.equal(response.ok, true);
      return response.json();
    };

    const handoff = await postJson("/dev/fake-wechat/messages", { msgid: "msg_llm_wiki_001", open_kfid: "wk_test_001", external_userid: "wm_llm_wiki", text: { content: "护理后可以化妆吗？" } });
    await postJson(`/handoff/tickets/${handoff.result.ticket.id}/claim`, { operator_id: "operator_001", expected_version: 0 });
    const resolved = await postJson(`/handoff/tickets/${handoff.result.ticket.id}/resolve`, { operator_id: "operator_001", answer_text: "建议先做好保湿和防晒，再根据皮肤状态决定。" });
    const published = await postJson(`/knowledge/feedback-candidates/${resolved.candidate.id}/publish-to-llm-wiki`, {});

    assert.equal(published.status, "written");
    assert.equal(published.candidate.governance_target, "llm_wiki");
    assert.ok(writes.has(published.artifact.path));
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
