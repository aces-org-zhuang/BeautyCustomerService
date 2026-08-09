import { createHash } from "node:crypto";
import { hashId, nowIso } from "../domain/ids.js";

function unquote(value) {
  return value.replace(/^"(.*)"$/, "$1");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
      attempts: 1,
      last_error: null,
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
      Object.assign(syncJob, { status: "failed", last_error: error.message, source_refs: sourceRefs, parse_progress: parseProgress, updated_at: nowIso() });
      throw error;
    }
  }
}
