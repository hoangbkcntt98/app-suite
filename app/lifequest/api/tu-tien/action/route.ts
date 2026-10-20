import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@lifequest/lib/prisma";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { getSelectedCharacter } from "@lifequest/lib/character/session";
import {
  RulesEngine,
  StoryDirector,
  AiNarrationError,
  narrateScene,
  normalizeAiNarrationProvider,
  type TuTienGameState,
  type RuleResult,
} from "@lifequest/lib/tu-tien";

const actionSchema = z.object({
  action: z.string().min(1).max(500),
  choice: z.number().int().min(0).max(2).optional(),
  narratorModel: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((model) => !/[\u0000-\u001f]/.test(model))
    .optional(),
});

function seededRng(seed: number, turn: number): () => number {
  const m = 0x80000000;
  const a = 1103515245;
  const c = 12345;
  let state = seed + turn * 7919;
  state = ((state % m) + m) % m;
  return () => {
    state = (a * state + c) % m;
    return state / m;
  };
}

function ruleResultJson(result: RuleResult): Prisma.InputJsonValue {
  return {
    success: result.success,
    cultivationGain: result.cultivationGain,
    stonesDelta: result.stonesDelta,
    hpDelta: result.hpDelta,
    notes: result.notes,
    discovered: result.discovered,
  };
}

export async function POST(request: NextRequest) {
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

    const game = await prisma.tuTienGame.findFirst({
      where: {
        characterId: character.id,
        status: "active",
      },
      include: {
        player: true,
        world: true,
        scenes: {
          orderBy: { turn: "desc" },
          take: 1,
        },
        history: {
          orderBy: { turn: "desc" },
          take: 30,
        },
      },
    });

    if (!game || !game.player || !game.world) {
      return NextResponse.json(
        { message: "Không có game đang chạy." },
        { status: 404 }
      );
    }

    const body = await request.json();
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Hành động không hợp lệ.", errors: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { action, narratorModel } = parsed.data;

    const rng = seededRng(game.seed, game.turn);
    const rules = new RulesEngine(rng);
    const director = new StoryDirector(rng);

    const gameState: TuTienGameState = {
      player: {
        name: game.player.name,
        age: game.player.age,
        lifespan: game.player.lifespan,
        origin: game.player.origin,
        spiritRoot: game.player.spiritRoot,
        cultivation: game.player.cultivation,
        realm: game.player.realm,
        hp: game.player.hp,
        maxHp: game.player.maxHp,
        spiritStones: game.player.spiritStones,
        will: game.player.will,
        luck: game.player.luck,
        reputation: game.player.reputation,
        inventory: game.player.inventory,
        relations: game.player.relations as Record<string, number>,
        flags: game.player.flags as Record<string, boolean>,
      },
      world: {
        name: game.world.name,
        year: game.world.year,
        region: game.world.region,
        sects: game.world.sects,
        factions: game.world.factions,
        publicEvents: game.world.publicEvents,
      },
      difficulty: game.difficulty,
      gainMult: game.gainMult,
      dangerMult: game.dangerMult,
      turn: game.turn,
      history: game.history.map((h) => `Turn ${h.turn}: ${h.action}`).slice().reverse(),
      currentScene: "playing",
    };

    const result = rules.applyChoice(gameState, action);
    const scene = await narrateScene(
      gameState,
      director.nextScene(gameState, action, result),
      normalizeAiNarrationProvider(game.llmProvider),
      narratorModel
    );

    await prisma.$transaction(async (tx) => {
      await tx.tuTienPlayer.update({
        where: { id: game.player!.id },
        data: {
          cultivation: gameState.player.cultivation,
          realm: gameState.player.realm,
          hp: gameState.player.hp,
          spiritStones: gameState.player.spiritStones,
          will: gameState.player.will,
          luck: gameState.player.luck,
          reputation: gameState.player.reputation,
          inventory: gameState.player.inventory,
          age: gameState.player.age,
          relations: gameState.player.relations,
          flags: gameState.player.flags,
        },
      });

      await tx.tuTienWorld.update({
        where: { id: game.world!.id },
        data: {
          year: gameState.world.year,
          publicEvents: gameState.world.publicEvents,
        },
      });

      await tx.tuTienGame.update({
        where: { id: game.id },
        data: { turn: gameState.turn },
      });

      await tx.tuTienHistory.create({
        data: {
          gameId: game.id,
          turn: game.turn,
          action,
          result: ruleResultJson(result),
        },
      });

      await tx.tuTienScene.create({
        data: {
          gameId: game.id,
          turn: gameState.turn,
          title: scene.title,
          story: scene.story,
          choices: scene.choices,
        },
      });

      if (gameState.player.hp <= 0) {
        await tx.tuTienGame.update({
          where: { id: game.id },
          data: { status: "ended" },
        });
      }
    });

    return NextResponse.json({
      message: result.success ? "Thành công!" : "Thất bại...",
      result,
      scene: {
        ...scene,
        turn: gameState.turn,
      },
      player: {
        name: gameState.player.name,
        realm: gameState.player.realm,
        cultivation: gameState.player.cultivation,
        hp: gameState.player.hp,
        spiritStones: gameState.player.spiritStones,
        age: gameState.player.age,
      },
      world: {
        year: gameState.world.year,
        publicEvents: gameState.world.publicEvents,
      },
      gameOver: gameState.player.hp <= 0,
    });
  } catch (error) {
    if (error instanceof AiNarrationError) {
      return NextResponse.json({ message: error.message }, { status: 502 });
    }
    console.error("TU_TIEN_ACTION_ERROR", error);
    return NextResponse.json(
      { message: "Lỗi server." },
      { status: 500 }
    );
  }
}
