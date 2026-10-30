# Campaign reliability — safety-first implementation

## Current state
This PR adds tested pure Meta 130429 classification/backoff helpers, read-only audit,
and an optional **manual-review-only** stale recipient recovery script.
**It does not enable campaign sending or automatic retries.** The local
`CampaignRecipient` Prisma schema, migration and `queue.ts` modifications are
uncommitted on the developer's Windows machine and not in this GitHub branch.
Merge/integration is blocked until those local changes are safely synchronized.

## Crash recovery
Run `node scripts/audit-campaign-queue.cjs` to inspect queue and ledger.
Run `node scripts/review-stale-recipients.cjs` for dry run.
Only after reviewing the output, run `node scripts/review-stale-recipients.cjs --apply`
to CAS-update stale `PROCESSING` rows to `REVIEW_REQUIRED`.
This does **not** resend anything. Active/waiting/delayed jobs are excluded.
The database row may represent a send that Meta accepted before a crash.
Human/provider reconciliation is mandatory before any retry.
`RECOVERY_AUDIT_MINUTES` defaults to 15; minimum is 15 for the write script.

## Meta 130429
`getMetaRateLimit(error)` detects Meta error code 130429 in parsed provider
errors. `rateLimitBackoffMs(attempts, retryAfterMs)` supplies bounded
30s/60s/120s/.../15m delay. Use this only for **definitively rejected**
requests. Do not replay ambiguous timeouts, or bulk replay all failed jobs.
A production worker must also enforce **shared per-phone-number throttling**
across workers, limit attempts, isolate tenants, and use provider webhooks to
reconcile accepted/delivered/failed messages. These integrations are NOT
implemented in this PR.

## Verification
From project root: `npm test -w apps/api` and
`npx tsc --noEmit -p apps/api/tsconfig.json`.
No live WhatsApp messages are sent by these tests.
