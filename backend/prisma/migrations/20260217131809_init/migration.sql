-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('DISPONIVEL', 'ATRIBUIDA', 'BLOQUEADA');

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "contractType" TEXT,
    "function" TEXT,
    "express" TEXT,
    "fulfillmentPickup" TEXT,
    "eContractTemplateId" TEXT,
    "gender" TEXT,
    "email" TEXT,
    "cpf" TEXT,
    "cnpj" TEXT,
    "rntrcNumber" TEXT,
    "nationality" TEXT,
    "rg" TEXT,
    "ufIssueRg" TEXT,
    "rgIssueDate" TEXT,
    "countryOfOrigin" TEXT,
    "rne" TEXT,
    "rneExpirationDate" TEXT,
    "registeredUfRne" TEXT,
    "birthDate" TEXT,
    "motherName" TEXT,
    "fatherName" TEXT,
    "city" TEXT,
    "neighbourhood" TEXT,
    "streetName" TEXT,
    "addressNumber" TEXT,
    "zipcode" TEXT,
    "cardNumber" TEXT,
    "riskAssessmentDocument" TEXT,
    "cnhType" TEXT,
    "cnhNumber" TEXT,
    "cnhSecurityCode" TEXT,
    "cnhObservations" TEXT,
    "ufIssueCnh" TEXT,
    "firstLicenceDate" TEXT,
    "cnhIssueDate" TEXT,
    "driverLicenseExpireDate" TEXT,
    "pickupStationId" TEXT,
    "pickupStationShiftId" TEXT,
    "deliveryStationId" TEXT,
    "deliveryStationShiftId" TEXT,
    "lineHaulStationId" TEXT,
    "renavam" TEXT,
    "licensePlate" TEXT,
    "ufEmittingCrlv" TEXT,
    "vehicleManufacturingYear" TEXT,
    "cpfCnpjOwnerVehicle" TEXT,
    "vehicleOwnerName" TEXT,
    "vehicleType" TEXT,
    "spxStatus" TEXT,
    "radExpireTime" TEXT,
    "digitalCertificateExpiryDate" TEXT,
    "driverType" TEXT,
    "suspensionReason" TEXT,
    "ds" TEXT,
    "normalizedVehicleType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
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

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentOverview_rowNumber_key" ON "AssignmentOverview"("rowNumber");

-- CreateIndex
CREATE INDEX "AssignmentOverview_driverId_idx" ON "AssignmentOverview"("driverId");

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
