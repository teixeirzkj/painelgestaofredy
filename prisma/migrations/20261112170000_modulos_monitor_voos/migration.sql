-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "modulesJson" TEXT NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "FlightSegment" ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "lastCheckedOn" TEXT,
ADD COLUMN     "liveGate" TEXT,
ADD COLUMN     "liveRevisedAt" TEXT,
ADD COLUMN     "liveScheduledAt" TEXT,
ADD COLUMN     "liveStatus" TEXT,
ADD COLUMN     "liveTerminal" TEXT;

-- CreateTable
CREATE TABLE "FlightChange" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "flightSegmentId" TEXT,
    "kind" TEXT NOT NULL,
    "flight" TEXT NOT NULL,
    "departureAt" TEXT NOT NULL,
    "newTimeAt" TEXT,
    "detail" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'AERODATABOX',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "FlightChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FlightChange_companyId_dedupeKey_key" ON "FlightChange"("companyId", "dedupeKey");

-- CreateIndex
CREATE INDEX "FlightChange_companyId_resolvedAt_idx" ON "FlightChange"("companyId", "resolvedAt");

-- CreateIndex
CREATE INDEX "FlightChange_saleId_idx" ON "FlightChange"("saleId");

-- AddForeignKey
ALTER TABLE "FlightChange" ADD CONSTRAINT "FlightChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightChange" ADD CONSTRAINT "FlightChange_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightChange" ADD CONSTRAINT "FlightChange_flightSegmentId_fkey" FOREIGN KEY ("flightSegmentId") REFERENCES "FlightSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Supabase: tabela nova fechada para a chave pública
ALTER TABLE "FlightChange" ENABLE ROW LEVEL SECURITY;
