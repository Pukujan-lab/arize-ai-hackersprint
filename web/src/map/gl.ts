// WebGL for the map: solid extruded states, a raised Colorado block, the county layer on top of it,
// typed links, and a perspective camera that moves through the scene. The geometry never changes, so
// it is built once into vertex buffers and redrawn through one matrix each frame.
//
// A vertex is 8 floats: position (x, y, z), colour (r, g, b), texture coordinate (u, v).
// World coordinates are the projected plane centred on the origin, with y pointing up.

import { WORLD_HEIGHT, WORLD_WIDTH } from "@/lib/geo";

export type Vec3 = [number, number, number];
export type Ring = [number, number][];

export type Mesh = { buffer: WebGLBuffer; count: number; mode: number };

export type Camera3 = {
  eye: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  viewProj: Float32Array;
  W: number;
  H: number;
  fov: number;
};

/** How tall the surrounding states are, and how far Colorado stands above them. */
export const STATE_DEPTH = 8;
export const COLORADO_DEPTH = 24;
/** The thin lip the Colorado counties are extruded by, on top of Colorado's block. */
export const COUNTY_LIP = 1.2;
/** The surface the counties sit on: where pins and county geometry live. */
export const SURFACE_Y = COLORADO_DEPTH + COUNTY_LIP;
/** Links are drawn just above the county surface so they are never hidden by it. */
export const ARC_Y = SURFACE_Y + 1.4;

const FOV = (40 * Math.PI) / 180;
/** The camera looks down at this angle, so the extruded walls are visible. */
const ELEVATION = (58 * Math.PI) / 180;
/** A little margin around the plane at the national view. */
const FIT = 1.18;
/** What the camera centres on vertically: the middle of the raised block. */
const TARGET_Y = COLORADO_DEPTH * 0.45;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => {
  const len = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
};

