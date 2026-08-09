const operatorId = "operator_local";

const elements = {
  status: document.querySelector("#status"),
  refresh: document.querySelector("#refresh"),
  form: document.querySelector("#message-form"),
  externalUserid: document.querySelector("#external-userid"),
  messageContent: document.querySelector("#message-content"),
  runtimeMode: document.querySelector("#runtime-mode"),
  pipeline: document.querySelector("#pipeline"),
  integrations: document.querySelector("#integrations"),
  integrationHealth: document.querySelector("#integration-health"),
  ragflowLifecycleProbe: document.querySelector("#ragflow-lifecycle-probe"),
  ragflowLifecycleChecks: document.querySelector("#ragflow-lifecycle-checks"),
  metrics: document.querySelector("#metrics"),
  policyProfile: document.querySelector("#policy-profile"),
  policyForm: document.querySelector("#policy-form"),
  policyGreeting: document.querySelector("#policy-greeting"),
  policyHandoff: document.querySelector("#policy-handoff"),
  policyClosing: document.querySelector("#policy-closing"),
  outbox: document.querySelector("#outbox"),
  outboxCount: document.querySelector("#outbox-count"),
  decisionLogs: document.querySelector("#decision-logs"),
  logCount: document.querySelector("#log-count"),
  tickets: document.querySelector("#tickets"),
  ticketCount: document.querySelector("#ticket-count"),
  candidates: document.querySelector("#candidates"),
  candidateCount: document.querySelector("#candidate-count"),
  answerChecks: document.querySelector("#answer-checks"),
  answerCheckCount: document.querySelector("#answer-check-count"),
  alerts: document.querySelector("#alerts"),
  alertCount: document.querySelector("#alert-count"),
  scanApproved: document.querySelector("#scan-approved"),
  scanApprovedSync: document.querySelector("#scan-approved-sync"),
  scanRuns: document.querySelector("#scan-runs"),
  scanRunCount: document.querySelector("#scan-run-count"),
  knowledgeDocuments: document.querySelector("#knowledge-documents"),
  knowledgeDocumentCount: document.querySelector("#knowledge-document-count"),
  localKnowledge: document.querySelector("#local-knowledge"),
  knowledgeCount: document.querySelector("#knowledge-count"),
  publishedKnowledge: document.querySelector("#published-knowledge"),
  publishedCount: document.querySelector("#published-count"),
  materialForm: document.querySelector("#material-form"),
  materialTitle: document.querySelector("#material-title"),
  materialBody: document.querySelector("#material-body"),
  materials: document.querySelector("#materials"),
  materialCount: document.querySelector("#material-count"),
  batchForm: document.querySelector("#batch-form"),
  batchTitle: document.querySelector("#batch-title"),
  batchFiles: document.querySelector("#batch-files"),
  batchContent: document.querySelector("#batch-content"),
  batches: document.querySelector("#batches"),
  batchCount: document.querySelector("#batch-count"),
};

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.dataset.state = isError ? "error" : "ok";
}

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(path, {
    ...options,
    headers: isFormData ? { ...(options.headers || {}) } : { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.reason || body.error || `${response.status} ${response.statusText}`);
  return body;
}

function emptyState(text) {
  const node = document.createElement("p");
  node.className = "empty";
  node.textContent = text;
  return node;
}

function badge(text, state) {
  const node = document.createElement("span");
  node.className = "badge";
  node.dataset.state = state || "neutral";
  node.textContent = text;
  return node;
}

function renderFeatures(features) {
  elements.runtimeMode.textContent = features.mode;
  elements.pipeline.replaceChildren();
  for (const item of features.pipeline) {
    const step = document.createElement("article");
    step.className = "step";
    step.append(badge(item.status, item.status), document.createElement("h3"), document.createElement("p"));
    step.querySelector("h3").textContent = item.label;
    step.querySelector("p").textContent = item.detail;
    elements.pipeline.append(step);
  }

  elements.integrations.replaceChildren();
  const integrationRows = [
    ["WeChat", features.integrations.wechat.mode, `blocked: ${features.integrations.wechat.blocked_prerequisites.join(", ")}`],
    ["RAGFlow", features.integrations.ragflow.mode, `retrieval: ${features.integrations.ragflow.retrieval_enabled} · ids: ${features.integrations.ragflow.dataset_ids_configured} · names: ${features.integrations.ragflow.dataset_names_configured.join(", ")} · ${features.integrations.ragflow.base_url}`],
    ["LLM Wiki", features.integrations.llm_wiki.mode, `candidate path configured: ${features.integrations.llm_wiki.candidate_path_configured}`],
    ["Evaluation", features.integrations.evaluation.mode, `requires: ${features.integrations.evaluation.publish_requires.join(" + ")}`],
  ];
  for (const [name, state, detail] of integrationRows) {
    const row = document.createElement("article");
    row.className = "integration";
    row.append(document.createElement("strong"), badge(state, state), document.createElement("p"));
    row.querySelector("strong").textContent = name;
    row.querySelector("p").textContent = detail;
    elements.integrations.append(row);
  }

  const metrics = features.metrics;
  const metricRows = [
    ["会话", metrics.conversations],
    ["事件", metrics.events],
    ["出站", metrics.outbox],
    ["日志", metrics.decision_logs],
    ["工单", metrics.tickets],
    ["候选", metrics.feedback_candidates],
    ["发布阻断", metrics.candidates_by_publication_decision.block || 0],
    ["本地发布", metrics.published_knowledge],
    ["材料", metrics.materials],
    ["材料包", metrics.material_batches],
    ["Blocks", metrics.material_blocks],
    ["蒸馏", metrics.distillations],
  ];
  elements.metrics.replaceChildren(...metricRows.map(([label, value]) => {
    const item = document.createElement("article");
    item.className = "metric";
    item.append(document.createElement("span"), document.createElement("strong"));
    item.querySelector("span").textContent = label;
    item.querySelector("strong").textContent = String(value);
    return item;
  }));
}

function renderReplyPolicy(policy) {
  elements.policyProfile.textContent = policy.profile;
  elements.policyGreeting.value = policy.greeting;
  elements.policyHandoff.value = policy.handoff_template;
  elements.policyClosing.value = policy.closing;
}

function renderIntegrationHealth(health) {
  elements.integrationHealth.replaceChildren();
  const rows = [
    ["RAGFlow", health.ragflow.status, health.ragflow.reason || (health.ragflow.ok ? "reachable" : "not ready")],
    ["RAGFlow Dataset", health.ragflow_datasets.ok ? "resolved" : "unresolved", health.ragflow_datasets.datasetIds?.join(", ") || health.ragflow_datasets.reason || "not ready"],
    ["LLM Wiki", health.llm_wiki.status, health.llm_wiki.reason || (health.llm_wiki.ok ? "reachable" : "not ready")],
    ["Local Test Knowledge", health.local_test_knowledge.enabled ? "mock_enabled" : "disabled", health.local_test_knowledge.enabled ? "explicit demo mode" : "not used"],
  ];
  for (const [name, state, detail] of rows) {
    const row = document.createElement("article");
    row.className = "integration";
    row.append(document.createElement("strong"), badge(state, state), document.createElement("p"));
    row.querySelector("strong").textContent = name;
    row.querySelector("p").textContent = detail;
    elements.integrationHealth.append(row);
  }
}

function renderRagflowLifecycleChecks(checks) {
  elements.ragflowLifecycleChecks.replaceChildren();
  if (checks.length === 0) {
    elements.ragflowLifecycleChecks.append(emptyState("尚未验证 RAGFlow 替换/撤回能力"));
    return;
  }
  for (const check of checks.slice().reverse().slice(0, 3)) {
    const card = document.createElement("article");
    card.className = "integration";
    card.innerHTML = `
      <strong>${check.status}</strong>
      <p></p>
    `;
    card.querySelector("p").textContent = `${check.dataset_name} · delete: ${check.delete_supported} · retrieval cleared: ${check.retrieval_cleared} · ${check.failure_reason || "verified"}`;
    elements.ragflowLifecycleChecks.append(card);
  }
}

function renderTickets(tickets) {
  elements.ticketCount.textContent = String(tickets.length);
  elements.tickets.replaceChildren();
  if (tickets.length === 0) {
    elements.tickets.append(emptyState("暂无人工工单"));
    return;
  }

  for (const ticket of tickets) {
    const card = document.createElement("article");
    card.className = "ticket";
    card.innerHTML = `
      <div class="ticket-header">
        <strong>${ticket.status}</strong>
        <span>${ticket.reason}</span>
      </div>
      <p class="question"></p>
      <dl class="candidate-flow">
        <div><dt>Reason</dt><dd></dd></div>
        <div><dt>Confidence</dt><dd></dd></div>
        <div><dt>Source</dt><dd></dd></div>
      </dl>
      <p class="meta">${ticket.id} · ${ticket.assigned_to || "未领取"}</p>
      <div class="actions"></div>
    `;
    card.querySelector(".question").textContent = ticket.operator_payload?.original_user_message || "";
    const detailValues = card.querySelectorAll(".candidate-flow dd");
    detailValues[0].textContent = ticket.operator_payload?.handoff_reason || ticket.reason;
    detailValues[1].textContent = `${ticket.operator_payload?.confidence ?? "n/a"} / ${ticket.operator_payload?.auto_answer_threshold ?? "n/a"}`;
    detailValues[2].textContent = ticket.operator_payload?.source_refs?.join(", ") || ticket.operator_payload?.provider_error || "no source";
    const actions = card.querySelector(".actions");

    if (ticket.status === "needs_human") {
      const claim = document.createElement("button");
      claim.type = "button";
      claim.textContent = "领取";
      claim.addEventListener("click", () => claimTicket(ticket));
      actions.append(claim);
    }

    if (ticket.status === "assigned") {
      const input = document.createElement("textarea");
      input.rows = 3;
      input.placeholder = "输入人工回复";
      const resolve = document.createElement("button");
      resolve.type = "button";
      resolve.textContent = "回复并解决";
      resolve.addEventListener("click", () => resolveTicket(ticket, input.value));
      actions.append(input, resolve);
    }

    if (ticket.status === "resolved") {
      const summary = document.createElement("p");
      summary.className = "answer";
      summary.textContent = ticket.resolution_summary || "已解决";
      actions.append(summary);
    }

    elements.tickets.append(card);
  }
}

function renderDecisionLogs(logs) {
  elements.logCount.textContent = String(logs.length);
  elements.decisionLogs.replaceChildren();
  if (logs.length === 0) {
    elements.decisionLogs.append(emptyState("暂无决策日志"));
    return;
  }
  for (const log of logs.slice().reverse().slice(0, 20)) {
    const card = document.createElement("article");
    card.className = "reply";
    card.innerHTML = `
      <div class="ticket-header">
        <strong>${log.final_decision}</strong>
        <span>${log.handoff_reason || log.support_status}</span>
      </div>
      <p class="question"></p>
      <dl class="candidate-flow">
        <div><dt>Confidence</dt><dd></dd></div>
        <div><dt>Source</dt><dd></dd></div>
        <div><dt>Trace</dt><dd></dd></div>
      </dl>
    `;
    card.querySelector(".question").textContent = log.question;
    const values = card.querySelectorAll(".candidate-flow dd");
    values[0].textContent = `${log.confidence ?? "n/a"} / ${log.auto_answer_threshold ?? "n/a"}`;
    values[1].textContent = log.source_refs?.join(", ") || log.provider_error || "no source";
    values[2].textContent = `${log.id} · ${log.ticket_id || log.outbound_id || "no action"}`;
    elements.decisionLogs.append(card);
  }
}

function renderOutbox(messages) {
  elements.outboxCount.textContent = String(messages.length);
  elements.outbox.replaceChildren();
  if (messages.length === 0) {
    elements.outbox.append(emptyState("暂无自动回复"));
    return;
  }

  for (const message of messages.slice().reverse()) {
    const intentLabel = message.intent === "ai_answer" ? "AI 自动回复" : "转人工提示";
    const card = document.createElement("article");
    card.className = "reply";
    card.innerHTML = `
      <div class="ticket-header">
        <strong>${intentLabel}</strong>
        <span>${message.status}</span>
      </div>
      <p class="answer"></p>
      <p class="meta"></p>
    `;
    card.querySelector(".answer").textContent = message.content;
    card.querySelector(".meta").textContent = `${message.id} · ${message.source_refs?.join(", ") || "no source"}`;
    elements.outbox.append(card);
  }
}

function renderCandidates(artifacts) {
  elements.candidateCount.textContent = String(artifacts.length);
  elements.candidates.replaceChildren();
  if (artifacts.length === 0) {
    elements.candidates.append(emptyState("暂无候选知识"));
    return;
  }

  for (const candidate of artifacts) {
    const card = document.createElement("article");
    card.className = "candidate";
    card.innerHTML = `
      <div class="ticket-header">
        <strong>${candidate.review_status}</strong>
        <span>${candidate.publication_decision?.publication_decision || "unknown"}</span>
      </div>
      <p class="question"></p>
      <p class="answer"></p>
      <dl class="candidate-flow">
        <div><dt>LLM Wiki</dt><dd></dd></div>
        <div><dt>Evaluation</dt><dd></dd></div>
        <div><dt>RAGFlow Sync</dt><dd></dd></div>
        <div><dt>Block Reason</dt><dd></dd></div>
        <div><dt>Source</dt><dd></dd></div>
        <div><dt>Risk</dt><dd></dd></div>
        <div><dt>Excerpt</dt><dd></dd></div>
      </dl>
      <div class="actions"></div>
      <p class="meta">${candidate.id}</p>
    `;
    card.querySelector(".question").textContent = candidate.question;
    card.querySelector(".answer").textContent = candidate.answer;
    const details = card.querySelectorAll(".candidate-flow dd");
    details[0].textContent = `${candidate.llm_wiki_artifact?.status || "draft_review"} · ${candidate.llm_wiki_artifact?.path || "wiki/review"}`;
    details[1].textContent = candidate.evaluation_status;
    details[2].textContent = `${candidate.ragflow_sync?.status || "blocked"} -> ${candidate.ragflow_sync?.target || "RAGFlow production KB"}`;
    details[3].textContent = candidate.publication_decision?.reason || "unknown";
    details[4].textContent = candidate.source_refs?.join(", ") || "no source";
    details[5].textContent = [candidate.risk_label, ...(candidate.risk_labels || [])].filter(Boolean).join(", ") || "normal";
    details[6].textContent = candidate.source_excerpt || candidate.confidence_basis || "no excerpt";
    const actions = card.querySelector(".actions");
    if (candidate.review_status === "review") {
      const approve = document.createElement("button");
      approve.type = "button";
      approve.textContent = "审核通过";
      approve.addEventListener("click", () => reviewCandidate(candidate, "approve"));
      actions.append(approve);
    }
    if (candidate.review_status === "approved" && candidate.evaluation_status !== "pass") {
      const evaluate = document.createElement("button");
      evaluate.type = "button";
      evaluate.textContent = "本地评估通过";
      evaluate.addEventListener("click", () => evaluateCandidate(candidate));
      actions.append(evaluate);
    }
    if (candidate.publication_decision?.publication_decision === "publish" && !candidate.published_at) {
      const publish = document.createElement("button");
      publish.type = "button";
      publish.textContent = "发布到本地知识";
      publish.addEventListener("click", () => publishCandidate(candidate));
      actions.append(publish);
    }
    if (candidate.llm_wiki_artifact?.path && candidate.publication_decision?.publication_decision === "publish") {
      const verify = document.createElement("button");
      verify.type = "button";
      verify.textContent = "同步并验证回答";
      verify.addEventListener("click", () => syncAndVerifyCandidate(candidate));
      actions.append(verify);
    }
    elements.candidates.append(card);
  }
}

function renderAnswerChecks(checks) {
  elements.answerCheckCount.textContent = String(checks.length);
  elements.answerChecks.replaceChildren();
  if (checks.length === 0) {
    elements.answerChecks.append(emptyState("暂无回答生效验证记录"));
    return;
  }
  for (const check of checks.slice().reverse().slice(0, 20)) {
    const card = document.createElement("article");
    card.className = "reply";
    card.innerHTML = `
      <div class="ticket-header">
        <strong>${check.answer_check_status}</strong>
        <span>${check.sync_status}</span>
      </div>
      <p class="question"></p>
      <p class="answer"></p>
      <dl class="candidate-flow">
        <div><dt>知识文件</dt><dd></dd></div>
        <div><dt>检索文档</dt><dd></dd></div>
        <div><dt>来源</dt><dd></dd></div>
        <div><dt>原因</dt><dd></dd></div>
      </dl>
      <p class="meta"></p>
    `;
    card.querySelector(".question").textContent = check.question || "未记录验证问题";
    card.querySelector(".answer").textContent = check.answer_text || "未返回可验证答案";
    const details = card.querySelectorAll(".candidate-flow dd");
    details[0].textContent = check.candidate_path || "no path";
    details[1].textContent = check.document_id || "no document";
    details[2].textContent = check.source_refs?.join(", ") || "no source";
    details[3].textContent = check.failure_reason || "已生效";
    card.querySelector(".meta").textContent = `${check.id} · ${check.updated_at}`;
    elements.answerChecks.append(card);
  }
}

function renderAlerts(alerts) {
  const openAlerts = alerts.filter((alert) => alert.status === "open");
  elements.alertCount.textContent = String(openAlerts.length);
  elements.alerts.replaceChildren();
  if (alerts.length === 0) {
    elements.alerts.append(emptyState("暂无知识告警"));
    return;
  }
  for (const alert of alerts.slice().reverse().slice(0, 10)) {
    const card = document.createElement("article");
    card.className = "reply";
    card.innerHTML = `
      <div class="ticket-header">
        <strong>${alert.severity}</strong>
        <span>${alert.status}</span>
      </div>
      <p class="question"></p>
      <p class="answer"></p>
      <div class="actions"></div>
      <p class="meta"></p>
    `;
    card.querySelector(".question").textContent = alert.title;
    card.querySelector(".answer").textContent = alert.detail;
    if (alert.status === "open") {
      const ack = document.createElement("button");
      ack.type = "button";
      ack.textContent = "确认告警";
      ack.addEventListener("click", () => acknowledgeAlert(alert));
      card.querySelector(".actions").append(ack);
    }
    card.querySelector(".meta").textContent = `${alert.id} · ${alert.ref_id || "no ref"}`;
    elements.alerts.append(card);
  }
}

function renderScanRuns(runs) {
  elements.scanRunCount.textContent = String(runs.length);
  elements.scanRuns.replaceChildren();
  if (runs.length === 0) {
    elements.scanRuns.append(emptyState("暂无 LLM Wiki 变更扫描记录"));
    return;
  }
  for (const run of runs.slice().reverse().slice(0, 10)) {
    const card = document.createElement("article");
    card.className = "reply";
    card.innerHTML = `
      <div class="ticket-header">
        <strong>${run.status}</strong>
        <span>${run.scan_root}</span>
      </div>
      <dl class="candidate-flow">
        <div><dt>新增</dt><dd>${run.added}</dd></div>
        <div><dt>修改</dt><dd>${run.modified}</dd></div>
        <div><dt>删除</dt><dd>${run.deleted}</dd></div>
        <div><dt>降级</dt><dd>${run.downgraded}</dd></div>
        <div><dt>无变化</dt><dd>${run.unchanged}</dd></div>
        <div><dt>阻断</dt><dd>${run.blocked}</dd></div>
      </dl>
      <div class="scan-findings"></div>
      <p class="meta"></p>
    `;
    const findings = card.querySelector(".scan-findings");
    for (const finding of (run.findings || []).slice(0, 6)) {
      const row = document.createElement("p");
      row.className = "meta";
      row.textContent = `${finding.change_type}: ${finding.source_path} · ${finding.sync_status || "not_synced"} · ${finding.reason || "ok"}`;
      findings.append(row);
    }
    card.querySelector(".meta").textContent = `${run.id} · ${run.failure_reason || run.updated_at}`;
    elements.scanRuns.append(card);
  }
}

function renderKnowledgeDocuments(documents) {
  elements.knowledgeDocumentCount.textContent = String(documents.length);
  elements.knowledgeDocuments.replaceChildren();
  if (documents.length === 0) {
    elements.knowledgeDocuments.append(emptyState("暂无可回答知识注册记录"));
    return;
  }
  for (const doc of documents.slice().reverse().slice(0, 20)) {
    const card = document.createElement("article");
    card.className = "reply";
    card.innerHTML = `
      <div class="ticket-header">
        <strong>${doc.lifecycle_status}</strong>
        <span>${doc.answer_status}</span>
      </div>
      <dl class="candidate-flow">
        <div><dt>知识文件</dt><dd></dd></div>
        <div><dt>检索文档</dt><dd></dd></div>
        <div><dt>替换为</dt><dd></dd></div>
        <div><dt>原因</dt><dd></dd></div>
      </dl>
      <div class="actions"></div>
      <p class="meta"></p>
    `;
    const details = card.querySelectorAll(".candidate-flow dd");
    details[0].textContent = doc.source_path;
    details[1].textContent = doc.document_id;
    details[2].textContent = doc.superseded_by || "-";
    details[3].textContent = doc.reason || "approved";
    if (doc.lifecycle_status === "active") {
      const withdraw = document.createElement("button");
      withdraw.type = "button";
      withdraw.textContent = "撤回回答";
      withdraw.addEventListener("click", () => withdrawKnowledgeDocument(doc));
      card.querySelector(".actions").append(withdraw);
    }
    card.querySelector(".meta").textContent = `${doc.id} · ${doc.updated_at}`;
    elements.knowledgeDocuments.append(card);
  }
}

function renderLocalKnowledge(items) {
  elements.knowledgeCount.textContent = String(items.length);
  elements.localKnowledge.replaceChildren();
  if (items.length === 0) {
    elements.localKnowledge.append(emptyState("本地测试知识库默认关闭。设置 BCS_ENABLE_LOCAL_TEST_KNOWLEDGE=1 才启用演示知识。"));
    return;
  }
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "knowledge";
    card.innerHTML = `
      <div class="ticket-header">
        <strong></strong>
        <span>${item.support_status}</span>
      </div>
      <p class="answer"></p>
      <p class="meta"></p>
    `;
    card.querySelector("strong").textContent = item.title;
    card.querySelector(".answer").textContent = item.answer;
    card.querySelector(".meta").textContent = `match: ${item.match.join(", ")} · confidence: ${item.confidence}`;
    elements.localKnowledge.append(card);
  }
}

