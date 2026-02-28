/*
  Warnings:

  - The `status` column on the `SupportTicket` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `role` on the `Analyst` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `authorType` on the `SupportMessage` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "AnalystRole" AS ENUM ('ADMIN', 'ANALISTA', 'SUPERVISOR');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('WAITING_ANALYST', 'IN_PROGRESS', 'WAITING_DRIVER', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportAuthorType" AS ENUM ('DRIVER', 'ANALYST', 'SYSTEM');

-- AlterTable
ALTER TABLE "Analyst" DROP COLUMN "role",
ADD COLUMN     "role" "AnalystRole" NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Hub" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SupportMessage" DROP COLUMN "authorType",
ADD COLUMN     "authorType" "SupportAuthorType" NOT NULL;

-- AlterTable
ALTER TABLE "SupportTicket" DROP COLUMN "status",
ADD COLUMN     "status" "SupportTicketStatus" NOT NULL DEFAULT 'WAITING_ANALYST',
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SystemConfig" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Analyst_role_idx" ON "Analyst"("role");

-- CreateIndex
CREATE INDEX "SupportTicket_hubId_status_idx" ON "SupportTicket"("hubId", "status");
