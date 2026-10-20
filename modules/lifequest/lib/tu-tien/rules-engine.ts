export type TuTienPlayer = {
  name: string;
  age: number;
  lifespan: number;
  origin: string;
  spiritRoot: string;
  cultivation: number;
  realm: string;
  hp: number;
  maxHp: number;
  spiritStones: number;
  will: number;
  luck: number;
  reputation: number;
  inventory: string[];
  relations: Record<string, number>;
  flags: Record<string, boolean>;
};

export type TuTienWorld = {
  name: string;
  year: number;
  region: string;
  sects: string[];
  factions: string[];
  publicEvents: string[];
};

export type TuTienGameState = {
  player: TuTienPlayer;
  world: TuTienWorld;
  difficulty: string;
  gainMult: number;
  dangerMult: number;
  turn: number;
  history: string[];
  currentScene: string;
};

export type RuleResult = {
  success: boolean;
  cultivationGain: number;
  stonesDelta: number;
  hpDelta: number;
  notes: string[];
  discovered: string[];
};

import { realmFor } from './constants';

function rngInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function rngFloat(rng: () => number, min: number, max: number): number {
  return rng() * (max - min) + min;
}

function rngChoice<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export class RulesEngine {
  constructor(private rng: () => number = Math.random) {}

  check(stat: number, difficulty: number, bonus = 0): { success: boolean; roll: number; target: number } {
    const roll = rngInt(this.rng, 1, 100);
    const target = Math.max(5, Math.min(95, 45 + stat * 5 + bonus - difficulty));
    return { success: roll <= target, roll, target };
  }

  applyChoice(state: TuTienGameState, action: string): RuleResult {
    const p = state.player;
    const actionL = action.toLowerCase();
    const result: RuleResult = {
      success: true,
      cultivationGain: 0,
      stonesDelta: 0,
      hpDelta: 0,
      notes: [],
      discovered: [],
    };

    if (/(tu luyện|tu luyen|luyện khí|luyen khi|bế quan|be quan)/.test(actionL)) {
      const base = rngInt(this.rng, 5, 12);
      result.cultivationGain = Math.round(base * state.gainMult * 10) / 10;
      result.notes.push('Ngươi dành thời gian hấp thu linh khí và ổn định kinh mạch.');
    } else if (/(động phủ|dong phu|bí cảnh|bi canh|thám hiểm|tham hiem|khám phá|kham pha)/.test(actionL)) {
      const { success, roll, target } = this.check(p.luck, Math.round(42 * state.dangerMult));
      result.success = success;
      result.notes.push(`Kiểm định cơ duyên: ${roll}/${target}.`);
      if (success) {
        const stones = rngInt(this.rng, 4, 18);
        result.stonesDelta = stones;
        result.cultivationGain = Math.round(rngFloat(this.rng, 2, 7) * state.gainMult * 10) / 10;
        if (this.rng() < 0.22) {
          const item = rngChoice(this.rng, [
            'Tàn quyển Thanh Mộc Quyết',
            'Dưỡng Khí Đan',
            'Mảnh cổ ngọc',
            'Hạ phẩm pháp kiếm',
          ]);
          p.inventory.push(item);
          result.discovered.push(item);
        }
      } else {
        const dmg = Math.round(rngInt(this.rng, 8, 24) * state.dangerMult);
        result.hpDelta = -dmg;
        result.notes.push('Ngươi đụng phải nguy hiểm vượt ngoài dự liệu.');
      }
    } else if (/(tông môn|tong mon|thanh vân|thanh van|nhiệm vụ|nhiem vu|trưởng lão|truong lao|tuyển đệ tử|tuyen de tu)/.test(actionL)) {
      const { success, roll, target } = this.check(p.will, Math.round(35 * state.dangerMult), p.reputation);
      result.success = success;
      result.notes.push(`Kiểm định tông môn: ${roll}/${target}.`);
      if (success) {
        result.stonesDelta = rngInt(this.rng, 3, 10);
        p.reputation += 1;
      } else {
        p.reputation -= 1;
      }
    } else if (/(đánh|danh|giết|giet|tấn công|tan cong|phục kích|phuc kich)/.test(actionL)) {
      const power = p.will + Math.floor(p.cultivation / 20);
      const { success, roll, target } = this.check(power, Math.round(45 * state.dangerMult));
      result.success = success;
      result.notes.push(`Kiểm định chiến đấu: ${roll}/${target}.`);
      if (success) {
        result.cultivationGain = Math.round(rngFloat(this.rng, 1, 4) * state.gainMult * 10) / 10;
        result.stonesDelta = rngInt(this.rng, 0, 8);
      } else {
        result.hpDelta = -Math.round(rngInt(this.rng, 12, 30) * state.dangerMult);
      }
    } else {
      const { success, roll, target } = this.check(
        Math.floor((p.will + p.luck) / 2),
        Math.round(38 * state.dangerMult)
      );
      result.success = success;
      result.notes.push(`Kiểm định hành động tự do: ${roll}/${target}.`);
      if (success) {
        result.cultivationGain = Math.round(rngFloat(this.rng, 0, 3) * state.gainMult * 10) / 10;
      } else {
        result.hpDelta = -rngInt(this.rng, 0, Math.round(8 * state.dangerMult));
      }
    }

    p.cultivation = Math.max(0, p.cultivation + result.cultivationGain);
    p.spiritStones = Math.max(0, p.spiritStones + result.stonesDelta);
    p.hp = Math.max(0, Math.min(p.maxHp, p.hp + result.hpDelta));
    const oldRealm = p.realm;
    p.realm = realmFor(p.cultivation);
    if (p.realm !== oldRealm) {
      result.notes.push(`Đột phá: ${oldRealm} → ${p.realm}.`);
    }

    state.turn += 1;
    if (state.turn % 8 === 0) {
      p.age += 1;
      state.world.year += 1;
      this.worldTick(state);
    }

    return result;
  }

  worldTick(state: TuTienGameState) {
    const events = [
      'Hai tông môn nhỏ tranh chấp một mỏ linh thạch ở biên giới.',
      'Một tán tu Kim Đan mất tích gần Hắc Phong Lĩnh.',
      'Giá Dưỡng Khí Đan tăng mạnh tại phường thị.',
      'Ma tu xuất hiện nhiều hơn trên tuyến thương đạo phía tây.',
      'Một thiên tài trẻ tuổi của Thanh Vân Tông nổi danh sau đại bỉ.',
    ];
    state.world.publicEvents.push(events[Math.floor(this.rng() * events.length)]);
    state.world.publicEvents = state.world.publicEvents.slice(-5);
  }
}
