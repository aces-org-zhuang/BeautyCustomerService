import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

class LlmWikiRequestError extends Error {
  constructor(response, body) {
    super(`llm_wiki_request_failed:${response.status}:${JSON.stringify(body).slice(0, 500)}`);
    this.status = response.status;
    this.body = body;
  }
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
    throw new LlmWikiRequestError(response, body);
  }
  return body;
}

function safeProjectFilePath(projectPath, wikiPath) {
  if (!wikiPath || wikiPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(wikiPath)) {
    throw new Error("invalid_llm_wiki_relative_path");
  }
  const projectRoot = resolve(projectPath);
  const targetPath = resolve(projectRoot, wikiPath.replaceAll("\\", "/"));
  if (targetPath !== projectRoot && !targetPath.startsWith(`${projectRoot}${sep}`)) {
    throw new Error("llm_wiki_path_escapes_project");
  }
  return targetPath;
}

function toWikiPath(rootPath, filePath) {
  return filePath.slice(resolve(rootPath).length + 1).replaceAll("\\", "/");
}

export class LlmWikiClient {
  constructor({ baseUrl, token }) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  get configured() {
    return Boolean(this.baseUrl);
  }

  headers(extra = {}) {
    const auth = this.token ? { Authorization: `Bearer ${this.token}`, "X-LLM-Wiki-Token": this.token } : {};
    return { ...auth, ...extra };
  }

  async health() {
    if (!this.configured) return { ok: false, status: "unconfigured", reason: "missing_llm_wiki_base_url" };
    try {
      const body = await readJsonResponse(await fetch(joinUrl(this.baseUrl, "/api/v1/health"), { headers: this.headers() }));
      return { ok: true, status: "reachable", body };
    } catch (error) {
      return { ok: false, status: "unreachable", reason: error.message };
    }
  }

  async readFile(path) {
    const body = await readJsonResponse(await fetch(joinUrl(this.baseUrl, `/api/v1/projects/current/files/content?path=${encodeURIComponent(path)}`), {
      headers: this.headers(),
    }));
    return body.content;
  }

  async currentProject() {
    const body = await readJsonResponse(await fetch(joinUrl(this.baseUrl, "/api/v1/projects"), {
      headers: this.headers(),
    }));
    return body.currentProject;
  }

  async rescanSources() {
    const body = await readJsonResponse(await fetch(joinUrl(this.baseUrl, "/api/v1/projects/current/sources/rescan"), {
      method: "POST",
      headers: this.headers(),
    }));
    return body;
  }

  async listMarkdownFiles(rootPath) {
    const project = await this.currentProject();
    if (!project?.path) throw new Error("missing_llm_wiki_current_project_path");
    const scanRootPath = safeProjectFilePath(project.path, rootPath);
    const entries = [];
    async function visit(dir) {
      const items = await readdir(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name === ".llm-wiki" || item.name === "vendor") continue;
        const fullPath = resolve(dir, item.name);
        if (item.isDirectory()) {
          await visit(fullPath);
          continue;
        }
        if (item.isFile() && item.name.endsWith(".md")) entries.push(toWikiPath(project.path, fullPath));
      }
    }
    await visit(scanRootPath);
    return entries.sort();
  }

  async writeFile(path, content) {
    try {
      const body = await readJsonResponse(await fetch(joinUrl(this.baseUrl, "/api/v1/projects/current/files/content"), {
        method: "PUT",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ path, content }),
      }));
      return { ok: true, path, method: "http_put", body };
    } catch (error) {
      if (error.status !== 405) throw error;
      const project = await this.currentProject();
      if (!project?.path) throw new Error("missing_llm_wiki_current_project_path");
      const targetPath = safeProjectFilePath(project.path, path);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content, "utf8");
      const rescan = await this.rescanSources();
      return { ok: true, path, method: "project_file_rescan", projectId: project.id, projectPath: project.path, rescan };
    }
  }
}
