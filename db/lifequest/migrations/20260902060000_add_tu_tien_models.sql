BEGIN;

CREATE TABLE "tu_tien_games" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "turn" INTEGER NOT NULL DEFAULT 1,
    "difficulty" TEXT NOT NULL,
    "gainMult" DOUBLE PRECISION NOT NULL,
    "dangerMult" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "llmProvider" TEXT NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tu_tien_games_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tu_tien_players" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "age" INTEGER NOT NULL DEFAULT 16,
    "lifespan" INTEGER NOT NULL DEFAULT 90,
    "origin" TEXT NOT NULL,
    "spiritRoot" TEXT NOT NULL,
    "cultivation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "realm" TEXT NOT NULL DEFAULT 'Phàm Nhân',
    "hp" INTEGER NOT NULL DEFAULT 100,
    "maxHp" INTEGER NOT NULL DEFAULT 100,
    "spiritStones" INTEGER NOT NULL DEFAULT 0,
    "will" INTEGER NOT NULL DEFAULT 5,
    "luck" INTEGER NOT NULL DEFAULT 5,
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "inventory" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relations" JSONB,
    "flags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tu_tien_players_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tu_tien_worlds" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "region" TEXT NOT NULL,
    "sects" TEXT[] NOT NULL,
    "factions" TEXT[] NOT NULL,
    "publicEvents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tu_tien_worlds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tu_tien_histories" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tu_tien_histories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tu_tien_scenes" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "story" TEXT NOT NULL,
    "choices" TEXT[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tu_tien_scenes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "tu_tien_games"
    ADD CONSTRAINT "tu_tien_games_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "tu_tien_games_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tu_tien_players"
    ADD CONSTRAINT "tu_tien_players_gameId_key" UNIQUE ("gameId"),
    ADD CONSTRAINT "tu_tien_players_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "tu_tien_games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tu_tien_worlds"
    ADD CONSTRAINT "tu_tien_worlds_gameId_key" UNIQUE ("gameId"),
    ADD CONSTRAINT "tu_tien_worlds_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "tu_tien_games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tu_tien_histories"
    ADD CONSTRAINT "tu_tien_histories_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "tu_tien_games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tu_tien_scenes"
    ADD CONSTRAINT "tu_tien_scenes_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "tu_tien_games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "tu_tien_games_userId_idx" ON "tu_tien_games"("userId");
CREATE INDEX "tu_tien_games_characterId_idx" ON "tu_tien_games"("characterId");
CREATE INDEX "tu_tien_histories_gameId_idx" ON "tu_tien_histories"("gameId");
CREATE INDEX "tu_tien_scenes_gameId_idx" ON "tu_tien_scenes"("gameId");

COMMIT;
