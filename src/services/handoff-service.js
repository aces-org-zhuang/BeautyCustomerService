import { hashId, nowIso } from "../domain/ids.js";
import { evaluateFeedbackCandidate } from "./evaluation-gate.js";

export function createHandoffTicket(conversation, triggerEvent, aiDecision) {
  const reason = aiDecision.handoff_reason || aiDecision.support_status || "policy";
  return {
    id: hashId("ticket", `${conversation.id}:${triggerEvent.id}:${reason}`),
    conversation_id: conversation.id,
    status: "needs_human",
    reason,
    payload_ref: hashId("handoff_payload", triggerEvent.id),
    operator_payload: {
      external_userid: conversation.external_userid,
      open_kfid: conversation.open_kfid,
      original_user_message: triggerEvent.normalized_payload.content,
      ai_answer: aiDecision.answer_text,
      source_refs: aiDecision.source_refs,
      handoff_reason: reason,
      support_status: aiDecision.support_status,
      confidence: aiDecision.confidence,
      auto_answer_threshold: aiDecision.auto_answer_threshold,
      provider_error: aiDecision.provider_error,
    },
    assigned_to: null,
    assignment_version: 0,
    resolution_summary: null,
    resolved_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

export function claimTicket(ticket, operatorId, expectedVersion = ticket.assignment_version) {
  if (ticket.status !== "needs_human") return { ok: false, reason: "ticket_not_claimable" };
  if (ticket.assignment_version !== expectedVersion) return { ok: false, reason: "assignment_version_conflict" };
  ticket.status = "assigned";
  ticket.assigned_to = operatorId;
  ticket.assignment_version += 1;
  ticket.updated_at = nowIso();
  return { ok: true, ticket };
}

export function resolveTicket(ticket, { operatorId, answerText }) {
  if (ticket.status !== "assigned") return { ok: false, reason: "ticket_not_assigned" };
  if (ticket.assigned_to !== operatorId) return { ok: false, reason: "operator_mismatch" };
  ticket.status = "resolved";
  ticket.resolution_summary = answerText;
  ticket.resolved_at = nowIso();
  ticket.updated_at = nowIso();
  return { ok: true, ticket };
}

export function createFeedbackCandidate(ticket, answerText) {
  const candidate = {
    id: hashId("candidate", `${ticket.id}:${answerText}`),
    question: ticket.operator_payload.original_user_message,
    answer: answerText,
    source_refs: ticket.operator_payload.source_refs?.length ? ticket.operator_payload.source_refs : [`conversation/${ticket.conversation_id}`, ticket.payload_ref],
    created_from: "human_feedback",
    handoff_reason: ticket.reason,
    governance_target: "pending_llm_wiki",
    llm_wiki_artifact: {
      path: `wiki/draft-answers/${hashId("candidate", `${ticket.id}:${answerText}`)}.md`,
      status: "not_written",
    },
    review_status: "review",
    reviewer_id: null,
    reviewed_at: null,
    evaluation_status: "pending",
    published_at: null,
    ragflow_sync_allowed: false,
    ragflow_sync: {
      target: "LLM Wiki approved-answers -> RAGFlow",
      status: "blocked",
      reason: "review_and_evaluation_required",
    },
    created_at: nowIso(),
  };
  candidate.publication_decision = evaluateFeedbackCandidate(candidate);
  return candidate;
}
