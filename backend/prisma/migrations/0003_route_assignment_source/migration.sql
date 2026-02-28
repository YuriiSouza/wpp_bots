CREATE TYPE "RouteAssignmentSource" AS ENUM ('SYNC', 'MANUAL', 'TELEGRAM_BOT');

ALTER TABLE "Route"
ADD COLUMN "assignmentSource" "RouteAssignmentSource" NOT NULL DEFAULT 'SYNC';
