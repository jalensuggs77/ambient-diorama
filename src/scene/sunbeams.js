import * as THREE from 'three';
import { hashGLSL } from '../shaders/common.js';

// 白天阳光透过落地窗形成的体积光柱 + 在光里飘浮的灰尘。
// 光柱是一个沿光线方向“拉伸”的窗形棱柱，片元着色器沿视线做 24 步光线步进：
// 把每个采样点沿光线方向投影回玻璃平面，落在窗洞里（且不在窗棂上）就算被照亮。
// 所以窗棂的影子、光柱的边缘都是解析算出来的，不需要阴影贴图。

const LIGHT_GLSL = /* glsl */ `
  uniform vec3 uDir;      // 光线前进方向（从窗外射入室内）
  uniform vec4 uRect;     // 窗洞 x0, y0, x1, y1（已扣掉窗框）
  uniform vec2 uMullions; // 两根竖梃的 x
  uniform float uGlassZ;

  float lightAt(vec3 p) {
    if (p.y < 0.0 || p.y > 3.3 || p.z < uGlassZ || p.z > 6.7 || abs(p.x) > 3.6) return 0.0;
    float s = (p.z - uGlassZ) / uDir.z;
    vec3 q = p - uDir * s;
    float inside = step(uRect.x, q.x) * step(q.x, uRect.z) * step(uRect.y, q.y) * step(q.y, uRect.w);
    float mull = step(0.03, abs(q.x - uMullions.x)) * step(0.03, abs(q.x - uMullions.y));
    return inside * mull * exp(-s * 0.18);
  }
`;

export class Sunbeams {
  constructor(win) {
    this.win = win;
    this.group = new THREE.Group();
    const frame = 0.07;
    const w = win.x1 - win.x0;
    this.rect = new THREE.Vector4(win.x0 + frame, win.y0 + frame, win.x1 - frame, win.y1 - frame);
    const shared = {
      uDir: { value: new THREE.Vector3(0, -0.5, 1).normalize() },
      uRect: { value: this.rect },
      uMullions: { value: new THREE.Vector2(win.x0 + w * 0.27, win.x1 - w * 0.27) },
      uGlassZ: { value: win.glassZ },
      uColor: { value: new THREE.Color() },
      uIntensity: { value: 0 },
      uTime: { value: 0 },
    };
    this.uniforms = shared;

    // ----- 光柱 -----
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uLength: { value: 8 }, uCamInside: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        uniform vec3 uDir;
        uniform vec4 uRect;
        uniform float uGlassZ, uLength;
        varying vec3 vP;
        void main() {
          vec3 q = position + 0.5;
          // 棱柱比窗洞略大一圈，免得边缘被裁掉
          vec3 base = vec3(mix(uRect.x - 0.05, uRect.z + 0.05, q.x), mix(uRect.y - 0.05, uRect.w + 0.05, q.y), uGlassZ + 0.01);
          vP = base + uDir * q.z * uLength;
          gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${LIGHT_GLSL}
        ${hashGLSL}
        uniform vec3 uColor;
        uniform float uIntensity, uCamInside, uTime;
        varying vec3 vP;
        void main() {
          vec3 rd = normalize(vP - cameraPosition);
          vec3 ro;
          float len;
          if (gl_FrontFacing) {
            if (uCamInside > 0.5) discard;
            ro = vP;
            len = 5.0;
          } else {
            if (uCamInside < 0.5) discard;
            ro = cameraPosition;
            len = min(distance(cameraPosition, vP), 6.0);
          }
          float stepL = len / 24.0;
          float jitter = hash12(gl_FragCoord.xy + fract(uTime) * 13.0);
          float acc = 0.0;
          for (int i = 0; i < 24; i++) {
            vec3 p = ro + rd * (float(i) + jitter) * stepL;
            // 缓慢翻滚的空气，让光柱有一点不均匀的质感
            float haze = 0.75 + 0.25 * sin(p.x * 3.1 + uTime * 0.3) * sin(p.y * 2.3 - uTime * 0.2 + p.z * 1.7);
            acc += lightAt(p) * haze;
          }
          acc *= stepL;
          gl_FragColor = vec4(uColor * acc * uIntensity, 1.0);
        }
      `,
    });
    this.beam = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.beamMat);
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 2;
    this.beam.raycast = () => {};
    this.group.add(this.beam);

    // ----- 浮尘 -----
    const n = 700;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = -2.2 + Math.random() * 4.6;
      pos[i * 3 + 1] = Math.random() * 3.2;
      pos[i * 3 + 2] = Math.random() * 5;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uViewportH: { value: 800 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        ${LIGHT_GLSL}
        attribute float aSeed;
        uniform float uTime, uViewportH;
        varying float vBright;
        void main() {
          vec3 p = position;
          float s = aSeed * 40.0;
          p.x += sin(uTime * 0.13 + s) * 0.3 + sin(uTime * 0.31 + s * 1.7) * 0.06;
          p.z += cos(uTime * 0.11 + s * 1.3) * 0.3;
          p.y = mod(p.y + sin(uTime * 0.09 + s) * 0.25 + uTime * (0.01 + aSeed * 0.02), 3.2);
          // 在光里亮，光外只剩极淡的一点
          vBright = lightAt(p) * (0.6 + 0.4 * sin(uTime * (1.0 + aSeed * 2.0) + s));
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_PointSize = (0.006 + aSeed * 0.01) * projectionMatrix[1][1] * uViewportH * 0.5 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uIntensity;
        varying float vBright;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(uColor * a * vBright * uIntensity * 4.0, 1.0);
        }
      `,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    this.dust.raycast = () => {};
    this.group.add(this.dust);
    this._q = new THREE.Vector3();
  }

  setViewportHeight(h) {
    this.dustMat.uniforms.uViewportH.value = h;
  }

  update(t, env, rain, cameraPosition) {
    const u = this.uniforms;
    u.uTime.value = t;
    // 光线方向 = 指向太阳方向的反方向；只有太阳在窗外上方时才有光柱
    u.uDir.value.copy(env.sunDir).negate();
    const sunUp = THREE.MathUtils.smoothstep(env.sunDir.y, 0.0, 0.12);
    const intoRoom = THREE.MathUtils.smoothstep(u.uDir.value.z, 0.15, 0.4);
    const k = env.day * sunUp * intoRoom * (1 - rain * 0.75);
    u.uIntensity.value = k * 0.32;
    u.uColor.value.copy(env.sunColor);
    this.group.visible = k > 0.005;
    if (!this.group.visible) return;

    // 镜头在光柱里面时改为从镜头处开始步进（画背面）
    const d = u.uDir.value;
    const c = cameraPosition;
    const s = (c.z - this.win.glassZ) / d.z;
    const q = this._q.copy(c).addScaledVector(d, -s);
    const r = this.rect;
    const inside = s > 0 && s < 8 && q.x > r.x - 0.05 && q.x < r.z + 0.05 && q.y > r.y - 0.05 && q.y < r.w + 0.05;
    this.beamMat.uniforms.uCamInside.value = inside ? 1 : 0;
    this.beamMat.depthTest = !inside;
  }
}
