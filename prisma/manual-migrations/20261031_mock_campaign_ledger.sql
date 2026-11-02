-- Additive-only ledger for standalone MOCK campaign simulation.
-- Inspect your local schema and take a backup before running migrations.
CREATE TABLE IF NOT EXISTS "MockCampaignDelivery" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "mockId" TEXT,
  "lastError" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MockCampaignDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MockCampaignDelivery_campaignId_contactId_key"
  ON "MockCampaignDelivery"("campaignId", "contactId");
CREATE INDEX IF NOT EXISTS "MockCampaignDelivery_tenantId_campaignId_status_idx"
  ON "MockCampaignDelivery"("tenantId", "campaignId", "status");
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MockCampaignDelivery_campaignId_fkey') THEN
  ALTER TABLE "MockCampaignDelivery" ADD CONSTRAINT "MockCampaignDelivery_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MockCampaignDelivery_tenantId_fkey') THEN
  ALTER TABLE "MockCampaignDelivery" ADD CONSTRAINT "MockCampaignDelivery_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;
