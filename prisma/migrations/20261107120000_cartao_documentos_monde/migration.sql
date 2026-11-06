-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "mondeId" TEXT;

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "cardBillsJson" TEXT,
ADD COLUMN     "cardInstallments" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "FinancialAccount" ADD COLUMN     "closingDay" INTEGER,
ADD COLUMN     "dueDay" INTEGER;

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "docExpiry" TEXT,
ADD COLUMN     "docNumber" TEXT;

-- CreateTable
CREATE TABLE "MondeIntegration" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "passwordEnc" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONECTADA',
    "lastError" TEXT,
    "nextPage" INTEGER NOT NULL DEFAULT 1,
    "totalPages" INTEGER,
    "importing" BOOLEAN NOT NULL DEFAULT false,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "lastImportAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MondeIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MondeIntegration_companyId_key" ON "MondeIntegration"("companyId");

-- CreateIndex
CREATE INDEX "Client_companyId_mondeId_idx" ON "Client"("companyId", "mondeId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MondeIntegration" ADD CONSTRAINT "MondeIntegration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

