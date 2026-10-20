import type { TuTienWorld } from './rules-engine';

const WORLD_NAMES = ['Thương Lan Giới', 'Cửu Huyền Giới', 'Thiên Mang Giới'];
const REGIONS = [
  'Nam Hoang — Thanh Hà quận',
  'Bắc Vực — Lạc Tuyết châu',
  'Đông Châu — Vân Mộng trạch',
];
const SECT_POOL = ['Thanh Vân Tông', 'Thiên Kiếm Môn', 'Bách Thảo Cốc', 'Huyền Âm Tông', 'Vạn Pháp Các'];
const FACTION_POOL = ['Trần gia', 'Tán Tu Minh', 'Hắc Phong Trại', 'Vạn Bảo Lâu', 'Huyết Hà Giáo'];

function shuffle<T>(rng: () => number, arr: T[]): T[] {
  const result = arr.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function generateWorld(rng: () => number = Math.random): TuTienWorld {
  const name = WORLD_NAMES[Math.floor(rng() * WORLD_NAMES.length)];
  const year = Math.floor(rng() * (260 - 130 + 1)) + 130;
  const region = REGIONS[Math.floor(rng() * REGIONS.length)];
  const sects = shuffle(rng, SECT_POOL).slice(0, 3);
  const factions = shuffle(rng, FACTION_POOL).slice(0, 3);
  return { name, year, region, sects, factions, publicEvents: [] };
}
