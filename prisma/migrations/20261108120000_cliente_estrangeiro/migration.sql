-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "foreigner" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "rne" TEXT;

-- CreateIndex
CREATE INDEX "Client_companyId_passportNumber_idx" ON "Client"("companyId", "passportNumber");


-- Normaliza passaportes antigos (salvos como digitados) no mesmo formato da busca e da importação
UPDATE "Client" SET "passportNumber" = NULLIF(UPPER(REPLACE("passportNumber", ' ', '')), '') WHERE "passportNumber" IS NOT NULL;
UPDATE "Passenger" SET "passportNumber" = NULLIF(UPPER(REPLACE("passportNumber", ' ', '')), '') WHERE "passportNumber" IS NOT NULL;
