# Ubuntu development setup

Install Node.js 22+, npm, and Docker Engine with Compose plugin.
Run `docker compose up -d`, `npm install`, and `npx prisma generate --schema prisma/schema.prisma`.
Configure `.env` from `.env.example`, using a strong JWT secret.
Use `npx prisma db push --schema prisma/schema.prisma` **only on disposable development databases**.
Run `npm run dev:api` and `npm run dev:web`.
This is not a production deployment guide: HTTPS, backups, migrations, isolation, monitoring, and provider tests remain required.
