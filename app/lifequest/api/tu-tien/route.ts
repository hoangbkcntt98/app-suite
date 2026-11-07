import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, withTransaction } from "@lifequest/lib/db";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { getSelectedCharacter } from "@lifequest/lib/character/session";
import {
  ORIGINS,
  ROOTS,
  DIFFICULTIES,
  StoryDirector,
  AiNarrationError,
  generateWorld,
  isAiNarrationEnabled,
  isAiNarrationFeatureEnabled,
  narrateScene,
  normalizeAiNarrationProvider,
  type TuTienGameState,
} from "@lifequest/lib/tu-tien";

const aiNarrationProviderSchema = z.enum([
  "none",
  "openai",
  "deepseek",
  "9router",
]);

const createGameSchema = z.object({
  name: z.string().min(1).max(30),
  origin: z.enum(["1", "2", "3", "4"]),
  root: z.enum(["1", "2", "3", "4"]),
  difficulty: z.enum(["1", "2", "3", "4"]),
  llmProvider: aiNarrationProviderSchema.default("none"),
  narratorModel: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((model) => !/[\u0000-\u001f]/.test(model))
    .optional(),
});

const gameOperationSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("save") }),
  z.object({ operation: z.literal("resume") }),
  z.object({
    operation: z.literal("narrator"),
    llmProvider: aiNarrationProviderSchema,
  }),
]);

type GameWithDetails = {
  id: string;
  turn: number;
  difficulty: string;
  status: string;
  llmProvider: string;
  seed: number;
  gainMult: number;
  dangerMult: number;
  updatedAt: Date;
  player: {
    name: string;
    realm: string;
    hp: number;
    maxHp: number;
    [key: string]: any;
  } | null;
  world: Record<string, any> | null;
  scenes: Record<string, any>[];
};

type SavedGameRecord = {
  id: string;
  turn: number;
  difficulty: string;
  status: string;
  updatedAt: Date;
  player: {
    name: string;
    realm: string;
    hp: number;
    maxHp: number;
  } | null;
  scenes: {
    title: string;
    story: string;
  }[];
};

type GameSceneRecord = {
  title: string;
  story: string;
};

function seededRng(seed: number): () => number {
  const m = 0x80000000;
  const a = 1103515245;
  const c = 12345;
  let state = seed;
  return () => {
    state = (a * state + c) % m;
    return state / m;
  };
}

function gamePayload(game: GameWithDetails) {
  return {
    game: {
      id: game.id,
      turn: game.turn,
      difficulty: game.difficulty,
      status: game.status,
      llmProvider: normalizeAiNarrationProvider(game.llmProvider),
    },
    player: game.player,
    world: game.world,
    scene: game.scenes.at(-1) || null,
    scenes: game.scenes,
  };
}

async function loadGameDetails(characterId: string, status: string) {
  const gameResult = await query<GameWithDetails>(
    `SELECT g.*, to_jsonb(p) AS player, to_jsonb(w) AS world
     FROM tu_tien_games g
     LEFT JOIN tu_tien_players p ON p."gameId" = g.id
     LEFT JOIN tu_tien_worlds w ON w."gameId" = g.id
     WHERE g."characterId" = $1 AND g.status = $2 LIMIT 1`,
    [characterId, status]
  );
  const game = gameResult.rows[0];
  if (!game) return null;
  const scenes = await query<GameSceneRecord>(
    `SELECT * FROM tu_tien_scenes WHERE "gameId" = $1 ORDER BY turn ASC`,
    [game.id]
  );
  return { ...game, scenes: scenes.rows };
}

function savedGameSummary(game: SavedGameRecord) {
  const scene = game.scenes[0] || null;

  return {
    id: game.id,
    turn: game.turn,
    difficulty: game.difficulty,
    status: game.status,
    updatedAt: game.updatedAt,
    player: game.player
      ? {
          name: game.player.name,
          realm: game.player.realm,
          hp: game.player.hp,
          maxHp: game.player.maxHp,
        }
      : null,
    scene: scene
      ? {
          title: scene.title,
          story: scene.story,
        }
      : null,
  };
}

