import { resolve } from "node:path";

const DEFAULT_LLM_WIKI_CANDIDATE_PATH = "wiki/queries/xiaoqipao-oily-skin.md";

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 8787),
    dataFile: resolve(env.BCS_DATA_FILE || "data/local-mvp-store.json"),
    ragflowBaseUrl: env.RAGFLOW_BASE_URL || "http://127.0.0.1:9380",
    ragflowApiKey: env.RAGFLOW_API_KEY || "",
    ragflowDatasetIds: (env.RAGFLOW_DATASET_IDS || "").split(",").map((item) => item.trim()).filter(Boolean),
    ragflowDatasetNames: (env.RAGFLOW_DATASET_NAMES || "beauty-faq").split(",").map((item) => item.trim()).filter(Boolean),
    ragflowStagingDatasetName: env.RAGFLOW_STAGING_DATASET_NAME || "beauty-material-staging",
    ragflowStagingChunkMethod: env.RAGFLOW_STAGING_CHUNK_METHOD || "naive",
    ragflowStagingChunkTokenNum: Number(env.RAGFLOW_STAGING_CHUNK_TOKEN_NUM || 128),
    ragflowStagingDelimiter: env.RAGFLOW_STAGING_DELIMITER || "\n.!?;。；！？",
    useRagflow: env.BCS_USE_RAGFLOW !== "0",
    autoAnswerConfidence: Number(env.BCS_AUTO_ANSWER_CONFIDENCE || 0.3),
    enableLocalTestKnowledge: env.BCS_ENABLE_LOCAL_TEST_KNOWLEDGE === "1",
    enableDemoPublishedKnowledge: env.BCS_ENABLE_DEMO_PUBLISHED_KNOWLEDGE === "1",
    llmWikiBaseUrl: env.LLM_WIKI_API_BASE_URL || "http://127.0.0.1:19828",
    llmWikiApiToken: env.LLM_WIKI_API_TOKEN || "",
    llmWikiCandidatePath: env.LLM_WIKI_CANDIDATE_PATH || DEFAULT_LLM_WIKI_CANDIDATE_PATH,
    wechatKfEnabled: env.WECHAT_KF_ENABLED === "1",
    wechatKfSendEnabled: env.WECHAT_KF_SEND_ENABLED === "1",
    wechatCorpId: env.WECHAT_CORP_ID || env.WECHAT_KF_CORP_ID || "",
    wechatKfSecret: env.WECHAT_KF_SECRET || "",
    wechatKfCallbackToken: env.WECHAT_KF_CALLBACK_TOKEN || "",
    wechatKfEncodingAesKey: env.WECHAT_KF_ENCODING_AES_KEY || "",
    wechatKfCallbackPath: env.WECHAT_KF_CALLBACK_PATH || "/api/wechat/kf/callback",
    wechatKfApiBaseUrl: env.WECHAT_KF_API_BASE_URL || "https://qyapi.weixin.qq.com",
    wechatKfSyncLimit: Number(env.WECHAT_KF_SYNC_LIMIT || 100),
    wechatKfAccessTokenCacheTtlSeconds: Number(env.WECHAT_KF_ACCESS_TOKEN_CACHE_TTL_SECONDS || 6600),
  };
}
