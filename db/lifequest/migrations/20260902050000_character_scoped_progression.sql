BEGIN;

ALTER TABLE "attributes" ADD COLUMN "characterId" TEXT;
ALTER TABLE "missions" ADD COLUMN "characterId" TEXT;
ALTER TABLE "mission_logs" ADD COLUMN "characterId" TEXT;

-- Legacy user-scoped progression belongs to each user's earliest character.
WITH first_character AS (
  SELECT DISTINCT ON ("userId") id, "userId"
  FROM "characters"
  ORDER BY "userId", "createdAt" ASC
)
UPDATE "attributes" AS attribute
SET "characterId" = character.id
FROM first_character AS character
WHERE character."userId" = attribute."userId";

WITH first_character AS (
  SELECT DISTINCT ON ("userId") id, "userId"
  FROM "characters"
  ORDER BY "userId", "createdAt" ASC
)
UPDATE "missions" AS mission
SET "characterId" = character.id
FROM first_character AS character
WHERE character."userId" = mission."userId";

UPDATE "mission_logs" AS log
SET "characterId" = mission."characterId"
FROM "missions" AS mission
WHERE mission.id = log."missionId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "attributes" WHERE "characterId" IS NULL)
    OR EXISTS (SELECT 1 FROM "missions" WHERE "characterId" IS NULL)
    OR EXISTS (SELECT 1 FROM "mission_logs" WHERE "characterId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot assign legacy progression to a character.';
  END IF;
END $$;

ALTER TABLE "attributes" ALTER COLUMN "characterId" SET NOT NULL;
ALTER TABLE "missions" ALTER COLUMN "characterId" SET NOT NULL;
ALTER TABLE "mission_logs" ALTER COLUMN "characterId" SET NOT NULL;

ALTER TABLE "attributes" DROP CONSTRAINT IF EXISTS "attributes_userId_name_key";
ALTER TABLE "attributes"
  ADD CONSTRAINT "attributes_characterId_name_key" UNIQUE ("characterId", "name"),
  ADD CONSTRAINT "attributes_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE;

ALTER TABLE "missions"
  ADD CONSTRAINT "missions_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE;

ALTER TABLE "mission_logs"
  ADD CONSTRAINT "mission_logs_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE;

CREATE INDEX "attributes_characterId_idx" ON "attributes"("characterId");
CREATE INDEX "missions_characterId_idx" ON "missions"("characterId");
CREATE INDEX "mission_logs_characterId_idx" ON "mission_logs"("characterId");

COMMIT;
