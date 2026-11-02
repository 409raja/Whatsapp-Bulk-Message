# Meta Approved Template Discovery (standalone)

This increment is **read-only**. No real WhatsApp messages are sent.

## New endpoint
GET /api/v1/whatsapp/connections/:id/approved-templates

- Requires authenticated OWNER/ADMIN and tenant-owned WhatsApp connection.
- Server decrypts the stored token; no token or Meta credentials reach the web client.
- Requests only first 100 Meta message templates from that connection's WABA.
- Filters to APPROVED templates and returns name, language, category, variable-present flag.
- Does not modify RealJunctionCRM, Cloud API webhook configuration, existing Meta apps, or campaign data schema.
- Returns hasMore to indicate pagination is not yet supported.
- Does **not** guarantee that a template can be used for live send; parameter components, language, category, phone status and live eligibility still need validation.
- A PENDING WhatsApp connection can browse templates if token is valid; this does NOT activate the connection.

## Campaigns UI
- Pick a company-owned WhatsApp connection, then "Load approved templates".
- Selecting a template inserts only its identifier into the existing draft form.
- Important: the draft schema currently persists only templateName, not the chosen connection ID, template language or variable mappings; live sending must not be enabled yet.
- Existing mock sending stays independent of this selection.

## Next implementation gates
1. Persist authorized connection selection, template ID, language, variable mappings and explicit consent evidence in campaign records with an additive DB migration.
2. Add Meta phone readiness / permissions verification; maintain strict cross-tenant isolation.
3. Build durable per-number live queue, opt-out rechecks, rate limiting, deduplication, and 130429 backoff; keep mock and live separate.
4. Add signed Meta webhook status handling, provider message ledger, reconciliation and audit tests.
5. Controlled send to 1-2 owned/consenting numbers; only then scale gradually according to limits.

## Local verification
```powershell
git pull --ff-only origin feature/standalone-mock-start-20261031
npm run typecheck:mock -w apps/api
npx vitest run apps/api/src/meta-templates.test.ts apps/api/src/mock-analytics.test.ts apps/api/src/mock-lifecycle.test.ts
npm run build -w apps/web
```

Keep SEND_MODE=mock and META_CAMPAIGN_SEND_ENABLED=false. A real Meta business connection is needed for live template lookup. If none is saved, use the existing Meta Embedded Signup flow; do not paste long-lived access tokens into the frontend.
