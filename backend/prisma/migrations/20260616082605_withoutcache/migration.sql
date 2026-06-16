-- CreateEnum
CREATE TYPE "TelegramQueueStatus" AS ENUM ('WAITING', 'ACTIVE');

-- CreateTable
CREATE TABLE "TelegramSession" (
    "chatId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramSession_pkey" PRIMARY KEY ("chatId")
);

-- CreateTable
CREATE TABLE "TelegramQueueEntry" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "status" "TelegramQueueStatus" NOT NULL DEFAULT 'WAITING',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "TelegramQueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramKv" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramKv_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "TelegramLogEntry" (
    "id" BIGSERIAL NOT NULL,
    "bucket" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelegramQueueEntry_group_status_joinedAt_idx" ON "TelegramQueueEntry"("group", "status", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramQueueEntry_group_chatId_key" ON "TelegramQueueEntry"("group", "chatId");

-- CreateIndex
CREATE INDEX "TelegramKv_expiresAt_idx" ON "TelegramKv"("expiresAt");

-- CreateIndex
CREATE INDEX "TelegramLogEntry_bucket_createdAt_idx" ON "TelegramLogEntry"("bucket", "createdAt");
