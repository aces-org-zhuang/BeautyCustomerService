import { hashId, nowIso } from "../domain/ids.js";
import { evaluateFeedbackCandidate, runLocalCandidateEvaluation } from "./evaluation-gate.js";

export function reviewCandidate(candidate, { decision, reviewerId = "reviewer_local" }) {
  if (!candidate) return { ok: false, reason: "candidate_not_found" };
  if (!["approve", "reject"].includes(decision)) return { ok: false, reason: "invalid_review_decision" };
  if (candidate.published_at) return { ok: false, reason: "candidate_already_published" };
  candidate.review_status = decision === "approve" ? "approved" : "rejected";
  candidate.reviewer_id = reviewerId;
  candidate.reviewed_at = nowIso();
  candidate.publication_decision = evaluateFeedbackCandidate(candidate);
  return { ok: true, candidate };
}

export function evaluateCandidate(candidate, { result = "pass" }) {
  if (!candidate) return { ok: false, reason: "candidate_not_found" };
  if (candidate.review_status !== "approved") return { ok: false, reason: "candidate_not_approved" };
  const publicationDecision = runLocalCandidateEvaluation(candidate, result);
  return { ok: true, candidate, publication_decision: publicationDecision };
}

export function publishCandidate(state, candidate) {
  if (!candidate) return { ok: false, reason: "candidate_not_found" };
  candidate.publication_decision = evaluateFeedbackCandidate(candidate);
  if (candidate.publication_decision.publication_decision !== "publish") {
    return { ok: false, reason: candidate.publication_decision.reason, candidate };
  }
  const item = {
    id: hashId("published", `${candidate.id}:${candidate.answer}`),
    candidate_id: candidate.id,
    question: candidate.question,
    answer: candidate.answer,
    source_refs: candidate.source_refs || [],
    match: [candidate.question],
    confidence: 0.82,
    support_status: "supported",
    publication_target: "demo_local_published_knowledge",
    created_at: nowIso(),
  };
  const existingIndex = state.publishedKnowledge.findIndex((entry) => entry.id === item.id);
  if (existingIndex >= 0) state.publishedKnowledge[existingIndex] = item;
  else state.publishedKnowledge.push(item);
  candidate.published_at = item.created_at;
  candidate.ragflow_sync_allowed = false;
  candidate.ragflow_sync = { target: "demo_local_published_knowledge", status: "demo_published_local", reason: "demo_local_mvp_publish" };
  return { ok: true, candidate, published: item };
}
