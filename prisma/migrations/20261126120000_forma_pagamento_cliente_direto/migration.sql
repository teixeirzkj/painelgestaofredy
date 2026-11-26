-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "clientPayMethod" TEXT,
ADD COLUMN     "clientPayInstallments" INTEGER NOT NULL DEFAULT 1;