function renderPublishedKnowledge(items) {
  elements.publishedCount.textContent = String(items.length);
  elements.publishedKnowledge.replaceChildren();
  if (items.length === 0) {
    elements.publishedKnowledge.append(emptyState("暂无本地已发布知识"));
    return;
  }
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "knowledge";
    card.innerHTML = `
      <div class="ticket-header">
        <strong></strong>
        <span>published</span>
      </div>
      <p class="question"></p>
      <p class="answer"></p>
      <p class="meta"></p>
    `;
    card.querySelector("strong").textContent = item.id;
    card.querySelector(".question").textContent = item.question;
    card.querySelector(".answer").textContent = item.answer;
    card.querySelector(".meta").textContent = item.source_refs?.join(", ") || "no source";
    elements.publishedKnowledge.append(card);
  }
}

function renderMaterials(items) {
  elements.materialCount.textContent = String(items.length);
  elements.materials.replaceChildren();
  if (items.length === 0) {
    elements.materials.append(emptyState("暂无材料"));
    return;
  }
  for (const item of items.slice().reverse()) {
    const card = document.createElement("article");
    card.className = "knowledge";
    card.innerHTML = `
      <div class="ticket-header">
        <strong></strong>
        <span>${item.status}</span>
      </div>
      <p class="answer"></p>
      <p class="meta"></p>
    `;
    card.querySelector("strong").textContent = item.title;
    card.querySelector(".answer").textContent = item.body.slice(0, 180);
    card.querySelector(".meta").textContent = item.id;
    elements.materials.append(card);
  }
}