export async function GET() {
  try {
    const authUser = await getCurrentUserFromCookie();
    if (!authUser) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const character = await getSelectedCharacter(authUser.userId);
    if (!character) {
      return NextResponse.json(
        { message: "Chọn character trước khi chơi." },
        { status: 404 }
      );
    }

    const [game, savedResult] = await Promise.all([
      loadGameDetails(character.id, "active"),
      query<SavedGameRecord>(
        `SELECT g.*, to_jsonb(p) AS player,
           COALESCE((SELECT json_agg(s) FROM (
             SELECT * FROM tu_tien_scenes WHERE "gameId" = g.id ORDER BY turn DESC LIMIT 1
           ) s), '[]'::json) AS scenes
         FROM tu_tien_games g LEFT JOIN tu_tien_players p ON p."gameId" = g.id
         WHERE g."characterId" = $1 AND g.status = 'saved'
         ORDER BY g."updatedAt" DESC`,
        [character.id]
      ),
    ]);
    const savedGames = savedResult.rows;

    if (!game) {
      return NextResponse.json({
        game: null,
        player: null,
        world: null,
        scene: null,
        scenes: [],
        savedGames: savedGames.map(savedGameSummary),
        aiNarrationAllowed: isAiNarrationFeatureEnabled(),
        aiNarrationEnabled: false,
      });
    }

    return NextResponse.json({
      ...gamePayload(game),
      savedGames: savedGames.map(savedGameSummary),
      aiNarrationAllowed: isAiNarrationFeatureEnabled(),
      aiNarrationEnabled: isAiNarrationEnabled(
        normalizeAiNarrationProvider(game.llmProvider)
      ),
    });
  } catch (error) {
    console.error("GET_TU_TIEN_ERROR", error);
    return NextResponse.json(
      { message: "Lỗi server." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let createdGameId: string | null = null;
  try {
    const authUser = await getCurrentUserFromCookie();
    if (!authUser) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const character = await getSelectedCharacter(authUser.userId);
    if (!character) {
      return NextResponse.json(
        { message: "Chọn character trước khi chơi." },
        { status: 404 }
      );
    }

    const body = await request.json();
    const parsed = createGameSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Dữ liệu không hợp lệ.", errors: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, origin, root, difficulty, llmProvider, narratorModel } = parsed.data;
    const selectedLlmProvider = isAiNarrationFeatureEnabled()
      ? llmProvider
      : "none";
    const originData = ORIGINS[origin];
    const rootData = ROOTS[root];
    const diffData = DIFFICULTIES[difficulty];

    if (!originData || !rootData || !diffData) {
      return NextResponse.json(
        { message: "Config không hợp lệ." },
        { status: 400 }
      );
    }

    const seed = Math.floor(Math.random() * 999999999);
    const rng = seededRng(seed);

    const willBonus = originData.bonuses.will || 0;
    const luckBonus = originData.bonuses.luck || 0;
    const stonesBonus = originData.bonuses.spiritStones || 0;

    const existingResult = await query(
      `SELECT * FROM tu_tien_games WHERE "characterId" = $1 LIMIT 1`,
      [character.id]
    );
    const existingGame = existingResult.rows[0];

    if (existingGame && ["active", "saved"].includes(existingGame.status)) {
      return NextResponse.json(
        { message: "Đã có game đang chơi hoặc bản lưu. Hãy tiếp tục hoặc kết thúc game đó." },
        { status: 409 }
      );
    }

    const result = await withTransaction(async (tx) => {
      if (existingGame) {
        await tx.query(`DELETE FROM tu_tien_games WHERE id = $1`, [existingGame.id]);
      }

      const gameResult = await tx.query(
        `INSERT INTO tu_tien_games (id, "userId", "characterId", seed, difficulty, "gainMult", "dangerMult", "llmProvider", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW()) RETURNING *`,
        [randomUUID(), authUser.userId, character.id, seed, diffData.name,
          diffData.gainMult * rootData.multiplier, diffData.dangerMult, selectedLlmProvider]
      );
      const game = gameResult.rows[0];
      const playerResult = await tx.query(
        `INSERT INTO tu_tien_players (
          id, "gameId", name, origin, "spiritRoot", will, luck, "spiritStones",
          inventory, cultivation, realm, hp, "maxHp", age, lifespan, reputation,
          relations, flags, "createdAt", "updatedAt"
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,'Phàm Nhân',100,100,16,90,0,'{}','{}',NOW(),NOW())
         RETURNING *`,
        [randomUUID(), game.id, name, originData.name, rootData.name,
          5 + willBonus, 5 + luckBonus, stonesBonus, ["Áo vải", "Túi nước"]]
      );
      const worldData = generateWorld(rng);
      const worldResult = await tx.query(
        `INSERT INTO tu_tien_worlds (id, "gameId", name, year, region, sects, factions, "publicEvents", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW()) RETURNING *`,
        [randomUUID(), game.id, worldData.name, worldData.year, worldData.region,
          worldData.sects, worldData.factions, worldData.publicEvents]
      );

      return { game, player: playerResult.rows[0], world: worldResult.rows[0] };
    });
    createdGameId = result.game.id;

    const gameState: TuTienGameState = {
      player: {
        name: result.player.name,
        age: result.player.age,
        lifespan: result.player.lifespan,
        origin: result.player.origin,
        spiritRoot: result.player.spiritRoot,
        cultivation: result.player.cultivation,
        realm: result.player.realm,
        hp: result.player.hp,
        maxHp: result.player.maxHp,
        spiritStones: result.player.spiritStones,
        will: result.player.will,
        luck: result.player.luck,
        reputation: result.player.reputation,
        inventory: result.player.inventory,
        relations: result.player.relations as Record<string, number>,
        flags: result.player.flags as Record<string, boolean>,
      },
      world: {
        name: result.world.name,
        year: result.world.year,
        region: result.world.region,
        sects: result.world.sects,
        factions: result.world.factions,
        publicEvents: result.world.publicEvents,
      },
      difficulty: result.game.difficulty,
      gainMult: result.game.gainMult,
      dangerMult: result.game.dangerMult,
      turn: result.game.turn,
      history: [],
      currentScene: "opening",
    };

    const director = new StoryDirector(rng);
    const scene = await narrateScene(
      gameState,
      director.opening(gameState),
      selectedLlmProvider,
      narratorModel
    );

    const savedSceneResult = await query(
      `INSERT INTO tu_tien_scenes (id, "gameId", turn, title, story, choices, "createdAt")
       VALUES ($1,$2,1,$3,$4,$5,NOW()) RETURNING *`,
      [randomUUID(), result.game.id, scene.title, scene.story, scene.choices]
    );
    const savedScene = savedSceneResult.rows[0];

    return NextResponse.json({
      message: "Game đã được tạo.",
      game: {
        id: result.game.id,
        turn: result.game.turn,
        difficulty: result.game.difficulty,
        status: result.game.status,
        llmProvider: normalizeAiNarrationProvider(result.game.llmProvider),
      },
      player: result.player,
      world: result.world,
      scene: savedScene,
      scenes: [savedScene],
      aiNarrationAllowed: isAiNarrationFeatureEnabled(),
      aiNarrationEnabled: isAiNarrationEnabled(selectedLlmProvider),
    });
  } catch (error) {
    if (error instanceof AiNarrationError) {
      if (createdGameId) {
        try {
          await query(`DELETE FROM tu_tien_games WHERE id = $1`, [createdGameId]);
        } catch (cleanupError) {
          console.error("CREATE_TU_TIEN_AI_CLEANUP_ERROR", cleanupError);
        }
      }
      return NextResponse.json({ message: error.message }, { status: 502 });
    }
    console.error("CREATE_TU_TIEN_ERROR", error);
    return NextResponse.json(
      { message: "Lỗi server." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authUser = await getCurrentUserFromCookie();
    if (!authUser) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const character = await getSelectedCharacter(authUser.userId);
    if (!character) {
      return NextResponse.json(
        { message: "Chọn character trước khi chơi." },
        { status: 404 }
      );
    }

    const parsed = gameOperationSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Thao tác game không hợp lệ." },
        { status: 400 }
      );
    }

    const operation = parsed.data.operation;
    const status =
      operation === "save" ? "active" : operation === "resume" ? "saved" : "active";
    const gameResult = await query(
      `SELECT * FROM tu_tien_games WHERE "characterId" = $1 AND "userId" = $2 AND status = $3 LIMIT 1`,
      [character.id, authUser.userId, status]
    );
    const game = gameResult.rows[0];

    if (!game) {
      return NextResponse.json(
        {
          message:
            operation === "save"
              ? "Không có game đang chơi để lưu."
              : operation === "resume"
                ? "Không tìm thấy bản lưu."
                : "Không có game đang chơi để đổi AI kể chuyện.",
        },
        { status: 404 }
      );
    }

    let updateData: { status?: string; llmProvider?: string };
    if (operation === "save") {
      updateData = { status: "saved" };
    } else if (operation === "resume") {
      updateData = { status: "active" };
    } else {
      updateData = {
        llmProvider: isAiNarrationFeatureEnabled()
          ? parsed.data.llmProvider
          : "none",
      };
    }

    const updatedResult = await query(
      `UPDATE tu_tien_games SET status = COALESCE($2, status),
         "llmProvider" = COALESCE($3, "llmProvider"), "updatedAt" = NOW()
       WHERE id = $1 RETURNING *`,
      [game.id, updateData.status ?? null, updateData.llmProvider ?? null]
    );
    const updatedGame = await loadGameDetails(character.id, updatedResult.rows[0].status);
    if (!updatedGame) throw new Error("Updated game could not be loaded.");
    const llmProvider = normalizeAiNarrationProvider(updatedGame.llmProvider);

    return NextResponse.json({
      message:
        operation === "save"
          ? "Đã lưu game."
          : operation === "resume"
            ? "Đã tiếp tục game."
            : "Đã đổi AI kể chuyện.",
      ...gamePayload(updatedGame),
      savedGames:
        operation === "save"
          ? [
              savedGameSummary({
                ...updatedGame,
                scenes: updatedGame.scenes.slice(-1),
              }),
            ]
          : [],
      aiNarrationAllowed: isAiNarrationFeatureEnabled(),
      aiNarrationEnabled: isAiNarrationEnabled(llmProvider),
      savedGame:
        operation === "save"
          ? savedGameSummary({
              ...updatedGame,
              scenes: updatedGame.scenes.slice(-1),
            })
          : null,
    });
  } catch (error) {
    console.error("PATCH_TU_TIEN_ERROR", error);
    return NextResponse.json(
      { message: "Lỗi server." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const authUser = await getCurrentUserFromCookie();
    if (!authUser) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const character = await getSelectedCharacter(authUser.userId);
    if (!character) {
      return NextResponse.json(
        { message: "Character không tồn tại." },
        { status: 404 }
      );
    }

    const gameResult = await query(
      `SELECT * FROM tu_tien_games WHERE "characterId" = $1 AND status = 'active' LIMIT 1`,
      [character.id]
    );
    const game = gameResult.rows[0];

    if (!game) {
      return NextResponse.json(
        { message: "Không có game đang chạy." },
        { status: 404 }
      );
    }

    await query(
      `UPDATE tu_tien_games SET status = 'ended', "updatedAt" = NOW() WHERE id = $1`,
      [game.id]
    );

    return NextResponse.json({ message: "Game đã kết thúc." });
  } catch (error) {
    console.error("DELETE_TU_TIEN_ERROR", error);
    return NextResponse.json(
      { message: "Lỗi server." },
      { status: 500 }
    );
  }
}
