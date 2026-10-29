-- Attribute names must be unique per character, not per user.
DROP INDEX IF EXISTS "attributes_userId_name_key";

-- Give existing characters their missing default attributes.
INSERT INTO "attributes" (
  "id",
  "userId",
  "characterId",
  "name",
  "value",
  "multiplier",
  "icon",
  "color",
  "createdAt",
  "updatedAt"
)
SELECT
  concat(
    'attr_',
    md5(random()::text || clock_timestamp()::text || character.id || attribute.name)
  ),
  character."userId",
  character.id,
  attribute.name,
  0,
  attribute.multiplier,
  attribute.icon,
  attribute.color,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "characters" AS character
CROSS JOIN (
  VALUES
    ('Strength', 1.2::double precision, '💪', '#ef4444'),
    ('Intelligence', 1.5::double precision, '🧠', '#3b82f6'),
    ('Discipline', 1.0::double precision, '🛡️', '#10b981'),
    ('Creativity', 1.3::double precision, '🎨', '#f59e0b'),
    ('Wisdom', 1.8::double precision, '📚', '#8b5cf6')
) AS attribute("name", "multiplier", "icon", "color")
WHERE NOT EXISTS (
  SELECT 1
  FROM "attributes" AS existing
  WHERE existing."characterId" = character.id
    AND existing."name" = attribute.name
);
