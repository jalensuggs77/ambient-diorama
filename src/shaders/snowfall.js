import * as THREE from 'three';

// 窗外飘落的雪花：和雨丝一样，位置完全在顶点着色器里由时间算出。
// 雪花下落慢、左右飘，靠近玻璃的大一些、远处的小一些。
export function createSnowfall(count = 3500, boxMin = new THREE.Vector3(-8, -5, -16), boxSize = new THREE.Vector3(16, 13, 15.6)) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) seeds.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uAmount: { value: 0 },
      uColor: { value: new THREE.Color(0.9, 0.92, 1.0) },
      uViewportH: { value: 800 },
      uBoxMin: { value: boxMin },
      uBoxSize: { value: boxSize },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime, uAmount, uViewportH;
      uniform vec3 uBoxMin, uBoxSize;
      varying float vAlpha;
      void main() {
        float speed = 0.6 + aSeed.w * 0.9;
        vec3 p = uBoxMin + aSeed.xyz * uBoxSize;
        float fall = mod(aSeed.y * uBoxSize.y - uTime * speed, uBoxSize.y);
        p.y = uBoxMin.y + fall;
        float s = aSeed.x * 40.0 + aSeed.z * 17.0;
        p.x += sin(uTime * (0.5 + aSeed.w * 0.6) + s) * 0.4 + sin(uTime * 0.17 + s) * 0.8;
        p.z += cos(uTime * (0.4 + aSeed.x * 0.5) + s) * 0.3;
        float visible = step(aSeed.w * 0.97 + 0.02, uAmount);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = visible * (0.03 + aSeed.x * 0.035) * projectionMatrix[1][1] * uViewportH * 0.5 / -mv.z;
        vAlpha = visible * (0.55 + 0.45 * aSeed.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.15, d) * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}
