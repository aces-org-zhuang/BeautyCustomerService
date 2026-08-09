import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

const required = ["RAGFLOW_API_KEY", "LLM_WIKI_CANDIDATE_PATH"];
const missing = required.filter((name) => !process.env[name]);
if (!process.env.RAGFLOW_DATASET_IDS && !process.env.RAGFLOW_DATASET_NAMES) missing.push("RAGFLOW_DATASET_IDS or RAGFLOW_DATASET_NAMES");

if (missing.length > 0) {
  console.log(JSON.stringify({ ok: true, status: "skipped", reason: "missing_live_env", missing }, null, 2));
  process.exit(0);
}

const dir = await mkdtemp(join(tmpdir(), "bcs-live-verify-"));
const config = { ...loadConfig(), dataFile: join(dir, "store.json") };
const server = createServer(createApp(config));

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const postJson = async (path, body) => {
    const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { statusCode: response.status, body: await response.json() };
  };
  const health = await fetch(`${baseUrl}/integrations/health`).then((item) => item.json());
  const lifecycle = await postJson("/integrations/ragflow/lifecycle-probe", { question: process.env.BCS_LIVE_VERIFY_QUESTION || "bcs lifecycle probe" });
  const sync = await postJson("/knowledge/answer-loop/sync-and-verify", {
    candidate_path: process.env.LLM_WIKI_CANDIDATE_PATH,
    question: process.env.BCS_LIVE_VERIFY_QUESTION,
    expected_answer: process.env.BCS_LIVE_VERIFY_EXPECTED_ANSWER,
    wait_for_parse: process.env.BCS_LIVE_WAIT_FOR_PARSE === "1",
  });
  const ok = health.ragflow?.ok && health.llm_wiki?.ok && lifecycle.body.ok && sync.body.ok;
  console.log(JSON.stringify({ ok, status: ok ? "passed" : "failed", health, lifecycle: lifecycle.body, sync: sync.body }, null, 2));
  process.exit(ok ? 0 : 1);
} finally {
  server.close();
  await rm(dir, { recursive: true, force: true });
}
