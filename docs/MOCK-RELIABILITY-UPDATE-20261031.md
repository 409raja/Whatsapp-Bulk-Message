# Mock Campaign Reliability Update (31 October 2026)

This patch is **mock-only**. No real messaging is enabled, no live customer records are created by the synthetic benchmark, and the RealJunctionCRM repository is unchanged.

## Completed in GitHub source
- Benchmark now awaits at most **8** synthetic job completions concurrently to prevent the previously observed `MaxListenersExceededWarning` from large `Promise.all` arrays.
- `MockCampaignDelivery` Prisma model: one unique row per campaign/contact, scoped by tenant, attempt count, result status, and last mock error.
- Worker records simulated delivery outcomes in Postgres before returning success.
- Worker replays a previously completed mock record without re-simulating it, protecting against duplicate processing when replayed.
- Queue crash recovery attempts to re-enqueue **missing QUEUED jobs** for up to 100 queued campaigns at worker startup.
- Added tenant-authorized `GET /api/v1/campaigns/:id/mock-history` endpoint.
- Campaign UI shows per-contact mock status, attempt counts and errors.
- Retry checks consent and only retries recorded FAILED recipients.

## Before running locally
These are **source-level changes, NOT yet locally verified**. The user's local working tree may have additional V4 models/migrations that are not committed to this GitHub branch. **Do not overwrite or reset your existing Prisma data**.

1. Confirm active branch `feature/standalone-mock-start-20261031` and that local tracked changes can be safely updated.
2. Take a PostgreSQL backup (especially if previous V4 migration experiments created extra tables).
3. Compare your local `prisma/schema.prisma` and `prisma/migrations` with the GitHub branch. The new additive SQL is in `prisma/manual-migrations/20261031_mock_campaign_ledger.sql`. Apply it **only after reviewing** it against your current database. Do not use `--accept-data-loss`, `migrate reset`, or wipe the local volume.
4. Run `npx prisma generate --schema prisma/schema.prisma` after applying an appropriate compatible schema change.
5. Keep local `SEND_MODE=mock`, `META_CAMPAIGN_SEND_ENABLED=false`, Docker/Postgres and Redis running.
6. Run from the root:
   - `npx vitest run apps/api/src/mock-lifecycle.test.ts apps/api/src/analytics.test.ts`
   - `npx tsc --noEmit -p apps/api/tsconfig.json`
   - `npm run build -w apps/web`
   - `npm run test:mock-load -w apps/api` (synthetic 100, 500, 1000 batches)
7. Restart API, web and mock worker to load the new Prisma Client and source code.
8. Use a new consented **test** contact and a new mock draft to verify `QUEUED → COMPLETED`, progress and history.

## Known caveats
- The 100/500/1000 test measures **synthetic BullMQ job completion**, not a 1000-recipient WhatsApp campaign. The draft endpoint presently caps selected recipients at 500.
- Startup recovery is bounded to 100 queued campaigns per pass and handles missing Redis jobs, not every possible Redis outage, retry crash or stalled ACTIVE state. More fault-injection and durable outbox testing is needed before production.
- Existing campaigns completed before this ledger existed do not have reconstructed individual history. The UI correctly shows empty history rather than making it up.
- This patch does **not** deliver production-grade message persistence, per-provider rate limits, approved template management, billing, full security audits, webhook reconciliation or live Meta sending.
- Benchmarks and TypeScript/Next builds have **not been rerun** in the user's environment after this patch. Do not claim CI or live readiness until validated.

## Avoid destructive commands
Do not run `git clean`, `git stash pop`, `git reset --hard`, `prisma migrate reset`, or `prisma db push --accept-data-loss` merely to apply this patch.
