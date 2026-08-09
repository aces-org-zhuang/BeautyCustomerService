import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function base64DecodeAesKey(encodingAesKey) {
  if (!encodingAesKey || encodingAesKey.length !== 43) {
    throw new Error("invalid_encoding_aes_key");
  }
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  if (key.length !== 32) throw new Error("invalid_encoding_aes_key");
  return key;
}

function sha1(items) {
  return createHash("sha1").update(items.sort().join("")).digest("hex");
}

export function verifyWechatKfSignature({ token, timestamp, nonce, encrypted, msgSignature }) {
  if (!token || !timestamp || !nonce || !encrypted || !msgSignature) return false;
  return sha1([token, timestamp, nonce, encrypted]) === msgSignature;
}

export function decryptWechatKfPayload({ encodingAesKey, encrypted, corpId }) {
  const aesKey = base64DecodeAesKey(encodingAesKey);
  const decipher = createDecipheriv("aes-256-cbc", aesKey, aesKey.subarray(0, 16));
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(encrypted, "base64"), decipher.final()]);
  const pad = decrypted[decrypted.length - 1];
  if (pad < 1 || pad > 32) throw new Error("invalid_padding");
  const unpadded = decrypted.subarray(0, decrypted.length - pad);
  if (unpadded.length < 20) throw new Error("invalid_plaintext");

  const messageLength = unpadded.readUInt32BE(16);
  const messageStart = 20;
  const messageEnd = messageStart + messageLength;
  const message = unpadded.subarray(messageStart, messageEnd).toString("utf8");
  const receivedCorpId = unpadded.subarray(messageEnd).toString("utf8");
  if (corpId && receivedCorpId !== corpId) throw new Error("invalid_corp_id");
  return message;
}

export function encryptWechatKfPayloadForTest({ encodingAesKey, plaintext, corpId, random = randomBytes(16) }) {
  const aesKey = base64DecodeAesKey(encodingAesKey);
  const message = Buffer.from(plaintext, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(message.length, 0);
  const raw = Buffer.concat([Buffer.from(random).subarray(0, 16), length, message, Buffer.from(corpId, "utf8")]);
  const remainder = raw.length % 32;
  const padLength = remainder === 0 ? 32 : 32 - remainder;
  const padded = Buffer.concat([raw, Buffer.alloc(padLength, padLength)]);
  const cipher = createCipheriv("aes-256-cbc", aesKey, aesKey.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

export function extractXmlTag(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tagName}>|<${tagName}>([\\s\\S]*?)</${tagName}>`));
  return match ? (match[1] ?? match[2] ?? "") : "";
}

export function extractEncryptedFromXml(xml) {
  return extractXmlTag(xml, "Encrypt");
}

export function parseWechatKfEventXml(xml) {
  return {
    toUserName: extractXmlTag(xml, "ToUserName"),
    token: extractXmlTag(xml, "Token"),
    openKfid: extractXmlTag(xml, "OpenKfId"),
    event: extractXmlTag(xml, "Event"),
  };
}

export function createWechatKfSignature({ token, timestamp, nonce, encrypted }) {
  return sha1([token, timestamp, nonce, encrypted]);
}
