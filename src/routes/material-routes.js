import { hashId } from "../domain/ids.js";
import { createLocalBlocksForBatch, createMaterialBatch, distillMaterialBatch, refreshRagflowBlocks, startRagflowStagingParse } from "../services/material-batch-service.js";
import { createMaterial, distillMaterial } from "../services/material-service.js";

export function createMaterialRoutes({ config, store, ragflowClient, knowledgeLifecycleService, sendJson, readJson, readMaterialImportRequest }) {
  return async function handleMaterialRoutes({ request, response, url }) {
    if (request.method === "GET" && url.pathname === "/materials") {
      const state = await store.load();
      sendJson(response, 200, { ok: true, materials: state.materials });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/materials") {
      const body = await readJson(request);
      const result = await store.update((state) => {
        const created = createMaterial({ title: body.title, body: body.body, type: body.type, sourceNote: body.source_note });
        if (created.ok) state.materials.push(created.material);
        return created;
      });
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    if (request.method === "GET" && url.pathname === "/materials/batches") {
      const state = await store.load();
      sendJson(response, 200, { ok: true, batches: state.materialBatches, assets: state.materialAssets, blocks: state.materialBlocks });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/materials/import") {
      const body = await readMaterialImportRequest(request);
      const result = await store.update((state) => {
        const created = createMaterialBatch({ title: body.title, sourceNote: body.source_note, operatorId: body.operator_id, assets: body.assets || [] });
        if (!created.ok) return created;
        const localBlocks = createLocalBlocksForBatch(created.batch, created.assets);
        created.batch.block_ids = localBlocks.map((block) => block.id);
        state.materialBatches.push(created.batch);
        state.materialAssets.push(...created.assets);
        state.materialBlocks.push(...localBlocks);
        return { ...created, blocks: localBlocks };
      });
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    const batchParseMatch = url.pathname.match(/^\/materials\/batches\/([^/]+)\/parse$/);
    if (request.method === "POST" && batchParseMatch) {
      const body = await readJson(request);
      const state = await store.load();
      const batch = state.materialBatches.find((item) => item.id === batchParseMatch[1]);
      if (!batch) {
        sendJson(response, 404, { ok: false, reason: "material_batch_not_found" });
        return true;
      }
      const assets = state.materialAssets.filter((item) => item.batch_id === batch.id);
      const parsed = await startRagflowStagingParse({
        ragflowClient,
        batch,
        assets,
        datasetName: body.dataset_name || config.ragflowStagingDatasetName,
        chunkMethod: body.chunk_method || config.ragflowStagingChunkMethod,
        parserConfig: body.parser_config || {
          chunk_token_num: config.ragflowStagingChunkTokenNum,
          delimiter: config.ragflowStagingDelimiter,
          raptor: { use_raptor: false },
          graphrag: { use_graphrag: false },
          parent_child: { use_parent_child: false, children_delimiter: "\n" },
        },
        waitForParse: Boolean(body.wait_for_parse),
      }).catch((error) => ({ ok: false, status: "failed", reason: error.message }));
      if (parsed.ok) {
        await store.save({
          ...state,
          materialBatches: state.materialBatches.map((item) => item.id === batch.id ? parsed.batch : item),
          materialAssets: state.materialAssets.map((item) => parsed.assets.find((asset) => asset.id === item.id) || item),
          materialParseJobs: [...state.materialParseJobs, parsed.job],
        });
      }
      sendJson(response, parsed.ok ? 200 : 409, parsed);
      return true;
    }

    const batchRefreshMatch = url.pathname.match(/^\/materials\/batches\/([^/]+)\/refresh-blocks$/);
    if (request.method === "POST" && batchRefreshMatch) {
      const state = await store.load();
      const batch = state.materialBatches.find((item) => item.id === batchRefreshMatch[1]);
      if (!batch) {
        sendJson(response, 404, { ok: false, reason: "material_batch_not_found" });
        return true;
      }
      const assets = state.materialAssets.filter((item) => item.batch_id === batch.id);
      const refreshed = await refreshRagflowBlocks({ ragflowClient, batch, assets }).catch((error) => ({ ok: false, status: "failed", reason: error.message }));
      if (refreshed.ok) {
        const existingBlockIds = new Set(state.materialBlocks.map((block) => block.id));
        await store.save({
          ...state,
          materialBatches: state.materialBatches.map((item) => item.id === batch.id ? refreshed.batch : item),
          materialAssets: state.materialAssets.map((item) => refreshed.assets.find((asset) => asset.id === item.id) || item),
          materialBlocks: [...state.materialBlocks, ...refreshed.blocks.filter((block) => !existingBlockIds.has(block.id))],
        });
      }
      sendJson(response, refreshed.ok ? 200 : 409, refreshed);
      return true;
    }

    const batchDistillMatch = url.pathname.match(/^\/materials\/batches\/([^/]+)\/distill$/);
    if (request.method === "POST" && batchDistillMatch) {
      const result = await store.update((state) => {
        const batch = state.materialBatches.find((item) => item.id === batchDistillMatch[1]);
        const blocks = state.materialBlocks.filter((item) => item.batch_id === batchDistillMatch[1]);
        const distilled = distillMaterialBatch(batch, blocks);
        if (distilled.ok) {
          state.distillations.push(distilled.distillation);
          for (const candidate of distilled.distillation.faq_candidates) {
            const existingCandidate = state.feedbackCandidates.find((item) => item.id === candidate.id);
            if (existingCandidate) Object.assign(existingCandidate, candidate);
            else state.feedbackCandidates.push(candidate);
          }
        }
        return distilled;
      });
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    const materialMatch = url.pathname.match(/^\/materials\/([^/]+)$/);
    if (request.method === "GET" && materialMatch) {
      const state = await store.load();
      const material = state.materials.find((item) => item.id === materialMatch[1]);
      sendJson(response, material ? 200 : 404, material ? { ok: true, material } : { ok: false, reason: "material_not_found" });
      return true;
    }

    const distillMatch = url.pathname.match(/^\/materials\/([^/]+)\/distill$/);
    if (request.method === "POST" && distillMatch) {
      const body = await readJson(request);
      const result = await store.update((state) => {
        const material = state.materials.find((item) => item.id === distillMatch[1]);
        if (!material) return { ok: false, reason: "material_not_found" };
        const materialVersion = hashId("material_version", `${material.id}:${material.title}:${material.body}`);
        const existing = state.distillations.find((item) => item.material_id === material.id && item.material_version === materialVersion);
        if (existing && !body.force) return { ok: true, distillation: existing, reused: true };
        const distilled = distillMaterial(material);
        if (distilled.ok) {
          state.distillations.push(distilled.distillation);
          for (const candidate of distilled.distillation.faq_candidates) {
            const existingCandidate = state.feedbackCandidates.find((item) => item.id === candidate.id);
            if (existingCandidate) Object.assign(existingCandidate, candidate);
            else state.feedbackCandidates.push(candidate);
          }
        }
        return distilled;
      });
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    const distillationsMatch = url.pathname.match(/^\/materials\/([^/]+)\/distillations$/);
    if (request.method === "GET" && distillationsMatch) {
      const state = await store.load();
      sendJson(response, 200, { ok: true, distillations: state.distillations.filter((item) => item.material_id === distillationsMatch[1]) });
      return true;
    }

    const publishMaterialMatch = url.pathname.match(/^\/materials\/([^/]+)\/publish-to-llm-wiki$/);
    if (request.method === "POST" && publishMaterialMatch) {
      const body = await readJson(request);
      const result = await store.update(async (state) => {
        const distillations = state.distillations.filter((item) => item.material_id === publishMaterialMatch[1]);
        const distillation = body.distillation_id ? distillations.find((item) => item.id === body.distillation_id) : distillations.at(-1);
        if (!distillation) return { ok: false, reason: "distillation_not_found" };
        const published = await knowledgeLifecycleService.publishDistillationToLlmWiki(distillation);
        if (!published.ok) return published;
        for (const writtenCandidate of distillation.faq_candidates || []) {
          const candidate = state.feedbackCandidates.find((item) => item.id === writtenCandidate.id);
          if (candidate) Object.assign(candidate, writtenCandidate);
        }
        return published;
      }).catch((error) => ({ ok: false, status: "failed", reason: error.message }));
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    return false;
  };
}
