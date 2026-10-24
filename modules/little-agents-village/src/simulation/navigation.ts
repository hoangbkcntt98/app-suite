import { agents, type Vec2 } from '../data/agents';

export const NAV_CELL = 0.5;
type Cell = { x: number; z: number };
const bounds = { minX: -24, maxX: 24, minZ: -20, maxZ: 20 };
const key = ({ x, z }: Cell) => `${x},${z}`;
const fromWorld = (point: Vec2): Cell => ({ x: Math.round(point.x / NAV_CELL), z: Math.round(point.z / NAV_CELL) });
const toWorld = ({ x, z }: Cell): Vec2 => ({ x: x * NAV_CELL, z: z * NAV_CELL });
const inside = ({ x, z }: Cell) => x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;

const houseObstacles = agents.map((agent) => ({
  x: agent.home.x,
  z: agent.home.z + (agent.home.z < 0 ? -1.75 : 1.75),
}));
const treeObstacles: Vec2[] = [
  [-11, -8], [-8.6, -9.5], [-5.5, -9.4], [-1.8, -10], [2, -9.8], [6, -9.6], [10, -8],
  [-11, 8], [-8, 9.7], [-5, 9.5], [-1, 10], [3, 9.8], [7, 9.5], [10.5, 8],
].map(([x, z]) => ({ x, z }));
const bushObstacles: Vec2[] = [
  [-7, -2], [7, -2], [-7, 3], [7, 3], [-4, 7], [4, -7], [-10, 1], [10, -4],
].map(([x, z]) => ({ x, z }));
const deskObstacles = agents.map((agent) => agent.work);
const blocked = (cell: Cell) => {
  const point = toWorld(cell);
  if (houseObstacles.some((house) => Math.abs(point.x - house.x) < 1.2 && Math.abs(point.z - house.z) < 1.02)) return true;
  if (treeObstacles.some((tree) => Math.hypot(point.x - tree.x, point.z - tree.z) < 0.78)) return true;
  if (bushObstacles.some((bush) => Math.hypot(point.x - bush.x, point.z - bush.z) < 0.56)) return true;
  if (deskObstacles.some((desk) => Math.abs(point.x - desk.x) < 0.54 && Math.abs(point.z - desk.z) < 0.42)) return true;
  if (Math.abs(point.x) > 6.45 && Math.abs(point.z) < 0.2) return true;
  return false;
};

function nearestOpen(origin: Cell): Cell | null {
  if (inside(origin) && !blocked(origin)) return origin;
  for (let radius = 1; radius <= 12; radius += 1) {
    const candidates: Cell[] = [];
    for (let x = -radius; x <= radius; x += 1) {
      const z = radius - Math.abs(x);
      candidates.push({ x: origin.x + x, z: origin.z + z }, { x: origin.x + x, z: origin.z - z });
    }
    candidates.sort((a, b) => a.z - b.z || a.x - b.x);
    const found = candidates.find((cell) => inside(cell) && !blocked(cell));
    if (found) return found;
  }
  return null;
}

const heuristic = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
const neighbors = (cell: Cell): Cell[] => [
  { x: cell.x, z: cell.z - 1 }, { x: cell.x - 1, z: cell.z },
  { x: cell.x + 1, z: cell.z }, { x: cell.x, z: cell.z + 1 },
];

export function findPath(start: Vec2, destination: Vec2): Vec2[] | null {
  const from = nearestOpen(fromWorld(start));
  const to = nearestOpen(fromWorld(destination));
  if (!from || !to) return null;

  const open = new Map<string, Cell>([[key(from), from]]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[key(from), 0]]);
  const fScore = new Map<string, number>([[key(from), heuristic(from, to)]]);

  while (open.size) {
    const current = [...open.values()].sort((a, b) =>
      (fScore.get(key(a)) ?? Infinity) - (fScore.get(key(b)) ?? Infinity) ||
      a.z - b.z || a.x - b.x,
    )[0];
    const currentKey = key(current);
    if (currentKey === key(to)) {
      const path: Cell[] = [current];
      let cursor = currentKey;
      while (cameFrom.has(cursor)) {
        cursor = cameFrom.get(cursor)!;
        const [x, z] = cursor.split(',').map(Number);
        path.push({ x, z });
      }
      return path.reverse().slice(1).map(toWorld);
    }
    open.delete(currentKey);
    for (const next of neighbors(current)) {
      if (!inside(next) || blocked(next)) continue;
      const nextKey = key(next);
      const tentative = (gScore.get(currentKey) ?? Infinity) + 1;
      if (tentative >= (gScore.get(nextKey) ?? Infinity)) continue;
      cameFrom.set(nextKey, currentKey);
      gScore.set(nextKey, tentative);
      fScore.set(nextKey, tentative + heuristic(next, to));
      open.set(nextKey, next);
    }
  }
  return null;
}

export function nearestWalkable(point: Vec2): Vec2 | null {
  const cell = nearestOpen(fromWorld(point));
  return cell ? toWorld(cell) : null;
}

export function isWalkable(point: Vec2): boolean {
  const cell = fromWorld(point);
  return inside(cell) && !blocked(cell);
}
