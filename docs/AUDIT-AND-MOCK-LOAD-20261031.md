# Standalone WhatsApp Bulk Message — audit and mock validation (31 Oct 2026)

## Scope inspected
Branch `feature/standalone-mock-start-20261031`: API routes, BullMQ worker, Prisma data models, login/contacts/campaign pages, WhatsApp connection onboarding, unit tests and configuration. This is a source review, **not** a successful local build or live smoke test.

## Implemented or hardened in this consolidated update
- Mock-only API and queue worker: `SEND_MODE=mock`; no Meta Cloud API calls in mock worker.
- Campaign progress for selected opted-in recipients, with terminal statuses `COMPLETED`, `PARTIAL`, `FAILED`.
- Retry only failed mock jobs; reject retry if any failed recipient has withdrawn consent.
- Prevent overlapping frontend progress-poll requests from repeated timer ticks.
- Pure campaign outcome unit tests for 100% success, partial failure, and all skipped.
- **Isolated synthetic Redis benchmark** for 100, 500, and 1,000 jobs. It creates no contacts or campaigns in PostgreSQL and has no real telephone numbers.

## Findings and limitations (NOT production-ready)
1. **Critical: Message ledger absent in checked-in Prisma schema.** Reporting relies on Redis job history. For real-world message accountability add per-recipient immutable delivery attempts and external message IDs in Postgres; support retries, dedupe, failure reasons, retention, and recovery.
2. **High: Queue durability / partial enqueue.** Database status is set before all jobs are added; process interruption may leave a `QUEUED` campaign with missing jobs. Implement an outbox or recovery reconciler before live sending.
3. **High: Real Meta messaging deliberately disabled.** `/api/v1/campaigns/:id/start` returns 501. Approved templates, per-tenant credential management, rate limit scheduling, webhooks, and consent need production integration, explicitly outside this mock update.
4. **High: Retry edge cases.** Partial enqueue and revoked consent can make retry impossible until ledger and recovery are available; mock retry remains a development-only tool.
5. **High: Campaign audience cap.** Current draft API accepts at most 500 selected contacts and UI shows at most 500. The 1,000-job benchmark is **synthetic queue capacity testing**, not a proof that a 1,000-recipient real campaign works.
6. **High: Auth security.** JWT-based login is present; source review did not establish comprehensive API request throttling, refresh token rotation, enforced multi-tenant RBAC for every endpoint, or audit trails. Perform threat-model and tenant-isolation tests before external deployment.
7. **Medium: Frontend.** Draft management, contact pages, and connection UI exist; no validated end-to-end Meta template preview, campaign scheduling/cancellation, exportable delivery reconciliation or full analytics dashboard.
8. **Medium: Tests.** A few foundation tests are committed; complete API integration, concurrency, retry, failure injection, tenant isolation and UI browser E2E testing are not evidenced by CI for this branch.
9. **Medium: Documentation.** README/implementation status are older than the current mock testing capability. This document supplements those files.

## Safety and runbook
- Never use real recipient/customer data for load testing.
- Use disposable **local** Redis and synthetic contacts only.
- Set in root `.env`:
  `SEND_MODE=mock`
  `META_CAMPAIGN_SEND_ENABLED=false`
- Run normal targeted unit tests from the root:
  `npx vitest run apps/api/src/mock-lifecycle.test.ts apps/api/src/analytics.test.ts`
- Run synthetic benchmark:
  `npm run test:mock-load -w apps/api`
- No other worker needs to be running for the synthetic benchmark.
- Expected: three JSON lines for sizes 100, 500, 1000, with `succeeded=size`, `failed=0`. Results depend on the host and Redis; **no throughput numbers have been verified here**.
- Check backend and frontend TypeScript builds separately. Avoid `npx vitest run` at repository root without a test path if the separate `OpenWA` tree is present.
- Never run `git clean` or `stash pop` just to apply this update; preserve local untracked files and backup stash.
- If uncommitted local changes exist, stop before pulling. Your GitHub branch may be behind local-only V4 code and must not be blindly merged with it.

## Next release criteria
- Add persisted tenant-scoped recipient ledger and recovery.
- Add isolated 1000-recipient campaign E2E in staging, without real sends.
- Audit Meta onboarding + webhook signatures and production identity.
- Add rate limit and failure simulations, API request throttling, tests and CI.
- Validate build, tests, 100/500/1000 synthetic load runs locally; record measured times and errors.
