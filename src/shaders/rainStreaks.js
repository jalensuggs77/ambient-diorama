import * as THREE from 'three';

// 窗外下落的雨丝：位置完全在顶点着色器里由时间计算，CPU 无需每帧更新。
export function createRainStreaks(count = 4000, boxMin = new THREE.Vector3(-7, -4, -14), boxSize = new THREE.Vector3(14, 11, 13.6)) {
  const positions = new Float32Array(count * 2 * 3);
  const seeds = new Float32Array(count * 2 * 4);
  const ends = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const s = [Math.random(), Math.random(), Math.random(), Math.random()];
    for (let e = 0; e < 2; e++) {
      const k = i * 2 + e;
      seeds.set(s, k * 4);
      ends[k] = e;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -7), 30);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uRain: { value: 0.7 },
      uColor: { value: new THREE.Color(0.6, 0.65, 0.8) },
      uWind: { value: 1.2 },
      uBoxMin: { value: boxMin },
      uBoxSize: { value: boxSize },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      attribute float aEnd;
      uniform float uTime, uRain, uWind;
      uniform vec3 uBoxMin, uBoxSize;
      varying float vAlpha;
      void main() {
        float speed = 13.0 + aSeed.w * 7.0;
        vec3 p = uBoxMin + aSeed.xyz * uBoxSize;
        float fall = mod(aSeed.y * uBoxSize.y - uTime * speed, uBoxSize.y);
        p.y = uBoxMin.y + fall;
        p.x += uWind * (fall / speed);
        vec3 vel = vec3(-uWind, -speed, 0.0);
        p -= vel * 0.028 * aEnd * (0.7 + uRain * 0.6);
        float visible = step(aSeed.w * 0.97 + 0.02, uRain);
        vAlpha = visible * mix(1.0, 0.0, aEnd);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(uColor * vAlpha * 0.45, 1.0);
      }
    `,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return lines;
}
