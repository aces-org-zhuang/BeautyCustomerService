import { createHash } from "node:crypto";
import { hashId, nowIso } from "../domain/ids.js";
import { verifyDocumentCleared } from "./ragflow-lifecycle-probe-service.js";

function unquote(value) {
  return value.replace(/^"(.*)"$/, "$1");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isRetryableError(error) {
  const message = String(error?.message || error || "");
  return !message.includes("candidate must") && !message.includes("missing source content") && !message.includes("type must");
}

function scheduleRetry(syncJob, { error, maxAttempts = 3, retryDelayMs = 30000 }) {
  const retryable = isRetryableError(error);
  Object.assign(syncJob, {
    status: retryable && syncJob.attempts < maxAttempts ? "retry_scheduled" : "blocked",
    max_attempts: maxAttempts,
    next_retry_at: retryable && syncJob.attempts < maxAttempts ? new Date(Date.now() + retryDelayMs).toISOString() : null,
    last_error: error.message,
    error_type: retryable ? "retryable" : "non_retryable",
    updated_at: nowIso(),
  });
}

export function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error("candidate must contain YAML frontmatter");
  const [, yaml, body] = match;
  const data = {};
  let currentKey = null;
  for (const rawLine of yaml.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem && currentKey) {
      data[currentKey].push(unquote(listItem[1].trim()));
      continue;
    }
    const pair = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!pair) throw new Error(`unsupported frontmatter line: ${line}`);
    const [, key, value] = pair;
    currentKey = key;
    if (value === "[]" || value === "") data[key] = [];
    else {
      data[key] = unquote(value);
      currentKey = null;
    }
  }
  return { data, body: body.trim() };
}

function candidateToRagflowDocument(markdown, sourceContentsByPath) {
  const { data, body } = parseFrontmatter(markdown);
  if (data.type !== "faq_candidate") throw new Error("type must be faq_candidate");
  if (data.review_status !== "approved") throw new Error("candidate must be approved before RAGFlow sync");
  if (!["pass", "passed"].includes(data.evaluation_status)) throw new Error("candidate must pass evaluation before RAGFlow sync");
  if (!Array.isArray(data.sources) || data.sources.length === 0) throw new Error("candidate must preserve source refs");
  const sourceBlocks = data.sources.map((sourcePath) => {
    const content = sourceContentsByPath.get(sourcePath);
    if (!content) throw new Error(`missing source content for ${sourcePath}`);
    return `Source: ${sourcePath}\n${content.trim()}`;
  });
  return {
    displayName: `${String(data.question || "faq-candidate").slice(0, 40).replace(/[\\/:*?"<>|]/g, "_")}.md`,
    content: [
      body,
      "",
      "Sync metadata:",
      `question: ${data.question || ""}`,
      `source_refs: ${data.sources.join(", ")}`,
      "",
      ...sourceBlocks,
    ].join("\n"),
    sourceRefs: data.sources,
  };
}

export class KnowledgeSyncService {
  constructor({ llmWikiClient, ragflowClient }) {
    this.llmWikiClient = llmWikiClient;
    this.ragflowClient = ragflowClient;
  }

