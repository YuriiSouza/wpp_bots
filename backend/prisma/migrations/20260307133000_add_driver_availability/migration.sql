CREATE TABLE IF NOT EXISTS "DriverAvailability" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "DriverAvailability_driverId_availabilityDate_key"
  ON "DriverAvailability"("driverId", "availabilityDate");

CREATE INDEX IF NOT EXISTS "DriverAvailability_availabilityDate_status_idx"
  ON "DriverAvailability"("availabilityDate", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DriverAvailability_driverId_fkey'
  ) THEN
    ALTER TABLE "DriverAvailability"
    ADD CONSTRAINT "DriverAvailability_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
