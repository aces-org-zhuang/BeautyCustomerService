import { hashId, nowIso } from "../domain/ids.js";

function normalizeSyncedMessage(message, fallbackOpenKfid) {
  const openKfid = message.open_kfid || fallbackOpenKfid || "wk_unknown";
  const externalUserid = message.external_userid || message.from_userid || "wm_unknown";
  const msgid = message.msgid || hashId("msg", `${openKfid}:${externalUserid}:${message.send_time || Date.now()}:${message.text?.content || ""}`);
  return {
    msgid,
    open_kfid: openKfid,
    external_userid: externalUserid,
    text: { content: message.text?.content || message.content || "" },
    source: "wechat_kf",
    created_at: message.send_time ? new Date(Number(message.send_time) * 1000).toISOString() : nowIso(),
  };
}

export class WechatKfPlatform {
  constructor({ client, orchestrator, sendEnabled = false, syncLimit = 100 }) {
    this.client = client;
    this.orchestrator = orchestrator;
    this.sendEnabled = sendEnabled;
    this.syncLimit = syncLimit;
  }

  createOutboundSender() {
    return async ({ conversation, triggerEventId, intent, content, sourceRefs = [] }) => {
      if (!this.sendEnabled) {
        return {
          id: hashId("out", `${conversation.id}:${triggerEventId}:${intent}`),
          conversation_id: conversation.id,
          idempotency_key: `wechat:outbound:${conversation.id}:${triggerEventId}:${intent}`,
          message_type: "text",
          intent,
          status: "send_disabled",
          wechat_msgid: null,
          content,
          source_refs: sourceRefs,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
      }

      const result = await this.client.sendTextMessage({ openKfid: conversation.open_kfid, externalUserid: conversation.external_userid, text: content });
      return {
        id: hashId("out", `${conversation.id}:${triggerEventId}:${intent}`),
        conversation_id: conversation.id,
        idempotency_key: `wechat:outbound:${conversation.id}:${triggerEventId}:${intent}`,
        message_type: "text",
        intent,
        status: "sent",
        wechat_msgid: result.msgid || null,
        content,
        source_refs: sourceRefs,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
    };
  }

  async processCallbackEvent(event) {
    if (!event.token) return { ok: false, reason: "missing_sync_token" };
    const syncResult = await this.client.syncMessages({ token: event.token, limit: this.syncLimit });
    const messages = syncResult.msg_list || syncResult.msgList || [];
    const results = [];
    for (const message of messages) {
      if ((message.msgtype || "text") !== "text") continue;
      const inbound = normalizeSyncedMessage(message, event.openKfid);
      results.push(await this.orchestrator.processFakeWeChatMessage(inbound));
    }
    return { ok: true, next_cursor: syncResult.next_cursor || syncResult.nextCursor || "", has_more: Boolean(syncResult.has_more), processed: results.length, results };
  }
}