  async syncApprovedCandidate({ candidatePath, datasetId = null, datasetName = `beauty_sync_${Date.now()}`, waitForParse = false, state = null, force = false }) {
    if (!candidatePath) return { ok: false, status: "unconfigured", reason: "missing_llm_wiki_candidate_path" };
    if (!this.llmWikiClient.configured) return { ok: false, status: "unconfigured", reason: "missing_llm_wiki_base_url" };
    if (!this.ragflowClient.configured) return { ok: false, status: "unconfigured", reason: "missing_ragflow_api_key" };

    const candidateMarkdown = await this.llmWikiClient.readFile(candidatePath);
    const candidateHash = sha256(candidateMarkdown);
    const idempotencyKey = `sync:${candidatePath}:${candidateHash}:${datasetId || datasetName}`;
    const jobs = state?.knowledgeSyncJobs || [];
    const existingJob = jobs.find((job) => job.idempotency_key === idempotencyKey && ["started", "parsed"].includes(job.status));
    if (existingJob && !force) return { ok: true, status: "skipped_duplicate", syncJob: existingJob, candidatePath, datasetId: existingJob.dataset_id, documentId: existingJob.document_id, sourceRefs: existingJob.source_refs || [], parseProgress: existingJob.parse_progress || [] };

    const syncJob = {
      id: hashId("sync_job", idempotencyKey),
      idempotency_key: idempotencyKey,
      candidate_path: candidatePath,
      candidate_hash: candidateHash,
      dataset_id: datasetId,
      dataset_name: datasetName,
      document_id: null,
      status: "started",
      operation: "sync",
      attempts: 1,
      max_attempts: 3,
      next_retry_at: null,
      last_error: null,
      error_type: null,
      previous_document_id: null,
      replacement_document_id: null,
      delete_check: null,
      source_refs: [],
      parse_progress: [],
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    if (state) {
      const existingIndex = jobs.findIndex((job) => job.id === syncJob.id);
      if (existingIndex >= 0) {
        syncJob.attempts = (jobs[existingIndex].attempts || 0) + 1;
        syncJob.created_at = jobs[existingIndex].created_at;
        jobs[existingIndex] = syncJob;
      } else jobs.push(syncJob);
      state.knowledgeSyncJobs = jobs;
    }

    const parsedCandidate = parseFrontmatter(candidateMarkdown);
    const sourceRefs = parsedCandidate.data.sources || [];
    const sourceContentsByPath = new Map();
    for (const sourcePath of sourceRefs) sourceContentsByPath.set(sourcePath, await this.llmWikiClient.readFile(sourcePath));
    const document = candidateToRagflowDocument(candidateMarkdown, sourceContentsByPath);
    const parseProgress = [];

    try {
      const targetDatasetId = datasetId || await this.ragflowClient.createDataset(datasetName);
      const documentId = await this.ragflowClient.uploadDocument(targetDatasetId, document);
      await this.ragflowClient.parseDocument(targetDatasetId, documentId);

      if (waitForParse) {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const doc = await this.ragflowClient.getDocument(targetDatasetId, documentId);
          parseProgress.push(doc ? { run: doc.run, progress: doc.progress, progress_msg: doc.progress_msg } : { missingDoc: true });
          if (doc && (String(doc.run) === "1" || String(doc.run).toUpperCase() === "DONE") && Number(doc.progress) >= 1) break;
          if (doc && (String(doc.run) === "2" || String(doc.run).toUpperCase() === "FAIL")) throw new Error(`parse failed: ${doc.progress_msg || "unknown"}`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      Object.assign(syncJob, { dataset_id: targetDatasetId, document_id: documentId, status: parseProgress.some((item) => Number(item.progress) >= 1) ? "parsed" : "started", source_refs: sourceRefs, parse_progress: parseProgress, updated_at: nowIso() });
      return { ok: true, status: syncJob.status === "parsed" ? "sync_parsed" : "sync_started", candidatePath, datasetId: targetDatasetId, documentId, sourceRefs, parseProgress, syncJob };
    } catch (error) {
      Object.assign(syncJob, { status: "failed", source_refs: sourceRefs, parse_progress: parseProgress });
      scheduleRetry(syncJob, { error });
      throw error;
    }
  }

  async retrySyncJob({ jobId, state, waitForParse = false, force = true }) {
    if (!state) throw new Error("state is required");
    const job = (state.knowledgeSyncJobs || []).find((item) => item.id === jobId);
    if (!job) return { ok: false, status: "not_found", reason: "sync_job_not_found" };
    if (job.status === "blocked") return { ok: false, status: "blocked", reason: job.last_error || "sync_job_blocked", syncJob: job };
    job.status = "retrying";
    job.updated_at = nowIso();
    try {
      return await this.syncApprovedCandidate({
        candidatePath: job.candidate_path,
        datasetId: job.dataset_id,
        datasetName: job.dataset_name,
        waitForParse,
        state,
        force,
      });
    } catch (error) {
      return { ok: false, status: "failed", reason: error.message, syncJob: job };
    }
  }

  async retryDueJobs({ state, now = new Date(), limit = 10, waitForParse = false }) {
    if (!state) throw new Error("state is required");
    const due = (state.knowledgeSyncJobs || [])
      .filter((job) => job.status === "retry_scheduled" && job.next_retry_at && new Date(job.next_retry_at) <= new Date(now))
      .slice(0, limit);
    const results = [];
    for (const job of due) results.push(await this.retrySyncJob({ jobId: job.id, state, waitForParse }));
    return { ok: true, retried: results.filter((item) => item.ok).length, blocked: results.filter((item) => !item.ok).length, jobs: results };
  }

  async replaceApprovedCandidate({ candidatePath, datasetId = null, datasetName = `beauty_sync_${Date.now()}`, previousDocument, waitForParse = false, state = null, force = true, verifyQuestion = null }) {
    if (!previousDocument?.document_id || !previousDocument?.dataset_id) {
      return this.syncApprovedCandidate({ candidatePath, datasetId, datasetName, waitForParse, state, force });
    }
    if (!this.ragflowClient.configured) return { ok: false, status: "unconfigured", reason: "missing_ragflow_api_key" };
    const startedAt = nowIso();
    const job = {
      id: hashId("sync_job", `replace:${candidatePath}:${previousDocument.document_id}:${startedAt}`),
      idempotency_key: `replace:${candidatePath}:${previousDocument.document_id}:${startedAt}`,
      candidate_path: candidatePath,
      candidate_hash: null,
      dataset_id: datasetId || previousDocument.dataset_id,
      dataset_name: datasetName,
      document_id: null,
      status: "deleting_old",
      operation: "replace",
      attempts: 1,
      max_attempts: 3,
      next_retry_at: null,
      last_error: null,
      error_type: null,
      previous_document_id: previousDocument.document_id,
      replacement_document_id: null,
      delete_check: null,
      source_refs: [],
      parse_progress: [],
      created_at: startedAt,
      updated_at: startedAt,
    };
    if (state) state.knowledgeSyncJobs.push(job);
    try {
      await this.ragflowClient.deleteDocument(previousDocument.dataset_id, previousDocument.document_id);
      job.delete_check = await verifyDocumentCleared({ ragflowClient: this.ragflowClient, datasetId: previousDocument.dataset_id, documentId: previousDocument.document_id, question: verifyQuestion });
      if (!job.delete_check.document_cleared || !job.delete_check.retrieval_cleared) {
        Object.assign(job, { status: "delete_unverified", last_error: "document_or_retrieval_still_visible_after_delete", updated_at: nowIso() });
        return { ok: false, status: "delete_unverified", reason: job.last_error, syncJob: job };
      }
      const result = await this.syncApprovedCandidate({ candidatePath, datasetId: datasetId || previousDocument.dataset_id, datasetName, waitForParse, state, force });
      Object.assign(job, {
        candidate_hash: result.syncJob?.candidate_hash || null,
        document_id: result.documentId,
        replacement_document_id: result.documentId,
        source_refs: result.sourceRefs || [],
        parse_progress: result.parseProgress || [],
        status: "replaced",
        updated_at: nowIso(),
      });
      return { ...result, status: "replaced", syncJob: job };
    } catch (error) {
      Object.assign(job, { status: "failed", last_error: error.message, error_type: isRetryableError(error) ? "retryable" : "non_retryable", updated_at: nowIso() });
      return { ok: false, status: "failed", reason: error.message, syncJob: job };
    }
  }
}
