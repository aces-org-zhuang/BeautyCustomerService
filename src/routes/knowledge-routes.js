import { acknowledgeKnowledgeAlert } from "../services/knowledge-alert-service.js";
import { evaluateCandidate, publishCandidate, reviewCandidate } from "../services/knowledge-governance-service.js";

function toKnowledgeArtifact(candidate) {
  const publicationDecision = candidate.publication_decision || { publication_decision: "block", reason: "unknown" };
  const llmWikiArtifact = candidate.llm_wiki_artifact || { path: `wiki/draft-answers/${candidate.id}.md`, status: "draft_review" };
  const ragflowSync = candidate.ragflow_sync || {
    target: "LLM Wiki approved-answers -> RAGFlow",
    status: candidate.ragflow_sync_allowed ? "ready" : "blocked",
    reason: publicationDecision.reason || "review_and_evaluation_required",
  };
  return {
    id: candidate.id,
    batch_id: candidate.batch_id || null,
    material_id: candidate.material_id || null,
    question: candidate.question,
    answer: candidate.answer,
    source_refs: candidate.source_refs || [],
    source_excerpt: candidate.source_excerpt || "",
    risk_label: candidate.risk_label || "normal",
    risk_labels: candidate.risk_labels || [],
    confidence_basis: candidate.confidence_basis || "",
    created_from: candidate.created_from,
    handoff_reason: candidate.handoff_reason,
    governance_target: candidate.governance_target || "llm_wiki",
    llm_wiki_artifact: llmWikiArtifact,
    review_status: candidate.review_status,
    evaluation_status: candidate.evaluation_status,
    ragflow_sync_allowed: Boolean(candidate.ragflow_sync_allowed),
    ragflow_sync: ragflowSync,
    publication_decision: publicationDecision,
    created_at: candidate.created_at,
    published_at: candidate.published_at || null,
  };
}

