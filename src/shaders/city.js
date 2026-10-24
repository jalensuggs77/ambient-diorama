import * as THREE from 'three';
import { hashGLSL } from './common.js';

// 城市楼群：实例化的低多边形方块，窗户、霓虹边线、雾与光照都在着色器里程序化生成。
export function createCityMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uKeyColor: { value: new THREE.Color() },
      uKeyIntensity: { value: 1 },
      uSkyTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uNight: { value: 0 },
      uNeon: { value: 0 },
      uRain: { value: 0.5 },
      uTime: { value: 0 },
      uLightning: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vBase;
      varying vec3 vSize;
      varying vec3 vNormalW;
      void main() {
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = m * instanceMatrix;
        #endif
        vec4 wp = m * vec4(position, 1.0);
        vWorld = wp.xyz;
        vBase = (m * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vSize = vec3(length(m[0].xyz), length(m[1].xyz), length(m[2].xyz));
        vNormalW = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir, uKeyColor, uSkyTop, uHorizon;
      uniform float uKeyIntensity, uNight, uNeon, uRain, uTime, uLightning;
      varying vec3 vWorld;
      varying vec3 vBase;
      varying vec3 vSize;
      varying vec3 vNormalW;
      ${hashGLSL}

      vec3 neonPalette(float k) {
        if (k < 0.33) return vec3(1.0, 0.12, 0.65);
        if (k < 0.66) return vec3(0.1, 0.85, 1.0);
        return vec3(0.75, 0.3, 1.0);
      }

      void main() {
        vec3 n = normalize(vNormalW);
        float seed = hash12(vBase.xz * 0.37);
        float seed2 = hash12(vBase.xz * 1.91 + 4.0);
        float localY = vWorld.y - vBase.y;

        // 墙体基础色
        vec3 wall = mix(vec3(0.05, 0.055, 0.075), vec3(0.13, 0.13, 0.15), seed);
        wall = mix(wall, wall * vec3(1.1, 0.95, 0.9), step(0.7, seed2));
        float roof = step(0.6, n.y);

        // 窗户网格
        vec2 fuv = abs(n.x) > 0.5 ? vec2(vWorld.z, localY) : vec2(vWorld.x, localY);
        vec2 cellSize = vec2(mix(1.6, 2.6, seed2), mix(2.2, 3.0, seed));
        vec2 cell = floor(fuv / cellSize);
        vec2 f = fract(fuv / cellSize);
        float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.28, f.y) * step(f.y, 0.82);
        win *= (1.0 - roof) * step(1.0, localY) * step(localY, vSize.y - 1.5);

        float cellHash = hash12(cell + vBase.xz * 0.13 + n.xz * 7.0);
        float litProb = mix(0.08, 0.5, uNight);
        float lit = step(cellHash, litProb);
        // 偶尔有窗户在开关灯
        lit *= step(0.04, fract(cellHash * 31.0 + floor(uTime * 0.05 + cellHash * 5.0) * 0.618));
        vec3 warm = vec3(1.0, 0.72, 0.42);
        vec3 cool = vec3(0.55, 0.8, 1.0);
        vec3 winCol = mix(warm, cool, step(0.6, hash11(cellHash * 91.0)));
        winCol = mix(winCol, vec3(1.0, 0.3, 0.8), step(0.93, hash11(cellHash * 13.0)));

        // 光照（低多边形平面光）
        float diff = max(dot(n, normalize(uSunDir)), 0.0);
        vec3 ambient = mix(uHorizon, uSkyTop, n.y * 0.5 + 0.5) * 0.55;
        vec3 col = wall * (ambient + uKeyColor * diff * uKeyIntensity * 0.6);

        // 白天窗户玻璃反射天空
        vec3 glass = mix(uHorizon, uSkyTop, 0.4) * 0.35 + vec3(0.02, 0.03, 0.05);
        col = mix(col, glass, win * 0.85);
        col += win * lit * winCol * mix(0.25, 2.6, uNight);

        // 楼顶霓虹边线
        float hasNeon = step(0.55, seed2);
        float edge = smoothstep(0.35, 0.0, abs(localY - (vSize.y - 0.6))) * (1.0 - roof);
        float flicker = 0.85 + 0.15 * sin(uTime * (3.0 + seed * 9.0) + seed * 30.0);
        col += neonPalette(seed) * edge * hasNeon * uNeon * 3.0 * flicker;
        // 竖向灯带
        float stripe = hasNeon * step(0.8, seed) * smoothstep(0.12, 0.0, abs(fract(fuv.x / 9.0) - 0.5) - 0.02);
        col += neonPalette(fract(seed * 7.0)) * stripe * (1.0 - roof) * uNeon * 1.6;

        // 低处的霓虹雾（街道的光）
        float low = exp(-(vWorld.y + 40.0) / 18.0);
        col += vec3(0.6, 0.12, 0.5) * low * uNeon * 0.9;

        // 闪电照亮楼体
        col += vec3(0.6, 0.65, 0.8) * uLightning * 0.25 * (n.z * 0.5 + 0.5);

        // 距离雾（雨越大越浓）
        float dist = length(vWorld - cameraPosition);
        float density = mix(0.005, 0.016, uRain);
        float fogF = 1.0 - exp(-dist * density);
        vec3 fogCol = uHorizon * (1.0 + uLightning * 0.8);
        col = mix(col, fogCol, fogF);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
