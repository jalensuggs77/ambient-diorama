import * as THREE from 'three';
import { hashGLSL } from './common.js';

// 天空穹顶：渐变 + 太阳/月亮 + 星空 + 随雨量变厚的云层 + 闪电
export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uSunColor: { value: new THREE.Color() },
      uTime: { value: 0 },
      uRain: { value: 0.5 },
      uNight: { value: 0 },
      uDay: { value: 1 },
      uTwilight: { value: 0 },
      uLightning: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHorizon, uSunDir, uMoonDir, uSunColor;
      uniform float uTime, uRain, uNight, uDay, uTwilight, uLightning;
      varying vec3 vDir;
      ${hashGLSL}

      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;
        vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.65, h), 0.65));

        // 朝向太阳一侧的地平线更亮（朝霞/晚霞）
        vec2 sxz = normalize(uSunDir.xz + 1e-4);
        float toward = max(dot(normalize(dir.xz + 1e-4), sxz), 0.0);
        col += uSunColor * uTwilight * pow(toward, 3.0) * exp(-max(h, 0.0) * 5.0) * 0.55 * (1.0 - uRain * 0.6);

        // 太阳
        float sd = max(dot(dir, uSunDir), 0.0);
        float sunVis = 1.0 - uRain * 0.85;
        col += uSunColor * (smoothstep(0.99955, 0.9998, sd) * 18.0 * sunVis
                          + pow(sd, 96.0) * 0.9 * sunVis + pow(sd, 6.0) * 0.18 * uDay);

        // 月亮（带一点阴影的月面）
        float md = dot(dir, uMoonDir);
        float moonDisc = smoothstep(0.99925, 0.9995, md);
        vec3 tang = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
        float crater = valueNoise((dir - uMoonDir).xy * 900.0) * 0.35;
        float phaseShade = smoothstep(-0.012, 0.02, dot(dir - uMoonDir, tang) + 0.012);
        vec3 moonCol = vec3(0.95, 0.97, 1.0) * (1.0 - crater) * mix(0.15, 1.0, phaseShade);
        col += moonCol * moonDisc * uNight * (1.0 - uRain * 0.75) * 2.5;
        col += vec3(0.5, 0.6, 1.0) * pow(max(md, 0.0), 200.0) * 0.25 * uNight;

        // 星星
        vec3 sp = dir * 260.0;
        vec3 cell = floor(sp);
        float star = hash13(cell);
        float twinkle = 0.6 + 0.4 * sin(uTime * (2.0 + star * 5.0) + star * 40.0);
        float starMask = smoothstep(0.9965, 1.0, star) * smoothstep(0.35, 0.15, length(fract(sp) - 0.5));
        col += vec3(0.9, 0.95, 1.0) * starMask * twinkle * uNight * (1.0 - uRain) * smoothstep(0.03, 0.25, h) * 3.0;

        // 云层
        vec2 cuv = dir.xz / (h + 0.18) * 0.9 + vec2(uTime * 0.012, uTime * 0.004);
        float n = fbm(cuv * 1.3);
        float cover = mix(0.62, 0.22, uRain);
        float dens = smoothstep(cover, cover + 0.35, n) * smoothstep(-0.02, 0.18, h);
        vec3 cloudLit = mix(uHorizon * 1.15, uSunColor * 0.9 + uTop * 0.4, uDay * 0.6 + uTwilight * 0.4);
        vec3 cloudDark = uHorizon * mix(0.55, 0.8, uDay);
        vec3 cloudCol = mix(cloudLit, cloudDark, uRain * 0.75);
        // 夜里城市灯光映在云底
        cloudCol += vec3(0.32, 0.08, 0.3) * uNight * (0.35 + 0.65 * uRain) * 0.35;
        col = mix(col, cloudCol, dens * (0.6 + 0.35 * uRain));

        // 地平线处的城市光污染
        col += vec3(0.55, 0.12, 0.45) * uNight * exp(-max(h, 0.0) * 9.0) * 0.18;

        // 闪电照亮云层
        col += vec3(0.75, 0.8, 1.0) * uLightning * (0.35 + dens * 1.6) * smoothstep(-0.05, 0.3, h);

        if (h < 0.0) col = mix(col, uHorizon * 0.5, smoothstep(0.0, -0.15, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
