-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "lastRouteDate" TEXT,
ADD COLUMN     "totalRoutesAccepted" INTEGER NOT NULL DEFAULT 0;
