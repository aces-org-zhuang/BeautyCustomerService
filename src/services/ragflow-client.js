function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function readJsonResponse(response) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  if (!response.ok || (body && body.code && body.code !== 0)) {
    throw new Error(`ragflow_request_failed:${response.status}:${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

export class RagflowClient {
  constructor({ baseUrl, apiKey }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  get configured() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  headers(extra = {}) {
    return { Authorization: `Bearer ${this.apiKey}`, ...extra };
  }

  async health() {
    if (!this.configured) return { ok: false, status: "unconfigured", reason: "missing_ragflow_api_key" };
    try {
      const response = await fetch(joinUrl(this.baseUrl, "/api/v1/datasets"), { headers: this.headers() });
      if (response.status === 401) return { ok: false, status: "auth_failed", statusCode: 401 };
      await readJsonResponse(response);
      return { ok: true, status: "reachable" };
    } catch (error) {
      return { ok: false, status: "unreachable", reason: error.message };
    }
  }

  async retrieve({ datasetIds, question }) {
    if (!this.configured) return { ok: false, status: "unconfigured", reason: "missing_ragflow_api_key" };
    if (!datasetIds || datasetIds.length === 0) return { ok: false, status: "unconfigured", reason: "missing_ragflow_dataset_ids" };
    const body = {
      dataset_ids: datasetIds,
      question,
      page: 1,
      page_size: 5,
      similarity_threshold: 0.1,
      vector_similarity_weight: 0.3,
      top_k: 10,
    };
    const json = await readJsonResponse(await fetch(joinUrl(this.baseUrl, "/api/v1/retrieval"), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    }));
    const chunks = json?.data?.chunks || json?.data || [];
    return { ok: true, chunks: Array.isArray(chunks) ? chunks : [] };
  }

  async listDatasets() {
    if (!this.configured) return { ok: false, status: "unconfigured", reason: "missing_ragflow_api_key" };
    const json = await readJsonResponse(await fetch(joinUrl(this.baseUrl, "/api/v1/datasets"), { headers: this.headers() }));
    const raw = json?.data?.datasets || json?.data?.kbs || json?.data || [];
    return { ok: true, datasets: Array.isArray(raw) ? raw : [] };
  }

  async resolveDatasetIds({ datasetIds = [], datasetNames = [] }) {
    if (datasetIds.length > 0) return { ok: true, datasetIds, source: "env_ids" };
    if (datasetNames.length === 0) return { ok: false, status: "unconfigured", reason: "missing_ragflow_dataset_ids_or_names" };
    const listed = await this.listDatasets();
    if (!listed.ok) return listed;
    const resolved = listed.datasets
      .filter((dataset) => datasetNames.includes(dataset.name))
      .map((dataset) => dataset.id)
      .filter(Boolean);
    const missing = datasetNames.filter((name) => !listed.datasets.some((dataset) => dataset.name === name));
    if (resolved.length === 0) return { ok: false, status: "unconfigured", reason: "ragflow_dataset_names_not_found", missing };
    return { ok: true, datasetIds: resolved, source: "resolved_names", missing };
  }

  async createDataset(name, options = {}) {
    const body = { name };
    if (options.chunkMethod) body.chunk_method = options.chunkMethod;
    if (options.parserConfig) body.parser_config = options.parserConfig;
    const json = await readJsonResponse(await fetch(joinUrl(this.baseUrl, "/api/v1/datasets"), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    }));
    return json.data.id;
  }

  async uploadDocument(datasetId, { displayName, content, contentType = "text/markdown;charset=utf-8" }) {
    const form = new FormData();
    form.append("file", new Blob([content], { type: contentType }), displayName);
    const json = await readJsonResponse(await fetch(joinUrl(this.baseUrl, `/api/v1/datasets/${datasetId}/documents`), {
      method: "POST",
      headers: this.headers(),
      body: form,
    }));
    const docs = Array.isArray(json.data) ? json.data : [json.data];
    return docs[0].id;
  }

  async uploadDocumentBytes(datasetId, { displayName, bytes, contentType = "application/octet-stream" }) {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: contentType }), displayName);
    const json = await readJsonResponse(await fetch(joinUrl(this.baseUrl, `/api/v1/datasets/${datasetId}/documents`), {
      method: "POST",
      headers: this.headers(),
      body: form,
    }));
    const docs = Array.isArray(json.data) ? json.data : [json.data];
    return docs[0].id;
  }

  async parseDocument(datasetId, documentId) {
    await readJsonResponse(await fetch(joinUrl(this.baseUrl, `/api/v1/datasets/${datasetId}/chunks`), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ document_ids: [documentId] }),
    }));
  }

  async getDocument(datasetId, documentId) {
    const json = await readJsonResponse(await fetch(joinUrl(this.baseUrl, `/api/v1/datasets/${datasetId}/documents?id=${encodeURIComponent(documentId)}`), {
      headers: this.headers(),
    }));
    return Array.isArray(json.data?.docs) ? json.data.docs[0] : Array.isArray(json.data) ? json.data[0] : null;
  }

  async deleteDocument(datasetId, documentId) {
    await readJsonResponse(await fetch(joinUrl(this.baseUrl, `/api/v1/datasets/${datasetId}/documents`), {
      method: "DELETE",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ids: [documentId] }),
    }));
  }
}
