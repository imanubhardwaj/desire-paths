import { GRID, WATER, WORLD, type Pt } from "./world";

// Draws the ground: grass where nobody walks, trampled grass where some do,
// bare soil where many do. The wear texture is the only per-visitor input.

export interface GroundRenderer {
  readonly kind: "webgl" | "canvas";
  resize(width: number, height: number, dpr: number): void;
  setWear(wear: Uint8Array): void;
  render(cam: Pt, zoom: number, time: number): void;
  destroy(): void;
}

/** Mounts a canvas in `container`: WebGL2 if it works, otherwise a 2D fallback. */
export function createGroundRenderer(container: HTMLElement): GroundRenderer {
  const mount = () => container.appendChild(document.createElement("canvas"));

  const canvas = mount();
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" });
  if (gl) {
    try {
      return webglRenderer(canvas, gl);
    } catch (error) {
      console.warn("Falling back to canvas ground:", error);
    }
  }
  canvas.remove();
  return canvasRenderer(mount());
}

// --- WebGL2 ----------------------------------------------------------------------

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec2 uCam;
uniform float uScale;
uniform float uTime;
uniform float uWorld;
uniform sampler2D uWear;
uniform vec3 uWater[${WATER.length}];
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 w = uCam + (frag - uRes * 0.5) / uScale;

  float big = fbm(w * 0.004);
  float mid = fbm(w * 0.02);
  float sway = sin(uTime * 0.7 + w.y * 0.012 + w.x * 0.004) * 0.9;
  float blade = noise(w * vec2(0.55, 0.9) + vec2(sway, 0.0));

  // Ragged thresholds: worn edges should look like feet made them, not a brush.
  float wear = texture(uWear, w / uWorld).r;
  float jitter = (mid - 0.5) * 0.22 + (blade - 0.5) * 0.08;
  float trampled = smoothstep(0.10, 0.42, wear + jitter);
  float bare = smoothstep(0.48, 0.80, wear + jitter);

  vec3 grass = mix(vec3(0.12, 0.20, 0.10), vec3(0.19, 0.29, 0.13), big) * (0.80 + 0.40 * blade);
  vec3 flat_ = mix(vec3(0.29, 0.33, 0.18), vec3(0.35, 0.37, 0.21), mid) * (0.92 + 0.16 * blade);
  vec3 soil = mix(vec3(0.37, 0.29, 0.20), vec3(0.47, 0.38, 0.27), mid) * (0.90 + 0.20 * noise(w * 1.3));
  vec3 col = mix(mix(grass, flat_, trampled), soil, bare);

  float d = 1e9;
  for (int i = 0; i < ${WATER.length}; i++) d = min(d, length(w - uWater[i].xy) - uWater[i].z);
  d += (fbm(w * 0.03) - 0.5) * 18.0;
  vec3 water = mix(vec3(0.07, 0.15, 0.18), vec3(0.11, 0.22, 0.25), noise(w * 0.05 + uTime * 0.05));
  water += 0.05 * smoothstep(0.65, 1.0, noise(w * 0.12 + vec2(uTime * 0.3, uTime * 0.1)));
  col = mix(col, vec3(0.28, 0.27, 0.19), (1.0 - smoothstep(0.0, 16.0, d)) * 0.6);
  col = mix(col, water, 1.0 - smoothstep(-2.0, 2.0, d));

  vec2 e = min(w, uWorld - w);
  col = mix(vec3(0.04, 0.07, 0.04), col, smoothstep(-10.0, 50.0, min(e.x, e.y)));

  vec2 q = frag / uRes - 0.5;
  col *= 1.0 - dot(q, q) * 0.55;
  outColor = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile failed");
  }
  return shader;
}

function webglRenderer(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext): GroundRenderer {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "program link failed");
  }
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());

  const u = (name: string) => gl.getUniformLocation(program, name);
  const uRes = u("uRes");
  const uCam = u("uCam");
  const uScale = u("uScale");
  const uTime = u("uTime");
  gl.uniform1f(u("uWorld"), WORLD);
  gl.uniform3fv(u("uWater"), WATER.flatMap((c) => [c.x, c.y, c.r]));
  gl.uniform1i(u("uWear"), 0);

  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, GRID, GRID, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(GRID * GRID));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  let dpr = 1;

  return {
    kind: "webgl",
    resize(width, height, nextDpr) {
      dpr = nextDpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    },
    setWear(wear) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GRID, GRID, gl.RED, gl.UNSIGNED_BYTE, wear);
    },
    render(cam, zoom, time) {
      gl.uniform2f(uCam, cam.x, cam.y);
      gl.uniform1f(uScale, zoom * dpr);
      gl.uniform1f(uTime, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    },
  };
}

// --- Canvas 2D fallback ------------------------------------------------------------

function canvasRenderer(canvas: HTMLCanvasElement): GroundRenderer {
  const ctx = canvas.getContext("2d")!;
  const ground = document.createElement("canvas");
  ground.width = GRID;
  ground.height = GRID;
  const gctx = ground.getContext("2d")!;
  const image = gctx.createImageData(GRID, GRID);
  let dpr = 1;
  let w = 0;
  let h = 0;

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const grass = [31, 51, 26];
  const soil = [107, 86, 60];

  const api: GroundRenderer = {
    kind: "canvas",
    resize(width, height, nextDpr) {
      dpr = nextDpr;
      w = width;
      h = height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    },
    setWear(wear) {
      for (let i = 0; i < wear.length; i++) {
        const t = Math.min(1, wear[i] / 200);
        image.data[i * 4] = lerp(grass[0], soil[0], t);
        image.data[i * 4 + 1] = lerp(grass[1], soil[1], t);
        image.data[i * 4 + 2] = lerp(grass[2], soil[2], t);
        image.data[i * 4 + 3] = 255;
      }
      gctx.putImageData(image, 0, 0);
    },
    render(cam, zoom) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0a120a";
      ctx.fillRect(0, 0, w, h);
      ctx.translate(w / 2, h / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-cam.x, -cam.y);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(ground, 0, 0, WORLD, WORLD);
      ctx.fillStyle = "#13262c";
      for (const c of WATER) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    destroy() {
      canvas.remove();
    },
  };
  api.setWear(new Uint8Array(GRID * GRID));
  return api;
}
