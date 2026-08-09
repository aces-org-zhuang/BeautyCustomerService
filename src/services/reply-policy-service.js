export const DEFAULT_REPLY_POLICY = {
  profile: "warm_professional",
  greeting: "亲，",
  handoff_template: "这个问题需要人工客服进一步确认，我会为您转接。",
  risk_disclaimer: "如果有明显刺痛、泛红或屏障不稳定，建议先由美容师评估。",
  closing: "也可以补充近期皮肤状态，我帮您进一步判断。",
};

function containsRiskDisclaimer(text) {
  return text.includes("刺痛") || text.includes("泛红") || text.includes("屏障");
}

export class ReplyPolicyService {
  constructor(policy = null) {
    this.policy = { ...DEFAULT_REPLY_POLICY, ...(policy || {}) };
  }

  formatAnswer(factualAnswer) {
    const body = String(factualAnswer || "").trim();
    const disclaimer = containsRiskDisclaimer(body) ? "" : this.policy.risk_disclaimer;
    return [`${this.policy.greeting}${body}`, disclaimer, this.policy.closing].filter(Boolean).join(" ").trim();
  }

  formatHandoff(reason) {
    return `${this.policy.greeting}${this.policy.handoff_template}（原因：${reason}）`;
  }
}
