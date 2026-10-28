export const LEVEL_NAMES: Record<number, string> = {
  1: "Nhập Môn",
  2: "Luyện Khí Sơ Kì",
  3: "Luyện Khí Trung Kì",
  4: "Luyện Khí Đỉnh Phong",
  5: "Kim Đan Sơ Kì",
  6: "Kim Đan Trung Kì",
  7: "Kim Đan Đỉnh Phong",
  8: "Hóa Thần Sơ Kì",
  9: "Hóa Thần Hậu Kì",
  10: "Hóa Thần Đỉnh Phong",
};

export function getLevelName(level: number): string {
  return LEVEL_NAMES[level] || LEVEL_NAMES[10];
}

export function getRequiredExp(level: number) {
  return level * level * 100;
}

export function calculateLevelUp(currentLevel: number, currentExp: number) {
  let level = currentLevel;
  let exp = currentExp;
  let levelUpCount = 0;

  while (exp >= getRequiredExp(level)) {
    exp -= getRequiredExp(level);
    level += 1;
    levelUpCount += 1;
  }

  return {
    level,
    exp,
    levelUpCount,
    didLevelUp: levelUpCount > 0,
  };
}
