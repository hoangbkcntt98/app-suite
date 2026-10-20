import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@lifequest/lib/prisma";
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

const gameDetails = Prisma.validator<Prisma.TuTienGameDefaultArgs>()({
  include: {
    player: true,
    world: true,
    scenes: {
      orderBy: { turn: "asc" },
    },
  },
});

type GameWithDetails = Prisma.TuTienGameGetPayload<typeof gameDetails>;

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

    const [game, savedGames] = await prisma.$transaction([
      prisma.tuTienGame.findFirst({
        where: {
          characterId: character.id,
          status: "active",
        },
        ...gameDetails,
      }),
      prisma.tuTienGame.findMany({
        where: {
          characterId: character.id,
          status: "saved",
        },
        include: {
          player: true,
          scenes: {
            orderBy: { turn: "desc" },
            take: 1,
          },
        },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

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

    const existingGame = await prisma.tuTienGame.findUnique({
      where: { characterId: character.id },
    });

    if (existingGame && ["active", "saved"].includes(existingGame.status)) {
      return NextResponse.json(
        { message: "Đã có game đang chơi hoặc bản lưu. Hãy tiếp tục hoặc kết thúc game đó." },
        { status: 409 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      if (existingGame) {
        await tx.tuTienGame.delete({ where: { id: existingGame.id } });
      }

      const game = await tx.tuTienGame.create({
        data: {
          userId: authUser.userId,
          characterId: character.id,
          seed,
          difficulty: diffData.name,
          gainMult: diffData.gainMult * rootData.multiplier,
          dangerMult: diffData.dangerMult,
          llmProvider: selectedLlmProvider,
        },
      });

      const player = await tx.tuTienPlayer.create({
        data: {
          gameId: game.id,
          name,
          origin: originData.name,
          spiritRoot: rootData.name,
          will: 5 + willBonus,
          luck: 5 + luckBonus,
          spiritStones: stonesBonus,
          inventory: ["Áo vải", "Túi nước"],
          cultivation: 0,
          realm: "Phàm Nhân",
          hp: 100,
          maxHp: 100,
          age: 16,
          lifespan: 90,
          reputation: 0,
          relations: {},
          flags: {},
        },
      });

      const world = await tx.tuTienWorld.create({
        data: {
          gameId: game.id,
          ...generateWorld(rng),
        },
      });

      return { game, player, world };
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

    const savedScene = await prisma.tuTienScene.create({
      data: {
        gameId: result.game.id,
        turn: 1,
        title: scene.title,
        story: scene.story,
        choices: scene.choices,
      },
    });

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
          await prisma.tuTienGame.delete({ where: { id: createdGameId } });
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
    const game = await prisma.tuTienGame.findFirst({
      where: {
        characterId: character.id,
        userId: authUser.userId,
        status,
      },
    });

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

    let updateData: Prisma.TuTienGameUpdateInput;
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

    const updatedGame = await prisma.tuTienGame.update({
      where: { id: game.id },
      data: updateData,
      ...gameDetails,
    });
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

    const game = await prisma.tuTienGame.findFirst({
      where: {
        characterId: character.id,
        status: "active",
      },
    });

    if (!game) {
      return NextResponse.json(
        { message: "Không có game đang chạy." },
        { status: 404 }
      );
    }

    await prisma.tuTienGame.update({
      where: { id: game.id },
      data: { status: "ended" },
    });

    return NextResponse.json({ message: "Game đã kết thúc." });
  } catch (error) {
    console.error("DELETE_TU_TIEN_ERROR", error);
    return NextResponse.json(
      { message: "Lỗi server." },
      { status: 500 }
    );
  }
}
