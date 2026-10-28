"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { places, type Place } from "@/content/places";
import { drawOverlay } from "@/lib/paths/overlay";
import { LIMITS, PATH_MS, decodeGrid, type PathsState, type Walk } from "@/lib/paths/protocol";
import { createGroundRenderer } from "@/lib/paths/renderer";
import { GRID, SPAWN, cellIndex, resolve, type Pt } from "@/lib/paths/world";

const SPEED = 190;
const ACTIVE_R = 85;
const APPROACH_R = 46;
const PICK_R = 60;
const FLUSH_MS = 30_000;
const STUCK_MS = 600;
const GHOST_SPEED = 3;
const GHOST_REST = 12; // samples a ghost waits before walking again
const GHOST_TRAIL = 6;
// Your own steps show immediately, before the server ever hears about them.
const LOCAL_STEP = 0.5;
const LOCAL_SPREAD = 0.18;
const LOCAL_WEIGHT = 0.75;

const KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

const OPT_OUT_KEY = "paths:opt-out";
const OPT_OUT_EVENT = "paths:opt-out";

function readOptOut() {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeOptOut(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(OPT_OUT_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(OPT_OUT_EVENT, cb);
  };
}

function writeOptOut(value: boolean) {
  try {
    if (value) localStorage.setItem(OPT_OUT_KEY, "1");
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {}
  window.dispatchEvent(new Event(OPT_OUT_EVENT));
}

function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Where to stop when walking to a place: just short of it, on your side. */
function approach(place: Place, from: Pt): Pt {
  const dx = from.x - place.at[0];
  const dy = from.y - place.at[1];
  const d = Math.hypot(dx, dy) || 1;
  return { x: place.at[0] + (dx / d) * APPROACH_R, y: place.at[1] + (dy / d) * APPROACH_R };
}

function ghostAt(walk: Walk, offset: number, now: number): { at: Pt; trail: Pt[] } | null {
  const period = walk.length + GHOST_REST;
  const pos = ((now / PATH_MS) * GHOST_SPEED + offset * period) % period;
  if (pos >= walk.length - 1) return null;
  const k = Math.floor(pos);
  const t = pos - k;
  const [ax, ay] = walk[k];
  const [bx, by] = walk[k + 1];
  return {
    at: { x: ax + (bx - ax) * t, y: ay + (by - ay) * t },
    trail: walk.slice(Math.max(0, k - GHOST_TRAIL), k + 1).map(([x, y]) => ({ x, y })),
  };
}

type Status = { kind: "loading" } | { kind: "error" } | { kind: "ready"; visitors: number };

export function Meadow() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const optOut = useSyncExternalStore(subscribeOptOut, readOptOut, () => false);

  const groundRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const walkToRef = useRef<(id: string) => void>(() => {});

  useEffect(() => {
    const container = groundRef.current;
    const overlay = overlayRef.current;
    const ctx = overlay?.getContext("2d");
    if (!container || !overlay || !ctx) return;

    const ground = createGroundRenderer(container);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cancelled = false;

    // Wear: what the server knows, plus what you've walked this visit.
    const serverWear = new Uint8Array(GRID * GRID);
    const localWear = new Float32Array(GRID * GRID);
    const combined = new Uint8Array(GRID * GRID);
    let wearDirty = true;
    let lastUpload = 0;

    let ghosts: { walk: Walk; offset: number }[] = [];

    const me = resolve({ x: SPAWN.x + (Math.random() - 0.5) * 80, y: SPAWN.y + (Math.random() - 0.5) * 30 });
    const cam = { x: me.x, y: me.y - 140 };
    let facing = -Math.PI / 2;
    let target: Pt | null = null;
    let lastProgressAt = 0;
    const held = new Set<string>();

    const session = {
      id: randomId(),
      seen: new Set<number>(),
      pending: new Set<number>(),
      path: [] as Walk,
      lastCell: -1,
      lastSample: -Infinity,
    };

    // Sizing
    let w = 0;
    let h = 0;
    let zoom = 1;
    let overlayDpr = 1;
    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      zoom = Math.min(Math.max(Math.min(w, h) / 760, 0.55), 1.5);
      ground.resize(w, h, Math.min(window.devicePixelRatio || 1, 1.25));
      overlayDpr = Math.min(window.devicePixelRatio || 1, 2);
      overlay.width = Math.round(w * overlayDpr);
      overlay.height = Math.round(h * overlayDpr);
    };
    resize();
    window.addEventListener("resize", resize);

    fetch("/api/paths", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<PathsState>) : Promise.reject(new Error(String(r.status)))))
      .then((state) => {
        if (cancelled) return;
        const grid = decodeGrid(state.grid);
        if (grid.length === serverWear.length) serverWear.set(grid);
        wearDirty = true;
        ghosts = state.ghosts.map((walk) => ({ walk, offset: Math.random() }));
        setStatus({ kind: "ready", visitors: state.visitors });
      })
      .catch(() => {
        if (!cancelled) setStatus({ kind: "error" });
      });

    const walkTo = (p: Pt) => {
      target = p;
      lastProgressAt = performance.now();
    };
    walkToRef.current = (id) => {
      const place = places.find((p) => p.id === id);
      if (place) walkTo(approach(place, me));
    };

    // Pointer: click or tap to walk, hold and drag to steer
    let steering: number | null = null;
    const toWorld = (sx: number, sy: number): Pt => ({ x: cam.x + (sx - w / 2) / zoom, y: cam.y + (sy - h / 2) / zoom });
    const pick = (p: Pt) => places.find((pl) => Math.hypot(pl.at[0] - p.x, pl.at[1] - p.y) < PICK_R);
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      steering = e.pointerId;
      overlay.setPointerCapture(e.pointerId);
      const p = toWorld(e.clientX, e.clientY);
      const place = pick(p);
      walkTo(place ? approach(place, me) : p);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (steering === e.pointerId) walkTo(toWorld(e.clientX, e.clientY));
    };
    const onPointerUp = (e: PointerEvent) => {
      if (steering === e.pointerId) steering = null;
    };
    overlay.addEventListener("pointerdown", onPointerDown);
    overlay.addEventListener("pointermove", onPointerMove);
    overlay.addEventListener("pointerup", onPointerUp);
    overlay.addEventListener("pointercancel", onPointerUp);

    // Keyboard
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.code in KEYS) || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as Element).closest("input, textarea, [role=dialog]")) return;
      held.add(e.code);
      target = null;
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => held.delete(e.code);
    const onBlur = () => held.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    // Hand footsteps to the ground. Each send carries only cells not yet sent,
    // plus the whole walk so far (the server keeps the latest walk per visit).
    const flush = () => {
      if (readOptOut() || session.seen.size < LIMITS.minCells) return;
      if (session.pending.size === 0 && session.path.length < 2) return;
      const cells = [...session.pending].slice(0, LIMITS.maxCellsPerDeposit);
      const body = JSON.stringify({ v: 1, id: session.id, cells, path: session.path });
      const sent = () => cells.forEach((c) => session.pending.delete(c));
      if (navigator.sendBeacon?.("/api/paths", new Blob([body], { type: "application/json" }))) {
        sent();
      } else {
        fetch("/api/paths", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } })
          .then((r) => r.ok && sent())
          .catch(() => {});
      }
    };
    const flushTimer = window.setInterval(flush, FLUSH_MS);
    const onVisibility = () => {
      if (document.hidden) flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);

    const step = (dt: number, now: number) => {
      let vx = 0;
      let vy = 0;
      for (const code of held) {
        vx += KEYS[code][0];
        vy += KEYS[code][1];
      }

      let next: Pt | null = null;
      if (vx || vy) {
        const len = Math.hypot(vx, vy);
        next = { x: me.x + (vx / len) * SPEED * dt, y: me.y + (vy / len) * SPEED * dt };
      } else if (target) {
        const dx = target.x - me.x;
        const dy = target.y - me.y;
        const d = Math.hypot(dx, dy);
        if (d < 2) {
          target = null;
        } else {
          const s = Math.min(SPEED * dt, d);
          next = { x: me.x + (dx / d) * s, y: me.y + (dy / d) * s };
        }
      }

      if (next) {
        const p = resolve(next);
        const moved = Math.hypot(p.x - me.x, p.y - me.y);
        if (moved > 0.05) facing = Math.atan2(p.y - me.y, p.x - me.x);
        if (moved > 0.3) lastProgressAt = now;
        else if (target && now - lastProgressAt > STUCK_MS) target = null;
        me.x = p.x;
        me.y = p.y;
      }

      const cell = cellIndex(me.x, me.y);
      if (cell !== session.lastCell) {
        session.lastCell = cell;
        localWear[cell] = Math.min(1, localWear[cell] + LOCAL_STEP);
        for (const n of [cell - 1, cell + 1, cell - GRID, cell + GRID]) {
          if (n >= 0 && n < localWear.length) localWear[n] = Math.min(1, localWear[n] + LOCAL_SPREAD);
        }
        if (!session.seen.has(cell) && session.seen.size < LIMITS.maxCellsPerSession) {
          session.seen.add(cell);
          session.pending.add(cell);
        }
        wearDirty = true;
      }

      if (now - session.lastSample >= PATH_MS && session.path.length < LIMITS.maxPathPoints) {
        session.lastSample = now;
        session.path.push([Math.round(me.x), Math.round(me.y)]);
      }
    };

    let currentActive: string | null = null;
    const updateActive = () => {
      let best: string | null = null;
      let bestD = ACTIVE_R;
      for (const p of places) {
        const d = Math.hypot(p.at[0] - me.x, p.at[1] - me.y);
        if (d < bestD) {
          bestD = d;
          best = p.id;
        }
      }
      if (best !== currentActive) {
        currentActive = best;
        setActiveId(best);
      }
    };

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      step(dt, now);
      updateActive();

      if (wearDirty && now - lastUpload > 100) {
        for (let i = 0; i < combined.length; i++) {
          const s = serverWear[i] / 255;
          const l = localWear[i] * LOCAL_WEIGHT;
          combined[i] = Math.round(255 * (1 - (1 - s) * (1 - l)));
        }
        ground.setWear(combined);
        wearDirty = false;
        lastUpload = now;
      }

      const follow = 1 - Math.exp(-dt * (reduced ? 12 : 4));
      cam.x += (me.x - cam.x) * follow;
      cam.y += (me.y - cam.y) * follow;

      ground.render(cam, zoom, reduced ? 0 : now / 1000);
      drawOverlay(ctx, {
        width: w,
        height: h,
        dpr: overlayDpr,
        zoom,
        cam,
        me,
        facing,
        target,
        places,
        activeId: currentActive,
        ghosts: ghosts.flatMap((g) => {
          const s = ghostAt(g.walk, g.offset, now);
          return s ? [s] : [];
        }),
      });

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearInterval(flushTimer);
      flush();
      ground.destroy();
      window.removeEventListener("resize", resize);
      overlay.removeEventListener("pointerdown", onPointerDown);
      overlay.removeEventListener("pointermove", onPointerMove);
      overlay.removeEventListener("pointerup", onPointerUp);
      overlay.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  useEffect(() => {
    if (!listOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setListOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listOpen]);

  const active = places.find((p) => p.id === activeId) ?? null;

  const statusLine =
    status.kind === "loading"
      ? "Reading the ground…"
      : status.kind === "error"
        ? "Couldn't read the ground. You can still walk."
        : status.visitors === 0
          ? "Nobody has walked here yet. You'll wear the first path."
          : `${status.visitors.toLocaleString()} ${status.visitors === 1 ? "person has" : "people have"} walked here. Every path is theirs.`;

  return (
    <>
      <div ref={groundRef} className="ground" aria-hidden />
      <canvas ref={overlayRef} className="overlay" aria-hidden />

      <header className="hud">
        <h1>desire paths</h1>
        <p className="hud-status">{statusLine}</p>
        <p className="hud-hint">Click or tap to walk · drag to steer · WASD</p>
        <div className="hud-row">
          <button type="button" onClick={() => setListOpen(true)}>
            Read without walking
          </button>
          <label>
            <input type="checkbox" checked={optOut} onChange={(e) => writeOptOut(e.target.checked)} />
            Leave no tracks
          </label>
        </div>
      </header>

      {active && !listOpen && <PlaceCard place={active} className="panel" />}

      {listOpen && (
        <div className="list" role="dialog" aria-modal="true" aria-label="Everything in the meadow">
          <div className="list-inner">
            <div className="list-head">
              <h2>Everything in the meadow</h2>
              <button type="button" onClick={() => setListOpen(false)} autoFocus>
                Close
              </button>
            </div>
            {places.map((p) => (
              <PlaceCard
                key={p.id}
                place={p}
                className="list-card"
                action={
                  <button
                    type="button"
                    onClick={() => {
                      setListOpen(false);
                      walkToRef.current(p.id);
                    }}
                  >
                    Walk here →
                  </button>
                }
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function PlaceCard({ place, className, action }: { place: Place; className: string; action?: React.ReactNode }) {
  return (
    <article className={className} aria-live={className === "panel" ? "polite" : undefined}>
      <header>
        <h2>{place.title}</h2>
        {place.meta && <span className="meta">{place.meta}</span>}
      </header>
      {place.body.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      {place.tags && (
        <ul className="tags">
          {place.tags.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
      {place.links && (
        <ul className="links">
          {place.links.map((l) => (
            <li key={l.href}>
              <a href={l.href}>{l.label}</a>
            </li>
          ))}
        </ul>
      )}
      {action}
    </article>
  );
}
