-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "telegramChatId" TEXT;

-- CreateIndex
CREATE INDEX "Driver_telegramChatId_idx" ON "Driver"("telegramChatId");
