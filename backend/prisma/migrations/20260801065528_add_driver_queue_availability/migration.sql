-- AlterEnum
ALTER TYPE "RouteAssignmentSource" ADD VALUE 'WEB';

-- CreateTable
CREATE TABLE "DriverQueueAvailability" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "clusters" TEXT[],
    "vehicleType" TEXT,
    "date" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverQueueAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriverQueueAvailability_date_idx" ON "DriverQueueAvailability"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DriverQueueAvailability_driverId_date_key" ON "DriverQueueAvailability"("driverId", "date");

-- AddForeignKey
ALTER TABLE "DriverQueueAvailability" ADD CONSTRAINT "DriverQueueAvailability_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
