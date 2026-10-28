import type { Place } from "@/content/places";
import { TREES, type Pt } from "./world";

// Everything drawn above the ground: places, recent visitors' ghosts, you, and
// the trees. World-space drawing; labels are drawn in screen space so they stay
// crisp and constant-size at any zoom.

export interface OverlayScene {
  width: number;
  height: number;
  dpr: number;
  zoom: number;
  cam: Pt;
  me: Pt;
  facing: number;
  target: Pt | null;
  places: Place[];
  activeId: string | null;
  ghosts: { at: Pt; trail: Pt[] }[];
}

const MONO = "var(--font-mono), ui-monospace, monospace";

export function drawOverlay(ctx: CanvasRenderingContext2D, s: OverlayScene) {
  const { width: w, height: h, zoom, cam } = s;
  const toScreen = (p: Pt): Pt => ({ x: (p.x - cam.x) * zoom + w / 2, y: (p.y - cam.y) * zoom + h / 2 });
  const margin = 80 / zoom;
  const visible = (p: Pt, r: number) =>
    Math.abs(p.x - cam.x) < w / 2 / zoom + r + margin && Math.abs(p.y - cam.y) < h / 2 / zoom + r + margin;

  ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-cam.x, -cam.y);

  if (s.target) drawTarget(ctx, s.target);
  for (const p of s.places) {
    const at = { x: p.at[0], y: p.at[1] };
    if (visible(at, 60)) drawPlace(ctx, p, at, p.id === s.activeId);
  }
  for (const g of s.ghosts) if (visible(g.at, 20)) drawGhost(ctx, g);
  drawMe(ctx, s.me, s.facing);
  for (const t of TREES) if (visible(t, t.r)) drawTree(ctx, t);

  ctx.restore();

  // Labels and off-screen hints, in screen space
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const p of s.places) {
    const sp = toScreen({ x: p.at[0], y: p.at[1] });
    const active = p.id === s.activeId;
    const inset = 36;
    if (sp.x > -inset && sp.x < w + inset && sp.y > -inset && sp.y < h + inset) {
      ctx.font = `${active ? 12 : 11}px ${MONO}`;
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fillText(p.label, sp.x + 1, sp.y + 34 * Math.max(zoom, 0.7) + 1);
      ctx.fillStyle = active ? "#f6efd9" : "rgba(236, 230, 214, 0.75)";
      ctx.fillText(p.label, sp.x, sp.y + 34 * Math.max(zoom, 0.7));
    } else {
      drawEdgeHint(ctx, sp, p.label, w, h);
    }
  }
}

function drawTarget(ctx: CanvasRenderingContext2D, t: Pt) {
  ctx.strokeStyle = "rgba(246, 239, 217, 0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(t.x, t.y, 9, 0, Math.PI * 2);
  ctx.stroke();
}

function drawMe(ctx: CanvasRenderingContext2D, p: Pt, facing: number) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.beginPath();
  ctx.ellipse(p.x + 2, p.y + 4, 8, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f6efd9";
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(246, 239, 217, 0.7)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.x + Math.cos(facing) * 9, p.y + Math.sin(facing) * 9);
  ctx.lineTo(p.x + Math.cos(facing) * 14, p.y + Math.sin(facing) * 14);
  ctx.stroke();
}

