// Glowing additive spark particles (CPU-simulated, drawn as one Points object).
import * as THREE from 'three';
import { GLOW_LAYER } from './stage.js';

const VERT = /* glsl */`
  attribute vec3 color;
  attribute float size;
  attribute float alpha;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */`
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    float core = 1.0 - smoothstep(0.0, 1.0, r);
    core *= core;
    float flare = max(0.0, 1.0 - abs(p.x) * 7.0) * max(0.0, 1.0 - abs(p.y))
                + max(0.0, 1.0 - abs(p.y) * 7.0) * max(0.0, 1.0 - abs(p.x));
    float a = (core + flare * 0.5) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a * 1.8, a);
  }
`;

export class Particles {
  constructor(parent, max = 1800) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 } },
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.layers.set(GLOW_LAYER);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    parent.add(this.points);
    this.tmpColor = new THREE.Color();
  }

  setScale(px) { this.mat.uniforms.uScale.value = px; }

  /**
   * Burst of sparks.
   * o: { x, y, z, count, colors[], speed, spread (0..1 cone), dir:[x,y,z], gravity, life, size, drag, jitter }
   */
  emit(o) {
    const colors = o.colors || ['#ffffff'];
    const dir = new THREE.Vector3(...(o.dir || [0, 1, 0])).normalize();
    const tmp = new THREE.Vector3();
    for (let n = 0; n < (o.count || 20); n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      // random direction inside a cone around dir
      tmp.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      tmp.lerp(dir, 1 - (o.spread ?? 1)).normalize();
      const sp = (o.speed || 4) * (0.35 + Math.random() * 0.9);
      const j = o.jitter || 0;
      this.pos[i * 3] = o.x + (Math.random() - 0.5) * j;
      this.pos[i * 3 + 1] = o.y + (Math.random() - 0.5) * j;
      this.pos[i * 3 + 2] = (o.z || 0) + (Math.random() - 0.5) * j * 0.3;
      this.vel[i * 3] = tmp.x * sp;
      this.vel[i * 3 + 1] = tmp.y * sp;
      this.vel[i * 3 + 2] = tmp.z * sp * 0.6;
      this.tmpColor.set(colors[(Math.random() * colors.length) | 0]);
      this.col[i * 3] = this.tmpColor.r;
      this.col[i * 3 + 1] = this.tmpColor.g;
      this.col[i * 3 + 2] = this.tmpColor.b;
      const life = (o.life || 1) * (0.6 + Math.random() * 0.7);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.baseSize[i] = (o.size || 0.3) * (0.5 + Math.random());
      this.grav[i] = o.gravity ?? -6;
      this.drag[i] = o.drag ?? 1.2;
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = Math.min(1, t * 2.2) * (0.75 + 0.25 * Math.sin(this.life[i] * 40 + i));
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * t);
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true;
  }
}
