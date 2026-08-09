import { hashId, nowIso } from "../domain/ids.js";
import { evaluateFeedbackCandidate } from "./evaluation-gate.js";

const RISK_PATTERNS = [
  { label: "medical_like", severity: "high", pattern: /治疗|治好|根治|永久|保证/ },
  { label: "sensitive_skin", severity: "medium", pattern: /敏感肌|屏障|刺痛|泛红|过敏/ },
  { label: "price_policy", severity: "medium", pattern: /价格|多少钱|优惠|套餐|团购/ },
  { label: "complaint_refund", severity: "high", pattern: /退款|投诉|赔偿/ },
];

function slugify(text) {
  return String(text || "material").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "material";
}

function sentenceIncludesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function splitIntoSections(material, sourcePath) {
  const chunks = material.body.trim().split(/(?:\r?\n\s*){2,}|(?<=[。！？!?])\s*/u).map((item) => item.trim()).filter(Boolean);
  const sections = (chunks.length > 0 ? chunks : [material.body.trim()]).map((content, index) => {
    const sectionId = `${slugify(material.title)}-${index + 1}`;
    return {
      id: sectionId,
      title: `${material.title} ${index + 1}`,
      content,
      source_ref: `${sourcePath}#${sectionId}`,
    };
  });
  return sections;
}

function findSourceSection(sections, words) {
  return sections.find((section) => sentenceIncludesAny(section.content, words)) || sections[0];
}

function detectRiskFindings(sections) {
  const findings = [];
  for (const section of sections) {
    for (const item of RISK_PATTERNS) {
      const match = section.content.match(item.pattern);
      if (!match) continue;
      findings.push({
        label: item.label,
        severity: item.severity,
        reason: `matched_${item.label}`,
        evidence: match[0],
        source_ref: section.source_ref,
      });
    }
  }
  return findings;
}

function riskLabelsForSource(riskFindings, sourceRef) {
  const labels = riskFindings.filter((item) => item.source_ref === sourceRef).map((item) => item.label);
  return [...new Set(labels)];
}

function buildFaqCandidates(material, sections, riskFindings) {
  const body = material.body;
  const candidates = [];
  if (sentenceIncludesAny(body, ["干燥", "干皮", "起皮", "补水", "卡粉"])) {
    const section = findSourceSection(sections, ["干燥", "干皮", "起皮", "补水", "卡粉"]);
    candidates.push({
      question: "干皮适合做补水护理吗？",
      answer: "干燥、紧绷、轻微起皮或妆前卡粉时，可以优先考虑补水类护理；如有明显刺痛或泛红，应先由美容师评估。",
      source_section: section,
      risk_label: riskFindings.some((item) => item.label === "sensitive_skin") ? "sensitive_skin" : "normal",
    });
  }
  if (sentenceIncludesAny(body, ["护理后", "保湿", "防晒", "刷酸", "强清洁"])) {
    const section = findSourceSection(sections, ["护理后", "保湿", "防晒", "刷酸", "强清洁"]);
    candidates.push({
      question: "护理后要注意什么？",
      answer: "护理后建议做好保湿和防晒，短期内避免刷酸、强清洁和其他刺激性护理。",
      source_section: section,
      risk_label: "normal",
    });
  }
  if (sentenceIncludesAny(body, ["预约", "到店", "门店", "时间"])) {
    const section = findSourceSection(sections, ["预约", "到店", "门店", "时间"]);
    candidates.push({
      question: "预约到店前需要确认什么？",
      answer: "预约到店前建议确认门店、期望时间、皮肤诉求，以及近期是否做过医美、刷酸或强刺激护理。",
      source_section: section,
      risk_label: "normal",
    });
  }
  if (candidates.length === 0) {
    const section = sections[0];
    candidates.push({
      question: `${material.title}适合哪些情况？`,
      answer: `${material.title}需要结合顾客当前皮肤状态判断；如信息不足，应由人工客服或美容师进一步确认。`,
      source_section: section,
      risk_label: "normal",
    });
  }
  return candidates.map((candidate) => {
    const sourceRef = candidate.source_section.source_ref;
    const riskLabels = riskLabelsForSource(riskFindings, sourceRef);
    if (candidate.risk_label !== "normal" && !riskLabels.includes(candidate.risk_label)) riskLabels.push(candidate.risk_label);
    const item = {
      id: hashId("material_candidate", `${material.id}:${candidate.question}:${candidate.answer}`),
      material_id: material.id,
      question: candidate.question,
      answer: candidate.answer,
      source_refs: [sourceRef],
      source_excerpt: candidate.source_section.content,
      risk_label: candidate.risk_label,
      risk_labels: riskLabels,
      confidence_basis: "local_rule_source_match",
      created_from: "material_distillation",
      governance_target: "pending_llm_wiki",
      llm_wiki_artifact: { path: null, status: "not_written" },
      review_status: "review",
      evaluation_status: "pending",
      created_at: nowIso(),
    };
    item.publication_decision = evaluateFeedbackCandidate(item);
    return item;
  });
}

export function createMaterial({ title, body, type = "unstructured_text", sourceNote = "manual_input" }) {
  const material = {
    id: hashId("material", `${title}:${body}:${Date.now()}`),
    type,
    title: title || "未命名材料",
    body: body || "",
    source_note: sourceNote,
    status: "draft",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  if (!material.body.trim()) return { ok: false, reason: "material_body_required" };
  return { ok: true, material };
}

export function distillMaterial(material) {
  if (!material) return { ok: false, reason: "material_not_found" };
  const sourcePath = `wiki/sources/${slugify(material.title)}-${material.id}.md`;
  const materialVersion = hashId("material_version", `${material.id}:${material.title}:${material.body}`);
  const sections = splitIntoSections(material, sourcePath);
  const riskFindings = detectRiskFindings(sections);
  const distillation = {
    id: hashId("distill", `${material.id}:${materialVersion}`),
    material_id: material.id,
    material_version: materialVersion,
    distiller: "local_rule_distiller",
    source_material: {
      path: sourcePath,
      title: material.title,
      content: material.body.trim(),
      sections,
    },
    faq_candidates: buildFaqCandidates(material, sections, riskFindings),
    risk_findings: riskFindings,
    created_at: nowIso(),
  };
  material.status = "distilled";
  material.updated_at = nowIso();
  return { ok: true, distillation };
}
