import { hashId, nowIso } from "../domain/ids.js";
import { fakeSendText, normalizeFakeWeChatMessage } from "./fake-wechat-platform.js";
import { createHandoffTicket } from "./handoff-service.js";
import { ReplyPolicyService } from "./reply-policy-service.js";

function findOrCreateConversation(state, event) {
  const id = hashId("conv", `${event.open_kfid}:${event.external_userid}`);
  let conversation = state.conversations.find((item) => item.id === id);
  if (!conversation) {
    conversation = {
      id,
      channel: "wechat_kf",
      external_userid: event.external_userid,
      open_kfid: event.open_kfid,
      state: "active_ai",
      handoff_reason: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    state.conversations.push(conversation);
  }
  return conversation;
}

function storeEvent(state, conversation, event) {
  if (state.events.some((item) => item.idempotency_key === event.idempotency_key)) {
    return { event: state.events.find((item) => item.idempotency_key === event.idempotency_key), duplicate: true };
  }
  const stored = { ...event, conversation_id: conversation.id };
  state.events.push(stored);
  return { event: stored, duplicate: false };
}

function answerAllowed(decision, minConfidence) {
  return decision.decision === "answer"
    && decision.support_status === "supported"
    && decision.confidence >= minConfidence
    && decision.source_refs.length > 0;
}

function withHandoffReason(decision, minConfidence) {
  if (decision.decision === "answer" && decision.confidence < minConfidence) {
    return { ...decision, handoff_reason: "low_confidence", auto_answer_threshold: minConfidence };
  }
  return { ...decision, auto_answer_threshold: minConfidence };
}

function createDecisionLog({ conversation, inbound, aiDecision, finalDecision, ticket = null, outbound = null, replyPolicyProfile = null }) {
  return {
    id: hashId("decision", `${inbound.id}:${finalDecision}:${ticket?.id || outbound?.id || "none"}`),
    conversation_id: conversation.id,
    inbound_event_id: inbound.id,
    external_userid: conversation.external_userid,
    question: inbound.normalized_payload.content,
    final_decision: finalDecision,
    handoff_reason: finalDecision === "handoff" ? (ticket?.reason || aiDecision.handoff_reason || "policy") : null,
    support_status: aiDecision.support_status,
    confidence: aiDecision.confidence,
    auto_answer_threshold: aiDecision.auto_answer_threshold,
    source_refs: aiDecision.source_refs || [],
    factual_answer: aiDecision.answer_text || null,
    final_reply: outbound?.content || null,
    reply_policy_profile: replyPolicyProfile,
    provider_error: aiDecision.provider_error || null,
    ticket_id: ticket?.id || null,
    outbound_id: outbound?.id || null,
    created_at: nowIso(),
  };
}

export class AnswerOrchestrator {
  constructor({ store, knowledgeService }) {
    this.store = store;
    this.knowledgeService = knowledgeService;
    this.autoAnswerConfidence = knowledgeService.config?.autoAnswerConfidence ?? 0.5;
  }

  async processFakeWeChatMessage(message) {
    return this.store.update(async (state) => {
      const inbound = normalizeFakeWeChatMessage(message);
      const conversation = findOrCreateConversation(state, inbound);
      const storedInbound = storeEvent(state, conversation, inbound);
      if (storedInbound.duplicate) return { duplicate: true, conversation, inbound: storedInbound.event };

      if (inbound.event_type === "menu_click" && inbound.normalized_payload.action === "dissatisfied") {
        const ticket = this.createTicketPath(state, conversation, inbound, {
          decision: "handoff",
          support_status: "needs_human",
          confidence: 0,
          answer_text: null,
          source_refs: [],
          handoff_reason: "dissatisfied",
        });
        return { duplicate: false, conversation, inbound, decision: "handoff", ticket };
      }

      const aiDecision = await this.knowledgeService.answer(inbound.normalized_payload.content, state);
      const tracedDecision = withHandoffReason(aiDecision, this.autoAnswerConfidence);
      const replyPolicy = new ReplyPolicyService(state.replyPolicy);
      if (answerAllowed(tracedDecision, this.autoAnswerConfidence)) {
        const finalReply = replyPolicy.formatAnswer(tracedDecision.answer_text);
        const outbound = fakeSendText({
          conversationId: conversation.id,
          triggerEventId: inbound.id,
          intent: "ai_answer",
          content: finalReply,
          sourceRefs: tracedDecision.source_refs,
        });
        state.outbox.push(outbound);
        state.events.push({
          id: hashId("evt", outbound.idempotency_key),
          conversation_id: conversation.id,
          event_type: "ai_answer",
          direction: "outbound",
          idempotency_key: outbound.idempotency_key,
          normalized_payload: { answer_text: finalReply, factual_answer: tracedDecision.answer_text, support_status: tracedDecision.support_status, confidence: tracedDecision.confidence },
          source_refs: tracedDecision.source_refs,
          created_at: nowIso(),
        });
        state.decisionLogs.push(createDecisionLog({ conversation, inbound, aiDecision: tracedDecision, finalDecision: "answer", outbound, replyPolicyProfile: replyPolicy.policy.profile }));
        return { duplicate: false, conversation, inbound, decision: "answer", outbound, aiDecision: tracedDecision };
      }

      const ticket = this.createTicketPath(state, conversation, inbound, tracedDecision);
      const outbound = fakeSendText({
        conversationId: conversation.id,
        triggerEventId: inbound.id,
        intent: "handoff_ack",
        content: replyPolicy.formatHandoff(ticket.reason),
        sourceRefs: tracedDecision.source_refs,
      });
      state.outbox.push(outbound);
      state.decisionLogs.push(createDecisionLog({ conversation, inbound, aiDecision: tracedDecision, finalDecision: "handoff", ticket, outbound, replyPolicyProfile: replyPolicy.policy.profile }));
      return { duplicate: false, conversation, inbound, decision: "handoff", ticket, aiDecision: tracedDecision };
    });
  }

  createTicketPath(state, conversation, inbound, aiDecision) {
    conversation.state = "needs_human";
    conversation.handoff_reason = aiDecision.handoff_reason;
    conversation.updated_at = nowIso();
    const ticket = createHandoffTicket(conversation, inbound, aiDecision);
    state.handoffTickets.push(ticket);
    return ticket;
  }
}
