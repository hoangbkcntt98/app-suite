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
const updateMissionSchema = z.object({
  attributeId: z.string().min(1).optional(),
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  difficulty: z.enum(difficulties).optional(),
  repeatType: z.enum(repeatTypes).optional(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  goldReward: z.coerce.number().int().min(0).optional().nullable(),
  isActive: z.boolean().optional(),
});

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
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
    const character = await getSelectedCharacter(authUser.userId);

    if (!character) {
      return NextResponse.json(
        { message: "Selected character not found." },
        { status: 404 }
      );
    }

    const result = await query(
      `SELECT m.*, to_jsonb(a) AS attribute,
        COALESCE((
          SELECT json_agg(l ORDER BY l."completedDate" DESC)
          FROM (
            SELECT * FROM mission_logs WHERE "missionId" = m.id
            ORDER BY "completedDate" DESC LIMIT 30
          ) l
        ), '[]'::json) AS logs
       FROM missions m JOIN attributes a ON a.id = m."attributeId"
       WHERE m.id = $1 AND m."characterId" = $2`,
      [id, character.id]
    );
    const mission = result.rows[0];

    if (!mission) {
      return NextResponse.json(
        {
          message: "Mission not found.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      mission,
    });
  } catch (error) {
    console.error("GET_MISSION_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
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
    const body = await request.json();

    const parsed = updateMissionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          message: "Invalid mission data.",
          errors: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const character = await getSelectedCharacter(authUser.userId);

    if (!character) {
      return NextResponse.json(
        { message: "Selected character not found." },
        { status: 404 }
      );
    }

    const existingResult = await query(
      `SELECT * FROM missions WHERE id = $1 AND "characterId" = $2`,
      [id, character.id]
    );
    const existingMission = existingResult.rows[0];

    if (!existingMission) {
      return NextResponse.json(
        {
          message: "Mission not found.",
        },
        { status: 404 }
      );
    }

    const data = parsed.data;

    if (data.attributeId) {
      const attributeResult = await query(
        `SELECT id FROM attributes WHERE id = $1 AND "characterId" = $2`,
        [data.attributeId, character.id]
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
    }

    const updateData: Record<string, unknown> = {};

    if (data.attributeId !== undefined) updateData.attributeId = data.attributeId;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.difficulty !== undefined) updateData.difficulty = data.difficulty;
    if (data.repeatType !== undefined) updateData.repeatType = data.repeatType;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (typeof data.goldReward === "number") updateData.goldReward = data.goldReward;

    if (data.startDate !== undefined) {
      updateData.startDate = data.startDate ? new Date(data.startDate) : null;
    }

    if (data.endDate !== undefined) {
      updateData.endDate = data.endDate ? new Date(data.endDate) : null;
    }

    if (data.difficulty) {
      const reward = getMissionRewardByDifficulty(data.difficulty);

      updateData.expReward = reward.expReward;
      updateData.goldReward = data.goldReward ?? reward.goldReward;
      updateData.statReward = reward.statReward;
    }

    if (data.goldReward === null) {
      const reward = getMissionRewardByDifficulty(data.difficulty ?? existingMission.difficulty);
      updateData.goldReward = reward.goldReward;
    }

    const fields = Object.entries(updateData);
    const values: unknown[] = [id, character.id];
    const assignments = fields.map(([field, value]) => {
      values.push(value);
      return `"${field}" = $${values.length}`;
    });
    const updated = await query(
      `UPDATE missions SET ${assignments.join(", ")}, "updatedAt" = NOW()
       WHERE id = $1 AND "characterId" = $2
       RETURNING *`,
      values
    );
    const mission = updated.rows[0];
    const attributeResult = await query(
      `SELECT * FROM attributes WHERE id = $1`,
      [mission.attributeId]
    );
    mission.attribute = attributeResult.rows[0];

    return NextResponse.json({
      message: "Mission updated successfully.",
      mission,
    });
  } catch (error) {
    console.error("UPDATE_MISSION_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
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
    const character = await getSelectedCharacter(authUser.userId);

    if (!character) {
      return NextResponse.json(
        { message: "Selected character not found." },
        { status: 404 }
      );
    }

    const existingResult = await query(
      `SELECT id FROM missions WHERE id = $1 AND "characterId" = $2`,
      [id, character.id]
    );
    const existingMission = existingResult.rows[0];

    if (!existingMission) {
      return NextResponse.json(
        {
          message: "Mission not found.",
        },
        { status: 404 }
      );
    }

    await query(`DELETE FROM missions WHERE id = $1`, [id]);

    return NextResponse.json({
      message: "Mission deleted successfully.",
    });
  } catch (error) {
    console.error("DELETE_MISSION_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
