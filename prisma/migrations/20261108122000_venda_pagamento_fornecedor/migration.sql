-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "supplierCardAccountId" TEXT,
ADD COLUMN     "supplierCardFirstBillMonth" TEXT,
ADD COLUMN     "supplierCardInstallments" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "supplierCardStartInstallment" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "supplierPayMethod" TEXT,
ADD COLUMN     "supplierPayment" TEXT NOT NULL DEFAULT 'FATURADO';

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "autoKey" TEXT;

-- CreateIndex
CREATE INDEX "Settlement_companyId_autoKey_idx" ON "Settlement"("companyId", "autoKey");

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_supplierCardAccountId_fkey" FOREIGN KEY ("supplierCardAccountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: produtos em que o cliente paga direto ao fornecedor (modelo Comissão)
UPDATE "SaleItem" SET "supplierPayment" = 'CLIENTE_DIRETO' WHERE "commercialModel" = 'COMISSAO';
