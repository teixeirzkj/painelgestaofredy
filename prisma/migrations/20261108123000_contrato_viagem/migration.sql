-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "saleIdsJson" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "tripId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Contract_companyId_tripId_key" ON "Contract"("companyId", "tripId");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Contratos já mandados ao cliente pela venda rápida (Frédy/WhatsApp) antes de o envio ser gravado no contrato
UPDATE "Contract" SET "sentAt" = CURRENT_TIMESTAMP
WHERE "sentAt" IS NULL AND "externalId" IS NULL
  AND EXISTS (SELECT 1 FROM "BalcaoFlow" b WHERE b."saleId" = "Contract"."saleId" AND b."companyId" = "Contract"."companyId" AND b."contractSent" = true);
