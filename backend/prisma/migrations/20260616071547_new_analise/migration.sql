-- CreateEnum
CREATE TYPE "RouteAssignmentSource" AS ENUM ('SYNC', 'MANUAL', 'TELEGRAM_BOT');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('DISPONIVEL', 'ATRIBUIDA', 'APROVADA', 'BLOQUEADA', 'EXPORTADA');

-- CreateEnum
CREATE TYPE "BlocklistStatus" AS ENUM ('BLOCKED', 'UNBLOCKED');

-- CreateEnum
CREATE TYPE "BlockedQueueRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "AnalystRole" AS ENUM ('ADMIN', 'ANALISTA', 'SUPERVISOR');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('WAITING_ANALYST', 'IN_PROGRESS', 'WAITING_DRIVER', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportAuthorType" AS ENUM ('DRIVER', 'ANALYST', 'SYSTEM');

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "hubId" TEXT,
    "status" TEXT,
    "vehicleType" TEXT,
    "ds" TEXT,
    "noShowCount" INTEGER NOT NULL DEFAULT 0,
    "declineRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hasActiveRoute" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverAvailability" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "availabilityDate" TEXT NOT NULL,
    "rawValue" TEXT,
    "status" TEXT NOT NULL,
    "availableAm" BOOLEAN NOT NULL DEFAULT false,
    "availablePm" BOOLEAN NOT NULL DEFAULT false,
    "clusterRaw" TEXT,
    "vehicleType" TEXT,
    "noShowTime" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "atId" TEXT NOT NULL,
    "routeDate" TEXT,
    "cluster" TEXT,
    "gaiola" TEXT,
    "cidade" TEXT,
    "requiredVehicleType" TEXT,
    "km" TEXT,
    "spr" TEXT,
    "paradas" TEXT,
    "requestedDriverId" TEXT,
    "sheetRowNumber" INTEGER,
    "driverId" TEXT,
    "driverName" TEXT,
    "driverVehicleType" TEXT,
    "driverAccuracy" TEXT,
    "driverPlate" TEXT,
    "status" "RouteStatus" NOT NULL DEFAULT 'DISPONIVEL',
    "assignedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shift" TEXT,
    "bairro" TEXT,
    "volume" TEXT,
    "gg" TEXT,
    "suggestionDriverDs" TEXT,
    "veiculoRoterizado" TEXT,
    "requiredVehicleTypeNorm" TEXT,
    "noShow" BOOLEAN NOT NULL DEFAULT false,
    "botAvailable" BOOLEAN NOT NULL DEFAULT false,
    "assignmentSource" "RouteAssignmentSource" NOT NULL DEFAULT 'SYNC',

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "driversCount" INTEGER NOT NULL DEFAULT 0,
    "routesAvailable" INTEGER NOT NULL DEFAULT 0,
    "routesAssigned" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hub" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analyst" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "telegramChatId" TEXT,
    "role" "AnalystRole" NOT NULL,
    "hubId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Analyst_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'WAITING_ANALYST',
    "driverId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "analystId" TEXT,
    "queuePosition" INTEGER,
    "waitingSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstResponseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorType" "SupportAuthorType" NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "telegramText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "DriverBlocklist" (
    "driverId" TEXT NOT NULL,
    "status" "BlocklistStatus" NOT NULL DEFAULT 'BLOCKED',
    "reason" TEXT,
    "timesListed" INTEGER NOT NULL DEFAULT 1,
    "lastActivatedAt" TIMESTAMP(3),
    "lastInactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverBlocklist_pkey" PRIMARY KEY ("driverId")
);

-- CreateTable
CREATE TABLE "BlockedQueueRequest" (
    "driverId" TEXT NOT NULL,
    "chatId" TEXT,
    "driverName" TEXT,
    "vehicleType" TEXT,
    "blockReason" TEXT,
    "status" "BlockedQueueRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cooldownUntil" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockedQueueRequest_pkey" PRIMARY KEY ("driverId")
);

-- CreateTable
CREATE TABLE "FaqItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaqItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Driver_hubId_idx" ON "Driver"("hubId");

-- CreateIndex
CREATE INDEX "Driver_hasActiveRoute_idx" ON "Driver"("hasActiveRoute");

-- CreateIndex
CREATE INDEX "DriverAvailability_availabilityDate_status_idx" ON "DriverAvailability"("availabilityDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DriverAvailability_driverId_availabilityDate_key" ON "DriverAvailability"("driverId", "availabilityDate");

-- CreateIndex
CREATE UNIQUE INDEX "Route_atId_key" ON "Route"("atId");

-- CreateIndex
CREATE INDEX "Route_atId_routeDate_idx" ON "Route"("atId", "routeDate");

-- CreateIndex
CREATE INDEX "Route_status_idx" ON "Route"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Analyst_email_key" ON "Analyst"("email");

-- CreateIndex
CREATE INDEX "Analyst_hubId_idx" ON "Analyst"("hubId");

-- CreateIndex
CREATE INDEX "Analyst_role_idx" ON "Analyst"("role");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_protocol_key" ON "SupportTicket"("protocol");

-- CreateIndex
CREATE INDEX "SupportTicket_hubId_status_idx" ON "SupportTicket"("hubId", "status");

-- CreateIndex
CREATE INDEX "SupportTicket_driverId_idx" ON "SupportTicket"("driverId");

-- CreateIndex
CREATE INDEX "SupportTicket_analystId_idx" ON "SupportTicket"("analystId");

-- CreateIndex
CREATE INDEX "SupportTicket_updatedAt_idx" ON "SupportTicket"("updatedAt");

-- CreateIndex
CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_createdAt_idx" ON "AuditLog"("entityType", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "DriverBlocklist_status_idx" ON "DriverBlocklist"("status");

-- CreateIndex
CREATE INDEX "DriverBlocklist_updatedAt_idx" ON "DriverBlocklist"("updatedAt");

-- CreateIndex
CREATE INDEX "BlockedQueueRequest_status_requestedAt_idx" ON "BlockedQueueRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "BlockedQueueRequest_updatedAt_idx" ON "BlockedQueueRequest"("updatedAt");

-- CreateIndex
CREATE INDEX "FaqItem_active_position_idx" ON "FaqItem"("active", "position");

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverAvailability" ADD CONSTRAINT "DriverAvailability_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analyst" ADD CONSTRAINT "Analyst_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_analystId_fkey" FOREIGN KEY ("analystId") REFERENCES "Analyst"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Analyst"("id") ON DELETE SET NULL ON UPDATE CASCADE;