function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function lookAt(eye: Vec3, target: Vec3, up: Vec3): Float32Array {
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

function mul(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/**
 * The camera for a zoom factor: it looks at the projected point (cx, cz) from above and to the south,
 * and its distance shrinks as the zoom grows, so a higher zoom is a closer camera, not a scaled picture.
 */
export function buildCamera(cx: number, cz: number, zoom: number, W: number, H: number): Camera3 {
  const width = Math.max(1, W);
  const height = Math.max(1, H);
  const aspect = Math.max(0.2, width / height);
  const viewH = Math.max(WORLD_HEIGHT, WORLD_WIDTH / aspect) / Math.max(0.2, zoom);
  const distance = (viewH * FIT) / (2 * Math.tan(FOV / 2));
  const target: Vec3 = [cx, TARGET_Y, cz];
  const eye: Vec3 = [cx, TARGET_Y + distance * Math.sin(ELEVATION), cz + distance * Math.cos(ELEVATION)];
  const forward = norm(sub(target, eye));
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return {
    eye,
    right,
    up,
    forward,
    viewProj: mul(perspective(FOV, aspect, 1, 40000), lookAt(eye, target, [0, 1, 0])),
    W: width,
    H: height,
    fov: FOV,
  };
}

/** A world point → canvas coordinates, or null when it is behind the camera. */
export function projectPoint(cam: Camera3, x: number, y: number, z: number): [number, number] | null {
  const m = cam.viewProj;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (w <= 0.0001) return null;
  const px = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  const py = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  return [(px * 0.5 + 0.5) * cam.W, (0.5 - py * 0.5) * cam.H];
}

/** The point on the horizontal plane y = planeY under a canvas point, or null above the horizon. */
export function unprojectGround(cam: Camera3, sx: number, sy: number, planeY: number): [number, number] | null {
  const tan = Math.tan(cam.fov / 2);
  const ndcX = (sx / cam.W) * 2 - 1;
  const ndcY = 1 - (sy / cam.H) * 2;
  const aspect = cam.W / cam.H;
  const dir = norm([
    cam.forward[0] + cam.right[0] * ndcX * tan * aspect + cam.up[0] * ndcY * tan,
    cam.forward[1] + cam.right[1] * ndcX * tan * aspect + cam.up[1] * ndcY * tan,
    cam.forward[2] + cam.right[2] * ndcX * tan * aspect + cam.up[2] * ndcY * tan,
  ]);
  if (Math.abs(dir[1]) < 1e-6) return null;
  const t = (planeY - cam.eye[1]) / dir[1];
  if (t <= 0) return null;
  return [cam.eye[0] + dir[0] * t, cam.eye[2] + dir[2] * t];
}

// ------------------------------------------------------------------ geometry

function rgb(hex: string): Vec3 {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const shade = (c: Vec3, k: number): Vec3 => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];

function push(out: number[], p: Vec3, colour: Vec3): void {
  out.push(p[0], p[1], p[2], colour[0], colour[1], colour[2], 0, 0);
}

function pushUV(out: number[], p: Vec3, colour: Vec3, u: number, v: number): void {
  out.push(p[0], p[1], p[2], colour[0], colour[1], colour[2], u, v);
}

function signedArea(ring: Ring): number {
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

/** Ear clipping: the top of an extruded shape is a fan of triangles inside its own ring. */
function triangulate(ring: Ring): number[] {
  const n = ring.length;
  if (n < 3) return [];
  const order: number[] = [];
  for (let i = 0; i < n; i += 1) order.push(i);
  if (signedArea(ring) < 0) order.reverse();

  const pointInTriangle = (i: number, a: number, b: number, c: number): boolean => {
    const [x, y] = ring[i];
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const [cx, cy] = ring[c];
    const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
    const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
    const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  };

  const out: number[] = [];
  let guard = n * n + 8;
  while (order.length > 3 && guard > 0) {
    guard -= 1;
    let clipped = false;
    for (let i = 0; i < order.length; i += 1) {
      const a = order[(i + order.length - 1) % order.length];
      const b = order[i];
      const c = order[(i + 1) % order.length];
      const [ax, ay] = ring[a];
      const [bx, by] = ring[b];
      const [cx, cy] = ring[c];
      const convex = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0;
      if (!convex) continue;
      let clean = true;
      for (const other of order) {
        if (other === a || other === b || other === c) continue;
        if (pointInTriangle(other, a, b, c)) {
          clean = false;
          break;
        }
      }
      if (!clean) continue;
      out.push(a, b, c);
      order.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (order.length === 3) out.push(order[0], order[1], order[2]);
  else if (order.length > 3) {
    // A ring the clipper could not finish still gets a fan, so the shape is never left hollow.
    for (let i = 1; i + 1 < order.length; i += 1) out.push(order[0], order[i], order[i + 1]);
  }
  return out;
}

/** A solid: the ring's top face plus a wall down each edge, shaded by the way the edge faces. */
function addPrism(out: number[], ring: Ring, y0: number, y1: number, top: Vec3, wall: Vec3): void {
  const tris = triangulate(ring);
  for (let i = 0; i < tris.length; i += 3) {
    const a = ring[tris[i]];
    const b = ring[tris[i + 1]];
    const c = ring[tris[i + 2]];
    push(out, [a[0], y1, a[1]], top);
    push(out, [b[0], y1, b[1]], top);
    push(out, [c[0], y1, c[1]], top);
  }
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    // Light comes from the south-west, so walls facing it read as lit and the rest fall away.
    const facing = Math.max(0, (-dz / len) * -0.45 + (dx / len) * 0.89);
    const colour = shade(wall, 0.62 + 0.5 * facing);
    push(out, [a[0], y0, a[1]], colour);
    push(out, [b[0], y0, b[1]], colour);
    push(out, [b[0], y1, b[1]], colour);
    push(out, [a[0], y0, a[1]], colour);
    push(out, [b[0], y1, b[1]], colour);
    push(out, [a[0], y1, a[1]], colour);
  }
}

export type SceneSource = {
  states: { name: string; polys: Ring[] }[];
  counties: { name: string; polys: Ring[]; fill: string }[];
  arcs: { from: [number, number]; to: [number, number]; colour: string }[];
  palette: { stateTop: string; stateWall: string; coTop: string; coWall: string; countyTop: string; countyWall: string };
};

export type SceneBuffers = {
  stateTop: number[];
  stateWall: number[];
  countyTop: number[];
  countyWall: number[];
  arcs: number[];
  stateMeshes: number;
  countyMeshes: number;
  coloradoRaised: boolean;
};

const CX = WORLD_WIDTH / 2;
const CY = WORLD_HEIGHT / 2;
const wx = (px: number) => px - CX;
const wz = (py: number) => py - CY;

export function buildScene(source: SceneSource): SceneBuffers {
  const stateTop: number[] = [];
  const stateWall: number[] = [];
  const countyTop: number[] = [];
  const countyWall: number[] = [];
  const arcs: number[] = [];

  const p = source.palette;
  const coTop = rgb(p.coTop);
  const coWall = rgb(p.coWall);
  const stTop = rgb(p.stateTop);
  const stWall = rgb(p.stateWall);
  const ctyWall = rgb(p.countyWall);

  let stateMeshes = 0;
  let countyMeshes = 0;
  let coloradoRaised = false;

  for (const state of source.states) {
    const raised = state.name === "Colorado";
    if (raised) coloradoRaised = true;
    const depth = raised ? COLORADO_DEPTH : STATE_DEPTH;
    for (const ring of state.polys) {
      stateMeshes += 1;
      const shifted: Ring = ring.map(([x, y]) => [wx(x), wz(y)] as [number, number]);
      addPrism(stateTop, shifted, 0, depth, raised ? coTop : stTop, raised ? coWall : stWall);
    }
  }

  for (const county of source.counties) {
    const top = rgb(county.fill);
    for (const ring of county.polys) {
      countyMeshes += 1;
      const shifted: Ring = ring.map(([x, y]) => [wx(x), wz(y)] as [number, number]);
      addPrism(countyTop, shifted, COLORADO_DEPTH, SURFACE_Y, top, ctyWall);
    }
  }

  for (const arc of source.arcs) {
    const colour = rgb(arc.colour);
    const [x1, z1] = [wx(arc.from[0]), wz(arc.from[1])];
    const [x2, z2] = [wx(arc.to[0]), wz(arc.to[1])];
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz) || 1;
    const bend = Math.min(40, len * 0.35);
    const cxp = (x1 + x2) / 2 - (dz / len) * bend;
    const czp = (z1 + z2) / 2 + (dx / len) * bend;
    const steps = 14;
    let px = x1;
    let pz = z1;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const u = 1 - t;
      const nx = u * u * x1 + 2 * u * t * cxp + t * t * x2;
      const nz = u * u * z1 + 2 * u * t * czp + t * t * z2;
      push(arcs, [px, ARC_Y, pz], colour);
      push(arcs, [nx, ARC_Y, nz], colour);
      px = nx;
      pz = nz;
    }
  }

  return { stateTop, stateWall, countyTop, countyWall, arcs, stateMeshes, countyMeshes, coloradoRaised };
}

// ------------------------------------------------------------------ renderer

const VERTEX = `
attribute vec3 aPos;
attribute vec3 aColour;
attribute vec2 aUV;
uniform mat4 uMVP;
varying vec3 vColour;
varying vec2 vUV;
void main() {
  vColour = aColour;
  vUV = aUV;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
uniform sampler2D uTex;
uniform float uUseTex;
uniform vec4 uTint;
varying vec3 vColour;
varying vec2 vUV;
void main() {
  if (uUseTex > 0.5) {
    vec4 t = texture2D(uTex, vUV);
    gl_FragColor = vec4(t.rgb * vColour, t.a * uTint.a);
  } else {
    gl_FragColor = vec4(vColour, uTint.a);
  }
}`;

type GL = WebGLRenderingContext | WebGL2RenderingContext;

function compile(gl: GL, kind: number, source: string): WebGLShader | null {
  const shader = gl.createShader(kind);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Draws the scene. Returns null when the browser gives us no three-dimensional surface. */
export class SceneRenderer {
  gl: GL;
  private program: WebGLProgram;
  private aPos: number;
  private aColour: number;
  private aUV: number;
  private uMVP: WebGLUniformLocation | null;
  private uUseTex: WebGLUniformLocation | null;
  private uTint: WebGLUniformLocation | null;
  private uTex: WebGLUniformLocation | null;
  private meshes: Record<string, Mesh> = {};
  private basemap: WebGLTexture | null = null;
  private basemapQuad: Mesh | null = null;
  private ocean: Vec3 = [0.03, 0.04, 0.09];

  private constructor(gl: GL, program: WebGLProgram) {
    this.gl = gl;
    this.program = program;
    this.aPos = gl.getAttribLocation(program, "aPos");
    this.aColour = gl.getAttribLocation(program, "aColour");
    this.aUV = gl.getAttribLocation(program, "aUV");
    this.uMVP = gl.getUniformLocation(program, "uMVP");
    this.uUseTex = gl.getUniformLocation(program, "uUseTex");
    this.uTint = gl.getUniformLocation(program, "uTint");
    this.uTex = gl.getUniformLocation(program, "uTex");
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  static create(canvas: HTMLCanvasElement): SceneRenderer | null {
    const options: WebGLContextAttributes = { antialias: true, alpha: false, depth: true };
    let gl: GL | null = null;
    try {
      gl = canvas.getContext("webgl2", options) as WebGL2RenderingContext | null;
    } catch {
      gl = null;
    }
    if (!gl) {
      try {
        gl = canvas.getContext("webgl", options) as WebGLRenderingContext | null;
      } catch {
        gl = null;
      }
    }
    if (!gl) return null;
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    return new SceneRenderer(gl, program);
  }

  setOcean(hex: string): void {
    this.ocean = rgb(hex);
  }

  private upload(name: string, data: number[], mode: number): void {
    const gl = this.gl;
    const existing = this.meshes[name];
    if (existing) gl.deleteBuffer(existing.buffer);
    if (!data.length) {
      delete this.meshes[name];
      return;
    }
    const buffer = gl.createBuffer();
    if (!buffer) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    this.meshes[name] = { buffer, count: data.length / 8, mode };
  }

  setScene(scene: SceneBuffers): void {
    this.upload("stateTop", scene.stateTop, this.gl.TRIANGLES);
    this.upload("stateWall", scene.stateWall, this.gl.TRIANGLES);
    this.upload("countyTop", scene.countyTop, this.gl.TRIANGLES);
    this.upload("countyWall", scene.countyWall, this.gl.TRIANGLES);
    this.upload("arcs", scene.arcs, this.gl.LINES);
  }

  /** The basemap is a picture of the projected plane, laid flat under the solids. */
  setBasemap(image: HTMLCanvasElement | null): void {
    const gl = this.gl;
    if (this.basemap) {
      gl.deleteTexture(this.basemap);
      this.basemap = null;
    }
    if (!image) return;
    const texture = gl.createTexture();
    if (!texture) return;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.basemap = texture;

    const y = -0.6;
    const x0 = wx(0);
    const x1 = wx(WORLD_WIDTH);
    const z0 = wz(0);
    const z1 = wz(WORLD_HEIGHT);
    const white: Vec3 = [1, 1, 1];
    const a: Vec3 = [x0, y, z0];
    const b: Vec3 = [x1, y, z0];
    const c: Vec3 = [x1, y, z1];
    const d: Vec3 = [x0, y, z1];
    const quad: number[] = [];
    pushUV(quad, a, white, 0, 1);
    pushUV(quad, b, white, 1, 1);
    pushUV(quad, c, white, 1, 0);
    pushUV(quad, a, white, 0, 1);
    pushUV(quad, c, white, 1, 0);
    pushUV(quad, d, white, 0, 0);
    this.upload("basemap", quad, gl.TRIANGLES);
    this.basemapQuad = this.meshes["basemap"] || null;
  }

  resize(width: number, height: number): void {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    const canvas = gl.canvas as HTMLCanvasElement;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
  }

  private drawMesh(mesh: Mesh, tint: [number, number, number, number], textured: boolean): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    const stride = 8 * 4;
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, stride, 0);
    if (this.aColour >= 0) {
      gl.enableVertexAttribArray(this.aColour);
      gl.vertexAttribPointer(this.aColour, 3, gl.FLOAT, false, stride, 3 * 4);
    }
    if (this.aUV >= 0) {
      gl.enableVertexAttribArray(this.aUV);
      gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, stride, 6 * 4);
    }
    gl.uniform1f(this.uUseTex, textured ? 1 : 0);
    gl.uniform4f(this.uTint, tint[0], tint[1], tint[2], tint[3]);
    gl.drawArrays(mesh.mode, 0, mesh.count);
  }

  render(cam: Camera3, basemapOn: boolean): void {
    const gl = this.gl;
    gl.clearColor(this.ocean[0], this.ocean[1], this.ocean[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uMVP, false, cam.viewProj);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.uTex, 0);

    if (basemapOn && this.basemap && this.basemapQuad) {
      gl.bindTexture(gl.TEXTURE_2D, this.basemap);
      gl.depthMask(false);
      this.drawMesh(this.basemapQuad, [1, 1, 1, 0.85], true);
      gl.depthMask(true);
    }

    for (const name of ["stateWall", "stateTop", "countyWall", "countyTop"]) {
      const mesh = this.meshes[name];
      if (mesh) this.drawMesh(mesh, [0, 0, 0, 1], false);
    }
    const arcs = this.meshes["arcs"];
    if (arcs) {
      gl.disable(gl.DEPTH_TEST);
      this.drawMesh(arcs, [1, 1, 1, 0.9], false);
      gl.enable(gl.DEPTH_TEST);
    }
  }
}
