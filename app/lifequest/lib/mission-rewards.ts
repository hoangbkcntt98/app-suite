import { MissionDifficulty } from "@prisma/client";

export const MISSION_REWARDS = {
  [MissionDifficulty.EASY]: {
    expReward: 10,
    goldReward: 2,
    statReward: 1,
  },
  [MissionDifficulty.NORMAL]: {
    expReward: 20,
    goldReward: 5,
    statReward: 1,
  },
  [MissionDifficulty.HARD]: {
    expReward: 40,
    goldReward: 10,
    statReward: 2,
  },
  [MissionDifficulty.EPIC]: {
    expReward: 80,
    goldReward: 20,
    statReward: 3,
  },
};

export function getMissionRewardByDifficulty(difficulty: MissionDifficulty) {
  return MISSION_REWARDS[difficulty];
}

export function calculateExpWithMultiplier(
  attributeValue: number,
  attributeMultiplier: number
): number {
  return Math.max(1, Math.round(attributeValue * attributeMultiplier));
}
