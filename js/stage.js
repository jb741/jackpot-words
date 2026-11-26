// Renderer, synthwave backdrop (sky, striped sun, scrolling neon grid with mountains), bloom.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Board objects on this layer (neon frame, sparks) get bloom. Everything else on the board (the tiles)
 *  is drawn after the bloom pass, so their red/blue/green stays crisp instead of bleeding together. */
export const GLOW_LAYER = 1;

/** A RenderPass that only draws the given camera layers. */
class LayerPass extends RenderPass {
  constructor(scene, camera, mask) { super(scene, camera); this.mask = mask; }
  render(...args) {
    const saved = this.camera.layers.mask;
    this.camera.layers.mask = this.mask;
    super.render(...args);
    this.camera.layers.mask = saved;
  }
}

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const SKY_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vDir;
  uniform float uTime, uPulse;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    float y = vDir.y;
    vec3 top = vec3(0.004, 0.0, 0.018);
    vec3 mid = vec3(0.07, 0.004, 0.14);
    vec3 hor = vec3(0.75, 0.05, 0.32);
    vec3 col = mix(mid, top, smoothstep(0.08, 0.7, y));
    col = mix(hor, col, smoothstep(-0.03, 0.2, y));
    col += hor * uPulse * 0.6 * (1.0 - smoothstep(0.0, 0.5, y));
    // stars
    vec2 sp = vec2(atan(vDir.x, -vDir.z) * 70.0, y * 70.0);
    vec2 id = floor(sp);
    vec2 f = fract(sp) - 0.5;
    float h = hash(id);
    vec2 off = vec2(hash(id + 7.1), hash(id + 3.3)) - 0.5;
    float star = step(0.975, h) * (1.0 - smoothstep(0.0, 0.11, length(f - off * 0.6)));
    float tw = 0.55 + 0.45 * sin(uTime * (1.5 + h * 4.0) + h * 50.0);
    col += vec3(0.9, 0.85, 1.0) * star * tw * smoothstep(0.06, 0.4, y) * 1.4;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const SUN_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const SUN_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform float uTime, uPulse;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    p *= 1.35;            // plane is larger than the disc to leave room for the halo
    float r = length(p);
    float aa = fwidth(r) * 1.5;
    float disc = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
    float t = p.y * 0.5 + 0.5;
    vec3 c4 = vec3(0.55, 0.02, 0.6), c3 = vec3(1.0, 0.05, 0.45), c2 = vec3(1.0, 0.32, 0.12), c1 = vec3(1.0, 0.82, 0.12);
    vec3 col = mix(c4, c3, smoothstep(0.0, 0.38, t));
    col = mix(col, c2, smoothstep(0.38, 0.68, t));
    col = mix(col, c1, smoothstep(0.68, 1.0, t));
    float gap = 0.0;
    if (p.y < 0.2) {
      float k = 0.2 - p.y;
      float st = fract(p.y * 7.0 - uTime * 0.18);
      float thick = clamp(k * 0.42, 0.0, 0.8);
      float w = fwidth(p.y * 7.0) * 1.5;
      gap = 1.0 - smoothstep(thick - w, thick + w, st);
    }
    float a = disc * (1.0 - gap);
    float halo = exp(-max(r - 1.0, 0.0) * 3.2) * (1.0 - disc) * 0.55;
    vec3 outc = col * a * (1.25 + uPulse) + vec3(1.0, 0.18, 0.55) * halo * (0.7 + uPulse);
    gl_FragColor = vec4(outc, 1.0);
  }
