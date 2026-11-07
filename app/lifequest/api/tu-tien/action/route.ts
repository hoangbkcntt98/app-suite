import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, withTransaction } from "@lifequest/lib/db";
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

function ruleResultJson(result: RuleResult) {
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

    const gameResult = await query(
      `SELECT g.*, to_jsonb(p) AS player, to_jsonb(w) AS world
       FROM tu_tien_games g
       LEFT JOIN tu_tien_players p ON p."gameId" = g.id
       LEFT JOIN tu_tien_worlds w ON w."gameId" = g.id
       WHERE g."characterId" = $1 AND g.status = 'active' LIMIT 1`,
      [character.id]
    );
    const game = gameResult.rows[0];
    if (game) {
      const [sceneResult, historyResult] = await Promise.all([
        query(
          `SELECT * FROM tu_tien_scenes WHERE "gameId" = $1 ORDER BY turn DESC LIMIT 1`,
          [game.id]
        ),
        query(
          `SELECT * FROM tu_tien_histories WHERE "gameId" = $1 ORDER BY turn DESC LIMIT 30`,
          [game.id]
        ),
      ]);
      game.scenes = sceneResult.rows;
      game.history = historyResult.rows;
    }

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
      history: game.history.map((h: { turn: number; action: string }) => `Turn ${h.turn}: ${h.action}`).slice().reverse(),
      currentScene: "playing",
    };

    const result = rules.applyChoice(gameState, action);
    const scene = await narrateScene(
      gameState,
      director.nextScene(gameState, action, result),
      normalizeAiNarrationProvider(game.llmProvider),
      narratorModel
    );

    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE tu_tien_players SET cultivation=$2, realm=$3, hp=$4, "spiritStones"=$5,
           will=$6, luck=$7, reputation=$8, inventory=$9, age=$10, relations=$11,
           flags=$12, "updatedAt"=NOW() WHERE id=$1`,
        [
          game.player.id, gameState.player.cultivation, gameState.player.realm,
          gameState.player.hp, gameState.player.spiritStones, gameState.player.will,
          gameState.player.luck, gameState.player.reputation, gameState.player.inventory,
          gameState.player.age, gameState.player.relations, gameState.player.flags,
        ]
      );

      await tx.query(
        `UPDATE tu_tien_worlds SET year=$2, "publicEvents"=$3, "updatedAt"=NOW() WHERE id=$1`,
        [game.world.id, gameState.world.year, gameState.world.publicEvents]
      );

      await tx.query(
        `UPDATE tu_tien_games SET turn=$2, status=$3, "updatedAt"=NOW() WHERE id=$1`,
        [game.id, gameState.turn, gameState.player.hp <= 0 ? "ended" : game.status]
      );

      await tx.query(
        `INSERT INTO tu_tien_histories (id, "gameId", turn, action, result, "createdAt")
         VALUES ($1,$2,$3,$4,$5,NOW())`,
        [randomUUID(), game.id, game.turn, action, ruleResultJson(result)]
      );

      await tx.query(
        `INSERT INTO tu_tien_scenes (id, "gameId", turn, title, story, choices, "createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [randomUUID(), game.id, gameState.turn, scene.title, scene.story, scene.choices]
      );

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