export function createKnowledgeRoutes({ config, store, knowledgeService, knowledgeLifecycleService, knowledgeSyncService, knowledgeAnswerLoopService, knowledgeScanService, ragflowClient, sendJson, readJson }) {
  return async function handleKnowledgeRoutes({ request, response, url }) {
    if (request.method === "GET" && url.pathname === "/knowledge/feedback-candidates") {
      const state = await store.load();
      sendJson(response, 200, { ok: true, candidates: state.feedbackCandidates });
      return true;
    }

    if (request.method === "GET" && url.pathname === "/knowledge/published") {
      const state = await store.load();
      sendJson(response, 200, { ok: true, knowledge: state.publishedKnowledge });
      return true;
    }

    if (request.method === "GET" && url.pathname === "/knowledge/local-test") {
      sendJson(response, 200, { ok: true, knowledge: knowledgeService.listLocalKnowledge() });
      return true;
    }

    const reviewMatch = url.pathname.match(/^\/knowledge\/feedback-candidates\/([^/]+)\/review$/);
    if (request.method === "POST" && reviewMatch) {
      const body = await readJson(request);
      const result = await store.update((state) => {
        const candidate = state.feedbackCandidates.find((item) => item.id === reviewMatch[1]);
        return reviewCandidate(candidate, { decision: body.decision, reviewerId: body.reviewer_id || "reviewer_local" });
      });
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    const evaluateMatch = url.pathname.match(/^\/knowledge\/feedback-candidates\/([^/]+)\/evaluate$/);
    if (request.method === "POST" && evaluateMatch) {
      const body = await readJson(request);
      const result = await store.update((state) => {
        const candidate = state.feedbackCandidates.find((item) => item.id === evaluateMatch[1]);
        return evaluateCandidate(candidate, { result: body.result || "pass" });
      });
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    const publishMatch = url.pathname.match(/^\/knowledge\/feedback-candidates\/([^/]+)\/publish-local$/);
    if (request.method === "POST" && publishMatch) {
      if (!config.enableDemoPublishedKnowledge) {
        sendJson(response, 409, { ok: false, status: "demo_only_disabled", reason: "publish_local_disabled" });
        return true;
      }
      const result = await store.update((state) => {
        const candidate = state.feedbackCandidates.find((item) => item.id === publishMatch[1]);
        return publishCandidate(state, candidate);
      });
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    const publishCandidateToLlmWikiMatch = url.pathname.match(/^\/knowledge\/feedback-candidates\/([^/]+)\/publish-to-llm-wiki$/);
    if (request.method === "POST" && publishCandidateToLlmWikiMatch) {
      const result = await store.update((state) => {
        const candidate = state.feedbackCandidates.find((item) => item.id === publishCandidateToLlmWikiMatch[1]);
        return knowledgeLifecycleService.publishCandidateToLlmWiki(candidate);
      }).catch((error) => ({ ok: false, status: "failed", reason: error.message }));
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    const refreshCandidateMatch = url.pathname.match(/^\/knowledge\/feedback-candidates\/([^/]+)\/refresh-llm-wiki-status$/);
    if (request.method === "POST" && refreshCandidateMatch) {
      const result = await store.update((state) => {
        const candidate = state.feedbackCandidates.find((item) => item.id === refreshCandidateMatch[1]);
        return knowledgeLifecycleService.refreshCandidateFromLlmWiki(candidate);
      }).catch((error) => ({ ok: false, status: "failed", reason: error.message }));
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    if (request.method === "POST" && url.pathname === "/knowledge/sync/llm-wiki-to-ragflow") {
      const body = await readJson(request);
      const requestedDatasetNames = body.dataset_name ? [body.dataset_name] : config.ragflowDatasetNames;
      const resolvedDataset = body.dataset_id
        ? { ok: true, datasetIds: [body.dataset_id] }
        : await ragflowClient.resolveDatasetIds({ datasetIds: config.ragflowDatasetIds, datasetNames: requestedDatasetNames }).catch((error) => ({ ok: false, reason: error.message }));
      if (!resolvedDataset.ok && !body.create_dataset) {
        sendJson(response, 409, { ok: false, status: "unconfigured", reason: resolvedDataset.reason || "ragflow_dataset_not_resolved" });
        return true;
      }
      const result = await store.update(async (state) => {
        try {
          return await knowledgeSyncService.syncApprovedCandidate({
            candidatePath: body.candidate_path || config.llmWikiCandidatePath,
            datasetId: resolvedDataset?.ok ? resolvedDataset.datasetIds[0] : null,
            datasetName: body.dataset_name,
            waitForParse: Boolean(body.wait_for_parse),
            force: Boolean(body.force),
            state,
          });
        } catch (error) {
          return { ok: false, status: "failed", reason: error.message };
        }
      }).catch((error) => ({ ok: false, status: "failed", reason: error.message }));
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    if (request.method === "GET" && url.pathname === "/knowledge/sync-jobs") {
      const state = await store.load();
      sendJson(response, 200, { ok: true, jobs: state.knowledgeSyncJobs });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/knowledge/sync/retry-due") {
      const body = await readJson(request);
      const result = await store.update((state) => knowledgeSyncService.retryDueJobs({ state, now: body.now || new Date(), limit: body.limit || 10, waitForParse: Boolean(body.wait_for_parse) })).catch((error) => ({ ok: false, status: "failed", reason: error.message }));
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    if (request.method === "POST" && url.pathname === "/knowledge/answer-loop/sync-and-verify") {
      const body = await readJson(request);
      const requestedDatasetNames = body.dataset_name ? [body.dataset_name] : config.ragflowDatasetNames;
      const resolvedDataset = body.dataset_id
        ? { ok: true, datasetIds: [body.dataset_id] }
        : await ragflowClient.resolveDatasetIds({ datasetIds: config.ragflowDatasetIds, datasetNames: requestedDatasetNames }).catch((error) => ({ ok: false, reason: error.message }));
      if (!resolvedDataset.ok && !body.create_dataset) {
        const result = await store.update((state) => knowledgeAnswerLoopService.recordBlocked({ state, candidatePath: body.candidate_path || config.llmWikiCandidatePath, question: body.question || null, expectedAnswer: body.expected_answer || null, reason: resolvedDataset.reason || "ragflow_dataset_not_resolved" }));
        sendJson(response, 409, result);
        return true;
      }
      const result = await store.update((state) => knowledgeAnswerLoopService.syncAndVerify({ candidatePath: body.candidate_path || config.llmWikiCandidatePath, datasetId: resolvedDataset?.ok ? resolvedDataset.datasetIds[0] : null, datasetName: body.dataset_name, question: body.question, expectedAnswer: body.expected_answer, waitForParse: Boolean(body.wait_for_parse), force: Boolean(body.force), physicalReplace: Boolean(body.physical_replace), state })).catch((error) => ({ ok: false, status: "answer_failed", reason: error.message }));
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    if (request.method === "GET" && url.pathname === "/knowledge/answer-loop/checks") {
      const state = await store.load();
      sendJson(response, 200, { ok: true, checks: state.knowledgeAnswerChecks });
      return true;
    }

    if (request.method === "GET" && url.pathname === "/knowledge/documents") {
      const state = await store.load();
      sendJson(response, 200, { ok: true, documents: state.knowledgeDocuments });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/knowledge/answer-loop/scan-approved") {
      const body = await readJson(request);
      const result = await store.update((state) => knowledgeScanService.scanApproved({ scanRoot: body.scan_root || "wiki/approved-answers", autoSync: Boolean(body.auto_sync), autoWithdraw: body.auto_withdraw !== false, physicalWithdraw: Boolean(body.physical_withdraw), physicalReplace: Boolean(body.physical_replace), state })).catch((error) => ({ ok: false, status: "failed", reason: error.message }));
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    if (request.method === "GET" && url.pathname === "/knowledge/answer-loop/scan-runs") {
      const state = await store.load();
      sendJson(response, 200, { ok: true, runs: state.knowledgeScanRuns });
      return true;
    }

    const scanRunMatch = url.pathname.match(/^\/knowledge\/answer-loop\/scan-runs\/([^/]+)$/);
    if (request.method === "GET" && scanRunMatch) {
      const state = await store.load();
      const run = state.knowledgeScanRuns.find((item) => item.id === scanRunMatch[1]);
      sendJson(response, run ? 200 : 404, run ? { ok: true, run } : { ok: false, reason: "scan_run_not_found" });
      return true;
    }

    if (request.method === "GET" && url.pathname === "/knowledge/alerts") {
      const state = await store.load();
      sendJson(response, 200, { ok: true, alerts: state.knowledgeAlerts });
      return true;
    }

    const acknowledgeAlertMatch = url.pathname.match(/^\/knowledge\/alerts\/([^/]+)\/acknowledge$/);
    if (request.method === "POST" && acknowledgeAlertMatch) {
      const body = await readJson(request);
      const result = await store.update((state) => acknowledgeKnowledgeAlert(state, acknowledgeAlertMatch[1], body.actor || "operator_local"));
      sendJson(response, result.ok ? 200 : 404, result);
      return true;
    }

    if (request.method === "POST" && url.pathname === "/knowledge/answer-loop/withdraw") {
      const body = await readJson(request);
      const result = await store.update((state) => knowledgeAnswerLoopService.withdraw({ sourcePath: body.source_path || body.candidate_path || null, documentId: body.document_id || null, reason: body.reason || "withdrawn", question: body.question || null, physicalDelete: Boolean(body.physical_delete), verifyCleared: Boolean(body.verify_cleared), state })).catch((error) => ({ ok: false, status: "sync_blocked", reason: error.message }));
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    const answerCheckMatch = url.pathname.match(/^\/knowledge\/answer-loop\/checks\/([^/]+)$/);
    if (request.method === "GET" && answerCheckMatch) {
      const state = await store.load();
      const check = state.knowledgeAnswerChecks.find((item) => item.id === answerCheckMatch[1]);
      sendJson(response, check ? 200 : 404, check ? { ok: true, check } : { ok: false, reason: "answer_check_not_found" });
      return true;
    }

    const syncJobMatch = url.pathname.match(/^\/knowledge\/sync-jobs\/([^/]+)$/);
    if (request.method === "GET" && syncJobMatch) {
      const state = await store.load();
      const job = state.knowledgeSyncJobs.find((item) => item.id === syncJobMatch[1]);
      sendJson(response, job ? 200 : 404, job ? { ok: true, job } : { ok: false, reason: "sync_job_not_found" });
      return true;
    }

    const retrySyncJobMatch = url.pathname.match(/^\/knowledge\/sync-jobs\/([^/]+)\/retry$/);
    if (request.method === "POST" && retrySyncJobMatch) {
      const body = await readJson(request);
      const result = await store.update((state) => knowledgeSyncService.retrySyncJob({ jobId: retrySyncJobMatch[1], state, waitForParse: Boolean(body.wait_for_parse), force: body.force !== false })).catch((error) => ({ ok: false, status: "failed", reason: error.message }));
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    if (request.method === "GET" && url.pathname === "/knowledge/artifacts") {
      const state = await store.load();
      sendJson(response, 200, { ok: true, artifacts: state.feedbackCandidates.map(toKnowledgeArtifact) });
      return true;
    }

    return false;
  };
}