`;

const GRID_VERT = /* glsl */`
  uniform float uScroll;
  varying vec3 vW;
  varying float vH;
  varying float vDist;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    float zs = w.z - uScroll;
    float side = smoothstep(110.0, 460.0, abs(w.x));
    float h = fbm(vec2(w.x * 0.0035, zs * 0.0035));
    h = pow(h, 1.5) * 520.0 * side;
    w.y += h;
    vW = vec3(w.x, w.y, zs);
    vH = h;
    vec4 mv = viewMatrix * w;
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const GRID_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vW;
  varying float vH;
  varying float vDist;
  uniform vec3 uFog;
  uniform float uPulse, uTime;
  float line(float coord, float spacing) {
    float c = coord / spacing;
    float f = abs(fract(c - 0.5) - 0.5);
    float w = fwidth(c);
    return 1.0 - smoothstep(0.0, w * 1.4, f);
  }
  void main() {
    float g = max(line(vW.x, 36.0), line(vW.z, 36.0));
    float peak = smoothstep(20.0, 260.0, vH);
    vec3 lineCol = mix(vec3(1.0, 0.08, 0.7), vec3(0.1, 0.85, 1.0), peak);
    vec3 base = vec3(0.012, 0.0, 0.03) + vec3(0.05, 0.0, 0.09) * peak;
    vec3 col = base + lineCol * g * (1.5 + uPulse * 2.5);
    float fog = smoothstep(500.0, 2300.0, vDist);
    col = mix(col, uFog, fog);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Stage {
  constructor(canvas, quality = 'high') {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x05010f, 1);

    // --- backdrop
    this.bgScene = new THREE.Scene();
    this.bgCam = new THREE.PerspectiveCamera(58, 1, 1, 6000);
    this.bgCam.position.set(0, 16, 0);
    this.uni = { uTime: { value: 0 }, uPulse: { value: 0 }, uScroll: { value: 0 }, uFog: { value: new THREE.Color(0.32, 0.02, 0.18) } };

    const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24),
      new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uni, side: THREE.BackSide, depthWrite: false }));
    sky.renderOrder = -10;
    this.bgScene.add(sky);

    const R = 760;
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(R * 2.7, R * 2.7),
      new THREE.ShaderMaterial({ vertexShader: SUN_VERT, fragmentShader: SUN_FRAG, uniforms: this.uni, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sun.position.set(0, R * 0.42, -3200);
    this.sun.renderOrder = -5;
    this.bgScene.add(this.sun);

    const grid = new THREE.Mesh(new THREE.PlaneGeometry(5200, 3200, 220, 150),
      new THREE.ShaderMaterial({ vertexShader: GRID_VERT, fragmentShader: GRID_FRAG, uniforms: this.uni }));
    grid.rotation.x = -Math.PI / 2;
    grid.position.set(0, 0, -1500);
    this.bgScene.add(grid);

    // --- board scene (filled in by Board)
    this.boardScene = new THREE.Scene();
    this.boardCam = new THREE.PerspectiveCamera(28, 1, 1, 200);
    this.boardCam.position.set(0, 0, 60);
    this.boardCam.layers.enable(GLOW_LAYER);
    this.boardScene.environment = this.makeEnv();

    // --- post
    this.composer = null;
    this.speed = 70;
    this.speedTarget = 70;
    this.setQuality(quality);
  }

  /** A tiny synthwave-colored environment so the chrome bezels reflect pink and cyan. */
  makeEnv() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const s = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: SKY_VERT,
      fragmentShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          float y = vDir.y;
          vec3 c = mix(vec3(0.9, 0.1, 0.6), vec3(0.08, 0.02, 0.25), smoothstep(-0.1, 0.6, y));
          c = mix(vec3(0.02, 0.0, 0.06), c, smoothstep(-0.6, -0.05, y));
          c += vec3(0.2, 0.9, 1.2) * smoothstep(0.92, 0.99, abs(vDir.x)) * step(0.0, y) * 2.0;
          c += vec3(1.5, 1.2, 1.4) * smoothstep(0.85, 0.98, y);
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
    const tex = pm.fromScene(s, 0.03).texture;
    pm.dispose();
    return tex;
  }

  setQuality(q) {
    this.quality = q;
    const high = q !== 'low';
    const dpr = Math.min(window.devicePixelRatio || 1, high ? 2 : 1.25);
    this.renderer.setPixelRatio(dpr);
    if (this.composer) { this.composer.dispose(); }
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: high ? 4 : 0 });
    const comp = new EffectComposer(this.renderer, rt);
    const bgPass = new RenderPass(this.bgScene, this.bgCam);
    comp.addPass(bgPass);
    this.bloom = null;
    if (high) {
      // background + board frame + sparks -> bloom -> tiles on top
      const glowPass = new LayerPass(this.boardScene, this.boardCam, 1 << GLOW_LAYER);
      glowPass.clear = false;
      glowPass.clearDepth = true;
      comp.addPass(glowPass);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.62);
      comp.addPass(this.bloom);
      const tilePass = new LayerPass(this.boardScene, this.boardCam, 1);
      tilePass.clear = false;
      tilePass.clearDepth = true;
      comp.addPass(tilePass);
    } else {
      const boardPass = new RenderPass(this.boardScene, this.boardCam);
      boardPass.clear = false;
      boardPass.clearDepth = true;
      comp.addPass(boardPass);
    }
    comp.addPass(new OutputPass());
    this.composer = comp;
    if (this.w) this.resize(this.w, this.h);
  }

  resize(w, h) {
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.bgCam.aspect = w / h;
    this.bgCam.updateProjectionMatrix();
  }

  /** Put the vanishing point at a spot on screen (0..1 across, 0..1 down) by shifting the lens. */
  setHorizon(frac, xFrac = 0.5) {
    const e = this.bgCam.projectionMatrix.elements;
    this.bgCam.updateProjectionMatrix();
    e[8] = -(xFrac * 2 - 1);
    e[9] = -(1 - frac * 2);
    this.bgCam.projectionMatrixInverse.copy(this.bgCam.projectionMatrix).invert();
  }

  pulse(v = 1) { this.uni.uPulse.value = Math.max(this.uni.uPulse.value, v); }
  setSpeed(v) { this.speedTarget = v; }

  render(dt, t) {
    this.uni.uTime.value = t;
    this.speed += (this.speedTarget - this.speed) * (1 - Math.exp(-dt * 2.5));
    this.uni.uScroll.value += this.speed * dt;
    this.uni.uPulse.value *= Math.exp(-dt * 1.8);
    this.bgCam.position.y = 16 + Math.sin(t * 0.45) * 1.2;
    this.bgCam.position.x = Math.sin(t * 0.21) * 6;
    this.composer.render(dt);
  }
}
