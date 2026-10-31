-- Additive migration. Back up database; execute once before regenerating Prisma Client.
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "connectionId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "templateLanguage" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "templateComponents" JSONB;
CREATE TABLE IF NOT EXISTS "LiveCampaignDelivery" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "tenantId" TEXT NOT NULL,
 "campaignId" TEXT NOT NULL,
 "contactId" TEXT NOT NULL,
 "connectionId" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'QUEUED',
 "messageId" TEXT,
 "attempts" INTEGER NOT NULL DEFAULT 0,
 "lastError" TEXT,
 "nextAttemptAt" TIMESTAMP(3),
 "updatedAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "LiveCampaignDelivery_campaignId_contactId_key" ON "LiveCampaignDelivery"("campaignId","contactId");
CREATE UNIQUE INDEX IF NOT EXISTS "LiveCampaignDelivery_messageId_key" ON "LiveCampaignDelivery"("messageId");
CREATE INDEX IF NOT EXISTS "LiveCampaignDelivery_tenantId_campaignId_status_idx" ON "LiveCampaignDelivery"("tenantId","campaignId","status");
CREATE INDEX IF NOT EXISTS "LiveCampaignDelivery_connectionId_status_idx" ON "LiveCampaignDelivery"("connectionId","status");
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='LiveCampaignDelivery_tenantId_fkey') THEN
  ALTER TABLE "LiveCampaignDelivery" ADD CONSTRAINT "LiveCampaignDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='LiveCampaignDelivery_campaignId_fkey') THEN
  ALTER TABLE "LiveCampaignDelivery" ADD CONSTRAINT "LiveCampaignDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='LiveCampaignDelivery_connectionId_fkey') THEN
  ALTER TABLE "LiveCampaignDelivery" ADD CONSTRAINT "LiveCampaignDelivery_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection"("id") ON UPDATE CASCADE;
 END IF;
END $$;
