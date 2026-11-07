import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { query, withTransaction } from "@lifequest/lib/db";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { getTodayInTokyoDateOnly } from "@lifequest/lib/date";
import { calculateLevelUp } from "@lifequest/lib/level";
import { getSelectedCharacter } from "@lifequest/lib/character/session";
import { calculateExpWithMultiplier } from "@lifequest/lib/mission-rewards";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const authUser = await getCurrentUserFromCookie();

    if (!authUser) {
      return NextResponse.json(
        {
          message: "Unauthorized.",
        },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    const today = getTodayInTokyoDateOnly();
    const character = await getSelectedCharacter(authUser.userId);

    if (!character) {
      return NextResponse.json(
        { message: "Selected character not found." },
        { status: 404 }
      );
    }

    const missionResult = await query(
      `SELECT m.*, to_jsonb(a) AS attribute
       FROM missions m JOIN attributes a ON a.id = m."attributeId"
       WHERE m.id = $1 AND m."characterId" = $2 AND m."isActive" = TRUE`,
      [id, character.id]
    );
    const mission = missionResult.rows[0];

    if (!mission) {
      return NextResponse.json(
        {
          message: "Mission not found or inactive.",
        },
        { status: 404 }
      );
    }

    const existingResult = await query(
      `SELECT id FROM mission_logs WHERE "missionId" = $1 AND "completedDate" = $2`,
      [mission.id, today]
    );
    const existingLog = existingResult.rows[0];

    if (existingLog) {
      return NextResponse.json(
        {
          message: "Mission already completed today.",
        },
        { status: 409 }
      );
    }

    const result = await withTransaction(async (client) => {
      const attributeResult = await client.query(
        `UPDATE attributes SET value = value + $2, "updatedAt" = NOW()
         WHERE id = $1 RETURNING *`,
        [mission.attributeId, mission.statReward]
      );
      const updatedAttribute = attributeResult.rows[0];

      const expWithMultiplier = calculateExpWithMultiplier(
        updatedAttribute.value,
        updatedAttribute.multiplier
      );

      const logResult = await client.query(
        `INSERT INTO mission_logs (
          id, "missionId", "userId", "characterId", "completedDate",
          "expEarned", "goldEarned", "statEarned", "createdAt"
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
        [
          randomUUID(), mission.id, authUser.userId, character.id, today,
          expWithMultiplier, mission.goldReward, mission.statReward,
        ]
      );
      const missionLog = logResult.rows[0];

      const rawExp = character.exp + expWithMultiplier;
      const rawGold = character.gold + mission.goldReward;

      const levelResult = calculateLevelUp(character.level, rawExp);

      const characterResult = await client.query(
        `UPDATE characters SET exp = $2, level = $3, gold = $4, "updatedAt" = NOW()
         WHERE id = $1 RETURNING *`,
        [character.id, levelResult.exp, levelResult.level, rawGold]
      );
      const updatedCharacter = characterResult.rows[0];

    return {
      missionLog,
      updatedAttribute,
      updatedCharacter,
      reward: {
        exp: expWithMultiplier,
        gold: mission.goldReward,
        stat: mission.statReward,
        attributeName: mission.attribute.name,
      },
        level: {
          before: character.level,
          after: updatedCharacter.level,
          didLevelUp: levelResult.didLevelUp,
          levelUpCount: levelResult.levelUpCount,
        },
      };
    });

    return NextResponse.json({
      message: result.level.didLevelUp
        ? "Mission completed! Level up!"
        : "Mission completed!",
      mission: {
        id: mission.id,
        title: mission.title,
      },
      reward: result.reward,
      character: {
        id: result.updatedCharacter.id,
        name: result.updatedCharacter.name,
        level: result.updatedCharacter.level,
        exp: result.updatedCharacter.exp,
        gold: result.updatedCharacter.gold,
      },
      attribute: {
        id: result.updatedAttribute.id,
        name: result.updatedAttribute.name,
        value: result.updatedAttribute.value,
      },
      level: result.level,
      log: result.missionLog,
    });
  } catch (error) {
    console.error("COMPLETE_MISSION_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
