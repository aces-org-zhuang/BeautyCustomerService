import { createHash } from "node:crypto";
import { hashId, nowIso } from "../domain/ids.js";
import { markKnowledgeDocumentAnswerStatus, upsertActiveKnowledgeDocument, withdrawKnowledgeDocument } from "./knowledge-document-registry.js";

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
  constructor({ llmWikiClient, knowledgeSyncService, knowledgeService }) {
    this.llmWikiClient = llmWikiClient;
    this.knowledgeSyncService = knowledgeSyncService;
    this.knowledgeService = knowledgeService;
  }

  async syncAndVerify({ candidatePath, datasetId = null, datasetName = null, question = null, expectedAnswer = null, waitForParse = false, force = false, state }) {
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
      syncResult = await this.knowledgeSyncService.syncApprovedCandidate({
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

    const answerResult = await this.knowledgeService.answer(verificationQuestion, state).catch((error) => ({ decision: "handoff", answer_text: null, source_refs: [], provider_error: error.message }));
    const matchedDocument = syncResult.documentId && (answerResult.source_refs || []).includes(syncResult.documentId);
    const matchedExpected = includesExpectedAnswer(answerResult.answer_text, expectedAnswer);
    const answerChanged = answerResult.decision === "answer" && matchedExpected && (matchedDocument || !syncResult.documentId);
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

  withdraw({ sourcePath = null, documentId = null, reason = "withdrawn", question = null, state }) {
    if (!state) throw new Error("state is required");
    const docs = withdrawKnowledgeDocument(state, { sourcePath, documentId, reason });
    if (docs.length === 0) return this.recordBlocked({ state, candidatePath: sourcePath, question, reason: "knowledge_document_not_found" });
    const check = createCheck({
      candidatePath: sourcePath || docs[0].source_path,
      candidateHash: docs[0].source_hash,
      question,
      syncResult: { datasetId: docs[0].dataset_id, documentId: docs[0].document_id, status: "withdrawn", syncJob: { id: docs[0].sync_job_id } },
      status: "withdrawn",
    });
    state.knowledgeAnswerChecks.push(check);
    return { ok: true, status: "withdrawn", documents: docs, check };
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
}
