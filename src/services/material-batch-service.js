import { hashId, nowIso } from "../domain/ids.js";
import { distillMaterial } from "./material-service.js";

function normalizeAsset(input, batchId, index) {
  const filename = input.filename || `material-${index + 1}.md`;
  const content = String(input.content || "").trim();
  const contentBase64 = input.content_base64 || input.contentBase64 || null;
  const mimeType = input.mime_type || input.mimeType || (filename.endsWith(".md") ? "text/markdown" : "text/plain");
  const checksum = hashId("asset_checksum", `${filename}:${mimeType}:${content || contentBase64 || ""}`);
  const localExtractable = mimeType.startsWith("text/") || filename.endsWith(".md") || filename.endsWith(".txt");
  return {
    id: hashId("asset", `${batchId}:${filename}:${checksum}`),
    batch_id: batchId,
    filename,
    mime_type: mimeType,
    content,
    content_base64: contentBase64,
    checksum,
    extraction_status: content || contentBase64 ? localExtractable ? "uploaded" : "uploaded_binary" : "unsupported",
    ragflow: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

export function createMaterialBatch({ title, sourceNote = "operator_upload", operatorId = "operator_local", assets = [] }) {
  const normalizedTitle = title || "未命名材料包";
  const batchId = hashId("material_batch", `${normalizedTitle}:${sourceNote}:${Date.now()}`);
  const materialAssets = assets.map((asset, index) => normalizeAsset(asset, batchId, index));
  if (materialAssets.length === 0) return { ok: false, reason: "material_assets_required" };
  if (materialAssets.every((asset) => !asset.content && !asset.content_base64)) return { ok: false, reason: "material_asset_content_required" };
  const batch = {
    id: batchId,
    title: normalizedTitle,
    source_note: sourceNote,
    status: "uploaded",
    asset_ids: materialAssets.map((asset) => asset.id),
    block_ids: [],
    parse_job_ids: [],
    created_by: operatorId,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  return { ok: true, batch, assets: materialAssets };
}

export function createLocalBlocksForBatch(batch, assets) {
  const blocks = [];
  for (const asset of assets) {
    if (!asset.content) continue;
    const chunks = asset.content.split(/(?:\r?\n\s*){2,}|(?<=[。！？!?])\s*/u).map((item) => item.trim()).filter(Boolean);
    for (const [index, content] of chunks.entries()) {
      blocks.push({
        id: hashId("material_block", `${asset.id}:local:${index + 1}:${content}`),
        batch_id: batch.id,
        asset_id: asset.id,
        source_ref: `asset://${asset.id}#block-${index + 1}`,
        content,
        block_type: asset.mime_type === "text/markdown" ? "markdown" : "paragraph",
        source: "local_asset",
        metadata: { filename: asset.filename, chunk_index: index + 1 },
        created_at: nowIso(),
      });
    }
  }
  return blocks;
}

export async function startRagflowStagingParse({ ragflowClient, batch, assets, datasetName, chunkMethod = "naive", parserConfig = null, waitForParse = false }) {
  if (!ragflowClient.configured) return { ok: false, status: "unconfigured", reason: "missing_ragflow_api_key" };
  const datasetId = await ragflowClient.createDataset(datasetName || `beauty-material-staging-${Date.now()}`, { chunkMethod, parserConfig });
  const uploaded = [];
  for (const asset of assets) {
    if (!asset.content && !asset.content_base64) continue;
    const stagingDisplayName = asset.mime_type === "text/markdown" && asset.filename.endsWith(".md") ? asset.filename.replace(/\.md$/i, ".txt") : asset.filename;
    const stagingContentType = asset.mime_type === "text/markdown" ? "text/plain" : asset.mime_type;
    const documentId = asset.content_base64
      ? await ragflowClient.uploadDocumentBytes(datasetId, {
        displayName: stagingDisplayName,
        bytes: Uint8Array.from(Buffer.from(asset.content_base64, "base64")),
        contentType: stagingContentType,
      })
      : await ragflowClient.uploadDocument(datasetId, {
        displayName: stagingDisplayName,
        content: asset.content,
        contentType: stagingContentType,
      });
    await ragflowClient.parseDocument(datasetId, documentId);
    asset.extraction_status = "parsing";
    asset.ragflow = { dataset_id: datasetId, document_id: documentId, dataset_name: datasetName || null, staging_filename: stagingDisplayName };
    asset.updated_at = nowIso();
    uploaded.push({ asset_id: asset.id, dataset_id: datasetId, document_id: documentId });
  }
  const job = {
    id: hashId("parse_job", `${batch.id}:${datasetId}:${Date.now()}`),
    batch_id: batch.id,
    target: "ragflow_staging",
    status: uploaded.length > 0 ? "started" : "no_uploadable_assets",
    dataset_id: datasetId,
    dataset_name: datasetName || null,
    chunk_method: chunkMethod,
    parser_config: parserConfig,
    uploaded,
    wait_for_parse: Boolean(waitForParse),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  batch.status = "parsing";
  batch.parse_job_ids = [...(batch.parse_job_ids || []), job.id];
  batch.updated_at = nowIso();
  return { ok: true, job, assets, batch };
}

export async function refreshRagflowBlocks({ ragflowClient, batch, assets }) {
  if (!ragflowClient.configured) return { ok: false, status: "unconfigured", reason: "missing_ragflow_api_key" };
  const blocks = [];
  const documents = [];
  for (const asset of assets) {
    if (!asset.ragflow?.dataset_id || !asset.ragflow?.document_id) continue;
    const document = await ragflowClient.getDocument(asset.ragflow.dataset_id, asset.ragflow.document_id);
    documents.push(document);
    if (document && (document.run === "DONE" || document.run === "1") && Number(document.progress) >= 1) asset.extraction_status = "parsed";
    else asset.extraction_status = "parsing";
    asset.updated_at = nowIso();
    if (asset.extraction_status !== "parsed") continue;
    const retrieval = await ragflowClient.retrieve({ datasetIds: [asset.ragflow.dataset_id], question: batch.title });
    for (const [index, chunk] of retrieval.chunks.entries()) {
      const content = String(chunk.content || chunk.content_with_weight || "").trim();
      if (!content) continue;
      blocks.push({
        id: hashId("material_block", `${asset.id}:ragflow:${chunk.id || index}:${content}`),
        batch_id: batch.id,
        asset_id: asset.id,
        source_ref: `ragflow://${asset.ragflow.dataset_id}/${asset.ragflow.document_id}/${chunk.id || index}`,
        content,
        block_type: "ragflow_chunk",
        source: "ragflow_staging",
        metadata: {
          dataset_id: asset.ragflow.dataset_id,
          document_id: asset.ragflow.document_id,
          chunk_id: chunk.id || null,
          document_name: chunk.document_name || asset.filename,
          similarity: chunk.similarity ?? null,
        },
        created_at: nowIso(),
      });
    }
  }
  if (blocks.length > 0) {
    batch.status = "parsed";
    batch.block_ids = [...new Set([...(batch.block_ids || []), ...blocks.map((block) => block.id)])];
  }
  batch.updated_at = nowIso();
  return { ok: true, batch, assets, documents, blocks };
}

export function distillMaterialBatch(batch, blocks) {
  if (!batch) return { ok: false, reason: "material_batch_not_found" };
  const usableBlocks = blocks.filter((block) => block.batch_id === batch.id && block.content);
  if (usableBlocks.length === 0) return { ok: false, reason: "material_blocks_required" };
  const material = {
    id: batch.id,
    title: batch.title,
    body: usableBlocks.map((block) => block.content).join("\n\n"),
  };
  const distilled = distillMaterial(material);
  if (!distilled.ok) return distilled;
  distilled.distillation.batch_id = batch.id;
  distilled.distillation.source = usableBlocks.some((block) => block.source === "ragflow_staging") ? "ragflow_chunks" : "local_blocks";
  distilled.distillation.source_blocks = usableBlocks.map((block) => block.id);
  for (const candidate of distilled.distillation.faq_candidates) {
    const block = usableBlocks.find((item) => candidate.source_excerpt && item.content.includes(candidate.source_excerpt)) || usableBlocks[0];
    candidate.batch_id = batch.id;
    candidate.source_refs = [block.source_ref];
    candidate.source_excerpt = block.content;
    candidate.confidence_basis = `${distilled.distillation.source}_source_match`;
  }
  batch.status = "distilled";
  batch.updated_at = nowIso();
  return distilled;
}
