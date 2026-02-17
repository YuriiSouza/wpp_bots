-- CreateEnum
CREATE TYPE "BlacklistStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "DriverBlacklist" (
    "driverId" TEXT NOT NULL,
    "status" "BlacklistStatus" NOT NULL DEFAULT 'ACTIVE',
    "timesListed" INTEGER NOT NULL DEFAULT 1,
    "lastActivatedAt" TIMESTAMP(3),
    "lastInactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverBlacklist_pkey" PRIMARY KEY ("driverId")
);

-- CreateIndex
CREATE INDEX "DriverBlacklist_status_idx" ON "DriverBlacklist"("status");

-- CreateIndex
CREATE INDEX "DriverBlacklist_updatedAt_idx" ON "DriverBlacklist"("updatedAt");