function renderBatches(payload) {
  const batches = payload.batches || [];
  const assets = payload.assets || [];
  const blocks = payload.blocks || [];
  elements.batchCount.textContent = String(batches.length);
  elements.batches.replaceChildren();
  if (batches.length === 0) {
    elements.batches.append(emptyState("暂无材料包"));
    return;
  }
  for (const batch of batches.slice().reverse()) {
    const batchAssets = assets.filter((asset) => asset.batch_id === batch.id);
    const batchBlocks = blocks.filter((block) => block.batch_id === batch.id);
    const card = document.createElement("article");
    card.className = "knowledge";
    card.innerHTML = `
      <div class="ticket-header">
        <strong></strong>
        <span>${batch.status}</span>
      </div>
      <dl class="candidate-flow">
        <div><dt>Assets</dt><dd></dd></div>
        <div><dt>Blocks</dt><dd></dd></div>
        <div><dt>Source</dt><dd></dd></div>
      </dl>
      <p class="meta"></p>
    `;
    card.querySelector("strong").textContent = batch.title;
    const details = card.querySelectorAll(".candidate-flow dd");
    details[0].textContent = batchAssets.map((asset) => `${asset.filename}:${asset.extraction_status}`).join(", ");
    details[1].textContent = String(batchBlocks.length);
    details[2].textContent = batchBlocks[0]?.source_ref || "no blocks";
    card.querySelector(".meta").textContent = batch.id;
    elements.batches.append(card);
  }
}

