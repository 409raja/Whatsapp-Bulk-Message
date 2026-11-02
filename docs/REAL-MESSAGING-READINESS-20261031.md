# WhatsApp Cloud API: remaining work to real messaging
Status: 31 October 2026. This document is a readiness checklist, **not** confirmation that Meta review is approved or real sending works.

## Already observed locally
- Campaign drafts and selected opted-in contacts.
- Mock queue worker and PostgreSQL per-recipient results.
- Two test contacts reported as MOCK_SENT, no failures.
- Synthetic BullMQ 100/500/1000 job tests were reported successful before the latest code changes.
- Web production build was reported successful after fixing JSX.
- The branch still has mock-only sending; POST /api/v1/campaigns/:id/start intentionally returns HTTP 501.

## Remaining gates for a controlled, consented real send (six workstreams)
1. **Backend safety and tests** — prove tenant isolation, role validation, consent enforcement, no duplicate sends on crash/retry; add integration tests and CI. New mock analytics is isolated and tenant-scoped but does not prove these integrations.
2. **Meta account readiness** — confirm the desired business phone number, WABA, app status, permissions / advanced access where relevant, token lifetime and secure per-tenant storage. App Review status must be confirmed in Meta dashboard rather than assumed.
3. **Approved templates & opt-in evidence** — template selection, variables, preview, language, marketing/utility purpose, explicit recipient consent and unsubscribe/opt-out. Outside 24-hour service window, only approved templates can initiate messages.
4. **Live send queue with guardrails** — per-phone pacing, respectful rate limits, backoff for 130429, circuit breaker, deduplication/idempotency and opt-out check immediately before dispatch. No bypass of Meta rate limits or messaging policy.
5. **Webhook and durable delivery ledger** — Meta signed callbacks, provider message IDs, accepted/sent/delivered/read/failed transitions, auditability and failure reconciliation. Keep this isolated from RealJunctionCRM's currently used webhook.
6. **Staging pilot and gradual rollout** — verify recipient consent, approved template, API acceptance and webhook delivery first with 1-2 owned/consenting contacts; only then gradually expand to more opted-in contacts after limits and results are measured.

## This phase (added to existing GitHub draft PR)
- Tenant-scoped mock analytics API: GET /api/v1/campaigns/mock-analytics.
- Dashboard mock-only stats for successful mock jobs, failed jobs and campaign status.
- Unit tests for mock analytics aggregations.
- Previous mock persistence/recovery code remains development-only and incomplete for live message delivery.

## Scope of readiness
No fixed time estimate. Real sending readiness depends on the current Meta app review and number status, approved templates, tests and production queue hardening. There is no legitimate unlimited or guaranteed block-free sending method. A contact list collected from ads does not by itself prove explicit WhatsApp opt-in.

## Validation commands (after pull)
- npx vitest run apps/api/src/mock-analytics.test.ts apps/api/src/mock-lifecycle.test.ts apps/api/src/analytics.test.ts
- npx tsc --noEmit -p apps/api/tsconfig.json
- npm run build -w apps/web

Do not modify Prisma schema for this specific analytics update. Existing ledger migration is already applied on the user's local PostgreSQL. Keep SEND_MODE=mock and META_CAMPAIGN_SEND_ENABLED=false. Do not activate real sending as a debugging shortcut.
