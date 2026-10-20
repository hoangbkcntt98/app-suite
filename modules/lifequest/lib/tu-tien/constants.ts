export const REALMS = [
  { name: 'Phàm Nhân', threshold: 0 },
  { name: 'Luyện Khí tầng 1', threshold: 10 },
  { name: 'Luyện Khí tầng 2', threshold: 25 },
  { name: 'Luyện Khí tầng 3', threshold: 45 },
  { name: 'Luyện Khí tầng 4', threshold: 70 },
  { name: 'Luyện Khí tầng 5', threshold: 100 },
  { name: 'Luyện Khí tầng 6', threshold: 140 },
  { name: 'Luyện Khí tầng 7', threshold: 190 },
  { name: 'Luyện Khí tầng 8', threshold: 250 },
  { name: 'Luyện Khí tầng 9', threshold: 320 },
  { name: 'Trúc Cơ sơ kỳ', threshold: 420 },
] as const;

export const ORIGINS = {
  '1': { name: 'Phàm nhân sơn thôn', bonuses: { will: 2, luck: 0, spiritStones: 2 } },
  '2': { name: 'Con cháu tu tiên gia tộc sa sút', bonuses: { will: 0, luck: 1, spiritStones: 12 } },
  '3': { name: 'Tạp dịch ngoại môn', bonuses: { will: 1, luck: 0, spiritStones: 6 } },
  '4': { name: 'Tán tu lang bạt', bonuses: { will: 0, luck: 2, spiritStones: 8 } },
} as const;

export const ROOTS = {
  '1': { name: 'Ngũ linh căn', multiplier: 0.80 },
  '2': { name: 'Tam linh căn', multiplier: 1.00 },
  '3': { name: 'Song linh căn', multiplier: 1.20 },
  '4': { name: 'Dị linh căn - Lôi', multiplier: 1.35 },
} as const;

export const DIFFICULTIES = {
  '1': { name: 'Tiên hiệp giải trí', gainMult: 1.20, dangerMult: 0.80 },
  '2': { name: 'Tu tiên chân thực', gainMult: 1.00, dangerMult: 1.00 },
  '3': { name: 'Phàm nhân lưu', gainMult: 0.85, dangerMult: 1.15 },
  '4': { name: 'Địa ngục', gainMult: 0.72, dangerMult: 1.35 },
} as const;

export function realmFor(cultivation: number): string {
  let current: string = REALMS[0].name;
  for (const { name, threshold } of REALMS) {
    if (cultivation >= threshold) current = name;
    else break;
  }
  return current;
}
