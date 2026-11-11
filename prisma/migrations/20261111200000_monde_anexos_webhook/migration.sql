-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "mondeId" TEXT;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "mondeProductId" TEXT;

-- AlterTable
ALTER TABLE "MondeIntegration" ADD COLUMN     "lastWebhookAt" TIMESTAMP(3),
ADD COLUMN     "webhookError" TEXT,
ADD COLUMN     "webhookEvents" TEXT,
ADD COLUMN     "webhookId" TEXT,
ADD COLUMN     "webhookKey" TEXT,
ADD COLUMN     "webhookSecretEnc" TEXT,
ADD COLUMN     "webhookUserId" TEXT;

-- CreateIndex
CREATE INDEX "Attachment_companyId_mondeId_idx" ON "Attachment"("companyId", "mondeId");

-- CreateIndex
CREATE UNIQUE INDEX "MondeIntegration_webhookKey_key" ON "MondeIntegration"("webhookKey");
