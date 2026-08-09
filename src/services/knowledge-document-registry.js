import { hashId, nowIso } from "../domain/ids.js";

export function upsertActiveKnowledgeDocument(state, { sourcePath, sourceHash, datasetId, documentId, syncJobId = null, reason = "approved" }) {
  if (!sourcePath || !documentId) return null;
  if (!state.knowledgeDocuments) state.knowledgeDocuments = [];
  const now = nowIso();
  for (const item of state.knowledgeDocuments) {
    if (item.source_path === sourcePath && item.lifecycle_status === "active" && item.document_id !== documentId) {
      item.lifecycle_status = "superseded";
      item.answer_status = "replaced";
      item.superseded_by = documentId;
      item.reason = "modified";
      item.updated_at = now;
    }
  }
  const existing = state.knowledgeDocuments.find((item) => item.document_id === documentId && item.dataset_id === datasetId);
  const next = {
    id: existing?.id || hashId("knowledge_doc", `${sourcePath}:${documentId}`),
    source_path: sourcePath,
    source_hash: sourceHash,
    dataset_id: datasetId,
    document_id: documentId,
    sync_job_id: syncJobId,
    lifecycle_status: "active",
    answer_status: "not_checked",
    superseded_by: null,
    reason,
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  if (existing) Object.assign(existing, next);
  else state.knowledgeDocuments.push(next);
  return existing || next;
}

export function withdrawKnowledgeDocument(state, { sourcePath = null, documentId = null, reason = "withdrawn" }) {
  if (!state.knowledgeDocuments) state.knowledgeDocuments = [];
  const now = nowIso();
  const docs = state.knowledgeDocuments.filter((item) => {
    if (documentId) return item.document_id === documentId;
    return sourcePath && item.source_path === sourcePath && item.lifecycle_status === "active";
  });
  for (const doc of docs) {
    doc.lifecycle_status = "inactive";
    doc.answer_status = "withdrawn";
    doc.reason = reason;
    doc.updated_at = now;
  }
  return docs;
}

export function markKnowledgeDocumentAnswerStatus(state, { documentId, answerStatus }) {
  if (!state.knowledgeDocuments) state.knowledgeDocuments = [];
  const doc = state.knowledgeDocuments.find((item) => item.document_id === documentId);
  if (!doc) return null;
  doc.answer_status = answerStatus;
  doc.updated_at = nowIso();
  return doc;
}

export function isDocumentAllowed(documentId, state) {
  if (!documentId || !state?.knowledgeDocuments) return true;
  const doc = state.knowledgeDocuments.find((item) => item.document_id === documentId);
  if (!doc) return true;
  return doc.lifecycle_status === "active";
}