function drawGhost(ctx: CanvasRenderingContext2D, g: { at: Pt; trail: Pt[] }) {
  if (g.trail.length > 1) {
    ctx.strokeStyle = "rgba(220, 236, 255, 0.12)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(g.trail[0].x, g.trail[0].y);
    for (const p of g.trail) ctx.lineTo(p.x, p.y);
    ctx.lineTo(g.at.x, g.at.y);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(220, 236, 255, 0.4)";
  ctx.beginPath();
  ctx.arc(g.at.x, g.at.y, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawTree(ctx: CanvasRenderingContext2D, t: { x: number; y: number; r: number }) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  ctx.beginPath();
  ctx.arc(t.x + t.r * 0.25, t.y + t.r * 0.35, t.r, 0, Math.PI * 2);
  ctx.fill();

  const tone = (t.x * 13 + t.y * 7) % 10;
  ctx.fillStyle = `rgb(${20 + tone}, ${36 + tone * 1.5}, ${20 + tone})`;
  ctx.beginPath();
  ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(160, 200, 120, 0.07)";
  ctx.beginPath();
  ctx.arc(t.x - t.r * 0.25, t.y - t.r * 0.25, t.r * 0.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlace(ctx: CanvasRenderingContext2D, place: Place, p: Pt, active: boolean) {
  if (active) {
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 70);
    glow.addColorStop(0, "rgba(246, 222, 160, 0.18)");
    glow.addColorStop(1, "rgba(246, 222, 160, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 70, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.beginPath();
  ctx.ellipse(p.x + 5, p.y + 7, 24, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  switch (place.kind) {
    case "gate":
      ctx.fillStyle = "#5b4632";
      ctx.fillRect(p.x - 30, p.y - 5, 8, 10);
      ctx.fillRect(p.x + 22, p.y - 5, 8, 10);
      ctx.strokeStyle = "rgba(91, 70, 50, 0.6)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.x - 22, p.y);
      ctx.lineTo(p.x + 22, p.y);
      ctx.stroke();
      break;
    case "cabin": {
      const dashed = place.placeholder;
      ctx.fillStyle = dashed ? "#4a3c2e" : "#6b4e36";
      ctx.fillRect(p.x - 22, p.y - 18, 44, 36);
      ctx.fillStyle = dashed ? "#56463a" : "#7d5c40";
      ctx.fillRect(p.x - 22, p.y - 18, 22, 36);
      ctx.strokeStyle = "rgba(30, 20, 12, 0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 18);
      ctx.lineTo(p.x, p.y + 18);
      ctx.stroke();
      break;
    }
    case "stone":
      ctx.fillStyle = "#7a776f";
      ctx.beginPath();
      ctx.moveTo(p.x - 20, p.y + 4);
      ctx.lineTo(p.x - 12, p.y - 14);
      ctx.lineTo(p.x + 8, p.y - 16);
      ctx.lineTo(p.x + 21, p.y - 2);
      ctx.lineTo(p.x + 14, p.y + 13);
      ctx.lineTo(p.x - 8, p.y + 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
      ctx.beginPath();
      ctx.ellipse(p.x - 3, p.y - 6, 10, 6, -0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "sign":
      ctx.fillStyle = "#4e3b2a";
      ctx.fillRect(p.x - 2, p.y - 4, 4, 18);
      ctx.fillStyle = "#8a6a45";
      ctx.fillRect(p.x - 20, p.y - 14, 40, 14);
      break;
    case "well":
      ctx.fillStyle = "#0e1a1d";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#8a857a";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 17, 0, Math.PI * 2);
      ctx.stroke();
      break;
  }
}

function drawEdgeHint(ctx: CanvasRenderingContext2D, sp: Pt, label: string, w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  const dx = sp.x - cx;
  const dy = sp.y - cy;
  const inset = 22;
  const scale = Math.min((cx - inset) / Math.abs(dx || 1e-6), (cy - inset) / Math.abs(dy || 1e-6));
  const x = cx + dx * scale;
  const y = cy + dy * scale;
  const angle = Math.atan2(dy, dx);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "rgba(236, 230, 214, 0.55)";
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(-4, -5);
  ctx.lineTo(-4, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = "rgba(236, 230, 214, 0.5)";
  const lx = Math.min(Math.max(x - Math.cos(angle) * 16, 40), w - 40);
  const ly = Math.min(Math.max(y - Math.sin(angle) * 16 - 5, 8), h - 18);
  ctx.fillText(label, lx, ly);
}
