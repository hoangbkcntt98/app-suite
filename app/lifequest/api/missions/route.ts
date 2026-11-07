import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@lifequest/lib/db";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { getMissionRewardByDifficulty, type MissionDifficulty } from "@lifequest/lib/mission-rewards";
import { getSelectedCharacter } from "@lifequest/lib/character/session";

type MissionRepeatType = "DAILY" | "WEEKLY" | "ONCE";
const difficulties = ["EASY", "NORMAL", "HARD", "EPIC"] as const;
const repeatTypes = ["DAILY", "WEEKLY", "ONCE"] as const;
const createMissionSchema = z.object({
  attributeId: z.string().min(1),
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  difficulty: z.enum(difficulties).default("NORMAL"),
  repeatType: z.enum(repeatTypes).default("DAILY"),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  goldReward: z.coerce.number().int().min(0).optional().nullable(),
});

export async function GET() {
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

    const character = await getSelectedCharacter(authUser.userId);

    if (!character) {
      return NextResponse.json(
        { message: "Selected character not found." },
        { status: 404 }
      );
    }

    const result = await query(
      `SELECT m.*,
        to_jsonb(a) AS attribute,
        COALESCE((
          SELECT json_agg(l ORDER BY l."completedDate" DESC)
          FROM (
            SELECT * FROM mission_logs WHERE "missionId" = m.id
            ORDER BY "completedDate" DESC LIMIT 10
          ) l
        ), '[]'::json) AS logs
       FROM missions m JOIN attributes a ON a.id = m."attributeId"
       WHERE m."characterId" = $1 ORDER BY m."createdAt" DESC`,
      [character.id]
    );
    const missions = result.rows;

    return NextResponse.json({
      missions,
    });
  } catch (error) {
    console.error("GET_MISSIONS_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();

    const parsed = createMissionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          message: "Invalid mission data.",
          errors: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const {
      attributeId,
      title,
      description,
      difficulty,
      repeatType,
      startDate,
      endDate,
      goldReward,
    } = parsed.data;

    const character = await getSelectedCharacter(authUser.userId);

    if (!character) {
      return NextResponse.json(
        { message: "Selected character not found." },
        { status: 404 }
      );
    }

    const attributeResult = await query(
      `SELECT id FROM attributes WHERE id = $1 AND "characterId" = $2`,
      [attributeId, character.id]
    );
    const attribute = attributeResult.rows[0];

    if (!attribute) {
      return NextResponse.json(
        {
          message: "Attribute not found.",
        },
        { status: 404 }
      );
    }

    const reward = getMissionRewardByDifficulty(difficulty);
    const parsedStartDate = startDate ? new Date(startDate) : null;
    const parsedEndDate = endDate ? new Date(endDate) : null;

    if (parsedStartDate && parsedEndDate && parsedEndDate < parsedStartDate) {
      return NextResponse.json(
        {
          message: "Due date must be after start date.",
        },
        { status: 400 }
      );
    }

    const result = await query(
      `INSERT INTO missions (
        id, "userId", "characterId", "attributeId", title, description,
        difficulty, "repeatType", "startDate", "endDate", "expReward",
        "goldReward", "statReward", "createdAt", "updatedAt"
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
       RETURNING *`,
      [
        randomUUID(), authUser.userId, character.id, attributeId, title,
        description ?? null, difficulty, repeatType, parsedStartDate, parsedEndDate,
        reward.expReward, goldReward ?? reward.goldReward, reward.statReward,
      ]
    );
    const mission = result.rows[0];

    return NextResponse.json(
      {
        message: "Mission created successfully.",
        mission,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("CREATE_MISSION_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
