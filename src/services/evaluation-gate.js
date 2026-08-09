export function evaluateFeedbackCandidate(candidate) {
  if (candidate.review_status !== "approved") {
    return { result_label: "unclear", publication_decision: "block", reason: "not_approved" };
  }
  if (candidate.evaluation_status !== "pass") {
    return { result_label: "unclear", publication_decision: "block", reason: "evaluation_pending" };
  }
  if (!candidate.source_refs || candidate.source_refs.length === 0) {
    return { result_label: "unsupported", publication_decision: "block", reason: "missing_source_refs" };
  }
  return { result_label: "supported", publication_decision: "publish", reason: "supported_by_sources" };
}

export function runLocalCandidateEvaluation(candidate, result = "pass") {
  if (result !== "pass") {
    candidate.evaluation_status = "fail";
    candidate.publication_decision = { result_label: "unsupported", publication_decision: "block", reason: "local_evaluation_failed" };
    return candidate.publication_decision;
  }
  candidate.evaluation_status = "pass";
  candidate.publication_decision = evaluateFeedbackCandidate(candidate);
  return candidate.publication_decision;
}
