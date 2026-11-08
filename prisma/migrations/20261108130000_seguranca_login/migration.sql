-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "AccessLog_email_type_createdAt_idx" ON "AccessLog"("email", "type", "createdAt");

-- CreateIndex
CREATE INDEX "AccessLog_ip_type_createdAt_idx" ON "AccessLog"("ip", "type", "createdAt");

