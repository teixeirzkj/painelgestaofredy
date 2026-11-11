-- AlterTable
ALTER TABLE "MondeIntegration" ADD COLUMN     "peopleCursor" TEXT,
ADD COLUMN     "salesCreated" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salesCursor" TEXT,
ADD COLUMN     "salesErrorsJson" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "salesFailed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salesImporting" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "salesLastImportAt" TIMESTAMP(3),
ADD COLUMN     "salesSkipped" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "mondeId" TEXT;


-- RLS (Supabase): nada novo; as tabelas já têm RLS ligado.
