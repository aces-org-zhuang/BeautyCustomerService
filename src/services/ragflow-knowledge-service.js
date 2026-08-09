import { LOCAL_TEST_KNOWLEDGE } from "../knowledge/local-test-knowledge.js";
import { isDocumentAllowed } from "./knowledge-document-registry.js";
import { RagflowClient } from "./ragflow-client.js";

export class RagflowKnowledgeService {
  constructor(config) {
    this.config = config;
    this.ragflowClient = new RagflowClient({ baseUrl: config.ragflowBaseUrl, apiKey: config.ragflowApiKey });
  }

  async answer(question, state = null) {
    if (this.isHighRisk(question)) return this.highRiskHandoff();
    if (this.config.useRagflow) {
      const live = await this.tryRagflowRetrieval(question, state);
      if (live.decision !== "handoff" || live.handoff_reason !== "ragflow_unavailable") return live;
    }
    const localPublished = this.publishedAnswer(question, state);
    if (localPublished) return localPublished;
    if (this.config.enableLocalTestKnowledge) {
      return this.localAnswer(question);
    }
    return {
      decision: "handoff",
      support_status: "unavailable",
      confidence: 0,
      answer_text: null,
      source_refs: [],
      handoff_reason: this.config.useRagflow ? "ragflow_unavailable" : "knowledge_provider_not_configured",
    };
  }

  isHighRisk(question) {
    return question.includes("永久") || question.includes("治好") || question.includes("治疗");
  }

  highRiskHandoff() {
    return {
      decision: "handoff",
      support_status: "unsupported",
      confidence: 0.12,
      answer_text: null,
      source_refs: [],
      handoff_reason: "unsupported",
    };
  }

  localAnswer(question) {
    if (this.isHighRisk(question)) return this.highRiskHandoff();

    const hit = LOCAL_TEST_KNOWLEDGE.find((item) => item.match.some((keyword) => question.includes(keyword)));
    if (!hit) {
      return {
        decision: "handoff",
        support_status: "unclear",
        confidence: 0.3,
        answer_text: null,
        source_refs: [],
        handoff_reason: "low_confidence",
      };
    }

    return {
      knowledge_id: hit.id,
      decision: hit.support_status === "supported" ? "answer" : "handoff",
      support_status: hit.support_status,
      confidence: hit.confidence,
      answer_text: hit.support_status === "supported" ? hit.answer : null,
      source_refs: hit.source_refs,
      handoff_reason: hit.support_status === "supported" ? null : "low_confidence",
    };
  }

  publishedAnswer(question, state) {
    const published = state?.publishedKnowledge || [];
    const hit = published.find((item) => item.match?.some((keyword) => question.includes(keyword) || keyword.includes(question)));
    if (!hit) return null;
    return {
      knowledge_id: hit.id,
      decision: "answer",
      support_status: "supported",
      confidence: hit.confidence || 0.82,
      answer_text: hit.answer,
      source_refs: hit.source_refs || [],
      handoff_reason: null,
    };
  }

  formatRagflowAnswer(chunk) {
    const content = String(chunk.content || "");
    const answerMatch = content.match(/Answer:\s*([\s\S]*?)(?:\n\s*<p>Source refs:|\n\s*Sync metadata:|\n\s*<h2>Source:|$)/i);
    const selected = answerMatch ? answerMatch[1] : content;
    const text = selected
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 300) || "已找到相关资料，请参考来源。";
  }

  listLocalKnowledge() {
    return this.config.enableLocalTestKnowledge ? LOCAL_TEST_KNOWLEDGE : [];
  }

  async tryRagflowRetrieval(question, state = null) {
    const resolvedDatasets = await this.ragflowClient.resolveDatasetIds({ datasetIds: this.config.ragflowDatasetIds, datasetNames: this.config.ragflowDatasetNames }).catch((error) => ({ ok: false, reason: error.message }));
    if (!resolvedDatasets.ok) {
      return {
        decision: "handoff",
        support_status: "unavailable",
        confidence: 0,
        answer_text: null,
        source_refs: [],
        handoff_reason: "ragflow_unavailable",
        provider_error: resolvedDatasets.reason,
      };
    }
    const retrieval = await this.ragflowClient.retrieve({ datasetIds: resolvedDatasets.datasetIds, question }).catch((error) => ({ ok: false, reason: error.message }));
    if (!retrieval.ok) {
      return {
        decision: "handoff",
        support_status: "unavailable",
        confidence: 0,
        answer_text: null,
        source_refs: [],
        handoff_reason: "ragflow_unavailable",
        provider_error: retrieval.reason,
      };
    }
    const chunks = retrieval.chunks.filter((chunk) => isDocumentAllowed(chunk.document_id, state));
    if (chunks.length === 0) {
      return {
        decision: "handoff",
        support_status: "unclear",
        confidence: 0,
        answer_text: null,
        source_refs: [],
        handoff_reason: "low_confidence",
      };
    }
    return {
      decision: "answer",
      support_status: "supported",
      confidence: chunks[0].similarity || 0.75,
      answer_text: this.formatRagflowAnswer(chunks[0]),
      source_refs: [chunks[0].document_id || chunks[0].dataset_id].filter(Boolean),
      handoff_reason: null,
    };
  }
}
