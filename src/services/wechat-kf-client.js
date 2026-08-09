export class WechatKfClient {
  constructor({ baseUrl = "https://qyapi.weixin.qq.com", corpId, secret, fetchImpl = globalThis.fetch, tokenTtlSeconds = 6600 }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.corpId = corpId;
    this.secret = secret;
    this.fetchImpl = fetchImpl;
    this.tokenTtlSeconds = tokenTtlSeconds;
    this.cachedToken = null;
  }

  configured() {
    return Boolean(this.corpId && this.secret);
  }

  async getAccessToken() {
    if (!this.configured()) throw new Error("wechat_kf_secret_unconfigured");
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) return this.cachedToken.value;
    const url = `${this.baseUrl}/cgi-bin/gettoken?corpid=${encodeURIComponent(this.corpId)}&corpsecret=${encodeURIComponent(this.secret)}`;
    const response = await this.fetchImpl(url);
    const body = await response.json();
    if (!response.ok || body.errcode) throw new Error(`wechat_access_token_failed:${body.errcode ?? response.status}`);
    const ttl = Math.max(60, Number(body.expires_in || this.tokenTtlSeconds) - 300);
    this.cachedToken = { value: body.access_token, expiresAt: Date.now() + ttl * 1000 };
    return body.access_token;
  }

  async postJson(path, payload) {
    const accessToken = await this.getAccessToken();
    const separator = path.includes("?") ? "&" : "?";
    const response = await this.fetchImpl(`${this.baseUrl}${path}${separator}access_token=${encodeURIComponent(accessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok || body.errcode) throw new Error(`wechat_api_error:${body.errcode ?? response.status}:${body.errmsg || "unknown"}`);
    return body;
  }

  async syncMessages({ token, cursor = "", limit = 100 }) {
    return this.postJson("/cgi-bin/kf/sync_msg", { token, cursor, limit });
  }

  async sendTextMessage({ openKfid, externalUserid, text }) {
    return this.postJson("/cgi-bin/kf/send_msg", {
      touser: externalUserid,
      open_kfid: openKfid,
      msgtype: "text",
      text: { content: text },
    });
  }
}
