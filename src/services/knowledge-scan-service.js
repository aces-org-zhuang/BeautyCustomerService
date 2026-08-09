import { createHash } from "node:crypto";
import { hashId, nowIso } from "../domain/ids.js";
import { parseFrontmatter } from "./knowledge-sync-service.js";
import { withdrawKnowledgeDocument } from "./knowledge-document-registry.js";
import { createKnowledgeAlert } from "./knowledge-alert-service.js";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gateStatus(markdown) {
  const parsed = parseFrontmatter(markdown);
  const data = parsed.data;
  if (data.type !== "faq_candidate") return { ok: false, reason: "type_not_faq_candidate", data };
  if (data.review_status !== "approved") return { ok: false, reason: "review_not_approved", data };
  if (!["pass", "passed"].includes(data.evaluation_status)) return { ok: false, reason: "evaluation_not_passed", data };
  if (!Array.isArray(data.sources) || data.sources.length === 0) return { ok: false, reason: "missing_sources", data };
  return { ok: true, reason: "gate_passed", data };
}

function countFindings(findings, type) {
  return findings.filter((item) => item.change_type === type).length;
}

export class KnowledgeScanService {
  constructor({ llmWikiClient, knowledgeAnswerLoopService = null }) {
    this.llmWikiClient = llmWikiClient;
    this.knowledgeAnswerLoopService = knowledgeAnswerLoopService;
  }

  async scanApproved({ scanRoot = "wiki/approved-answers", autoSync = false, autoWithdraw = true, state }) {
    if (!state) throw new Error("state is required");
    if (!state.knowledgeScanRuns) state.knowledgeScanRuns = [];
    if (!state.knowledgeDocuments) state.knowledgeDocuments = [];
    const startedAt = nowIso();
    const findings = [];
    const run = {
      id: hashId("scan_run", `${scanRoot}:${startedAt}`),
      scan_root: scanRoot,
      status: "started",
      added: 0,
      modified: 0,
      deleted: 0,
      downgraded: 0,
      unchanged: 0,
      blocked: 0,
      findings,
      failure_reason: null,
      created_at: startedAt,
      updated_at: startedAt,
    };
    state.knowledgeScanRuns.push(run);

    try {
      const paths = await this.llmWikiClient.listMarkdownFiles(scanRoot);
      const seen = new Set(paths);
      for (const path of paths) {
        const finding = await this.classifyPath(path, state);
        findings.push(finding);
        if (autoSync && ["added", "modified"].includes(finding.change_type)) await this.syncFinding(finding, state, findings);
      }
      for (const doc of state.knowledgeDocuments.filter((item) => item.lifecycle_status === "active" && item.source_path.startsWith(scanRoot) && !seen.has(item.source_path))) {
        if (autoWithdraw) withdrawKnowledgeDocument(state, { sourcePath: doc.source_path, reason: "llm_wiki_deleted" });
        findings.push({ source_path: doc.source_path, change_type: "deleted", source_hash: null, previous_hash: doc.source_hash, document_id: doc.document_id, reason: "missing_from_scan_root" });
      }
      this.finishRun(run, "completed");
      this.alertIfNeeded(state, run);
    } catch (error) {
      findings.push({ source_path: scanRoot, change_type: "blocked", reason: error.message });
      this.finishRun(run, "failed", error.message);
      this.alertIfNeeded(state, run);
    }
    return { ok: run.status === "completed", status: run.status, run };
  }

  async syncFinding(finding, state, findings) {
    if (!this.knowledgeAnswerLoopService) {
      finding.sync_status = "blocked";
      finding.reason = "missing_answer_loop_service";
      return;
    }
    const result = await this.knowledgeAnswerLoopService.syncAndVerify({
      candidatePath: finding.source_path,
      question: finding.question,
      expectedAnswer: null,
      waitForParse: false,
      force: finding.change_type === "modified",
      state,
    });
    finding.sync_status = result.status;
    finding.answer_check_id = result.check?.id || null;
    finding.document_id = result.sync?.documentId || finding.document_id || null;
    if (!result.ok) {
      finding.sync_status = "blocked";
      finding.reason = result.reason || result.status;
    }
  }

  async classifyPath(path, state) {
    try {
      const markdown = await this.llmWikiClient.readFile(path);
      const sourceHash = sha256(markdown);
      const gate = gateStatus(markdown);
      const activeDoc = state.knowledgeDocuments.find((item) => item.source_path === path && item.lifecycle_status === "active");
      const previousDoc = activeDoc || state.knowledgeDocuments.find((item) => item.source_path === path);
      const base = { source_path: path, source_hash: sourceHash, previous_hash: previousDoc?.source_hash || null, review_status: gate.data?.review_status || null, evaluation_status: gate.data?.evaluation_status || null, question: gate.data?.question || null, document_id: previousDoc?.document_id || null };
      if (!gate.ok) {
        if (activeDoc) withdrawKnowledgeDocument(state, { sourcePath: path, reason: gate.reason });
        return { ...base, change_type: "downgraded", reason: gate.reason };
      }
      if (!previousDoc) return { ...base, change_type: "added", reason: "new_approved_file" };
      if (previousDoc.source_hash !== sourceHash) return { ...base, change_type: "modified", reason: "hash_changed" };
      return { ...base, change_type: "unchanged", reason: "hash_unchanged" };
    } catch (error) {
      return { source_path: path, change_type: "blocked", reason: error.message };
    }
  }

  finishRun(run, status, failureReason = null) {
    run.status = status;
    run.added = countFindings(run.findings, "added");
    run.modified = countFindings(run.findings, "modified");
    run.deleted = countFindings(run.findings, "deleted");
    run.downgraded = countFindings(run.findings, "downgraded");
    run.unchanged = countFindings(run.findings, "unchanged");
    run.blocked = countFindings(run.findings, "blocked");
    run.failure_reason = failureReason;
    run.updated_at = nowIso();
  }

  alertIfNeeded(state, run) {
    if (run.status !== "failed" && run.blocked === 0) return null;
    return createKnowledgeAlert(state, {
      source: "llm_wiki_scan",
      severity: run.status === "failed" ? "error" : "warning",
      title: run.status === "failed" ? "LLM Wiki 扫描失败" : "LLM Wiki 扫描存在阻断项",
      detail: run.failure_reason || `${run.blocked} 个文件阻断`,
      refId: run.id,
    });
  }
}
