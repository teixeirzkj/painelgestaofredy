-- CreateTable
CREATE TABLE "BalcaoFlow" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "saleId" TEXT,
    "fredyCardId" TEXT,
    "cardDone" BOOLEAN NOT NULL DEFAULT false,
    "dataChecked" BOOLEAN NOT NULL DEFAULT false,
    "docsDone" BOOLEAN NOT NULL DEFAULT false,
    "contractSent" BOOLEAN NOT NULL DEFAULT false,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BalcaoFlow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BalcaoFlow_companyId_clientId_idx" ON "BalcaoFlow"("companyId", "clientId");

-- CreateIndex
CREATE INDEX "BalcaoFlow_companyId_fredyCardId_idx" ON "BalcaoFlow"("companyId", "fredyCardId");

-- CreateIndex
CREATE INDEX "BalcaoFlow_companyId_userId_finishedAt_idx" ON "BalcaoFlow"("companyId", "userId", "finishedAt");

-- AddForeignKey
ALTER TABLE "BalcaoFlow" ADD CONSTRAINT "BalcaoFlow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalcaoFlow" ADD CONSTRAINT "BalcaoFlow_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalcaoFlow" ADD CONSTRAINT "BalcaoFlow_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

