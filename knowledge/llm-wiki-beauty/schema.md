# Schema

Required frontmatter for FAQ candidate pages:

```yaml
type: faq_candidate
question: string
answer: string
sources: [raw/sources/<file>]
product_scope: string
service_scope: string
risk_label: normal|sensitive|medical_like|complaint_refund|price_dispute|needs_confirmation
review_status: draft|review|approved|rejected
evaluation_status: pending|passed|contradicted|unsupported
```

Sync rule:

- Only `review_status: approved` and `evaluation_status: passed` may sync to RAGFlow.
- `sources` must be non-empty.
- Medical-like or permanent-cure claims must be blocked or routed to human review.
