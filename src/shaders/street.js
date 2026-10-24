import * as THREE from 'three';
import { hashGLSL } from './common.js';

// 楼下的街道：落地窗能看到更低的地方，这里补上湿漉漉的路面、霓虹反光和车流光带。
export function createStreetMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHorizon: { value: new THREE.Color() },
      uNight: { value: 0 },
      uNeon: { value: 0 },
      uRain: { value: 0.5 },
      uTime: { value: 0 },
      uLightning: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon;
      uniform float uNight, uNeon, uRain, uTime, uLightning;
      varying vec3 vWorld;
      ${hashGLSL}

      void main() {
        vec2 p = vWorld.xz;
        // 南北向大道与东西向小街
        float ax = (fract((p.x + 21.0) / 42.0) - 0.5) * 42.0;
        float sz = (fract(p.y / 34.0) - 0.5) * 34.0;
        float avenue = smoothstep(4.5, 3.5, abs(ax));
        float street = smoothstep(3.0, 2.2, abs(sz));
        float road = max(avenue, street);

        // 湿路面反射天空，雨越大越亮
        vec3 col = vec3(0.025, 0.022, 0.035) + uHorizon * (0.08 + 0.18 * uRain) * road;
        col += vec3(0.85, 0.2, 0.6) * road * 0.12 * uNeon;

        // 大道上的车流：一侧白色车头灯，一侧红色尾灯
        float id = floor((p.x + 21.0) / 42.0);
        float dir = ax > 0.0 ? 1.0 : -1.0;
        float laneMask = smoothstep(0.5, 0.0, abs(abs(ax) - 1.6)) * avenue;
        float flow = fract(p.y * 0.045 + uTime * 0.35 * dir + hash11(id + dir) * 7.0);
        float cars = smoothstep(0.7, 0.75, flow) * step(flow, 0.95) * step(0.3, hash12(vec2(id, floor(p.y * 0.045 + uTime * 0.35 * dir))));
        vec3 carCol = dir > 0.0 ? vec3(2.4, 2.2, 1.9) : vec3(2.4, 0.2, 0.25);
        col += carCol * cars * laneMask * (0.4 + 0.6 * uNight);

        // 街灯
        float lamp = smoothstep(0.9, 0.0, length(vec2(abs(ax) - 4.6, fract(p.y / 12.0) * 12.0 - 6.0)));
        col += vec3(1.0, 0.6, 0.3) * lamp * uNight * 1.5;

        col += vec3(0.6, 0.65, 0.8) * uLightning * 0.15;

        float dist = length(vWorld - cameraPosition);
        float fogF = 1.0 - exp(-dist * mix(0.005, 0.016, uRain));
        col = mix(col, uHorizon, fogF);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
