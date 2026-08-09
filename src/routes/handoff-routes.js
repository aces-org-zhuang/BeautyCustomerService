import { claimTicket, createFeedbackCandidate, resolveTicket } from "../services/handoff-service.js";

export function createHandoffRoutes({ store, sendJson, readJson }) {
  return async function handleHandoffRoutes({ request, response, url }) {
    if (request.method === "GET" && url.pathname === "/handoff/tickets") {
      const state = await store.load();
      sendJson(response, 200, { ok: true, tickets: state.handoffTickets });
      return true;
    }

    const claimMatch = url.pathname.match(/^\/handoff\/tickets\/([^/]+)\/claim$/);
    if (request.method === "POST" && claimMatch) {
      const body = await readJson(request);
      const result = await store.update((state) => {
        const ticket = state.handoffTickets.find((item) => item.id === claimMatch[1]);
        if (!ticket) return { ok: false, reason: "ticket_not_found" };
        return claimTicket(ticket, body.operator_id || "operator_local", body.expected_version ?? ticket.assignment_version);
      });
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    const resolveMatch = url.pathname.match(/^\/handoff\/tickets\/([^/]+)\/resolve$/);
    if (request.method === "POST" && resolveMatch) {
      const body = await readJson(request);
      const result = await store.update((state) => {
        const ticket = state.handoffTickets.find((item) => item.id === resolveMatch[1]);
        if (!ticket) return { ok: false, reason: "ticket_not_found" };
        const resolved = resolveTicket(ticket, { operatorId: body.operator_id || "operator_local", answerText: body.answer_text || "" });
        if (!resolved.ok) return resolved;
        const candidate = createFeedbackCandidate(ticket, body.answer_text || "");
        state.feedbackCandidates.push(candidate);
        const conversation = state.conversations.find((item) => item.id === ticket.conversation_id);
        if (conversation) {
          conversation.state = "resolved";
          conversation.updated_at = ticket.updated_at;
        }
        return { ok: true, ticket, candidate };
      });
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    return false;
  };
}
