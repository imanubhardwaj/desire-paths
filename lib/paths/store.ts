import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Redis } from "@upstash/redis";
import {
  KEEP_WEEKS,
  LIMITS,
  buildWear,
  weekOf,
  type CellCounts,
  type Deposit,
  type PathsState,
  type Walk,
} from "./protocol";

export interface PathsStore {
  read(): Promise<PathsState>;
  deposit(d: Deposit): Promise<void>;
}

let store: PathsStore | undefined;

export function getStore(): PathsStore {
  store ??=
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? redisStore() : fileStore();
  return store;
}

const encode = (grid: Uint8Array) => Buffer.from(grid).toString("base64");

// --- Upstash Redis (production) ------------------------------------------------
//
// paths:week:<n>        hash  cell -> footsteps that week (expires after KEEP_WEEKS)
// paths:session:<id>    int   cells this visit has deposited (caps one person's wear)
// paths:visitors        int   distinct visits
// paths:ghosts          list  recent visit ids, newest first
// paths:ghost:<id>      json  that visit's walk
// paths:snapshot        json  the built PathsState, rebuilt at most every SNAPSHOT_TTL

const SESSION_TTL = 2 * 24 * 60 * 60;
const GHOST_TTL = 30 * 24 * 60 * 60;
const SNAPSHOT_TTL = 30;

// KEYS: week hash, session counter   ARGV: session cap, week ttl, session ttl, ...cells
// Returns how many cells were accepted, or -1 when this was the visit's first deposit.
const DEPOSIT_SCRIPT = `
local first = redis.call('EXISTS', KEYS[2]) == 0
local used = tonumber(redis.call('GET', KEYS[2]) or '0')
local room = tonumber(ARGV[1]) - used
local n = 0
for i = 4, #ARGV do
  if n >= room then break end
  redis.call('HINCRBY', KEYS[1], ARGV[i], 1)
  n = n + 1
end
redis.call('INCRBY', KEYS[2], n)
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
if n > 0 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end
if first then return -1 end
return n
`;

function redisStore(): PathsStore {
  const redis = Redis.fromEnv();
  const weekKey = (w: number) => `paths:week:${w}`;

  return {
    async read() {
      const cached = await redis.get<PathsState>("paths:snapshot");
      if (cached) return cached;

      const now = weekOf(Date.now());
      const pipe = redis.pipeline();
      for (let age = 0; age < KEEP_WEEKS; age++) pipe.hgetall(weekKey(now - age));
      pipe.get("paths:visitors");
      pipe.lrange("paths:ghosts", 0, LIMITS.maxGhosts - 1);
      const results = await pipe.exec();

      const weeks = results.slice(0, KEEP_WEEKS).map((counts, age) => ({ age, counts: counts as CellCounts | null }));
      const visitors = Number(results[KEEP_WEEKS] ?? 0);
      const ids = (results[KEEP_WEEKS + 1] as string[] | null) ?? [];
      const walks = ids.length ? await redis.mget<(Walk | null)[]>(...ids.map((id) => `paths:ghost:${id}`)) : [];

      const state: PathsState = {
        visitors,
        grid: encode(buildWear(weeks)),
        ghosts: walks.filter((w): w is Walk => Array.isArray(w) && w.length > 1),
      };
      await redis.set("paths:snapshot", state, { ex: SNAPSHOT_TTL });
      return state;
    },

    async deposit(d) {
      const weekTtl = (KEEP_WEEKS + 1) * 7 * 24 * 60 * 60;
      const result = Number(
        await redis.eval(
          DEPOSIT_SCRIPT,
          [weekKey(weekOf(Date.now())), `paths:session:${d.id}`],
          [String(LIMITS.maxCellsPerSession), String(weekTtl), String(SESSION_TTL), ...d.cells.map(String)],
        ),
      );

      const pipe = redis.pipeline();
      if (result === -1) pipe.incr("paths:visitors");
      if (d.path.length > 1) {
        pipe.set(`paths:ghost:${d.id}`, JSON.stringify(d.path), { ex: GHOST_TTL });
        pipe.lrem("paths:ghosts", 0, d.id);
        pipe.lpush("paths:ghosts", d.id);
        pipe.ltrim("paths:ghosts", 0, LIMITS.maxGhosts - 1);
      }
      if (pipe.length()) await pipe.exec();
    },
  };
}

// --- Local JSON file (development) ---------------------------------------------

interface FileState {
  visitors: number;
  sessions: Record<string, { cells: number; at: number }>;
  weeks: Record<string, Record<string, number>>;
  ghosts: { id: string; path: Walk }[];
}

const FILE = path.join(process.cwd(), ".data", "paths.json");

function fileStore(): PathsStore {
  let chain: Promise<unknown> = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  const load = async (): Promise<FileState> => {
    try {
      return JSON.parse(await readFile(FILE, "utf8")) as FileState;
    } catch {
      return { visitors: 0, sessions: {}, weeks: {}, ghosts: [] };
    }
  };

  const save = async (state: FileState) => {
    await mkdir(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(state));
    await rename(tmp, FILE);
  };

  return {
    async read() {
      const state = await load();
      const now = weekOf(Date.now());
      const weeks = Array.from({ length: KEEP_WEEKS }, (_, age) => ({ age, counts: state.weeks[now - age] ?? null }));
      return {
        visitors: state.visitors,
        grid: encode(buildWear(weeks)),
        ghosts: state.ghosts.map((g) => g.path),
      };
    },

    deposit: (d) =>
      serialized(async () => {
        const state = await load();
        const now = Date.now();
        const week = weekOf(now);

        let session = state.sessions[d.id];
        if (!session) {
          session = state.sessions[d.id] = { cells: 0, at: now };
          state.visitors += 1;
        }
        const accepted = d.cells.slice(0, Math.max(0, LIMITS.maxCellsPerSession - session.cells));
        session.cells += accepted.length;
        session.at = now;

        const counts = (state.weeks[week] ??= {});
        for (const c of accepted) counts[c] = (counts[c] ?? 0) + 1;

        if (d.path.length > 1) {
          state.ghosts = [{ id: d.id, path: d.path }, ...state.ghosts.filter((g) => g.id !== d.id)].slice(
            0,
            LIMITS.maxGhosts,
          );
        }

        for (const w of Object.keys(state.weeks)) if (Number(w) <= week - KEEP_WEEKS) delete state.weeks[w];
        for (const [id, s] of Object.entries(state.sessions)) {
          if (now - s.at > SESSION_TTL * 1000) delete state.sessions[id];
        }

        await save(state);
      }),
  };
}
