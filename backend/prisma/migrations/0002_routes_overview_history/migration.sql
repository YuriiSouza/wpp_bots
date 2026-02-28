ALTER TABLE "Route"
ADD COLUMN "atId" TEXT,
ADD COLUMN "routeDate" TEXT,
ADD COLUMN "shift" TEXT,
ADD COLUMN "requestedDriverId" TEXT,
ADD COLUMN "noShow" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "sheetRowNumber" INTEGER;

UPDATE "Route"
SET "atId" = "id"
WHERE "atId" IS NULL;

ALTER TABLE "Route"
ALTER COLUMN "atId" SET NOT NULL;

CREATE INDEX "Route_atId_routeDate_idx" ON "Route"("atId", "routeDate");
CREATE INDEX "Route_routeDate_shift_idx" ON "Route"("routeDate", "shift");
CREATE INDEX "Route_noShow_status_idx" ON "Route"("noShow", "status");
