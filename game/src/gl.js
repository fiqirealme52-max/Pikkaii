// Neon Bay — a tiny hand-written WebGL renderer: no library, no network, no
// build step. One shader (lambert sun + ambient + emissive + linear fog), one
// vertex layout (position, normal, colour), and a MeshBuilder that turns boxes,
// quads and cylinders into triangle soup with per-face normals. Dynamic things
// (cars, people, the helicopter) are meshes drawn with a model matrix; the
// whole city is baked into two static meshes at load time.

const VERTEX_SHADER = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform vec3 uCamPos;
uniform float uWave;
uniform float uTime;
varying vec3 vColor;
varying vec3 vNormal;
varying float vFog;
varying float vSky;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  if (uWave > 0.0) {
    world.y += (sin(world.x * 0.08 + uTime * 1.3) + cos(world.z * 0.06 + uTime * 0.9)) * 0.35 * uWave;
  }
  vNormal = normalize(mat3(uModel) * aNormal);
  vColor = aColor;
  vFog = distance(world.xyz, uCamPos);
  vSky = clamp(vNormal.y * 0.7 + 0.5, 0.0, 1.0);
  gl_Position = uProj * uView * world;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uEmissive;
uniform float uEmissiveStrength;
uniform vec3 uTint;
uniform float uUnlit;
uniform float uNoFog;
uniform float uSky;
uniform vec3 uSkyTop;
uniform vec3 uSkyBottom;
uniform float uAlpha;
varying vec3 vColor;
varying vec3 vNormal;
varying float vFog;
varying float vSky;
void main() {
  vec3 color;
  if (uSky > 0.5) {
    color = mix(uSkyBottom, uSkyTop, vSky);
  } else if (uUnlit > 0.5) {
    color = vColor * uTint;
  } else {
    float diffuse = max(dot(normalize(vNormal), normalize(uSunDir)), 0.0);
    vec3 lit = vColor * uTint * (uAmbient + uSunColor * diffuse);
    vec3 glow = vColor * uTint * uEmissive * uEmissiveStrength;
    color = lit + glow;
  }
  if (uNoFog < 0.5) {
    float f = clamp((vFog - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    color = mix(color, uFogColor, f);
  }
  gl_FragColor = vec4(color, uAlpha);
}
`;

/** Parse '#rrggbb' into [r, g, b] in 0..1. */
export function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

/** Column-major perspective matrix. */
export function mat4Perspective(fovy, aspect, near, far) {
  const m = new Float32Array(16);
  const f = 1 / Math.tan(fovy / 2);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/** Column-major look-at matrix. */
export function mat4LookAt(eye, target, up) {
  const zx = eye[0] - target[0];
  const zy = eye[1] - target[1];
  const zz = eye[2] - target[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  const z = [zx / zl, zy / zl, zz / zl];
  let xx = up[1] * z[2] - up[2] * z[1];
  let xy = up[2] * z[0] - up[0] * z[2];
  let xz = up[0] * z[1] - up[1] * z[0];
  const xl = Math.hypot(xx, xy, xz) || 1;
  const x = [xx / xl, xy / xl, xz / xl];
  const y = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  const m = new Float32Array(16);
  m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
  m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
  m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
  m[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  m[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  m[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  m[15] = 1;
  return m;
}

/** Column-major multiply: returns a * b. */
export function mat4Multiply(a, b) {
  const m = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += a[k * 4 + r] * b[c * 4 + k];
      m[c * 4 + r] = s;
    }
  }
  return m;
}

/**
 * Model matrix for a thing at (x, y, z), rotated rotY around Y, scaled by
 * (sx, sy, sz): T * R_y * S.
 */
export function mat4FromTRS(x, y, z, rotY, sx, sy, sz) {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const m = new Float32Array(16);
  m[0] = c * sx; m[1] = 0; m[2] = -s * sx; m[3] = 0;
  m[4] = 0; m[5] = sy; m[6] = 0; m[7] = 0;
  m[8] = s * sz; m[9] = 0; m[10] = c * sz; m[11] = 0;
  m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
  return m;
}

/** A triangle soup: positions, normals and colours, 9 floats a vertex. */
export class MeshBuilder {
  constructor() {
    this.data = [];
  }

  /** One triangle, with a shared face normal. */
  tri(ax, ay, az, bx, by, bz, cx, cy, cz, color, nx, ny, nz) {
    const d = this.data;
    const c = hexRgb(color);
    d.push(ax, ay, az, nx, ny, nz, c[0], c[1], c[2]);
    d.push(bx, by, bz, nx, ny, nz, c[0], c[1], c[2]);
    d.push(cx, cy, cz, nx, ny, nz, c[0], c[1], c[2]);
  }

  /** A quad from four corners (a, b, c, d), with the normal from its winding. */
  quad(a, b, c, d, color) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = d[0] - a[0];
    const vy = d[1] - a[1];
    const vz = d[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], color, nx, ny, nz);
    this.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], color, nx, ny, nz);
  }

  /**
   * A box centred at (cx, cy, cz) with size (sx, sy, sz). `colors` may give a
   * colour per face: { top, bottom, px, nx, pz, nz } — anything missing uses
   * the base colour.
   */
  box(cx, cy, cz, sx, sy, sz, color, colors) {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y0 = cy - sy / 2;
    const y1 = cy + sy / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    const f = colors || {};
    // Top (+y) and bottom (-y).
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], f.top || color);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], f.bottom || color);
    // +z, -z, +x, -x.
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], f.pz || color);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], f.nz || color);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], f.px || color);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], f.nx || color);
  }

  /**
   * A box from a centre and three basis vectors: u, v, w are the box's axes
   * (each a [x, y, z] direction), lu, lv, lw its half-extents along them.
   * Used for tilted things like palm fronds and helicopter rotors.
   */
  boxBasis(cx, cy, cz, u, v, w, lu, lv, lw, color) {
    const corner = (a, b, c) => [
      cx + u[0] * a * lu + v[0] * b * lv + w[0] * c * lw,
      cy + u[1] * a * lu + v[1] * b * lv + w[1] * c * lw,
      cz + u[2] * a * lu + v[2] * b * lv + w[2] * c * lw,
    ];
    const pppp = corner(1, 1, 1);
    const pppm = corner(1, 1, -1);
    const ppmp = corner(1, -1, 1);
    const ppmm = corner(1, -1, -1);
    const pmpp = corner(-1, 1, 1);
    const pmpm = corner(-1, 1, -1);
    const pmmp = corner(-1, -1, 1);
    const pmmm = corner(-1, -1, -1);
    this.quad(pppp, pmpp, pmpm, pppm, color); // +u
    this.quad(pmmm, pmmp, ppmp, ppmm, color); // -u
    this.quad(pppp, pppm, ppmm, ppmp, color); // +v
    this.quad(pmmm, pmpm, pmmp, pmpp, color); // -v
    this.quad(pppp, ppmp, pmmp, pmpp, color); // +w
    this.quad(ppmm, pmpm, pmmm, pppm, color); // -w
  }

  /** A vertical cylinder centred at (cx, cy, cz), height h, radius r. */
  cylinder(cx, cy, cz, r, h, color, segments) {
    return this.cylinderTapered(cx, cy, cz, r, r, h, color, segments);
  }

  /** A vertical cone/frustum: radius rTop at the top, rBottom at the bottom. */
  cylinderTapered(cx, cy, cz, rTop, rBottom, h, color, segments) {
    const seg = segments || 8;
    const y0 = cy - h / 2;
    const y1 = cy + h / 2;
    for (let i = 0; i < seg; i += 1) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const x0b = cx + Math.cos(a0) * rBottom;
      const z0b = cz + Math.sin(a0) * rBottom;
      const x1b = cx + Math.cos(a1) * rBottom;
      const z1b = cz + Math.sin(a1) * rBottom;
      const x0t = cx + Math.cos(a0) * rTop;
      const z0t = cz + Math.sin(a0) * rTop;
      const x1t = cx + Math.cos(a1) * rTop;
      const z1t = cz + Math.sin(a1) * rTop;
      const nx0 = Math.cos(a0);
      const nz0 = Math.sin(a0);
      const nx1 = Math.cos(a1);
      const nz1 = Math.sin(a1);
      const c = hexRgb(color);
      const d = this.data;
      d.push(x0b, y0, z0b, nx0, 0, nz0, c[0], c[1], c[2]);
      d.push(x1b, y0, z1b, nx1, 0, nz1, c[0], c[1], c[2]);
      d.push(x1t, y1, z1t, nx1, 0, nz1, c[0], c[1], c[2]);
      d.push(x0b, y0, z0b, nx0, 0, nz0, c[0], c[1], c[2]);
      d.push(x1t, y1, z1t, nx1, 0, nz1, c[0], c[1], c[2]);
      d.push(x0t, y1, z0t, nx0, 0, nz0, c[0], c[1], c[2]);
    }
    // Caps.
    const c = hexRgb(color);
    for (let i = 0; i < seg; i += 1) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const x0t = cx + Math.cos(a0) * rTop;
      const z0t = cz + Math.sin(a0) * rTop;
      const x1t = cx + Math.cos(a1) * rTop;
      const z1t = cz + Math.sin(a1) * rTop;
      const x0b = cx + Math.cos(a0) * rBottom;
      const z0b = cz + Math.sin(a0) * rBottom;
      const x1b = cx + Math.cos(a1) * rBottom;
      const z1b = cz + Math.sin(a1) * rBottom;
      this.data.push(cx, y1, cz, 0, 1, 0, c[0], c[1], c[2]);
      this.data.push(x0t, y1, z0t, 0, 1, 0, c[0], c[1], c[2]);
      this.data.push(x1t, y1, z1t, 0, 1, 0, c[0], c[1], c[2]);
      this.data.push(cx, y0, cz, 0, -1, 0, c[0], c[1], c[2]);
      this.data.push(x1b, y0, z1b, 0, -1, 0, c[0], c[1], c[2]);
      this.data.push(x0b, y0, z0b, 0, -1, 0, c[0], c[1], c[2]);
    }
    return this;
  }

  /** A flat quad lying on the ground (y = const), for roads, grass and water. */
  groundQuad(x0, z0, x1, z1, y, color) {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], color);
  }

  /** Number of triangles so far. */
  get triangleCount() {
    return this.data.length / 27;
  }

  build() {
    return new Float32Array(this.data);
  }
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`shader compile failed: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

/**
 * The renderer: owns the WebGL context, the one program, and the lighting
 * state for the current frame (sun, sky, fog). Meshes are uploaded once and
 * drawn with a model matrix and per-draw options.
 */
export function createGLRenderer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: false });
  if (!gl) throw new Error('WebGL is not available in this browser');

  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`);
  }
  gl.useProgram(program);

  const loc = {};
  for (const name of [
    'aPos', 'aNormal', 'aColor', 'uProj', 'uView', 'uModel', 'uCamPos', 'uWave', 'uTime',
    'uSunDir', 'uSunColor', 'uAmbient', 'uFogColor', 'uFogNear', 'uFogFar',
    'uEmissive', 'uEmissiveStrength', 'uTint', 'uUnlit', 'uNoFog', 'uSky',
    'uSkyTop', 'uSkyBottom', 'uAlpha',
  ]) {
    loc[name] = name[0] === 'a'
      ? gl.getAttribLocation(program, name)
      : gl.getUniformLocation(program, name);
  }

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearDepth(1);

  const state = {
    proj: mat4Identity(),
    view: mat4Identity(),
    camPos: [0, 0, 0],
    sunDir: [0.4, 0.8, 0.3],
    sunColor: [1, 0.9, 0.75],
    ambient: [0.45, 0.45, 0.5],
    fogColor: [0.55, 0.6, 0.75],
    fogNear: 250,
    fogFar: 1600,
    emissiveStrength: 0,
    skyTop: [0.35, 0.55, 0.95],
    skyBottom: [1, 0.65, 0.45],
    time: 0,
  };

  function resize(width, height) {
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  }

  function setCamera(proj, view, camPos) {
    state.proj = proj;
    state.view = view;
    state.camPos = camPos;
  }

  /** The lighting / sky / fog for this frame. */
  function setEnvironment(env) {
    Object.assign(state, env);
  }

  function applyEnvironment() {
    gl.uniform3fv(loc.uSunDir, state.sunDir);
    gl.uniform3fv(loc.uSunColor, state.sunColor);
    gl.uniform3fv(loc.uAmbient, state.ambient);
    gl.uniform3fv(loc.uFogColor, state.fogColor);
    gl.uniform1f(loc.uFogNear, state.fogNear);
    gl.uniform1f(loc.uFogFar, state.fogFar);
    gl.uniform1f(loc.uEmissiveStrength, state.emissiveStrength);
    gl.uniform3fv(loc.uSkyTop, state.skyTop);
    gl.uniform3fv(loc.uSkyBottom, state.skyBottom);
    gl.uniform1f(loc.uTime, state.time);
  }

  function clear(skyColor) {
    gl.clearColor(skyColor[0], skyColor[1], skyColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  /** Upload a builder's triangles once; returns a mesh the renderer can draw. */
  function createMesh(builder) {
    const data = builder.build();
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buffer, count: data.length / 9 };
  }

  /** Upload raw vertices (same 9-float layout) — for meshes built elsewhere. */
  function createMeshFromData(data) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buffer, count: data.length / 9 };
  }

  /**
   * Draw a mesh with a model matrix. Options: emissive (0/1), tint [r,g,b],
   * unlit (0/1), noFog (0/1), sky (0/1), wave (0/1), depthWrite (default true).
   */
  function drawMesh(mesh, model, opts) {
    const o = opts || {};
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    gl.enableVertexAttribArray(loc.aPos);
    gl.enableVertexAttribArray(loc.aNormal);
    gl.enableVertexAttribArray(loc.aColor);
    gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 36, 0);
    gl.vertexAttribPointer(loc.aNormal, 3, gl.FLOAT, false, 36, 12);
    gl.vertexAttribPointer(loc.aColor, 3, gl.FLOAT, false, 36, 24);
    gl.uniformMatrix4fv(loc.uProj, false, state.proj);
    gl.uniformMatrix4fv(loc.uView, false, state.view);
    gl.uniformMatrix4fv(loc.uModel, false, model);
    gl.uniform3fv(loc.uCamPos, state.camPos);
    gl.uniform1f(loc.uWave, o.wave ? 1 : 0);
    gl.uniform1f(loc.uEmissive, o.emissive ? 1 : 0);
    gl.uniform3fv(loc.uTint, o.tint || [1, 1, 1]);
    gl.uniform1f(loc.uUnlit, o.unlit ? 1 : 0);
    gl.uniform1f(loc.uNoFog, o.noFog ? 1 : 0);
    gl.uniform1f(loc.uSky, o.sky ? 1 : 0);
    gl.uniform1f(loc.uAlpha, o.alpha === undefined ? 1 : o.alpha);
    if (o.cull === false) gl.disable(gl.CULL_FACE);
    gl.depthMask(o.depthWrite === false ? false : true);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    gl.depthMask(true);
    if (o.cull === false) gl.enable(gl.CULL_FACE);
  }

  return {
    gl, resize, setCamera, setEnvironment, applyEnvironment, clear,
    createMesh, createMeshFromData, drawMesh,
    /** The current frame's environment, for the sky dome and the HUD. */
    get env() { return state; },
  };
}