async function refresh() {
  setStatus("刷新中");
  const [features, health, lifecycleChecks, policy, outbox, decisionLogs, tickets, artifacts, answerChecks, alerts, scanRuns, knowledgeDocuments, localKnowledge, publishedKnowledge, materials, batches] = await Promise.all([
    api("/runtime/features"),
    api("/integrations/health"),
    api("/integrations/ragflow/lifecycle-probes"),
    api("/reply-policy"),
    api("/outbox"),
    api("/decision-logs"),
    api("/handoff/tickets"),
    api("/knowledge/artifacts"),
    api("/knowledge/answer-loop/checks"),
    api("/knowledge/alerts"),
    api("/knowledge/answer-loop/scan-runs"),
    api("/knowledge/documents"),
    api("/knowledge/local-test"),
    api("/knowledge/published"),
    api("/materials"),
    api("/materials/batches"),
  ]);
  renderFeatures(features);
  renderIntegrationHealth(health);
  renderRagflowLifecycleChecks(lifecycleChecks.checks);
  renderReplyPolicy(policy.policy);
  renderOutbox(outbox.messages);
  renderDecisionLogs(decisionLogs.logs);
  renderTickets(tickets.tickets);
  renderCandidates(artifacts.artifacts);
  renderAnswerChecks(answerChecks.checks);
  renderAlerts(alerts.alerts);
  renderScanRuns(scanRuns.runs);
  renderKnowledgeDocuments(knowledgeDocuments.documents);
  renderLocalKnowledge(localKnowledge.knowledge);
  renderPublishedKnowledge(publishedKnowledge.knowledge);
  renderMaterials(materials.materials);
  renderBatches(batches);
  setStatus("就绪");
}

