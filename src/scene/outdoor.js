import * as THREE from 'three';
import { createSkyMaterial } from '../shaders/sky.js';
import { createCityMaterial } from '../shaders/city.js';
import { createRainStreaks } from '../shaders/rainStreaks.js';
import { createStreetMaterial } from '../shaders/street.js';

// 窗外世界：天空、赛博朋克城市、霓虹招牌、飞行汽车与雨丝。
// 它被渲染到离屏纹理中，再由窗玻璃着色器折射显示。

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCity(rand, material) {
  const boxes = [];
  const add = (x, z, w, d, base, h) => boxes.push({ x, z, w, d, base, h });

  // 近处的两侧楼宇，框住视野
  add(-16, -22, 10, 10, -60, 75);
  add(15, -20, 9, 12, -60, 68);
  add(-10, -34, 7, 8, -60, 50);
  add(11, -38, 8, 7, -60, 54);

  // 远处的楼群
  for (let z = -45; z > -230; z -= 9 + rand() * 6) {
    const spread = 30 + (-z) * 0.55;
    for (let x = -spread; x < spread; x += 6 + rand() * 9) {
      if (rand() < 0.2) continue;
      const w = 4 + rand() * 7;
      const d = 4 + rand() * 7;
      const far = Math.min(1, -z / 200);
      // 我们住在高楼层：大多数楼顶低于视线，偶尔有超高塔楼
      let h = 16 + rand() * 26 + (rand() < 0.04 ? 30 + rand() * 40 : 0) + far * 14;
      const cx = x + rand() * 3;
      const cz = z + rand() * 4;
      add(cx, cz, w, d, -60, h);
      // 退台式顶部
      if (rand() < 0.45) {
        const h2 = 6 + rand() * 18;
        add(cx + (rand() - 0.5) * w * 0.3, cz, w * (0.45 + rand() * 0.3), d * (0.45 + rand() * 0.3), -60 + h, h2);
        h += h2;
      }
      // 天线
      if (rand() < 0.25) add(cx, cz, 0.35, 0.35, -60 + h, 4 + rand() * 10);
    }
  }

  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, material, boxes.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  boxes.forEach((b, i) => {
    m.compose(new THREE.Vector3(b.x, b.base, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
    mesh.setMatrixAt(i, m);
  });
  mesh.computeBoundingSphere();
  mesh.frustumCulled = false;
  return mesh;
}

function makeSignTexture(text, color, vertical) {
  const canvas = document.createElement('canvas');
  const cw = vertical ? 128 : 512;
  const ch = vertical ? 128 * text.length + 32 : 160;
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext('2d');
  g.fillStyle = 'rgba(8,4,16,0.92)';
  g.fillRect(0, 0, cw, ch);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.strokeRect(10, 10, cw - 20, ch - 20);
  g.fillStyle = '#ffffff';
  g.font = `bold ${vertical ? 92 : 110}px "PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Microsoft YaHei",sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let pass = 0; pass < 2; pass++) {
    g.shadowBlur = pass === 0 ? 30 : 8;
    g.fillStyle = pass === 0 ? color : '#fff6ff';
    if (vertical) {
      [...text].forEach((c, i) => g.fillText(c, cw / 2, 16 + 64 + i * 128));
    } else {
      g.fillText(text, cw / 2, ch / 2 + 6);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: cw / ch };
}

function buildSigns() {
  const defs = [
    { text: '雨夜', color: '#ff2fa8', vertical: true, pos: [2.3, 0.5, -5.5], rotY: -0.45, h: 3.0 },
    { text: '拉面', color: '#29e6ff', vertical: true, pos: [-11, 2, -16.9], rotY: 0, h: 6 },
    { text: '電脳', color: '#b86bff', vertical: true, pos: [10.4, 6, -14.9], rotY: 0, h: 6.5 },
    { text: 'NEON 24H', color: '#ff4f6d', vertical: false, pos: [-6.5, 9, -29.9], rotY: 0, h: 2.4 },
    { text: '酒場', color: '#ffb02e', vertical: true, pos: [6, -6, -34.4], rotY: 0, h: 5 },
    { text: 'SYNTH', color: '#29e6ff', vertical: false, pos: [-2, 22, -60], rotY: 0, h: 4.5 },
  ];
  const group = new THREE.Group();
  const signs = defs.map((d, i) => {
    const { tex, aspect } = makeSignTexture(d.text, d.color, d.vertical);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.2, 2.2, 2.2), fog: true });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(d.h * aspect, d.h), mat);
    mesh.position.set(...d.pos);
    mesh.rotation.y = d.rotY;
    group.add(mesh);
    return { mesh, mat, seed: i * 1.7 + 0.3, glitch: 0 };
  });
  return { group, signs };
}

function buildTraffic(rand) {
  const count = 46;
  const geo = new THREE.BoxGeometry(0.9, 0.22, 0.35);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  const cars = [];
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const lane = Math.floor(rand() * 6);
    const dir = lane % 2 === 0 ? 1 : -1;
    const car = {
      x: (rand() - 0.5) * 160,
      y: -6 + lane * 4 + rand() * 1.5,
      z: -22 - lane * 9 - rand() * 4,
      speed: (8 + rand() * 10) * dir,
    };
    cars.push(car);
    // 迎面是白色车头灯，远离是红色尾灯
    col.setRGB(dir > 0 ? 3 : 2.5, dir > 0 ? 2.8 : 0.25, dir > 0 ? 2.4 : 0.3);
    if (rand() < 0.15) col.setRGB(0.4, 2.4, 3);
    mesh.setColorAt(i, col);
  }
  return { mesh, cars };
}

export class Outdoor {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x1c0f33, 0.01);
    const rand = mulberry32(20261024);

    this.skyMat = createSkyMaterial();
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);

    this.cityMat = createCityMaterial();
    this.city = buildCity(rand, this.cityMat);
    this.scene.add(this.city);

    const { group, signs } = buildSigns();
    this.signs = signs;
    this.scene.add(group);

    this.streetMat = createStreetMaterial();
    const street = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), this.streetMat);
    street.rotation.x = -Math.PI / 2;
    street.position.set(0, -60, -300);
    this.scene.add(street);

    this.traffic = buildTraffic(rand);
    this.scene.add(this.traffic.mesh);

    this.rain = createRainStreaks();
    this.scene.add(this.rain);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this._p = new THREE.Vector3();
  }

  update(t, dt, env, rain, lightning) {
    const sky = this.skyMat.uniforms;
    sky.uTop.value.copy(env.skyTop);
    sky.uHorizon.value.copy(env.skyHorizon);
    sky.uSunDir.value.copy(env.sunDir);
    sky.uMoonDir.value.copy(env.moonDir);
    sky.uSunColor.value.copy(env.sunColor);
    sky.uTime.value = t;
    sky.uRain.value = rain;
    sky.uNight.value = env.night;
    sky.uDay.value = env.day;
    sky.uTwilight.value = env.twilight;
    sky.uLightning.value = lightning;

    const city = this.cityMat.uniforms;
    city.uSunDir.value.copy(env.keyDir);
    city.uKeyColor.value.copy(env.keyColor);
    city.uKeyIntensity.value = env.keyIntensity;
    city.uSkyTop.value.copy(env.skyTop);
    city.uHorizon.value.copy(env.skyHorizon);
    city.uNight.value = env.night;
    city.uNeon.value = env.neon;
    city.uRain.value = rain;
    city.uTime.value = t;
    city.uLightning.value = lightning;

    const st = this.streetMat.uniforms;
    st.uHorizon.value.copy(env.skyHorizon);
    st.uNight.value = env.night;
    st.uNeon.value = env.neon;
    st.uRain.value = rain;
    st.uTime.value = t;
    st.uLightning.value = lightning;

    this.scene.fog.color.copy(env.skyHorizon);
    this.scene.fog.density = 0.006 + rain * 0.012;

    // 霓虹招牌闪烁，偶尔故障
    for (const s of this.signs) {
      if (Math.random() < dt * 0.15) s.glitch = 0.25 + Math.random() * 0.4;
      s.glitch = Math.max(0, s.glitch - dt);
      const off = s.glitch > 0 && Math.sin(t * 60 + s.seed * 10) > 0 ? 0.15 : 1;
      const k = (0.35 + 1.9 * env.neon) * off * (0.93 + 0.07 * Math.sin(t * 9 + s.seed));
      s.mat.color.setScalar(k);
    }

    // 飞行汽车
    const { mesh, cars } = this.traffic;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      c.x += c.speed * dt;
      if (c.x > 90) c.x -= 180;
      if (c.x < -90) c.x += 180;
      this._p.set(c.x, c.y + Math.sin(t * 0.7 + i) * 0.3, c.z);
      this._m.compose(this._p, this._q, this._s);
      mesh.setMatrixAt(i, this._m);
    }
    mesh.instanceMatrix.needsUpdate = true;

    // 雨丝
    const r = this.rain.material.uniforms;
    r.uTime.value = t;
    r.uRain.value = rain;
    r.uColor.value.copy(env.skyHorizon).multiplyScalar(0.9).addScalar(0.08 + lightning * 0.8);
    r.uColor.value.r += 0.12 * env.neon;
    r.uColor.value.b += 0.1 * env.neon;
  }
}
