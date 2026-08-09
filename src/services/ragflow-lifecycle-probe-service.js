import { hashId, nowIso } from "../domain/ids.js";

export class RagflowLifecycleProbeService {
  constructor({ ragflowClient }) {
    this.ragflowClient = ragflowClient;
  }

  async probeDocumentLifecycle({ datasetName = `bcs_lifecycle_probe_${Date.now()}`, question = "bcs lifecycle probe", state = null }) {
    const startedAt = nowIso();
    const check = {
      id: hashId("ragflow_lifecycle", `${datasetName}:${startedAt}`),
      dataset_name: datasetName,
      dataset_id: null,
      document_id: null,
      delete_supported: false,
      retrieval_cleared: false,
      status: "started",
      failure_reason: null,
      created_at: startedAt,
      updated_at: startedAt,
    };
    if (state) state.ragflowLifecycleChecks.push(check);

    if (!this.ragflowClient.configured) {
      return this.finish(check, "blocked", "missing_ragflow_api_key");
    }

    try {
      const datasetId = await this.ragflowClient.createDataset(datasetName);
      check.dataset_id = datasetId;
      const documentId = await this.ragflowClient.uploadDocument(datasetId, {
        displayName: "bcs-lifecycle-probe.md",
        content: `Answer: ${question} should disappear after delete.\n\nSync metadata:\nquestion: ${question}`,
      });
      check.document_id = documentId;
      await this.ragflowClient.parseDocument(datasetId, documentId);
      await this.ragflowClient.deleteDocument(datasetId, documentId);
      check.delete_supported = true;

      const docAfterDelete = await this.ragflowClient.getDocument(datasetId, documentId).catch(() => null);
      const retrievalAfterDelete = await this.ragflowClient.retrieve({ datasetIds: [datasetId], question }).catch((error) => ({ ok: false, reason: error.message, chunks: [] }));
      check.retrieval_cleared = !docAfterDelete && (retrievalAfterDelete.chunks || []).length === 0;
      return this.finish(check, check.retrieval_cleared ? "lifecycle_supported" : "delete_unverified", check.retrieval_cleared ? null : "document_or_retrieval_still_visible_after_delete");
    } catch (error) {
      return this.finish(check, "blocked", error.message);
    }
  }

  finish(check, status, failureReason) {
    check.status = status;
    check.failure_reason = failureReason;
    check.updated_at = nowIso();
    return { ok: status === "lifecycle_supported", status, check };
  }
}
