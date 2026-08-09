import { hashId, nowIso } from "../domain/ids.js";

export function normalizeFakeWeChatMessage(message) {
  const openKfid = message.open_kfid || "wk_local_001";
  const externalUserid = message.external_userid || "wm_local_001";
  const msgid = message.msgid || hashId("msg", `${openKfid}:${externalUserid}:${message.text?.content || ""}:${Date.now()}`);
  const idempotencyKey = `wechat:inbound:${openKfid}:${msgid}`;
  const text = message.text || { content: message.content || "" };

  if (text.menu_id === "dissatisfied") {
    return {
      id: hashId("evt", idempotencyKey),
      event_type: "menu_click",
      direction: "inbound",
      idempotency_key: idempotencyKey,
      wechat_msgid: msgid,
      open_kfid: openKfid,
      external_userid: externalUserid,
      normalized_payload: { content: text.content || "不满意", action: "dissatisfied", menu_id: "dissatisfied" },
      source_refs: [],
      created_at: nowIso(),
    };
  }

  return {
    id: hashId("evt", idempotencyKey),
    event_type: "user_text",
    direction: "inbound",
    idempotency_key: idempotencyKey,
    wechat_msgid: msgid,
    open_kfid: openKfid,
    external_userid: externalUserid,
    normalized_payload: { content: text.content || "" },
    source_refs: [],
    created_at: nowIso(),
  };
}

export function fakeSendText({ conversationId, triggerEventId, intent, content, sourceRefs = [] }) {
  return {
    id: hashId("out", `${conversationId}:${triggerEventId}:${intent}`),
    conversation_id: conversationId,
    idempotency_key: `wechat:outbound:${conversationId}:${triggerEventId}:${intent}`,
    message_type: "text",
    intent,
    status: "sent",
    wechat_msgid: hashId("fake", content),
    content,
    source_refs: sourceRefs,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}
