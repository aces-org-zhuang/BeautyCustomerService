import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function createEmptyState() {
  return {
    conversations: [],
    events: [],
    outbox: [],
    handoffTickets: [],
    feedbackCandidates: [],
    publishedKnowledge: [],
    decisionLogs: [],
    materials: [],
    materialBatches: [],
    materialAssets: [],
    materialBlocks: [],
    materialParseJobs: [],
    distillations: [],
    knowledgeSyncJobs: [],
    knowledgeAnswerChecks: [],
    knowledgeDocuments: [],
    knowledgeScanRuns: [],
    knowledgeAlerts: [],
    ragflowLifecycleChecks: [],
    replyPolicy: null,
  };
}

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return { ...createEmptyState(), ...JSON.parse(raw) };
    } catch (error) {
      if (error.code === "ENOENT") return createEmptyState();
      throw error;
    }
  }

  async save(state) {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  async update(mutator) {
    const operation = this.writeQueue.then(async () => {
      const state = await this.load();
      const result = await mutator(state);
      await this.save(state);
      return result;
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async reset() {
    const state = createEmptyState();
    await this.save(state);
    return state;
  }
}
