-- CreateEnum
CREATE TYPE "BlocklistStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('DISPONIVEL', 'ATRIBUIDA', 'BLOQUEADA');

-- CreateTable
CREATE TABLE "AssignmentOverview" (
    "id" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "driverId" TEXT,
    "payload" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentOverview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationState" (
    "phone" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "lastDriverId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationState_pkey" PRIMARY KEY ("phone")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "vehicleType" TEXT,
    "ds" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "noShowCount" INTEGER NOT NULL DEFAULT 0,
    "declineRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverBlocklist" (
    "driverId" TEXT NOT NULL,
    "status" "BlocklistStatus" NOT NULL DEFAULT 'ACTIVE',
    "timesListed" INTEGER NOT NULL DEFAULT 1,
    "lastActivatedAt" TIMESTAMP(3),
    "lastInactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverBlocklist_pkey" PRIMARY KEY ("driverId")
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

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "gaiola" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "requiredVehicleType" TEXT,
    "requiredVehicleTypeNorm" TEXT,
    "suggestionDriverDs" TEXT,
    "km" TEXT,
    "spr" TEXT,
    "volume" TEXT,
    "gg" TEXT,
    "veiculoRoterizado" TEXT,
    "driverId" TEXT,
    "driverName" TEXT,
    "driverVehicleType" TEXT,
    "driverAccuracy" TEXT,
    "driverPlate" TEXT,
    "status" "RouteStatus" NOT NULL DEFAULT 'DISPONIVEL',
    "assignedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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

-- CreateIndex
CREATE INDEX "AssignmentOverview_driverId_idx" ON "AssignmentOverview"("driverId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentOverview_rowNumber_key" ON "AssignmentOverview"("rowNumber" ASC);

-- CreateIndex
CREATE INDEX "DriverBlocklist_status_idx" ON "DriverBlocklist"("status" ASC);

-- CreateIndex
CREATE INDEX "DriverBlocklist_updatedAt_idx" ON "DriverBlocklist"("updatedAt" ASC);

-- CreateIndex
CREATE INDEX "FaqItem_active_position_idx" ON "FaqItem"("active" ASC, "position" ASC);

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

