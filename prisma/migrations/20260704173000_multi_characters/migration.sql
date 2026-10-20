DROP INDEX IF EXISTS "characters_userId_key";
CREATE INDEX IF NOT EXISTS "characters_userId_idx" ON "characters"("userId");
