# WhatsApp Bulk Message SaaS

Independent multi-tenant SaaS foundation. Does not modify TrackLead CRM.

## Current scope (v0.1 scaffold)
- Next.js UI with registration/login
- Express/TypeScript API, PostgreSQL/Prisma models for tenants/users/memberships/contacts/campaigns
- JWT auth; tenant filtering for contact and campaign operations
- Sending intentionally disabled (501) until official Meta integration, approved templates, opt-out handling and durable queue are tested

**Not complete:** Original specification proposed NestJS, Redis/BullMQ workers, subscription billing, super admin, webhooks, analytics, QR gateway, audit logging, RBAC, migrations, automated tests and deployment. These are **not implemented** in this scaffold.

## Local development
1. Install Node.js 22+, npm and Docker.
2. Run `docker compose up -d`.
3. Copy `.env.example` to `.env`; replace `JWT_SECRET` with a strong random secret.
4. Run `npm install` and `npx prisma generate --schema prisma/schema.prisma`.
5. For a local disposable development database only, run `npx prisma db push --schema prisma/schema.prisma`. Production requires reviewed migrations.
6. Run `npm run dev:api` and in another terminal `npm run dev:web`.
7. Open `http://localhost:3000`.

Never commit live tokens, customer contact lists or session credentials.
