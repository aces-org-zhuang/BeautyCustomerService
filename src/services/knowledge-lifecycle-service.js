import { nowIso } from "../domain/ids.js";
import { evaluateFeedbackCandidate } from "./evaluation-gate.js";
import { parseFrontmatter } from "./knowledge-sync-service.js";

function yamlList(items) {
  if (!items || items.length === 0) return "[]";
  return `\n${items.map((item) => `  - ${JSON.stringify(item)}`).join("\n")}`;
}

function candidateMarkdown(candidate) {
  const sources = candidate.source_refs || [];
  return [
    "---",
    "type: faq_candidate",
    `id: ${candidate.id}`,
    `question: ${JSON.stringify(candidate.question || "")}`,
    `review_status: ${candidate.review_status || "review"}`,
    `evaluation_status: ${candidate.evaluation_status || "pending"}`,
    `sources: ${yamlList(sources)}`,
    "---",
    `Answer: ${candidate.answer || ""}`,
    "",
    candidate.source_excerpt ? `Source excerpt:\n${candidate.source_excerpt}` : "",
  ].filter((line) => line !== "").join("\n");
}

function sourceMaterialMarkdown(sourceMaterial) {
  return [
    "---",
    "type: source_material",
    `title: ${JSON.stringify(sourceMaterial.title || "")}`,
    "---",
    sourceMaterial.content || "",
  ].join("\n");
}

export class KnowledgeLifecycleService {
  constructor({ llmWikiClient }) {
    this.llmWikiClient = llmWikiClient;
  }

  async publishDistillationToLlmWiki(distillation) {
    if (!distillation) return { ok: false, reason: "distillation_not_found" };
    if (!this.llmWikiClient.configured) return { ok: false, status: "unconfigured", reason: "missing_llm_wiki_base_url" };

    const sourceMaterial = distillation.source_material;
    await this.llmWikiClient.writeFile(sourceMaterial.path, sourceMaterialMarkdown(sourceMaterial));
    const artifacts = [{ type: "source_material", path: sourceMaterial.path, status: "written" }];

    for (const candidate of distillation.faq_candidates || []) {
      const path = candidate.llm_wiki_artifact?.path || `wiki/draft-answers/${candidate.id}.md`;
      await this.llmWikiClient.writeFile(path, candidateMarkdown(candidate));
      candidate.governance_target = "llm_wiki";
      candidate.llm_wiki_artifact = { path, status: "written", written_at: nowIso() };
      artifacts.push({ type: "faq_candidate", id: candidate.id, path, status: "written" });
    }

    return { ok: true, status: "written", distillation_id: distillation.id, artifacts };
  }

  async publishCandidateToLlmWiki(candidate) {
    if (!candidate) return { ok: false, reason: "candidate_not_found" };
    if (!this.llmWikiClient.configured) return { ok: false, status: "unconfigured", reason: "missing_llm_wiki_base_url" };
    if (!candidate.source_refs || candidate.source_refs.length === 0) return { ok: false, reason: "missing_source_refs" };

    const path = candidate.llm_wiki_artifact?.path || `wiki/draft-answers/${candidate.id}.md`;
    await this.llmWikiClient.writeFile(path, candidateMarkdown(candidate));
    candidate.governance_target = "llm_wiki";
    candidate.llm_wiki_artifact = { path, status: "written", written_at: nowIso() };
    return { ok: true, status: "written", artifact: { type: "faq_candidate", id: candidate.id, path, status: "written" }, candidate };
  }

  async refreshCandidateFromLlmWiki(candidate) {
    if (!candidate) return { ok: false, reason: "candidate_not_found" };
    if (!this.llmWikiClient.configured) return { ok: false, status: "unconfigured", reason: "missing_llm_wiki_base_url" };
    const path = candidate.llm_wiki_artifact?.path;
    if (!path) return { ok: false, reason: "missing_llm_wiki_candidate_path" };

    const markdown = await this.llmWikiClient.readFile(path);
    const { data } = parseFrontmatter(markdown);
    if (data.type !== "faq_candidate") return { ok: false, reason: "invalid_llm_wiki_candidate_type" };

    if (data.review_status) candidate.review_status = data.review_status;
    if (data.evaluation_status) candidate.evaluation_status = data.evaluation_status === "passed" ? "pass" : data.evaluation_status;
    candidate.governance_target = "llm_wiki";
    candidate.llm_wiki_artifact = { ...candidate.llm_wiki_artifact, path, status: "read", refreshed_at: nowIso() };
    candidate.publication_decision = evaluateFeedbackCandidate(candidate);
    return { ok: true, candidate, source: "llm_wiki", path };
  }
}
