import { createHash } from "node:crypto";
import { hashId, nowIso } from "../domain/ids.js";
import { markKnowledgeDocumentAnswerStatus, upsertActiveKnowledgeDocument, withdrawKnowledgeDocument } from "./knowledge-document-registry.js";
import { verifyDocumentCleared } from "./ragflow-lifecycle-probe-service.js";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function includesExpectedAnswer(answerText, expectedAnswer) {
  if (!expectedAnswer) return true;
  return String(answerText || "").includes(expectedAnswer);
}

function createCheck({ candidatePath, candidateHash = null, question, expectedAnswer, syncResult = null, answerResult = null, status, failureReason = null }) {
  const createdAt = nowIso();
  return {
    id: hashId("answer_check", `${candidatePath}:${candidateHash || "no_hash"}:${question}:${createdAt}`),
    candidate_path: candidatePath,
    candidate_hash: candidateHash,
    question,
    expected_answer: expectedAnswer || null,
    dataset_id: syncResult?.datasetId || null,
    document_id: syncResult?.documentId || null,
    sync_job_id: syncResult?.syncJob?.id || null,
    sync_status: syncResult?.status || status,
    answer_check_status: status,
    answer_text: answerResult?.answer_text || null,
    source_refs: answerResult?.source_refs || [],
    failure_reason: failureReason,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

export class KnowledgeAnswerLoopService {
  constructor({ llmWikiClient, knowledgeSyncService, knowledgeService, ragflowClient = null }) {
    this.llmWikiClient = llmWikiClient;
    this.knowledgeSyncService = knowledgeSyncService;
    this.knowledgeService = knowledgeService;
    this.ragflowClient = ragflowClient;
  }

  async syncAndVerify({ candidatePath, datasetId = null, datasetName = null, question = null, expectedAnswer = null, waitForParse = false, force = false, physicalReplace = false, state }) {
    if (!candidatePath) return this.recordBlocked({ state, candidatePath, question, expectedAnswer, reason: "missing_llm_wiki_candidate_path" });
    if (!state) throw new Error("state is required");

    let candidateMarkdown;
    try {
      candidateMarkdown = await this.llmWikiClient.readFile(candidatePath);
    } catch (error) {
      return this.recordBlocked({ state, candidatePath, question, expectedAnswer, reason: error.message });
    }
    const candidateHash = sha256(candidateMarkdown);
    const verificationQuestion = question || this.extractQuestion(candidateMarkdown);
    if (!verificationQuestion) return this.recordBlocked({ state, candidatePath, candidateHash, question, expectedAnswer, reason: "missing_verification_question" });

    let syncResult;
    try {
      const previousDocument = physicalReplace ? state.knowledgeDocuments?.find((item) => item.source_path === candidatePath && item.lifecycle_status === "active") : null;
      syncResult = physicalReplace && previousDocument && typeof this.knowledgeSyncService.replaceApprovedCandidate === "function"
        ? await this.knowledgeSyncService.replaceApprovedCandidate({
          candidatePath,
          datasetId,
          datasetName,
          previousDocument,
          waitForParse,
          force: true,
          verifyQuestion: verificationQuestion,
          state,
        })
        : await this.knowledgeSyncService.syncApprovedCandidate({
          candidatePath,
          datasetId,
          datasetName,
          waitForParse,
          force,
          state,
        });
    } catch (error) {
      return this.recordBlocked({ state, candidatePath, candidateHash, question: verificationQuestion, expectedAnswer, reason: error.message });
    }
    if (!syncResult.ok) return this.recordBlocked({ state, candidatePath, candidateHash, question: verificationQuestion, expectedAnswer, reason: syncResult.reason || syncResult.status || "sync_failed" });
    if (!syncResult.datasetId) return this.recordBlocked({ state, candidatePath, candidateHash, question: verificationQuestion, expectedAnswer, reason: "missing_synced_dataset_id" });
    if (!syncResult.documentId) return this.recordBlocked({ state, candidatePath, candidateHash, question: verificationQuestion, expectedAnswer, reason: "missing_synced_document_id" });

    const answerResult = await this.verifyAnswer(verificationQuestion, state, syncResult).catch((error) => ({ decision: "handoff", answer_text: null, source_refs: [], provider_error: error.message }));
    const matchedDocument = syncResult.documentId && (answerResult.source_refs || []).includes(syncResult.documentId);
    const matchedExpected = includesExpectedAnswer(answerResult.answer_text, expectedAnswer);
    const answerChanged = answerResult.decision === "answer" && matchedExpected && matchedDocument;
    const status = answerChanged ? "answer_changed" : "answer_unchanged";
    const failureReason = answerChanged ? null : answerResult.provider_error || "verification_answer_did_not_match_synced_document";
    if (syncResult.documentId) {
      upsertActiveKnowledgeDocument(state, {
        sourcePath: candidatePath,
        sourceHash: candidateHash,
        datasetId: syncResult.datasetId,
        documentId: syncResult.documentId,
        syncJobId: syncResult.syncJob?.id || null,
      });
      markKnowledgeDocumentAnswerStatus(state, { documentId: syncResult.documentId, answerStatus: answerChanged ? "effective" : "ineffective" });
    }
    const check = createCheck({ candidatePath, candidateHash, question: verificationQuestion, expectedAnswer, syncResult, answerResult, status, failureReason });
    state.knowledgeAnswerChecks.push(check);
    return { ok: true, status, sync: syncResult, answer: answerResult, check };
  }

  async withdraw({ sourcePath = null, documentId = null, reason = "withdrawn", question = null, physicalDelete = false, verifyCleared = false, state }) {
    if (!state) throw new Error("state is required");
    const docs = withdrawKnowledgeDocument(state, { sourcePath, documentId, reason });
    if (docs.length === 0) return this.recordBlocked({ state, candidatePath: sourcePath, question, reason: "knowledge_document_not_found" });
    const deleteChecks = [];
    if (physicalDelete) {
      if (!this.ragflowClient?.configured) return this.recordBlocked({ state, candidatePath: sourcePath || docs[0].source_path, question, reason: "missing_ragflow_api_key" });
      for (const doc of docs) {
        try {
          await this.ragflowClient.deleteDocument(doc.dataset_id, doc.document_id);
          const deleteCheck = verifyCleared
            ? await verifyDocumentCleared({ ragflowClient: this.ragflowClient, datasetId: doc.dataset_id, documentId: doc.document_id, question })
            : { document_cleared: true, retrieval_cleared: true, retrieval_status: "skipped", retrieval_reason: null };
          deleteChecks.push({ document_id: doc.document_id, ...deleteCheck });
          if (!deleteCheck.document_cleared || !deleteCheck.retrieval_cleared) {
            doc.answer_status = "delete_unverified";
            doc.updated_at = nowIso();
            return this.recordBlocked({ state, candidatePath: doc.source_path, candidateHash: doc.source_hash, question, reason: "document_or_retrieval_still_visible_after_delete" });
          }
        } catch (error) {
          doc.answer_status = "delete_failed";
          doc.updated_at = nowIso();
          return this.recordBlocked({ state, candidatePath: doc.source_path, candidateHash: doc.source_hash, question, reason: error.message });
        }
      }
    }
    const check = createCheck({
      candidatePath: sourcePath || docs[0].source_path,
      candidateHash: docs[0].source_hash,
      question,
      syncResult: { datasetId: docs[0].dataset_id, documentId: docs[0].document_id, status: "withdrawn", syncJob: { id: docs[0].sync_job_id } },
      status: "withdrawn",
    });
    check.delete_checks = deleteChecks;
    state.knowledgeAnswerChecks.push(check);
    return { ok: true, status: "withdrawn", documents: docs, deleteChecks, check };
  }

  recordBlocked({ state, candidatePath = null, candidateHash = null, question = null, expectedAnswer = null, reason }) {
    const check = createCheck({ candidatePath, candidateHash, question, expectedAnswer, status: "sync_blocked", failureReason: reason });
    if (state) state.knowledgeAnswerChecks.push(check);
    return { ok: false, status: "sync_blocked", reason, check };
  }

  extractQuestion(markdown) {
    const match = markdown.match(/^question:\s*"?([^"\n]+)"?$/m);
    return match ? match[1].trim() : null;
  }

  async verifyAnswer(question, state, syncResult) {
    if (typeof this.knowledgeService.tryRagflowRetrieval === "function") {
      return this.knowledgeService.tryRagflowRetrieval(question, state, { datasetIds: [syncResult.datasetId].filter(Boolean), datasetNames: [] });
    }
    return this.knowledgeService.answer(question, state, { datasetIds: [syncResult.datasetId].filter(Boolean), datasetNames: [] });
  }
}