async function reviewCandidate(candidate, decision) {
  try {
    setStatus("审核中");
    await api(`/knowledge/feedback-candidates/${candidate.id}/review`, {
      method: "POST",
      body: JSON.stringify({ decision, reviewer_id: operatorId }),
    });
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function evaluateCandidate(candidate) {
  try {
    setStatus("评估中");
    await api(`/knowledge/feedback-candidates/${candidate.id}/evaluate`, {
      method: "POST",
      body: JSON.stringify({ result: "pass" }),
    });
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function publishCandidate(candidate) {
  try {
    setStatus("发布中");
    await api(`/knowledge/feedback-candidates/${candidate.id}/publish-local`, { method: "POST", body: "{}" });
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function syncAndVerifyCandidate(candidate) {
  try {
    setStatus("同步并验证中");
    await api("/knowledge/answer-loop/sync-and-verify", {
      method: "POST",
      body: JSON.stringify({
        candidate_path: candidate.llm_wiki_artifact.path,
        question: candidate.question,
        expected_answer: candidate.answer?.slice(0, 24),
        wait_for_parse: true,
        force: true,
      }),
    });
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function acknowledgeAlert(alert) {
  try {
    setStatus("确认告警中");
    await api(`/knowledge/alerts/${alert.id}/acknowledge`, { method: "POST", body: JSON.stringify({ actor: operatorId }) });
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function withdrawKnowledgeDocument(doc) {
  try {
    setStatus("撤回回答中");
    await api("/knowledge/answer-loop/withdraw", {
      method: "POST",
      body: JSON.stringify({ document_id: doc.document_id, reason: "operator_withdrawn" }),
    });
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function claimTicket(ticket) {
  try {
    setStatus("领取中");
    await api(`/handoff/tickets/${ticket.id}/claim`, {
      method: "POST",
      body: JSON.stringify({ operator_id: operatorId, expected_version: ticket.assignment_version }),
    });
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function resolveTicket(ticket, answerText) {
  if (!answerText.trim()) {
    setStatus("请输入人工回复", true);
    return;
  }
  try {
    setStatus("回复中");
    await api(`/handoff/tickets/${ticket.id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ operator_id: operatorId, answer_text: answerText.trim() }),
    });
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  }
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setStatus("发送中");
    await api("/dev/fake-wechat/messages", {
      method: "POST",
      body: JSON.stringify({
        msgid: `msg_${Date.now()}`,
        open_kfid: "wk_local_001",
        external_userid: elements.externalUserid.value.trim() || "wm_local_001",
        text: { content: elements.messageContent.value.trim() },
      }),
    });
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.policyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setStatus("保存话术中");
    await api("/reply-policy", {
      method: "POST",
      body: JSON.stringify({
        greeting: elements.policyGreeting.value,
        handoff_template: elements.policyHandoff.value,
        closing: elements.policyClosing.value,
      }),
    });
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.materialForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setStatus("蒸馏中");
    const created = await api("/materials", {
      method: "POST",
      body: JSON.stringify({ title: elements.materialTitle.value, body: elements.materialBody.value, type: "unstructured_text" }),
    });
    await api(`/materials/${created.material.id}/distill`, { method: "POST", body: "{}" });
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.batchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setStatus("导入材料包中");
    let imported;
    if (elements.batchFiles.files.length > 0) {
      const form = new FormData();
      form.append("title", elements.batchTitle.value);
      form.append("source_note", "operator_file_upload");
      form.append("operator_id", operatorId);
      for (const file of elements.batchFiles.files) form.append("files", file, file.name);
      imported = await api("/materials/import", { method: "POST", headers: {}, body: form });
    } else {
      imported = await api("/materials/import", {
        method: "POST",
        body: JSON.stringify({
          title: elements.batchTitle.value,
          source_note: "operator_markdown_import",
          operator_id: operatorId,
          assets: [{ filename: `${elements.batchTitle.value || "material"}.md`, mime_type: "text/markdown", content: elements.batchContent.value }],
        }),
      });
    }
    await api(`/materials/batches/${imported.batch.id}/distill`, { method: "POST", body: "{}" });
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.refresh.addEventListener("click", () => refresh().catch((error) => setStatus(error.message, true)));
elements.ragflowLifecycleProbe.addEventListener("click", async () => {
  try {
    setStatus("验证 RAGFlow 生命周期中");
    await api("/integrations/ragflow/lifecycle-probe", { method: "POST", body: JSON.stringify({ question: "bcs lifecycle probe" }) });
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
    await refresh().catch(() => {});
  }
});
async function scanApproved(autoSync) {
  try {
    setStatus(autoSync ? "扫描并同步 LLM Wiki 已审问答中" : "扫描 LLM Wiki 已审问答中");
    await api("/knowledge/answer-loop/scan-approved", { method: "POST", body: JSON.stringify({ scan_root: "wiki/approved-answers", auto_sync: autoSync, auto_withdraw: true }) });
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
    await refresh().catch(() => {});
  }
}

elements.scanApproved.addEventListener("click", () => scanApproved(false));
elements.scanApprovedSync.addEventListener("click", () => scanApproved(true));
refresh().catch((error) => setStatus(error.message, true));
