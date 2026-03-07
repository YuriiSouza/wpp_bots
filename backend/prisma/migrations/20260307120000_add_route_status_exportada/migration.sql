DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'RouteStatus'
      AND e.enumlabel = 'EXPORTADA'
  ) THEN
    ALTER TYPE "RouteStatus" ADD VALUE 'EXPORTADA';
  END IF;
END $$;
