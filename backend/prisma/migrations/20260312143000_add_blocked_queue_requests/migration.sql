CREATE TYPE "BlockedQueueRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CONSUMED');

CREATE TABLE "BlockedQueueRequest" (
    "driverId" TEXT NOT NULL,
    "chatId" TEXT,
    "driverName" TEXT,
    "vehicleType" TEXT,
    "blockReason" TEXT,
    "status" "BlockedQueueRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockedQueueRequest_pkey" PRIMARY KEY ("driverId")
);

CREATE INDEX "BlockedQueueRequest_status_requestedAt_idx" ON "BlockedQueueRequest"("status", "requestedAt");
CREATE INDEX "BlockedQueueRequest_updatedAt_idx" ON "BlockedQueueRequest"("updatedAt");
