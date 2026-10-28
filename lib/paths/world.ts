import { places } from "@/content/places";

// World geometry shared by the client (rendering, movement) and the server
// (validating cells and walks). Everything is in world units.

export const WORLD = 2400;
export const CELL = 12;
export const GRID = WORLD / CELL;

export const SPAWN = { x: 1200, y: 2160 };
export const AVATAR_R = 8;

export interface Pt {
  x: number;
  y: number;
}

export interface Circle extends Pt {
  r: number;
}

/** The pond is the union of these circles. Paths have to bend around it. */
export const WATER: Circle[] = [
  { x: 1150, y: 1260, r: 190 },
  { x: 1320, y: 1130, r: 120 },
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic groves, kept clear of places, the gate and the pond. */
function plantTrees(): Circle[] {
  const rand = mulberry32(7);
  const groves = Array.from({ length: 7 }, () => ({ x: 200 + rand() * 2000, y: 200 + rand() * 1900 }));
  const trees: Circle[] = [];
  const clear = (x: number, y: number, r: number) =>
    x > 60 &&
    y > 60 &&
    x < WORLD - 60 &&
    y < WORLD - 60 &&
    Math.hypot(x - SPAWN.x, y - SPAWN.y) > 170 &&
    places.every((p) => Math.hypot(x - p.at[0], y - p.at[1]) > 120 + r) &&
    WATER.every((w) => Math.hypot(x - w.x, y - w.y) > w.r + r + 30) &&
    trees.every((t) => Math.hypot(x - t.x, y - t.y) > (t.r + r) * 0.9);

  for (let attempt = 0; attempt < 2000 && trees.length < 90; attempt++) {
    const r = 16 + rand() * 20;
    let x: number;
    let y: number;
    if (rand() < 0.65) {
      const g = groves[Math.floor(rand() * groves.length)];
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * 210;
      x = g.x + Math.cos(a) * d;
      y = g.y + Math.sin(a) * d;
    } else {
      x = rand() * WORLD;
      y = rand() * WORLD;
    }
    if (clear(x, y, r)) trees.push({ x, y, r });
  }
  return trees;
}

export const TREES = plantTrees();

// Canopies overhang; only the trunk area blocks walking.
const OBSTACLES: Circle[] = [
  ...WATER.map((w) => ({ ...w, r: w.r - 8 })),
  ...TREES.map((t) => ({ ...t, r: t.r * 0.5 })),
];

/** Pushes a point out of obstacles and back inside the world. */
export function resolve(p: Pt, radius = AVATAR_R): Pt {
  let { x, y } = p;
  for (let pass = 0; pass < 2; pass++) {
    for (const c of OBSTACLES) {
      const dx = x - c.x;
      const dy = y - c.y;
      const d = Math.hypot(dx, dy);
      const min = c.r + radius;
      if (d < min && d > 1e-6) {
        x = c.x + (dx / d) * min;
        y = c.y + (dy / d) * min;
      }
    }
  }
  const lo = 40;
  const hi = WORLD - 40;
  return { x: Math.min(Math.max(x, lo), hi), y: Math.min(Math.max(y, lo), hi) };
}

export function cellIndex(x: number, y: number): number {
  const cx = Math.min(GRID - 1, Math.max(0, Math.floor(x / CELL)));
  const cy = Math.min(GRID - 1, Math.max(0, Math.floor(y / CELL)));
  return cy * GRID + cx;
}
