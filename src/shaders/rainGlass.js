import * as THREE from 'three';
import { hashGLSL } from './common.js';

// 雨滴玻璃着色器
// 窗外场景先渲染到带 mipmap 的离屏纹理，这里按屏幕坐标采样它：
//  - 水珠被当作凸透镜：采样坐标反向偏移，形成缩小、倒置的窗外影像（真实的折射效果）
//  - 没有水珠的地方是起雾的玻璃：用更高的 mip 层级 + 多点采样做模糊
//  - 滑落的水珠会在身后留下清晰的轨迹和细小的残留水滴
//  - 拖动鼠标可以在雾气上擦出清晰区域（uWipe），雾气会慢慢回来
//  - 夜里玻璃像半面镜子：用 Reflector 渲染的镜像纹理（tDiffuse）叠加室内倒影
//  - 雨大时窗户底部积水往下淌；下雪时水珠换成结霜和粘在玻璃上的雪花
// 这里导出的是 Reflector 需要的 shader 定义（它要求有 tDiffuse / color / textureMatrix 三个 uniform）
export function createRainGlassShader() {
  return {
    name: 'RainGlass',
    uniforms: {
      tDiffuse: { value: null },
      color: { value: null },
      textureMatrix: { value: null },
      uScene: { value: null },
      uWipe: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uGlassSize: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uRain: { value: 0.7 },
      uSnow: { value: 0 },
      uFog: { value: 0.6 },
      uNight: { value: 1 },
      uReflect: { value: 0 },
      uInterior: { value: new THREE.Color(1.0, 0.55, 0.3) },
    },
    vertexShader: /* glsl */ `
      uniform mat4 textureMatrix;
      varying vec2 vUv;
      varying vec4 vRefl;
      void main() {
        vUv = uv;
        vRefl = textureMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uScene;
      uniform sampler2D uWipe;
      uniform sampler2D tDiffuse;
      uniform vec2 uResolution;
      uniform vec2 uGlassSize;
      uniform float uTime, uRain, uSnow, uFog, uNight, uReflect;
      uniform vec3 uInterior;
      varying vec2 vUv;
      varying vec4 vRefl;
      ${hashGLSL}

      // 雨滴撞上玻璃后停留、慢慢蒸发。返回 (透镜法线 xy, 遮罩)
      vec3 staticDrops(vec2 p, float t, float density) {
        vec2 id = floor(p);
        vec2 st = fract(p) - 0.5;
        float rate = 0.07 + hash12(id + 0.71) * 0.12;
        float cyc = t * rate + hash12(id + 9.3) * 11.0;
        float life = fract(cyc);
        vec3 r = hash32(id + floor(cyc) * 13.17);
        vec2 c = (r.xy - 0.5) * 0.6;
        vec2 d = st - c;
        float fade = smoothstep(0.0, 0.012, life) * (1.0 - smoothstep(0.2, 1.0, life));
        float exists = step(r.z, density);
        float rad = (0.1 + 0.18 * r.y) * (0.7 + 0.3 * fade);
        float m = smoothstep(rad, rad * 0.5, length(d)) * fade * exists;
        return vec3(d / rad * m, m);
      }

      float pathX(float y, vec3 r) {
        return (r.x - 0.5) * 0.42 + 0.07 * sin(y * 3.1 + r.z * 6.28) + 0.035 * sin(y * 7.7 + r.y * 6.28);
      }

      // 沿玻璃滑落的水珠：走走停停的运动 + 拖尾 + 残留小水滴
      // 返回 (透镜法线 xy, 水珠遮罩, 拖尾清晰遮罩)
      vec4 slidingDrops(vec2 p, float t, float density) {
        float column = floor(p.x);
        p.y += hash11(column * 7.31 + 1.3) * 3.7;
        vec2 cellSize = vec2(1.0, 2.0);
        vec2 id = floor(p / cellSize);
        vec2 q = p - id * cellSize;
        q.x -= 0.5;
        vec3 r = hash32(id + 3.17);
        float exists = step(r.z, density);

        float speed = 0.12 + r.x * 0.22;
        float ph = fract(t * speed + r.y);
        // 单调但带停顿的位移曲线：模拟水珠被表面张力“卡住”又突然滑下
        const float k = 3.0;
        float f = ph - sin(6.28318 * k * ph) / (6.28318 * k);
        float y = 1.85 - 1.7 * f;
        float x = pathX(y, r);

        float rad = 0.13 + 0.07 * r.z;
        vec2 d = q - vec2(x, y);
        d.y *= d.y > 0.0 ? 0.75 : 1.15;
        float fadeIO = smoothstep(0.0, 0.05, ph) * smoothstep(1.0, 0.93, ph);
        float drop = smoothstep(rad, rad * 0.55, length(d)) * fadeIO * exists;

        float above = q.y - y;
        float tx = q.x - pathX(q.y, r);
        float behind = step(0.0, above);
        float trailW = rad * 0.6;
        float trail = smoothstep(trailW, trailW * 0.3, abs(tx)) * behind * smoothstep(1.1, 0.0, above) * exists;

        // 拖尾里的小水滴（位置固定在玻璃上）
        float ty = q.y * 8.0;
        float cy = floor(ty);
        float keep = step(0.45, hash12(vec2(cy, id.x * 3.1 + id.y * 17.0)));
        vec2 dd = vec2(tx, (fract(ty) - 0.5) / 8.0);
        float dRad = rad * (0.22 + 0.18 * hash12(vec2(cy + 3.0, id.x)));
        float droplets = smoothstep(dRad, dRad * 0.45, length(dd)) * behind
                       * smoothstep(1.6, 0.25, above) * exists * keep;

        vec2 n = d / rad * drop + dd / dRad * droplets;
        return vec4(n, max(drop, droplets), trail);
      }

      void main() {
        vec2 g = vUv * uGlassSize;           // 以米为单位的玻璃坐标
        float t = uTime;
        float wipe = texture2D(uWipe, vUv).r;
        float rainK = uRain * (1.0 - uSnow);
        float dens = rainK;

        vec3 s1 = staticDrops(g * 28.0, t, dens * 0.85);
        vec3 s2 = staticDrops(g * 15.0 + 11.3, t * 0.9, dens * 0.55);
        vec4 d1 = slidingDrops(g * 4.3, t, dens * 0.9);
        vec4 d2 = slidingDrops(g * 6.8 + 5.1, t * 1.07, dens * 0.65);

        float trails = clamp(d1.w + d2.w, 0.0, 1.0);
        float staticKeep = (1.0 - trails) * (1.0 - wipe * 0.8);
        vec2 n = (s1.xy + s2.xy) * staticKeep + d1.xy + d2.xy;
        float dropMask = clamp(max(max(s1.z, s2.z) * staticKeep, max(d1.z, d2.z)), 0.0, 1.0);
        // ---- 窗底积水：雨大时水在窗框上积起一条，水面起伏并朝一侧流走 ----
        // 玻璃下面 0.38 米被窗前矮几挡住了，水线从矮几台面的高度往上涨
        float poolH = smoothstep(0.45, 1.0, rainK) * 0.075;
        float hasPool = step(0.001, poolH);
        float surf = 0.38 + poolH + (sin(g.x * 9.0 - t * 2.3) * 0.004 + sin(g.x * 23.0 + t * 3.7) * 0.0025) * hasPool;
        float under = hasPool * smoothstep(surf + 0.002, surf - 0.002, g.y);
        float meniscus = hasPool * smoothstep(0.006, 0.0, abs(g.y - surf));
        vec2 flowN = vec2(sin(g.x * 18.0 - t * 4.0 + g.y * 30.0), 0.6 * cos(g.x * 13.0 - t * 3.0 + g.y * 20.0)) * 0.16;
        n = mix(n, flowN, under);
        dropMask = max(dropMask, under * 0.35);
        // 积水上方有几道水往下淌汇入
        float rivX = fract(g.x * 1.7 + 0.3);
        float rivulet = hasPool * smoothstep(0.03, 0.0, abs(rivX - 0.5 - 0.02 * sin(g.y * 30.0))) * step(0.6, hash11(floor(g.x * 1.7 + 0.3)))
                      * smoothstep(surf + 0.25, surf, g.y) * step(surf, g.y);
        n += vec2(sign(rivX - 0.5) * 0.4, sin(g.y * 80.0 + t * 12.0) * 0.2) * rivulet;
        dropMask = max(dropMask, rivulet * 0.5);

        // ---- 下雪：边角和窗棂旁结出冰花 ----
        float frost = 0.0;
        if (uSnow > 0.001) {
          float edgeD = min(min(vUv.x, 1.0 - vUv.x) * uGlassSize.x, min(vUv.y, 1.0 - vUv.y) * uGlassSize.y);
          float mull = min(abs(vUv.x - 0.27), abs(vUv.x - 0.73)) * uGlassSize.x;
          edgeD = min(edgeD, mull * 1.4);
          edgeD -= max(0.0, 0.35 - g.y) * 0.5; // 底部结得更厚
          float warp = fbm(g * 2.5);
          float grow = (0.1 + 0.4 * (0.4 + 0.6 * uRain)) * uSnow;
          float base = smoothstep(grow, grow * 0.2, edgeD + (warp - 0.5) * 0.3);
          float c1 = fbm(g * 16.0 + warp * 3.0);
          float ridges = pow(1.0 - abs(c1 * 2.0 - 1.0), 6.0);
          frost = clamp(base * (0.6 + 0.4 * ridges) + ridges * base * 0.4, 0.0, 1.0) * uSnow;
          frost *= 1.0 - wipe * 0.9;
        }
        // 粘在玻璃上的雪花，会慢慢化掉
        vec3 flakes = staticDrops(g * 24.0 + 3.7, t * 0.35, uSnow * uRain * 0.45);
        float flake = smoothstep(0.2, 0.6, flakes.z) * uSnow;

        float clear = clamp(dropMask + trails + wipe + under, 0.0, 1.0);
        float fog = max(uFog * (1.0 - clear), frost * 0.8);

        vec2 suv = gl_FragCoord.xy / uResolution;
        vec2 aspect = vec2(uResolution.y / uResolution.x, 1.0);
        // 透镜折射：反向采样 -> 水珠里是缩小倒置的窗外世界
        vec2 ruv = suv - n * 0.032 * aspect;

        // 起雾玻璃的模糊
        float lod = fog * 4.2;
        float radius = fog * 0.012;
        float rot = hash12(floor(gl_FragCoord.xy)) * 6.2831;
        vec3 col = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 2.39996 + rot;
          float rr = sqrt((float(i) + 0.5) / 8.0) * radius;
          col += textureLod(uScene, ruv + vec2(cos(a), sin(a)) * rr * aspect, lod).rgb;
        }
        col /= 8.0;

        vec3 ambient = textureLod(uScene, suv, 7.0).rgb;

        // 凝结水汽散射室内外的光，略微发白
        vec3 fogTint = ambient * 0.35 + uInterior * 0.025 * uNight;
        col = mix(col, col * 0.7 + fogTint, fog * 0.55);

        // 水珠：边缘变暗（全反射）+ 一点高光
        vec2 nn = n / max(dropMask, 1e-3);
        float rim = smoothstep(0.45, 1.0, length(nn)) * dropMask;
        col *= 1.0 - rim * 0.55;
        float spec = smoothstep(0.32, 0.0, length(nn - vec2(-0.35, 0.4))) * dropMask;
        col += (ambient * 1.5 + uInterior * 0.12 * uNight + 0.04) * spec;

        // 积水：略暗、带一道亮的水面线
        col *= mix(1.0, 0.85, under);
        col += (ambient * 1.4 + uInterior * 0.08 * uNight + 0.04) * meniscus * 0.8;

        // 冰花：发白的散射 + 细碎的闪光
        vec3 frostCol = vec3(0.78, 0.86, 1.0) * (ambient * 1.3 + 0.06) + uInterior * 0.07 * uNight;
        col = mix(col, frostCol, frost * 0.75);
        vec2 sc = floor(g * 90.0);
        float sparkle = step(0.985, hash12(sc)) * (0.5 + 0.5 * sin(t * 3.0 + hash12(sc + 1.7) * 50.0));
        col += sparkle * frost * (ambient * 2.0 + 0.12);
        col = mix(col, vec3(0.85, 0.9, 1.0) * (ambient * 1.6 + 0.12) + uInterior * 0.1 * uNight, flake * 0.85);

        // 夜里的室内倒影：镜像相机渲染的纹理，被水珠扭曲、被雾和霜冲淡
        vec4 rp = vRefl;
        rp.xy += n * 0.025 * rp.w;
        vec3 refl = texture2DProj(tDiffuse, rp).rgb;
        col += refl * uReflect * (1.0 - fog * 0.8) * (1.0 - flake);
        col += uInterior * 0.01 * uNight * (1.0 - dropMask);
        col *= vec3(0.96, 0.99, 1.02);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  };
}
