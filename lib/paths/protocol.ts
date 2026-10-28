import { GRID, WORLD } from "./world";

// A deposit is what one visit hands to the ground: the grid cells it crossed
// since its last deposit, plus its whole walk so far (for replay as a ghost).

export const LIMITS = {
  maxCellsPerDeposit: 900,
  maxCellsPerSession: 1500,
  maxPathPoints: 720,
  maxGhosts: 24,
  maxBodyBytes: 64_000,
  minCells: 8,
};

/** Walk samples are taken every PATH_MS; ghosts replay against the same clock. */
export const PATH_MS = 500;

export type Walk = [number, number][];

export interface Deposit {
  v: 1;
  id: string;
  cells: number[];
  path: Walk;
}

export interface PathsState {
  visitors: number;
  /** base64 of GRID × GRID bytes, row-major, 0 = untouched, 255 = bare soil */
  grid: string;
  ghosts: Walk[];
}

const ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

function isInt(v: unknown, min: number, max: number): v is number {
  return Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
}

export function parseDeposit(raw: unknown): Deposit | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.id !== "string" || !ID_RE.test(r.id)) return null;
  if (!Array.isArray(r.cells) || r.cells.length > LIMITS.maxCellsPerDeposit) return null;
  if (!Array.isArray(r.path) || r.path.length > LIMITS.maxPathPoints) return null;

  const cells = new Set<number>();
  for (const c of r.cells) {
    if (!isInt(c, 0, GRID * GRID - 1)) return null;
    cells.add(c);
  }

  const path: Walk = [];
  for (const p of r.path) {
    if (!Array.isArray(p) || p.length !== 2 || !isInt(p[0], 0, WORLD) || !isInt(p[1], 0, WORLD)) return null;
    path.push([p[0], p[1]]);
  }

  return { v: 1, id: r.id, cells: [...cells], path };
}

// --- turning footsteps into ground ----------------------------------------------

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const KEEP_WEEKS = 12;
// Each week of age keeps this fraction of its footsteps.
const WEEKLY_DECAY = 0.82;
// Footsteps (after blur) needed to wear a cell about 63% of the way to bare.
const SOFTNESS = 2.5;

export const weekOf = (ms: number) => Math.floor(ms / WEEK_MS);

export type CellCounts = Record<string, number | string>;

/** Sums decayed weekly counts, softens them, and maps them to 0–255 wear. */
export function buildWear(weeks: { age: number; counts: CellCounts | null }[]): Uint8Array {
  const score = new Float32Array(GRID * GRID);
  for (const { age, counts } of weeks) {
    if (!counts) continue;
    const weight = WEEKLY_DECAY ** age;
    for (const key in counts) {
      const i = Number(key);
      if (i >= 0 && i < score.length) score[i] += Number(counts[key]) * weight;
    }
  }

  // 3×3 binomial blur: one walker's line becomes a soft strip, not a pixel trail.
  const out = new Uint8Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= GRID) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= GRID) continue;
          sum += score[yy * GRID + xx] * (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
        }
      }
      out[y * GRID + x] = Math.round(255 * (1 - Math.exp(-sum / 16 / SOFTNESS)));
    }
  }
  return out;
}

export function decodeGrid(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
