export function createIntegrationRoutes({ config, store, ragflowClient, llmWikiClient, ragflowLifecycleProbeService, sendJson, readJson }) {
  return async function handleIntegrationRoutes({ request, response, url }) {
    if (request.method === "GET" && url.pathname === "/integrations/health") {
      const [ragflow, llmWiki, ragflowDatasets] = await Promise.all([
        ragflowClient.health(),
        llmWikiClient.health(),
        ragflowClient.resolveDatasetIds({ datasetIds: config.ragflowDatasetIds, datasetNames: config.ragflowDatasetNames }).catch((error) => ({ ok: false, reason: error.message })),
      ]);
      sendJson(response, 200, { ok: true, ragflow, ragflow_datasets: ragflowDatasets, llm_wiki: llmWiki, local_test_knowledge: { enabled: config.enableLocalTestKnowledge } });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/integrations/ragflow/lifecycle-probe") {
      const body = await readJson(request);
      const result = await store.update((state) => ragflowLifecycleProbeService.probeDocumentLifecycle({
        datasetName: body.dataset_name || `bcs_lifecycle_probe_${Date.now()}`,
        question: body.question || "bcs lifecycle probe",
        state,
      }));
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    if (request.method === "GET" && url.pathname === "/integrations/ragflow/lifecycle-probes") {
      const state = await store.load();
      sendJson(response, 200, { ok: true, checks: state.ragflowLifecycleChecks });
      return true;
    }

    return false;
  };
}
