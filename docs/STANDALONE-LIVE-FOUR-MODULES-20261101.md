# Standalone Live Messaging Pilot — Four Modules
Status: source implemented on draft branch, NOT YET validated end-to-end against the user's Meta account.

## Scope
This update does not modify RealJunctionCRM, its app, WABA webhook subscription, or its API services.
It is a **maximum 2 recipient live pilot**, not unrestricted broadcast sending.
Existing mock worker remains separate. The normal `/api/v1/campaigns/:id/start` route remains HTTP 501.

### 1. Connection verification
POST `/api/v1/whatsapp/connections/:id/verify-phone` (JWT OWNER/ADMIN)
- Decrypt tenant's token server-side and query Meta's current phone status.
- Mark local connection ACTIVE only if Meta reports `status=CONNECTED`, `code_verification_status=VERIFIED`, and `platform_type=CLOUD_API`.
- If these fields are missing/unsupported, the connection stays PENDING: investigate Meta, do not force ACTIVE.
- Read-only approved-template lookup still works independently.

### 2. Campaign configuration
Campaign now persists optional `connectionId`, `templateLanguage` and `templateComponents` JSON.
Draft create/update checks the selected connection belongs to JWT tenant.
Selected template and language are verified against the chosen WABA at live pilot start.
The UI supports choosing an approved template and advanced components JSON; complex variable templates need validated component mappings and testing.

### 3. Controlled send queue
- `apps/api/src/live-pilot.ts` is isolated from mock queues.
- API and worker must both have `SEND_MODE=live`, `META_CAMPAIGN_SEND_ENABLED=true`, `LIVE_PILOT_ENABLED=true`.
- `POST /api/v1/campaigns/:id/live-pilot-start` accepts only 1-2 opted-in recipients; checks ACTIVE connection, approved template and company ownership.
- Separate Redis queue and `npm run dev:live-worker -w apps/api`; concurrency 1, pace <= 1 attempt per 3 seconds globally.
- Explicit Meta `130429` rejection: up to 4 attempts with exponential backoff; retries are limited.
- Network timeouts and ambiguous responses: mark UNKNOWN, do not automatically resend; investigate provider logs and webhooks before manual intervention.
- Existing campaign is claimed once to reduce duplicates; API acceptance (ACCEPTED) is not actual delivery.
- Crash recovery for PROCESSING/UNKNOWN is intentionally **not automated**, to avoid duplicates.

### 4. Webhook delivery tracking
- `GET/POST /api/v1/standalone/meta-webhook` standalone callback.
- GET validates `META_WEBHOOK_VERIFY_TOKEN`; POST checks HMAC SHA256 from `META_APP_SECRET` using raw bytes.
- Only updates rows matched on both Meta message ID and verified connection ID/tenant.
- Supports sent/delivered/read/failed statuses; `GET /api/v1/campaigns/:id/live-progress` reports recorded live results.
- Webhook event replay inbox, late/out-of-order updates and durable deduplication need more real-environment tests. The webhook must be explicitly configured in Meta, and **must not replace another application's existing callback**. If the same Meta app/WABA currently uses RealJunctionCRM's webhook, do NOT change it; use a separately approved and configured callback architecture first.

## Database steps — CAUTION
1. Back up PostgreSQL before any migration. Keep current untracked V4 files and stash untouched.
2. Stop API and workers before regenerating Prisma to prevent Windows EPERM DLL lock.
3. Run the additive SQL from the repository root:
```powershell
Get-Content "prisma\manual-migrations\20261101_live_campaign_foundation.sql" -Raw | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U bulk -d bulk
npx prisma generate --schema prisma/schema.prisma
```
4. No `migrate reset`, `db push --accept-data-loss`, `git clean`, or `reset --hard`.

## Safe verification without sending
```powershell
npm run typecheck:mock -w apps/api
npx vitest run apps/api/src/live-webhook.test.ts apps/api/src/meta-templates.test.ts apps/api/src/mock-analytics.test.ts apps/api/src/mock-lifecycle.test.ts
npm run build -w apps/web
```
Default keep `SEND_MODE=mock`, `META_CAMPAIGN_SEND_ENABLED=false` and `LIVE_PILOT_ENABLED=false`.

## Before the first real test
- Confirm local Meta connection verifies ACTIVE from Meta and template plus language match.
- Use a dedicated webhook callback, with valid TLS/public HTTPS and correct subscription; do not overwrite the other CRM's webhook.
- Run CI, database integration tests and staging tests; inspect controlled send outcomes and reconcile ambiguities.
- Only use owned or explicitly opted-in recipients; comply with Meta rules, applicable limits and unsubscribes.
- Activate real pilot intentionally in both API and separate worker environments, then start one carefully reviewed campaign.
- Do not launch 1000-contact campaigns from this pilot foundation.
