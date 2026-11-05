-- CreateTable
CREATE TABLE "FredyIntegration" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tokenEnc" TEXT NOT NULL,
    "tokenLast4" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONECTADA',
    "lastError" TEXT,
    "salesPanelId" TEXT,
    "salesPanelTitle" TEXT,
    "quoteStepId" TEXT,
    "wonStepId" TEXT,
    "lostStepId" TEXT,
    "fieldMapJson" TEXT NOT NULL DEFAULT '{}',
    "defaultSellerId" TEXT,
    "defaultProductType" TEXT NOT NULL DEFAULT 'PACOTE',
    "autoCreateSale" BOOLEAN NOT NULL DEFAULT true,
    "syncBack" BOOLEAN NOT NULL DEFAULT true,
    "webhookKey" TEXT NOT NULL,
    "webhookSubscriptionId" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEventAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FredyIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FredyWebhookEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "entityId" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "saleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FredyWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FredyIntegration_companyId_key" ON "FredyIntegration"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "FredyIntegration_webhookKey_key" ON "FredyIntegration"("webhookKey");

-- CreateIndex
CREATE INDEX "FredyWebhookEvent_companyId_createdAt_idx" ON "FredyWebhookEvent"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "FredyIntegration" ADD CONSTRAINT "FredyIntegration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FredyWebhookEvent" ADD CONSTRAINT "FredyWebhookEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

