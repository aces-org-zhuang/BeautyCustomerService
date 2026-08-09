import { decryptWechatKfPayload, extractEncryptedFromXml, parseWechatKfEventXml, verifyWechatKfSignature } from "../services/wechat-kf-crypto.js";

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}

function callbackConfigured(config) {
  return Boolean(config.wechatKfCallbackToken && config.wechatKfEncodingAesKey && config.wechatCorpId);
}

export function createWechatKfRoutes({ config, wechatKfPlatform }) {
  const callbackPath = config.wechatKfCallbackPath || "/api/wechat/kf/callback";

  return async function handleWechatKfRoutes({ request, response, url }) {
    if (url.pathname !== callbackPath) return false;

    if (!callbackConfigured(config)) {
      sendText(response, 400, "missing_wechat_callback_config");
      return true;
    }

    const msgSignature = url.searchParams.get("msg_signature") || "";
    const timestamp = url.searchParams.get("timestamp") || "";
    const nonce = url.searchParams.get("nonce") || "";

    if (request.method === "GET") {
      const echostr = url.searchParams.get("echostr") || "";
      if (!verifyWechatKfSignature({ token: config.wechatKfCallbackToken, timestamp, nonce, encrypted: echostr, msgSignature })) {
        sendText(response, 401, "invalid_signature");
        return true;
      }
      try {
        const plaintext = decryptWechatKfPayload({ encodingAesKey: config.wechatKfEncodingAesKey, encrypted: echostr, corpId: config.wechatCorpId });
        sendText(response, 200, plaintext);
      } catch (error) {
        sendText(response, 400, error.message || "decrypt_failed");
      }
      return true;
    }

    if (request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const encrypted = extractEncryptedFromXml(rawBody);
      if (!verifyWechatKfSignature({ token: config.wechatKfCallbackToken, timestamp, nonce, encrypted, msgSignature })) {
        sendText(response, 401, "invalid_signature");
        return true;
      }
      try {
        const plaintext = decryptWechatKfPayload({ encodingAesKey: config.wechatKfEncodingAesKey, encrypted, corpId: config.wechatCorpId });
        const event = parseWechatKfEventXml(plaintext);
        await wechatKfPlatform.processCallbackEvent(event);
        sendText(response, 200, "success");
      } catch (error) {
        sendText(response, 500, error.message || "wechat_callback_failed");
      }
      return true;
    }

    sendText(response, 405, "method_not_allowed");
    return true;
  };
}
