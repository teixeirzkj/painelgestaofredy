-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "cardFirstBillMonth" TEXT,
ADD COLUMN     "cardStartInstallment" INTEGER NOT NULL DEFAULT 1;

