import { hashId, nowIso } from "../domain/ids.js";

export function createKnowledgeAlert(state, { source, severity = "warning", title, detail, refId = null }) {
  if (!state.knowledgeAlerts) state.knowledgeAlerts = [];
  const now = nowIso();
  const alert = {
    id: hashId("knowledge_alert", `${source}:${title}:${detail}:${now}`),
    source,
    severity,
    status: "open",
    title,
    detail,
    ref_id: refId,
    created_at: now,
    updated_at: now,
  };
  state.knowledgeAlerts.push(alert);
  return alert;
}

export function acknowledgeKnowledgeAlert(state, alertId, actor = "operator_local") {
  const alert = state.knowledgeAlerts?.find((item) => item.id === alertId);
  if (!alert) return { ok: false, reason: "alert_not_found" };
  alert.status = "acknowledged";
  alert.acknowledged_by = actor;
  alert.updated_at = nowIso();
  return { ok: true, alert };
}
