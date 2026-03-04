DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Route"
    GROUP BY "atId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Nao foi possivel migrar Route.id para AT porque existem ATs duplicadas.';
  END IF;
END $$;

UPDATE "Route"
SET "id" = "atId"
WHERE "id" IS DISTINCT FROM "atId";

CREATE UNIQUE INDEX IF NOT EXISTS "Route_atId_key" ON "Route"("atId");
