import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { createRainGlassMaterial } from '../shaders/rainGlass.js';

RectAreaLightUniformsLib.init();

// 室内：低多边形的赛博朋克公寓窗台角落。
// 可点击物体：窗玻璃（雨声）、壁炉、收音机、风铃、猫咪。

// 落地窗：从地板一直到天花板
export const WINDOW = {
  x0: -1.72,
  x1: 1.76,
  y0: 0.04,
  y1: 3.2,
  glassZ: -0.15,
};
// 窗前矮几的台面高度（收音机、盆栽等摆在上面）
export const BENCH_Y = 0.42;
WINDOW.cx = (WINDOW.x0 + WINDOW.x1) / 2;
WINDOW.cy = (WINDOW.y0 + WINDOW.y1) / 2;
WINDOW.w = WINDOW.x1 - WINDOW.x0;
WINDOW.h = WINDOW.y1 - WINDOW.y0;

const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, ...opts });

function mesh(geo, material, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** 以最小/最大坐标创建方块 */
function slab(material, parent, x0, y0, z0, x1, y1, z1) {
  return mesh(
    new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0),
    material,
    parent,
    (x0 + x1) / 2,
    (y0 + y1) / 2,
    (z0 + z1) / 2,
  );
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeRand(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export class Room {
  constructor(sceneTexture) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.interactive = {};
    this.active = {};
    this.hovered = null;
    this.rand = makeRand(7);

    this.buildShell();
    this.buildWindow(sceneTexture);
    this.buildLights();
    this.buildFireplace();
    this.buildRadio();
    this.buildChime();
    this.buildCabinetAndCat();
    this.buildDecor();
  }

  // ---------- 房间结构 ----------
  buildShell() {
    const s = this.scene;
    const wallMat = mat(0x3a4060);
    const wallMat2 = mat(0x343955);
    const ceilMat = mat(0x262a3e);
    const { x0, x1, y0, y1 } = WINDOW;

    // 地板：一条条木板
    const plankColors = [0x5b3d2a, 0x553826, 0x62432e, 0x4f3423];
    for (let i = 0; i < 12; i++) {
      const px = -3.6 + i * 0.6;
      const m = mat(plankColors[i % plankColors.length], { roughness: 0.7 });
      slab(m, s, px, -0.1, -0.3, px + 0.6, 0, 6.8).castShadow = false;
    }
    slab(ceilMat, s, -3.7, 3.3, -0.3, 3.7, 3.4, 6.8);
    slab(wallMat2, s, -3.7, 0, -0.3, -3.6, 3.3, 6.8);
    slab(wallMat2, s, 3.6, 0, -0.3, 3.7, 3.3, 6.8);
    slab(wallMat2, s, -3.7, 0, 6.7, 3.7, 3.3, 6.8);

    // 带窗洞的窗墙（墙体会挡住阳光，只让光从窗洞照进来）
    slab(wallMat, s, -3.6, 0, -0.3, 3.6, y0, 0);
    slab(wallMat, s, -3.6, y1, -0.3, 3.6, 3.3, 0);
    slab(wallMat, s, -3.6, y0, -0.3, x0, y1, 0);
    slab(wallMat, s, x1, y0, -0.3, 3.6, y1, 0);

    // 踢脚线
    const trim = mat(0x171a26);
    slab(trim, s, -3.6, 0, 0, -3.4, 0.12, 0.03);
    slab(trim, s, -1.9, 0, 0, x0, 0.12, 0.03);
    slab(trim, s, x1, 0, 0, 1.85, 0.12, 0.03);
  }

  buildWindow(sceneTexture) {
    const s = this.scene;
    const { x0, x1, y0, y1, glassZ, cx, cy, w, h } = WINDOW;

    // 擦拭雾气的画布纹理
    this.wipeCanvas = document.createElement('canvas');
    this.wipeCanvas.width = 512;
    this.wipeCanvas.height = Math.round(512 * (h / w));
    this.wipeCtx = this.wipeCanvas.getContext('2d');
    this.wipeCtx.fillStyle = '#000';
    this.wipeCtx.fillRect(0, 0, this.wipeCanvas.width, this.wipeCanvas.height);
    this.wipeTexture = new THREE.CanvasTexture(this.wipeCanvas);
    this.wipeFadeTimer = 0;

    this.glassMat = createRainGlassMaterial(sceneTexture, this.wipeTexture, new THREE.Vector2(w, h));
    this.glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.glassMat);
    this.glass.position.set(cx, cy, glassZ);
    this.glass.userData.trackId = 'rain';
    s.add(this.glass);
    this.interactive.rain = this.glass;

    // 窗框
    const frame = mat(0x101119, { roughness: 0.5, metalness: 0.4 });
    const t = 0.07;
    const fz0 = glassZ - 0.04;
    const fz1 = glassZ + 0.05;
    slab(frame, s, x0, y0, fz0, x1, y0 + t, fz1);
    slab(frame, s, x0, y1 - t, fz0, x1, y1, fz1);
    slab(frame, s, x0, y0, fz0, x0 + t, y1, fz1);
    slab(frame, s, x1 - t, y0, fz0, x1, y1, fz1);
    // 两根竖梃把落地窗分成三扇，中间一扇最宽
    for (const mx of [x0 + w * 0.27, x1 - w * 0.27]) slab(frame, s, mx - 0.025, y0, fz0, mx + 0.025, y1, fz1);

    // 窗前的矮几：长条木板 + 两个木墩，上面摆着收音机和小物件
    const bench = mat(0x8a6548, { roughness: 0.7 });
    const benchLeg = mat(0x6d4e37);
    slab(bench, s, x0 + 0.05, BENCH_Y - 0.05, 0.05, x1 - 0.05, BENCH_Y, 0.52);
    slab(benchLeg, s, x0 + 0.2, 0, 0.1, x0 + 0.5, BENCH_Y - 0.05, 0.47);
    slab(benchLeg, s, x1 - 0.5, 0, 0.1, x1 - 0.2, BENCH_Y - 0.05, 0.47);
    // 坐垫：坐在这里看雨
    const seat = mesh(new THREE.BoxGeometry(0.7, 0.07, 0.42), mat(0x2f6f6f, { roughness: 1 }), s, -0.3, BENCH_Y + 0.035, 0.29);
    seat.rotation.y = 0.05;
  }

  buildLights() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0x8899cc, 0x2a1a10, 0.3);
    s.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xffffff, 1);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = -6;
    sc.right = 6;
    sc.top = 6;
    sc.bottom = -6;
    sc.near = 0.5;
    sc.far = 40;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.key.target.position.set(0, 0.8, 1.8);
    s.add(this.key, this.key.target);

    // 窗户本身是一块面光源：白天是天光，夜里是城市的霓虹辉光
    this.windowLight = new THREE.RectAreaLight(0xffffff, 1, WINDOW.w, WINDOW.h);
    this.windowLight.position.set(WINDOW.cx, WINDOW.cy, WINDOW.glassZ + 0.02);
    this.windowLight.lookAt(WINDOW.cx, WINDOW.cy - 0.4, 4);
    s.add(this.windowLight);

    // 窗外霓虹透进来的彩色光
    this.neonSpillA = new THREE.PointLight(0xff2fa8, 0, 9, 1.6);
    this.neonSpillA.position.set(1.4, 2.4, -1.4);
    this.neonSpillB = new THREE.PointLight(0x29e6ff, 0, 9, 1.6);
    this.neonSpillB.position.set(-1.0, 1.6, -1.6);
    s.add(this.neonSpillA, this.neonSpillB);

    // 天花板灯带
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(7.1, 0.03, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3fb4, emissiveIntensity: 2.5 }),
    );
    strip.position.set(0, 3.27, 0.03);
    s.add(strip);
    this.stripMat = strip.material;
    this.stripLight = new THREE.PointLight(0xff3fb4, 0.6, 6, 2);
    this.stripLight.position.set(0, 3.1, 0.4);
    s.add(this.stripLight);
  }

  // ---------- 壁炉 ----------
  buildFireplace() {
    const g = new THREE.Group();
    g.userData.trackId = 'fire';
    g.userData.hoverScale = false;
    this.scene.add(g);
    this.interactive.fire = g;
    const brick = mat(0x7a3a2c);
    const brickDark = mat(0x5e2b22);
    const stone = mat(0x55525a);
    const x0 = -3.4;
    const x1 = -1.9;
    const z1 = 0.6;
    const ox0 = -3.0;
    const ox1 = -2.3;
    const oy0 = 0.28;
    const oy1 = 1.0;

    slab(brick, g, x0, 0, 0, ox0, 3.3, z1);
    slab(brick, g, ox1, 0, 0, x1, 3.3, z1);
    slab(brick, g, ox0, 0, 0, ox1, oy0, z1);
    slab(brick, g, ox0, oy1, 0, ox1, 3.3, z1);
    slab(mat(0x120c0c), g, ox0, oy0, 0.001, ox1, oy1, 0.05);
    // 炉膛内部的烟熏
    slab(mat(0x1b1210), g, ox0, oy0, 0, ox0 + 0.02, oy1, z1 - 0.02);
    slab(mat(0x1b1210), g, ox1 - 0.02, oy0, 0, ox1, oy1, z1 - 0.02);
    // 炉前石台与壁炉架
    slab(stone, g, x0 - 0.05, 0, z1, x1 + 0.05, 0.1, z1 + 0.4);
    slab(mat(0x3b2a20, { roughness: 0.6 }), g, x0 - 0.08, 1.05, -0.02, x1 + 0.08, 1.13, z1 + 0.12);

    // 凸出的砖块细节
    for (let i = 0; i < 26; i++) {
      const bx = x0 + 0.1 + this.rand() * (x1 - x0 - 0.3);
      const by = 0.15 + this.rand() * 3.0;
      if (bx > ox0 - 0.1 && bx < ox1 && by > oy0 - 0.1 && by < 1.2) continue;
      slab(this.rand() > 0.5 ? brickDark : brick, g, bx, by, z1, bx + 0.22, by + 0.08, z1 + 0.015);
    }

    // 木柴
    const logMat = mat(0x3d2416);
    const emberMat = new THREE.MeshStandardMaterial({
      color: 0x2a1208,
      emissive: 0xff3a0a,
      emissiveIntensity: 1.2,
      flatShading: true,
    });
    this.emberMat = emberMat;
    const logGeo = new THREE.CylinderGeometry(0.05, 0.055, 0.55, 6);
    const logs = [
      [-2.65, oy0 + 0.05, 0.3, 0, 0, Math.PI / 2 + 0.1],
      [-2.65, oy0 + 0.05, 0.42, 0, 0.25, Math.PI / 2 - 0.1],
      [-2.65, oy0 + 0.13, 0.36, 0, -0.3, Math.PI / 2],
    ];
    logs.forEach(([x, y, z, rx, ry, rz], i) => {
      const l = mesh(logGeo, i === 2 ? emberMat : logMat, g, x, y, z);
      l.rotation.set(rx, ry, rz);
    });
    const coals = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), emberMat);
    coals.scale.set(1.6, 0.25, 0.8);
    coals.position.set(-2.65, oy0 + 0.01, 0.36);
    g.add(coals);

    // 火焰：低多边形锥体，叠加混合
    this.flames = [];
    const flameColors = [0xff4a12, 0xff7a1a, 0xffb43a, 0xffe08a];
    for (let i = 0; i < 9; i++) {
      const core = i >= 6;
      const geo = new THREE.ConeGeometry(core ? 0.05 : 0.08 + this.rand() * 0.04, 1, 5, 1, true);
      geo.translate(0, 0.5, 0);
      const fm = new THREE.MeshBasicMaterial({
        color: new THREE.Color(flameColors[core ? 3 : i % 3]).multiplyScalar(core ? 3 : 2.2),
        transparent: true,
        opacity: core ? 0.9 : 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const f = new THREE.Mesh(geo, fm);
      const bx = -2.65 + (core ? (i - 7) * 0.08 : (i - 2.5) * 0.09);
      f.position.set(bx, oy0 + 0.12, 0.34 + (this.rand() - 0.5) * 0.12);
      f.userData = { base: core ? 0.22 : 0.3 + this.rand() * 0.18, seed: this.rand() * 100, bx };
      g.add(f);
      this.flames.push(f);
    }

    // 火星粒子
    const n = 60;
    this.sparkData = Array.from({ length: n }, () => ({ life: 0, vx: 0, vy: 0, vz: 0 }));
    const pos = new Float32Array(n * 3).fill(-100);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparks = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        color: new THREE.Color(3, 1.4, 0.4),
        size: 0.025,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);

    this.fireLight = new THREE.PointLight(0xff7a30, 0, 7, 2);
    this.fireLight.position.set(-2.65, 0.7, 0.95);
    this.fireLight.castShadow = false;
    this.scene.add(this.fireLight);
    this.fireLevel = 0;

    // 壁炉架上的小物件
    const candle = mat(0xf0e6d0);
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 6), candle, this.scene, -3.2, 1.2, 0.35);
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 6), candle, this.scene, -3.1, 1.18, 0.42);
    const frameM = mesh(new THREE.BoxGeometry(0.3, 0.24, 0.03), mat(0x1a1a22), this.scene, -2.35, 1.26, 0.2);
    frameM.rotation.x = -0.15;
    const photo = canvasTexture(64, 48, (c, w, h) => {
      const grd = c.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#ff9a6b');
      grd.addColorStop(1, '#5a3b8c');
      c.fillStyle = grd;
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#20132e';
      c.beginPath();
      c.moveTo(0, h);
      c.lineTo(18, 26);
      c.lineTo(34, 36);
      c.lineTo(50, 20);
      c.lineTo(64, 34);
      c.lineTo(64, 48);
      c.fill();
    });
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.18), new THREE.MeshStandardMaterial({ map: photo }));
    pm.position.set(0, 0, 0.016);
    frameM.add(pm);
  }

  // ---------- 收音机 ----------
  buildRadio() {
    const g = new THREE.Group();
    g.userData.trackId = 'radio';
    g.position.set(1.05, BENCH_Y, 0.28);
    g.rotation.y = -0.22;
    this.scene.add(g);
    this.interactive.radio = g;

    const body = mat(0x2f8f87, { roughness: 0.55 });
    const cream = mat(0xe8dcc0, { roughness: 0.6 });
    const dark = mat(0x15161c, { roughness: 0.9 });
    mesh(new THREE.BoxGeometry(0.5, 0.28, 0.2), body, g, 0, 0.16, 0);
    mesh(new THREE.BoxGeometry(0.52, 0.03, 0.21), cream, g, 0, 0.3, 0);
    mesh(new THREE.BoxGeometry(0.52, 0.03, 0.21), cream, g, 0, 0.02, 0);

    // 扬声器
    const speaker = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 10), dark, g, -0.11, 0.16, 0.1);
    speaker.rotation.x = Math.PI / 2;
    this.speaker = speaker;
    const ring = mesh(new THREE.TorusGeometry(0.092, 0.01, 4, 10), cream, g, -0.11, 0.16, 0.105);
    ring.castShadow = false;
    for (let i = -2; i <= 2; i++) {
      const bar = mesh(new THREE.BoxGeometry(0.16, 0.006, 0.006), body, g, -0.11, 0.16 + i * 0.03, 0.112);
      bar.castShadow = false;
    }

    // 调频刻度窗
    this.dialMat = new THREE.MeshStandardMaterial({
      color: 0x2a1d08,
      emissive: 0xffa53a,
      emissiveIntensity: 0,
      map: canvasTexture(128, 48, (c, w, h) => {
        c.fillStyle = '#fff1d0';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#5a3a10';
        c.font = '10px monospace';
        for (let i = 0; i < 9; i++) {
          c.fillRect(8 + i * 14, 28, 1, i % 2 ? 6 : 10);
          if (i % 2 === 0) c.fillText(String(88 + i * 2), 3 + i * 14, 20);
        }
      }),
    });
    this.dialMat.emissiveMap = this.dialMat.map;
    const dial = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.065), this.dialMat);
    dial.position.set(0.12, 0.2, 0.101);
    g.add(dial);
    this.needle = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.055, 0.004), new THREE.MeshBasicMaterial({ color: 0xd8202a }));
    this.needle.position.set(0.1, 0.2, 0.104);
    g.add(this.needle);

    const knobGeo = new THREE.CylinderGeometry(0.025, 0.028, 0.03, 8);
    [0.07, 0.17].forEach((x) => {
      const k = mesh(knobGeo, cream, g, x, 0.1, 0.11);
      k.rotation.x = Math.PI / 2;
    });
    // 提手与天线
    const handle = mesh(new THREE.TorusGeometry(0.14, 0.014, 4, 10, Math.PI), dark, g, 0, 0.31, 0);
    handle.castShadow = true;
    const ant = mesh(new THREE.CylinderGeometry(0.005, 0.007, 0.55, 5), mat(0xc0c4cc, { metalness: 0.8, roughness: 0.3 }), g, 0.27, 0.5, -0.04);
    ant.rotation.z = -0.45;
    mesh(new THREE.IcosahedronGeometry(0.012, 0), cream, g, 0.39, 0.75, -0.04);

    this.radioLight = new THREE.PointLight(0xffa53a, 0, 1.6, 2);
    this.radioLight.position.set(0.1, 0.2, 0.3);
    g.add(this.radioLight);
    this.radioPulse = 0;
  }

  // ---------- 风铃 ----------
  buildChime() {
    const g = new THREE.Group();
    g.userData.trackId = 'chime';
    const hang = new THREE.Vector3(-0.85, 2.82, 0.22);
    g.position.copy(hang);
    this.scene.add(g);
    this.interactive.chime = g;

    // 天花板上的挂钩
    slab(mat(0x15161c), this.scene, hang.x - 0.015, 3.26, hang.z - 0.015, hang.x + 0.015, 3.3, hang.z + 0.015);

    const metal = mat(0xb8c2d0, { metalness: 0.75, roughness: 0.28, flatShading: true });
    const lineMat = new THREE.LineBasicMaterial({ color: 0x0c0c10 });
    const line = (a, b, parent) => {
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      parent.add(new THREE.Line(geo, lineMat));
    };

    this.chimeSwing = new THREE.Group();
    g.add(this.chimeSwing);
    line(new THREE.Vector3(0, 3.27 - hang.y, 0), new THREE.Vector3(0, 0, 0), this.chimeSwing);
    line(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.3, 0), this.chimeSwing);
    const cap = mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.03, 8), mat(0x6b4a33), this.chimeSwing, 0, -0.31, 0);
    cap.castShadow = true;

    this.rods = [];
    const lengths = [0.34, 0.3, 0.27, 0.24, 0.21];
    lengths.forEach((len, i) => {
      const a = (i / lengths.length) * Math.PI * 2 + 0.3;
      const pivot = new THREE.Group();
      pivot.position.set(Math.cos(a) * 0.065, -0.33, Math.sin(a) * 0.065);
      this.chimeSwing.add(pivot);
      line(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.05, 0), pivot);
      const rod = mesh(new THREE.CylinderGeometry(0.011, 0.011, len, 6), metal, pivot, 0, -0.05 - len / 2, 0);
      rod.castShadow = true;
      this.rods.push({ pivot, ax: 0, az: 0, vx: 0, vz: 0, angle: a });
    });

    // 中心击锤 + 纸签
    line(new THREE.Vector3(0, -0.32, 0), new THREE.Vector3(0, -0.72, 0), this.chimeSwing);
    mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 8), mat(0x6b4a33), this.chimeSwing, 0, -0.5, 0);
    const paperTex = canvasTexture(64, 192, (c, w, h) => {
      c.fillStyle = '#f2e3c4';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#c0392b';
      c.font = 'bold 44px "PingFang SC","Noto Sans CJK SC","Microsoft YaHei",serif';
      c.textAlign = 'center';
      c.fillText('風', w / 2, 70);
      c.fillText('鈴', w / 2, 130);
    });
    this.paper = new THREE.Mesh(
      new THREE.PlaneGeometry(0.07, 0.21),
      new THREE.MeshStandardMaterial({ map: paperTex, side: THREE.DoubleSide, roughness: 0.9 }),
    );
    this.paper.geometry.translate(0, -0.105, 0);
    this.paper.position.set(0, -0.72, 0);
    this.paper.castShadow = true;
    this.chimeSwing.add(this.paper);
    this.gust = 0.2;
  }

  // ---------- 矮柜、台灯与猫 ----------
  buildCabinetAndCat() {
    const s = this.scene;
    const wood = mat(0x3b2c3f, { roughness: 0.7 });
    slab(wood, s, 1.85, 0, 0, 3.35, 0.78, 0.55);
    slab(mat(0x4a3850), s, 1.83, 0.78, -0.01, 3.37, 0.81, 0.57);
    const knob = mat(0xd4af6a, { metalness: 0.6, roughness: 0.4 });
    [0.25, 0.55].forEach((y) => {
      slab(mat(0x33263a), s, 1.92, y - 0.12, 0.55, 2.58, y + 0.12, 0.565);
      slab(mat(0x33263a), s, 2.62, y - 0.12, 0.55, 3.28, y + 0.12, 0.565);
      slab(knob, s, 2.22, y - 0.015, 0.565, 2.28, y + 0.015, 0.585);
      slab(knob, s, 2.92, y - 0.015, 0.565, 2.98, y + 0.015, 0.585);
    });

    // 台灯
    const lampBase = mat(0x1d1d24, { metalness: 0.4, roughness: 0.5 });
    mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.03, 8), lampBase, s, 3.1, 0.825, 0.25);
    mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 5), lampBase, s, 3.1, 1.0, 0.25);
    this.shadeMat = new THREE.MeshStandardMaterial({
      color: 0xf0c890,
      emissive: 0xffb060,
      emissiveIntensity: 0.6,
      side: THREE.DoubleSide,
      flatShading: true,
    });
    const shade = mesh(new THREE.CylinderGeometry(0.09, 0.17, 0.18, 8, 1, true), this.shadeMat, s, 3.1, 1.2, 0.25);
    shade.castShadow = false;
    this.lampLight = new THREE.PointLight(0xffb36b, 0, 5, 2);
    this.lampLight.position.set(3.1, 1.12, 0.3);
    this.lampLight.castShadow = true;
    this.lampLight.shadow.mapSize.set(512, 512);
    this.lampLight.shadow.bias = -0.002;
    s.add(this.lampLight);

    // 猫
    const g = new THREE.Group();
    g.userData.trackId = 'cat';
    g.position.set(2.45, 0.81, 0.3);
    g.rotation.y = 0.35;
    s.add(g);
    this.interactive.cat = g;

    const cushion = mesh(new THREE.CylinderGeometry(0.3, 0.33, 0.07, 8), mat(0x6a3d8f), g, 0, 0.035, 0);
    cushion.scale.z = 0.8;
    const fur = mat(0xd98a3a, { roughness: 0.95 });
    const furDark = mat(0xa8622a, { roughness: 0.95 });
    const furLight = mat(0xf2d2a8, { roughness: 0.95 });

    this.catBody = new THREE.Group();
    this.catBody.position.set(0, 0.07, 0);
    g.add(this.catBody);
    const body = mesh(new THREE.IcosahedronGeometry(0.2, 1), fur, this.catBody, 0, 0.1, 0);
    body.scale.set(1.25, 0.6, 0.95);
    const back = mesh(new THREE.IcosahedronGeometry(0.12, 0), furDark, this.catBody, -0.06, 0.17, -0.06);
    back.scale.set(1.4, 0.45, 1.1);

    this.catHead = new THREE.Group();
    this.catHead.position.set(0.2, 0.1, 0.1);
    this.catHead.rotation.set(0.1, 0.5, -0.25);
    this.catBody.add(this.catHead);
    const head = mesh(new THREE.IcosahedronGeometry(0.105, 0), fur, this.catHead, 0, 0, 0);
    head.scale.set(1.1, 0.9, 1);
    mesh(new THREE.IcosahedronGeometry(0.05, 0), furLight, this.catHead, 0.07, -0.03, 0.03).scale.set(0.8, 0.7, 1);
    const earGeo = new THREE.ConeGeometry(0.035, 0.07, 4);
    this.ears = [-1, 1].map((side) => {
      const e = mesh(earGeo, furDark, this.catHead, 0.0, 0.085, side * 0.055);
      e.rotation.x = side * 0.35;
      return e;
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x2a1a10 });
    [-1, 1].forEach((side) => {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.006, 0.03), eyeMat);
      eye.position.set(0.1, 0.015, side * 0.04);
      eye.rotation.y = side * 0.2;
      this.catHead.add(eye);
    });

    const tail = mesh(new THREE.TorusGeometry(0.17, 0.035, 5, 10, Math.PI * 1.1), fur, this.catBody, 0, 0.04, 0);
    tail.rotation.x = Math.PI / 2;
    tail.rotation.z = 0.2;
    this.catTail = tail;

    // 呼噜时飘起的小音符
    this.zzz = [];
    const noteTex = canvasTexture(64, 64, (c) => {
      c.fillStyle = '#ffd9f0';
      c.font = 'bold 48px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.shadowColor = '#ff4fb8';
      c.shadowBlur = 10;
      c.fillText('z', 32, 34);
    });
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTex, transparent: true, opacity: 0, depthWrite: false }));
      sp.scale.setScalar(0.08);
      sp.position.set(0.25, 0.3, 0.1);
      g.add(sp);
      this.zzz.push({ sprite: sp, offset: i / 3 });
    }
  }

  // ---------- 其他装饰 ----------
  buildDecor() {
    const s = this.scene;
    // 窗台上的盆栽
    const pot = mat(0xb5654a);
    mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.14, 7), pot, s, -1.35, BENCH_Y + 0.07, 0.3);
    const leaf = mat(0x3f8f5a, { roughness: 0.8 });
    const leaf2 = mat(0x2f6f47, { roughness: 0.8 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const l = mesh(new THREE.ConeGeometry(0.035, 0.28 + this.rand() * 0.1, 4), i % 2 ? leaf : leaf2, s,
        -1.35 + Math.cos(a) * 0.04, BENCH_Y + 0.28, 0.3 + Math.sin(a) * 0.04);
      l.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
    }
    // 马克杯
    const mug = mat(0xe9e2d6);
    mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 8), mug, s, 0.25, BENCH_Y + 0.05, 0.36);
    const handle = mesh(new THREE.TorusGeometry(0.025, 0.008, 4, 6), mug, s, 0.3, BENCH_Y + 0.055, 0.36);
    handle.rotation.y = 0;
    // 书堆
    const bookColors = [0x8c2f39, 0x2d4a7a, 0xd9a441];
    bookColors.forEach((c, i) => {
      const b = mesh(new THREE.BoxGeometry(0.28, 0.04, 0.2), mat(c), s, 0.55, BENCH_Y + 0.02 + i * 0.04, 0.3);
      b.rotation.y = (i - 1) * 0.12;
    });

    // 置物架与书
    slab(mat(0x2b2030), s, 1.95, 1.75, 0, 3.3, 1.79, 0.28);
    let bx = 2.0;
    const palette = [0xd9a441, 0x2d4a7a, 0x8c2f39, 0x3f8f5a, 0xe8dcc0, 0x6a3d8f];
    while (bx < 3.15) {
      const w = 0.04 + this.rand() * 0.04;
      const h = 0.18 + this.rand() * 0.1;
      const b = slab(mat(palette[Math.floor(this.rand() * palette.length)]), s, bx, 1.79, 0.03, bx + w, 1.79 + h, 0.24);
      if (this.rand() < 0.15) b.rotation.z = 0.2;
      bx += w + 0.005;
    }

    // 墙上的霓虹小招牌
    const neonTex = canvasTexture(256, 128, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.strokeStyle = '#29e6ff';
      c.lineWidth = 5;
      c.shadowColor = '#29e6ff';
      c.shadowBlur = 16;
      c.font = 'bold 84px "PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.strokeText('LO·FI', w / 2, h / 2 + 4);
    });
    this.neonSignMat = new THREE.MeshBasicMaterial({ map: neonTex, transparent: true, color: new THREE.Color(2, 2, 2), depthWrite: false });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), this.neonSignMat);
    sign.position.set(2.62, 2.35, 0.02);
    s.add(sign);
    this.neonSignLight = new THREE.PointLight(0x29e6ff, 0.5, 2.5, 2);
    this.neonSignLight.position.set(2.62, 2.35, 0.4);
    s.add(this.neonSignLight);

    // 地毯和矮桌
    const rug = mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.02, 10), mat(0x1f4f5a), s, 0.1, 0.01, 2.3);
    rug.scale.z = 0.65;
    rug.castShadow = false;
    const rug2 = mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.022, 10), mat(0x2f6f6f), s, 0.1, 0.012, 2.3);
    rug2.scale.z = 0.65;
    rug2.castShadow = false;
    const tableMat = mat(0x6d4e37, { roughness: 0.6 });
    slab(tableMat, s, -0.55, 0.32, 1.95, 0.55, 0.37, 2.55);
    [[-0.5, 2.0], [0.5, 2.0], [-0.5, 2.5], [0.5, 2.5]].forEach(([x, z]) =>
      slab(tableMat, s, x - 0.03, 0, z - 0.03, x + 0.03, 0.32, z + 0.03));
    // 茶壶和茶杯
    const teapot = mat(0x2a5d4f, { roughness: 0.4 });
    const tp = mesh(new THREE.IcosahedronGeometry(0.09, 1), teapot, s, -0.15, 0.44, 2.25);
    tp.scale.y = 0.8;
    const spout = mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.1, 5), teapot, s, -0.05, 0.47, 2.25);
    spout.rotation.z = -0.9;
    mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.04, 7), mug, s, 0.15, 0.39, 2.3);
    mesh(new THREE.BoxGeometry(0.22, 0.03, 0.3), mat(0x8c2f39), s, 0.3, 0.385, 2.15).rotation.y = 0.4;

    // 地板坐垫
    const cush = mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.12, 8), mat(0x8a3a5c), s, -1.2, 0.06, 2.6);
    cush.scale.z = 0.85;
  }

  // ---------- 交互状态 ----------
  setActive(id, on) {
    this.active[id] = on;
  }

  setHover(id) {
    if (this.hovered === id) return;
    this.hovered = id;
  }

  wipeAt(uv, radiusPx = 26) {
    const c = this.wipeCtx;
    const x = uv.x * this.wipeCanvas.width;
    const y = (1 - uv.y) * this.wipeCanvas.height;
    const grd = c.createRadialGradient(x, y, 0, x, y, radiusPx);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.85)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = grd;
    c.beginPath();
    c.arc(x, y, radiusPx, 0, Math.PI * 2);
    c.fill();
    this.wipeTexture.needsUpdate = true;
  }

  chimeStrike(i, strength = 1) {
    const r = this.rods[i % this.rods.length];
    if (!r) return;
    r.vx += (Math.random() - 0.5) * 3 * strength;
    r.vz += (Math.random() - 0.5) * 3 * strength;
  }

  spawnSparks(count = 4) {
    const pos = this.sparks.geometry.attributes.position;
    let spawned = 0;
    for (let i = 0; i < this.sparkData.length && spawned < count; i++) {
      const s = this.sparkData[i];
      if (s.life > 0) continue;
      s.life = 0.6 + Math.random() * 0.9;
      s.vx = (Math.random() - 0.5) * 0.25;
      s.vy = 0.5 + Math.random() * 0.7;
      s.vz = 0.1 + Math.random() * 0.25;
      pos.setXYZ(i, -2.65 + (Math.random() - 0.5) * 0.3, 0.4, 0.35);
      spawned++;
    }
  }

  radioBeat(strength = 1) {
    this.radioPulse = Math.max(this.radioPulse, strength);
  }

  // ---------- 每帧更新 ----------
  update(t, dt, env, params) {
    const { rain, fog, lightning, fireRoar = 0.6, gust = 0.3, catBreath = 0, width, height } = params;

    // 主光（太阳/月亮 + 闪电）
    this.key.position.copy(this.key.target.position).addScaledVector(env.keyDir, 14);
    this.key.color.copy(env.keyColor);
    this.key.intensity = env.keyIntensity * 1.6 + lightning * 6;
    if (lightning > 0.01) this.key.color.lerp(new THREE.Color(0.8, 0.85, 1.0), Math.min(1, lightning * 2));
    this.hemi.color.copy(env.hemiSky);
    this.hemi.intensity = env.hemiIntensity * 0.9 + 0.08 + lightning * 0.8;
    this.windowLight.color.copy(env.skyHorizon).lerp(env.skyTop, 0.3);
    this.windowLight.color.r += 0.25 * env.neon * env.night;
    this.windowLight.color.b += 0.2 * env.neon * env.night;
    this.windowLight.intensity = 0.5 + env.day * 5 * (1 - rain * 0.35) + env.twilight * 1.5 + lightning * 12;

    const neonK = env.neon;
    this.neonSpillA.intensity = neonK * (1.6 + 0.3 * Math.sin(t * 2.3));
    this.neonSpillB.intensity = neonK * (1.2 + 0.3 * Math.sin(t * 1.7 + 1));
    this.stripMat.emissiveIntensity = 0.6 + neonK * 2.2;
    this.stripLight.intensity = neonK * 0.9;
    this.neonSignLight.intensity = 0.15 + neonK * 0.7;
    this.neonSignMat.color.setScalar(0.8 + neonK * 1.6);

    // 台灯随天色自动亮起
    const lampOn = env.night * 0.9 + env.twilight * 0.3;
    this.lampLight.intensity = lampOn * 2.2;
    this.shadeMat.emissiveIntensity = 0.1 + lampOn * 1.2;

    // 壁炉
    const fireOn = this.active.fire ? 1 : 0;
    this.fireLevel += (fireOn - this.fireLevel) * Math.min(1, dt * 1.2);
    const fl = this.fireLevel;
    const flick = 0.75 + 0.25 * Math.sin(t * 13.1) * Math.sin(t * 7.3 + 1) + 0.15 * fireRoar;
    this.fireLight.intensity = 0.3 + fl * 4.5 * flick + (this.hovered === 'fire' ? 1.5 : 0);
    this.emberMat.emissiveIntensity = 0.5 + fl * 1.6 * flick;
    for (const f of this.flames) {
      const { base, seed, bx } = f.userData;
      const n = Math.sin(t * 9 + seed) * 0.5 + Math.sin(t * 15.7 + seed * 2) * 0.3 + Math.sin(t * 4.1 + seed * 3) * 0.2;
      const hgt = base * (0.75 + 0.35 * n + 0.25 * fireRoar) * fl;
      f.scale.set(1 + n * 0.1, Math.max(0.001, hgt), 1 + n * 0.1);
      f.position.x = bx + Math.sin(t * 6 + seed) * 0.012;
      f.rotation.z = Math.sin(t * 5 + seed) * 0.12;
      f.visible = fl > 0.02;
    }
    const sp = this.sparks.geometry.attributes.position;
    for (let i = 0; i < this.sparkData.length; i++) {
      const s = this.sparkData[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vy += dt * 0.2;
      sp.setXYZ(i, sp.getX(i) + s.vx * dt, sp.getY(i) + s.vy * dt, sp.getZ(i) + s.vz * dt);
      if (s.life <= 0 || sp.getY(i) > 1.0) {
        s.life = 0;
        sp.setXYZ(i, 0, -100, 0);
      }
    }
    sp.needsUpdate = true;

    // 收音机
    const radioOn = this.active.radio ? 1 : 0;
    this.dialMat.emissiveIntensity += (radioOn * 1.4 - this.dialMat.emissiveIntensity) * Math.min(1, dt * 4);
    this.radioLight.intensity = this.dialMat.emissiveIntensity * 0.25;
    this.needle.position.x = 0.1 + Math.sin(t * 0.13) * 0.05;
    this.radioPulse *= Math.exp(-dt * 8);
    const sc = 1 + this.radioPulse * 0.08 * radioOn;
    this.speaker.scale.set(sc, 1, sc);

    // 风铃：整体随风摆动，每根铜管是阻尼弹簧
    const chimeOn = this.active.chime ? 1 : 0.25;
    this.gust += (gust * chimeOn - this.gust) * Math.min(1, dt * 0.8);
    const sway = this.gust;
    this.chimeSwing.rotation.z = Math.sin(t * 1.3) * 0.05 * sway + Math.sin(t * 2.9) * 0.02 * sway;
    this.chimeSwing.rotation.x = Math.sin(t * 1.1 + 1) * 0.06 * sway;
    this.paper.rotation.x = Math.sin(t * 2.2) * 0.35 * sway + 0.1 * sway;
    this.paper.rotation.y = Math.sin(t * 1.4) * 0.6 * sway;
    for (const r of this.rods) {
      const k = 30;
      const c = 1.6;
      r.vx += (-k * r.ax - c * r.vx) * dt;
      r.vz += (-k * r.az - c * r.vz) * dt;
      r.ax += r.vx * dt;
      r.az += r.vz * dt;
      r.pivot.rotation.x = r.ax * 0.3 + Math.sin(t * 1.7 + r.angle) * 0.03 * sway;
      r.pivot.rotation.z = r.az * 0.3;
    }

    // 猫：呼吸 + 呼噜时尾巴和耳朵动一动
    const purr = this.active.cat ? 1 : 0;
    const breath = catBreath || Math.sin(t * 1.6) * 0.5 + 0.5;
    this.catBody.scale.set(1, 1 + breath * 0.06 * (0.6 + purr * 0.6), 1 + breath * 0.03);
    this.catBody.position.y = 0.07 + (purr ? Math.sin(t * 160) * 0.0012 : 0);
    this.catTail.rotation.z = 0.2 + Math.sin(t * (purr ? 1.8 : 0.5)) * (purr ? 0.12 : 0.03);
    const twitch = Math.pow(Math.max(0, Math.sin(t * 0.9)), 30);
    this.ears[0].rotation.z = twitch * 0.4;
    this.catHead.rotation.z = -0.25 + breath * 0.03;
    for (const z of this.zzz) {
      const p = (t * 0.25 + z.offset) % 1;
      z.sprite.position.set(0.28 + p * 0.12, 0.25 + p * 0.35, 0.1 + Math.sin(p * 6 + z.offset * 4) * 0.04);
      z.sprite.material.opacity = purr * Math.sin(p * Math.PI) * 0.9;
      z.sprite.scale.setScalar(0.05 + p * 0.06);
    }

    // 擦拭的雾气慢慢重新凝结
    this.wipeFadeTimer += dt;
    if (this.wipeFadeTimer > 0.12) {
      this.wipeFadeTimer = 0;
      const c = this.wipeCtx;
      c.fillStyle = 'rgba(0,0,0,0.035)';
      c.fillRect(0, 0, this.wipeCanvas.width, this.wipeCanvas.height);
      this.wipeTexture.needsUpdate = true;
    }

    // 雨滴玻璃
    const u = this.glassMat.uniforms;
    u.uTime.value = t;
    u.uRain.value = rain;
    u.uFog.value = fog;
    u.uNight.value = env.night;
    u.uResolution.value.set(width, height);
    u.uInterior.value.setRGB(1.0, 0.5 + 0.1 * fl, 0.28).multiplyScalar(0.4 + fl * 0.8 + lampOn * 0.4);

    // 悬停高亮
    for (const [id, obj] of Object.entries(this.interactive)) {
      if (id === 'rain' || obj.userData.hoverScale === false) continue;
      const target = this.hovered === id ? 1.05 : 1;
      const s = obj.scale.x + (target - obj.scale.x) * Math.min(1, dt * 10);
      obj.scale.setScalar(s);
    }
  }
}
