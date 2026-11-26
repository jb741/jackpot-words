// The 3D game board. Every square is a little slot-machine reel drawn by a shader.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const ROWS = 6;
export const BLANK = 26;
const PITCH = 1.16;
const DEPTH = 0.26;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const letterIndex = (ch) => (ch ? LETTERS.indexOf(ch.toUpperCase()) : BLANK);

const col = (h) => new THREE.Color(h);
export const PALETTE = {
  emptyBorder: col('#4b2a96'),
  typedBorder: col('#22e8ff'),
  hit: col('#16ee6c'), hitBorder: col('#d2ffe6'),
  near: col('#2a63ff'), nearBorder: col('#c0d4ff'),
  miss: col('#d01a37'), missBorder: col('#ffa3b1'),
  white: col('#ffffff'), dark: col('#03170b'),
};
export const RESULT_HEX = { hit: '#1dff7a', near: '#3a7bff', miss: '#ff2e4d' };

// ---------------------------------------------------------------- glyph atlas
export function makeGlyphAtlas(renderer) {
  const cell = 128, cols = 8, rows = 4;
  const c = document.createElement('canvas');
  c.width = cell * cols; c.height = cell * rows;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = '900 84px Orbitron, "Avenir Next", sans-serif';
  const cap = g.measureText('H').actualBoundingBoxAscent || 62;
  for (let i = 0; i < 26; i++) {
    const x = (i % cols) * cell + cell / 2;
    const y = Math.floor(i / cols) * cell + cell / 2 + cap / 2;
    g.fillText(LETTERS[i], x, y);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// ---------------------------------------------------------------- tile shader
const FACE_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const FACE_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uAtlas;
  uniform float uOffset, uSpeed, uWarp, uFinalIdx, uFinalLetter, uStartIdx, uStartLetter, uSeed;
  uniform vec3 uFill; uniform float uFillAmt;
  uniform vec3 uBorder; uniform float uBorderGlow;
  uniform vec3 uLetterColor; uniform float uLetterGlow;
  uniform float uFlash, uShine, uSelected, uTime, uDim;

  float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  float h1(float n) { return fract(sin(n * 91.3458 + uSeed * 47.123) * 47453.5453); }
  float letterAt(float n) {
    if (abs(n - uFinalIdx) < 0.5) return uFinalLetter;
    if (abs(n - uStartIdx) < 0.5) return uStartLetter;
    return floor(h1(n) * 25.999);
  }
  float glyphA(float L, vec2 uv) {
    if (L > 25.5 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    float c = mod(L, 8.0);
    float r = floor(L / 8.0);
    vec2 t = vec2((c + uv.x) / 8.0, 1.0 - (r + 1.0 - uv.y) / 4.0);
    return texture2D(uAtlas, t).a;
  }
  float reelSample(float u, float s) {
    float n = floor(s + 0.5);
    float v = s - n + 0.5;
    // squash glyph slightly so letters keep some margin inside a reel cell
    return glyphA(letterAt(n), vec2(u, (v - 0.5) * 1.08 + 0.5));
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = sdRound(p, vec2(1.0), 0.26);
    float aa = fwidth(d) * 1.25;
    float inside = 1.0 - smoothstep(-aa, aa, d);
    if (inside < 0.002) discard;

    // ---- reel window
    const float W = 0.84;
    vec2 wp = p / W;
    float inWin = step(abs(wp.x), 1.0) * step(abs(wp.y), 1.0);
    const float maxA = 1.05;
    float yl = clamp(wp.y, -1.0, 1.0);
    float th = mix(yl * maxA, asin(clamp(yl * sin(maxA), -1.0, 1.0)), uWarp);
    float s = uOffset + th / (2.0 * maxA);
    float u = wp.x * 0.5 + 0.5;
    float blur = clamp(uSpeed * 0.011, 0.0, 0.5);
    float a = 0.0;
    if (blur > 0.02) {
      for (int i = 0; i < 7; i++) { a += reelSample(u, s + (float(i) / 6.0 - 0.5) * blur); }
      a /= 7.0;
    } else {
      a = reelSample(u, s);
    }
    a *= inWin;
    float cyl = mix(1.0, 0.25 + 0.75 * cos(th * 1.15), uWarp);

    // ---- glass body
    vec3 base = mix(vec3(0.012, 0.004, 0.035), vec3(0.055, 0.016, 0.14), vUv.y);
    base += vec3(0.05, 0.02, 0.1) * pow(1.0 - abs(p.x + p.y) * 0.5, 6.0) * 0.6;   // faint diagonal sheen
    vec3 reel = vec3(0.06, 0.025, 0.13) * cyl + vec3(0.25, 0.1, 0.45) * pow(max(cos(th * 1.15), 0.0), 18.0) * 0.5;
    base = mix(base, reel, uWarp * inWin * 0.9);

    // ---- result fill
    vec3 fill = uFill * (0.62 + 0.55 * vUv.y);
    fill += uFill * smoothstep(-0.5, 0.0, d) * 0.55;
    vec3 c = mix(base, fill, uFillAmt);

    // ---- letter
    vec3 lc = uLetterColor * (1.0 + uLetterGlow);
    c = mix(c, lc, clamp(a * cyl, 0.0, 1.0));

    // ---- border ring + inner glow
    float ring = smoothstep(-0.115, -0.075, d) * (1.0 - smoothstep(-0.03, -0.005, d));
    float halo = smoothstep(-0.42, -0.06, d) * (1.0 - ring);
    vec3 bc = uBorder * (1.0 + uBorderGlow * 1.6);
    c += bc * ring + uBorder * halo * uBorderGlow * 0.22;

    // ---- selection (pulsing pink ring + caret)
    float pulse = 0.65 + 0.35 * sin(uTime * 6.0);
    vec3 pink = vec3(1.0, 0.1, 0.75);
    c = mix(c, pink * (1.4 + pulse), ring * uSelected);
    float caret = step(abs(p.x), 0.34) * step(abs(p.y + 0.72), 0.045);
    c += pink * caret * uSelected * pulse * 1.6;

    // ---- landing shine + flash
    float sh = 1.0 - smoothstep(0.0, 0.16, abs((p.x + p.y * 0.7) * 0.5 - uShine));
    c += vec3(1.0) * sh * 0.55 * step(-2.0, uShine);
    c += uFill * uFlash * 1.3 + vec3(1.0) * uFlash * 0.25;

    c *= uDim;
    gl_FragColor = vec4(c, 1.0);
  }
`;

function makeFaceMaterial(atlas) {
  return new THREE.ShaderMaterial({
    vertexShader: FACE_VERT,
    fragmentShader: FACE_FRAG,
    uniforms: {
      uAtlas: { value: atlas },
      uOffset: { value: 0 }, uSpeed: { value: 0 }, uWarp: { value: 0 },
      uFinalIdx: { value: -9999 }, uFinalLetter: { value: BLANK },
      uStartIdx: { value: 0 }, uStartLetter: { value: BLANK },
      uSeed: { value: Math.random() * 100 },
      uFill: { value: new THREE.Color(0, 0, 0) }, uFillAmt: { value: 0 },
      uBorder: { value: PALETTE.emptyBorder.clone() }, uBorderGlow: { value: 0.2 },
      uLetterColor: { value: PALETTE.white.clone() }, uLetterGlow: { value: 0.5 },
      uFlash: { value: 0 }, uShine: { value: -3 }, uSelected: { value: 0 }, uTime: { value: 0 }, uDim: { value: 1 },
    },
  });
}

// ---------------------------------------------------------------- easing
const C1 = 1.70158, C3 = C1 + 1;
const easeOutBack = (x) => 1 + C3 * Math.pow(x - 1, 3) + C1 * Math.pow(x - 1, 2);
const EOB_SLOPE = 3 * C3 - 2 * C1; // derivative of easeOutBack at 0
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/**
 * Reel motion: accelerate, cruise, then decelerate with a little overshoot ("thunk").
 * Lands exactly on an integer cell so the target letter is centered.
 */
function makeMotion({ start, total = 1, vmax = 0, ta = 0.12, td = 0.45, cells = 1, delay = 0 }) {
  let D, Dacc = 0, Ddec, tc = 0;
  if (vmax > 0) {
    Dacc = vmax * ta / 2;
    Ddec = vmax * td / EOB_SLOPE;
    D = Math.max(Math.ceil(Dacc + Ddec), Math.round(Dacc + Ddec + vmax * Math.max(0, total - ta - td)));
    tc = (D - Dacc - Ddec) / vmax;
  } else {
    ta = 0; D = cells; Ddec = cells; tc = 0;
  }
  const end = ta + tc + td;
  return {
    t: -delay, end, final: start + D,
    pos(t) {
      if (t <= 0) return start;
      if (t < ta) return start + 0.5 * (vmax / ta) * t * t;
      if (t < ta + tc) return start + Dacc + vmax * (t - ta);
      if (t < end) return start + Dacc + vmax * tc + Ddec * easeOutBack((t - ta - tc) / td);
      return start + D;
    },
  };
}

// ---------------------------------------------------------------- tile
class Tile {
  constructor(board, row, col) {
    this.row = row; this.col = col;
    this.group = new THREE.Group();
    this.bezel = new THREE.Mesh(board.bezelGeo, board.bezelMat);
    this.mat = makeFaceMaterial(board.atlas);
    this.face = new THREE.Mesh(board.faceGeo, this.mat);
    this.face.position.z = DEPTH / 2 + 0.004;
    this.face.userData.tile = this;
    this.group.add(this.bezel, this.face);
    this.u = this.mat.uniforms;
    this.home = new THREE.Vector3();

    this.letter = BLANK;
    this.result = null;
    this.offset = 0; this.speed = 0; this.warp = 0; this.lastCell = 0;
    this.motion = null;

    this.scale = 1; this.scaleV = 0;
    this.z = 0; this.zV = 0;
    this.yOff = 0;
    this.border = PALETTE.emptyBorder.clone(); this.borderTarget = PALETTE.emptyBorder.clone();
    this.glow = 0.2; this.glowTarget = 0.2;
    this.fill = 0; this.fillTarget = 0;
    this.letterGlow = 0.5; this.letterGlowTarget = 0.5;
    this.flash = 0; this.shine = -3;
    this.sel = 0; this.selTarget = 0;
    this.dim = 1; this.dimTarget = 1;
    this.intro = 1; this.introDelay = 0; this.leaving = 0;
    this.flipT = null;
  }

  // Show a letter immediately (no animation).
  showLetter(L) {
    this.letter = L;
    this.offset = 0; this.motion = null;
    this.u.uStartIdx.value = 0; this.u.uStartLetter.value = L; this.u.uFinalIdx.value = -9999;
  }

  // Roll the reel to a new letter. Fast and short for typing, long for the big reveal.
  roll(L, opts, onLand, onTick) {
    if (this.motion) { // finish any running roll first
      this.showLetter(this.motion.letter);
    }
    const start = Math.round(this.offset);
    this.u.uStartIdx.value = start;
    this.u.uStartLetter.value = this.letter;
    this.u.uSeed.value = Math.random() * 100;
    const m = makeMotion({ start, ...opts });
    m.letter = L; m.onLand = onLand; m.onTick = onTick;
    this.u.uFinalIdx.value = m.final;
    this.u.uFinalLetter.value = L;
    this.motion = m;
    this.lastCell = start;
  }

  setTyped(L) {
    this.roll(L, { cells: 1, td: 0.16 });
    this.result = null;
    this.borderTarget.copy(L === BLANK ? PALETTE.emptyBorder : PALETTE.typedBorder);
    this.glowTarget = L === BLANK ? 0.2 : 0.9;
    this.letterGlowTarget = 0.55;
    this.u.uLetterColor.value.copy(PALETTE.white);
    if (L !== BLANK) { this.scaleV += 5; this.zV += 3; }
  }

  applyResult(result, animate) {
    this.result = result;
    this.u.uFill.value.copy(PALETTE[result]);
    this.fillTarget = 1;
    this.borderTarget.copy(PALETTE[result + 'Border']);
    this.glowTarget = result === 'miss' ? 0.35 : 0.9;
    this.u.uLetterColor.value.copy(result === 'hit' ? PALETTE.dark : PALETTE.white);
    this.letterGlowTarget = result === 'hit' ? 0 : 0.2;
    if (animate) {
      this.flash = result === 'miss' ? 0.5 : 1;
      this.shine = -1.3;
      this.zV += result === 'miss' ? 4 : 9;
      this.scaleV += result === 'miss' ? 2 : 6;
    } else {
      this.fill = 1;
      this.border.copy(this.borderTarget);
      this.glow = this.glowTarget;
      this.letterGlow = this.letterGlowTarget;
    }
  }

  clearResult() {
    this.result = null;
    this.fillTarget = 0;
    this.borderTarget.copy(PALETTE.emptyBorder);
    this.glowTarget = 0.2;
    this.letterGlowTarget = 0.5;
    this.u.uLetterColor.value.copy(PALETTE.white);
  }

  update(dt, t, board) {
    const u = this.u;
    // reel
    if (this.motion) {
      const m = this.motion;
      m.t += dt;
      const pos = m.pos(m.t);
      this.speed = Math.abs(pos - this.offset) / Math.max(dt, 1e-4);
      this.offset = pos;
      const cell = Math.floor(pos + 0.5);
      if (cell !== this.lastCell) { this.lastCell = cell; m.onTick && m.onTick(this, this.speed); }
      if (m.t >= m.end) {
        this.showLetter(m.letter);
        this.speed = 0;
        m.onLand && m.onLand(this);
      }
    } else {
      this.speed = 0;
    }
    u.uOffset.value = this.offset;
    u.uSpeed.value = this.speed;
    const warpT = this.speed > 5 ? 1 : 0;
    this.warp += (warpT - this.warp) * Math.min(1, dt * (warpT ? 16 : 9));
    u.uWarp.value = this.warp;

    // springs
    this.scaleV += ((1 - this.scale) * 340 - this.scaleV * 17) * dt;
    this.scale += this.scaleV * dt;
    this.zV += ((0 - this.z) * 220 - this.zV * 15) * dt;
    this.z += this.zV * dt;

    // colors
    const k = 1 - Math.exp(-dt * 10);
    this.border.lerp(this.borderTarget, k);
    u.uBorder.value.copy(this.border);
    this.glow += (this.glowTarget - this.glow) * k;
    u.uBorderGlow.value = this.glow + this.sel * 0.4;
    this.fill += (this.fillTarget - this.fill) * (1 - Math.exp(-dt * 16));
    u.uFillAmt.value = this.fill;
    this.letterGlow += (this.letterGlowTarget - this.letterGlow) * k;
    u.uLetterGlow.value = this.letterGlow;
    this.flash *= Math.exp(-dt * 4.5);
    u.uFlash.value = this.flash;
    if (this.shine > -3) { this.shine += dt * 3.4; if (this.shine > 2.6) this.shine = -3; }
    u.uShine.value = this.shine;
    this.sel += (this.selTarget - this.sel) * (1 - Math.exp(-dt * 14));
    u.uSelected.value = this.sel;
    this.dim += (this.dimTarget - this.dim) * (1 - Math.exp(-dt * 6));
    u.uDim.value = this.dim;
    u.uTime.value = t;

    // transform
    const g = this.group;
    let x = this.home.x, y = this.home.y + this.yOff, z = this.z, s = this.scale, rx = 0, ry = 0;
    if (board.shake && board.shake.row === this.row) x += board.shake.offset;
    if (this.intro < 1) {
      this.intro = clamp01((board.introClock - this.introDelay) / 0.75);
      const e = easeOutBack(this.intro);
      z += -14 * (1 - e);
      rx += (1 - e) * 1.4;
      s *= Math.max(0.001, e);
    }
    if (this.leaving > 0) {
      this.leaving = Math.min(1, this.leaving + dt * 3.2);
      const e = this.leaving * this.leaving;
      z += 10 * e; s *= Math.max(0.001, 1 - e); ry += e * 2;
    }
    if (this.flipT !== null) {
      this.flipT += dt;
      const p = clamp01(this.flipT / 0.75);
      if (this.flipT >= 0) {
        ry += easeInOutCubic(p) * Math.PI * 2;
        y += Math.sin(p * Math.PI) * 0.6;
        z += Math.sin(p * Math.PI) * 1.2;
      }
      if (p >= 1) this.flipT = null;
    }
    g.position.set(x, y, z);
    g.scale.setScalar(s);
    g.rotation.set(rx, ry, 0);
  }
}

// ---------------------------------------------------------------- backing panel
const PANEL_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uSize; uniform float uTime; uniform float uPulse;
  float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  void main() {
    vec2 p = (vUv - 0.5) * uSize;
    float d = sdRound(p, uSize * 0.5 - 0.05, 0.42);
    float aa = fwidth(d);
    if (d > aa) discard;
    float edge = smoothstep(-0.07, -0.02, d) * (1.0 - smoothstep(-0.01, aa, d));
    float k = 0.5 + 0.5 * sin((vUv.x * uSize.x - vUv.y * uSize.y) * 0.45 + uTime * 0.9);
    vec3 neon = mix(vec3(1.0, 0.1, 0.78), vec3(0.08, 0.85, 1.0), k);
    float inner = smoothstep(-0.6, 0.0, d) * 0.12;
    vec3 col = vec3(0.006, 0.0, 0.02) + neon * (edge * (1.5 + uPulse * 2.0) + inner);
    float alpha = max(0.62, edge);
    gl_FragColor = vec4(col, alpha);
  }
`;

// ---------------------------------------------------------------- board
export class Board {
  constructor(scene, atlas, envMap) {
    this.atlas = atlas;
    this.root = new THREE.Group();
    this.sway = new THREE.Group();
    this.root.add(this.sway);
    scene.add(this.root);
    this.bezelGeo = new RoundedBoxGeometry(1.08, 1.08, DEPTH, 3, 0.14);
    this.bezelMat = new THREE.MeshStandardMaterial({ color: 0x4a4268, metalness: 1, roughness: 0.28, envMap, envMapIntensity: 1.3 });
    this.faceGeo = new THREE.PlaneGeometry(1, 1);
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader: FACE_VERT, fragmentShader: PANEL_FRAG,
        uniforms: { uSize: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uPulse: { value: 0 } },
        transparent: true, depthWrite: false,
      })
    );
    this.panel.renderOrder = -1;
    this.panel.position.z = -0.35;
    this.panel.visible = false; // shown once the first board is built
    this.sway.add(this.panel);
    this.tiles = [];
    this.cols = 0;
    this.time = 0;
    this.introClock = 99;
    this.shake = null;
    this.tilt = { x: 0, y: 0 };
    this.pulse = 0;
    this.raycaster = new THREE.Raycaster();
    this.size = { w: 1, h: 1 };
  }

  build(cols, { animate = true } = {}) {
    for (const row of this.tiles) for (const t of row) { this.sway.remove(t.group); t.mat.dispose(); }
    this.tiles = [];
    this.cols = cols;
    this.size = { w: cols * PITCH - (PITCH - 1), h: ROWS * PITCH - (PITCH - 1) };
    this.panel.visible = true;
    this.panel.scale.set(this.size.w + 0.62, this.size.h + 0.62, 1);
    this.panel.material.uniforms.uSize.value.set(this.size.w + 0.62, this.size.h + 0.62);
    this.introClock = animate ? 0 : 99;
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const t = new Tile(this, r, c);
        t.home.set((c - (cols - 1) / 2) * PITCH, ((ROWS - 1) / 2 - r) * PITCH, 0);
        if (animate) { t.intro = 0; t.introDelay = 0.15 + r * 0.07 + c * 0.045 + Math.random() * 0.05; }
        t.update(0, 0, this);
        this.sway.add(t.group);
        row.push(t);
      }
      this.tiles.push(row);
    }
  }

  /** Fly the old squares away (used before rebuilding for a new word length). */
  leave() {
    for (const row of this.tiles) for (const t of row) t.leaving = 0.001 + Math.random() * 0.2;
    return new Promise((r) => setTimeout(r, 380));
  }

  tile(r, c) { return this.tiles[r] && this.tiles[r][c]; }

  /** Fit the board into the on-screen board area (CSS pixels) and point the camera at its center. */
  layout(vw, vh, rect, cam, pixelRatio) {
    cam.aspect = vw / vh;
    cam.updateProjectionMatrix();
    const H = 2 * cam.position.z * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const ppu = vh / H;
    const bw = this.size.w + 0.7, bh = this.size.h + 0.7;
    const maxTilePx = Math.min(104, rect.height / 6.6);
    const s = Math.min((rect.width * 0.97) / (bw * ppu), (rect.height * 0.97) / (bh * ppu), maxTilePx / ppu);
    this.root.scale.setScalar(s);
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const e = cam.projectionMatrix.elements;
    e[8] = -((cx / vw) * 2 - 1);
    e[9] = -(1 - (cy / vh) * 2);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    this.scale = s;
    this.pointScale = (vh * pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) * s;
  }

  /** Which square (if any) is under a screen point (NDC). */
  pick(ndc, cam) {
    this.raycaster.setFromCamera(ndc, cam);
    const faces = [];
    for (const row of this.tiles) for (const t of row) faces.push(t.face);
    const hit = this.raycaster.intersectObjects(faces, false)[0];
    return hit ? hit.object.userData.tile : null;
  }

  setCursor(row, col) {
    for (const r of this.tiles) for (const t of r) t.selTarget = t.row === row && t.col === col ? 1 : 0;
  }

  setActiveRow(row) {
    for (const r of this.tiles) for (const t of r) t.dimTarget = t.row > row ? 0.5 : 1;
  }

  shakeRow(row) { this.shake = { row, t: 0, offset: 0 }; }

  /** The big reveal. All reels spin together and stop one by one, left to right. */
  spinRow(row, letters, results, { tease = false, onLand, onTick } = {}) {
    return new Promise((resolve) => {
      const n = letters.length;
      let landed = 0;
      for (let c = 0; c < n; c++) {
        const t = this.tiles[row][c];
        const teaseThis = tease && c === n - 1;
        // A teased last reel keeps whirring after the others stop, then crawls in slowly.
        const total = teaseThis ? 0.85 + (c - 1) * 0.3 + 2.5 : 0.85 + c * 0.3;
        t.roll(letters[c], { vmax: 24, ta: 0.14, td: teaseThis ? 1.9 : 0.42, total }, (tile) => {
          tile.applyResult(results[c], true);
          onLand && onLand(c, results[c], tile);
          if (++landed === n) setTimeout(resolve, 260);
        }, onTick);
        t.glowTarget = 1.2;
      }
    });
  }

  /** Set a finished row instantly (when resuming a saved game). */
  setRow(row, letters, results) {
    for (let c = 0; c < letters.length; c++) {
      const t = this.tiles[row][c];
      t.showLetter(letters[c]);
      if (results) t.applyResult(results[c], false);
      else if (letters[c] !== BLANK) { t.borderTarget.copy(PALETTE.typedBorder); t.border.copy(PALETTE.typedBorder); t.glowTarget = t.glow = 0.9; }
    }
  }

  /** Spin every used square back to blank for a new game. */
  clearAll() {
    return new Promise((resolve) => {
      let pending = 0, any = false;
      for (const row of this.tiles) for (const t of row) {
        if (t.letter === BLANK && !t.result) continue;
        any = true; pending++;
        t.clearResult();
        t.roll(BLANK, { vmax: 30, ta: 0.08, td: 0.3, total: 0.45, delay: t.row * 0.06 + t.col * 0.03 }, () => {
          if (--pending === 0) setTimeout(resolve, 120);
        });
      }
      if (!any) resolve();
    });
  }

  celebrate(row) {
    for (const t of this.tiles[row]) t.flipT = -t.col * 0.09;
    this.pulse = 1;
  }

  /** World position of a square inside the board root (for particles). */
  tilePos(row, col) {
    const t = this.tiles[row][col];
    const v = new THREE.Vector3(t.home.x, t.home.y, 0.4);
    return v;
  }

  update(dt) {
    this.time += dt;
    this.introClock += dt;
    const t = this.time;
    this.sway.rotation.y = Math.sin(t * 0.37) * 0.045 + this.tilt.x * 0.07;
    this.sway.rotation.x = Math.sin(t * 0.29) * 0.03 - this.tilt.y * 0.05;
    if (this.shake) {
      const s = this.shake;
      s.t += dt;
      s.offset = 0.2 * Math.sin(s.t * 46) * Math.exp(-s.t * 6);
      if (s.t > 0.7) this.shake = null;
    }
    this.pulse *= Math.exp(-dt * 1.5);
    this.panel.material.uniforms.uTime.value = t;
    this.panel.material.uniforms.uPulse.value = this.pulse;
    for (const row of this.tiles) for (const tile of row) tile.update(dt, t, this);
  }
}
