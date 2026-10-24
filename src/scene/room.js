import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { createRainGlassShader } from '../shaders/rainGlass.js';
import { Sunbeams } from './sunbeams.js';

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
    // 漫游模式用的碰撞体（XZ 平面上的矩形）与可坐的位置
    this.colliders = [];
    this.seats = [];

    this.buildShell();
    this.buildWindow(sceneTexture);
    this.buildLights();
    this.buildFireplace();
    this.buildRadio();
    this.buildChime();
    this.buildCabinetAndCat();
    this.buildDecor();
    this.buildBackRoom();
    this.buildCeilingLight();
    this.buildSteam();
    this.buildColliders();
    this.sunbeams = new Sunbeams(WINDOW);
    this.scene.add(this.sunbeams.group);
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

    // 玻璃同时是一面 Reflector：夜里窗外暗下来时，能看到室内（壁炉火光、台灯、自己）的倒影
    this.glass = new Reflector(new THREE.PlaneGeometry(w, h), {
      shader: createRainGlassShader(),
      textureWidth: 512,
      textureHeight: 512,
      clipBias: 0.003,
      multisample: 0,
    });
    this.glassMat = this.glass.material;
    this.glassMat.uniforms.uScene.value = sceneTexture;
    this.glassMat.uniforms.uWipe.value = this.wipeTexture;
    this.glassMat.uniforms.uGlassSize.value.set(w, h);
    // 白天倒影几乎看不见，跳过这次额外渲染
    const renderReflection = this.glass.onBeforeRender;
    this.reflectK = 0;
    this.glass.onBeforeRender = (...args) => {
      if (this.reflectK > 0.02) renderReflection.apply(this.glass, args);
    };
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
    this.catTorso = body;
    this.catBack = back;
    // 两只前爪平时缩在身子底下，伸懒腰时沿着垫子往前伸出来
    this.catPaws = [-1, 1].map((side) => {
      const paw = mesh(new THREE.IcosahedronGeometry(0.035, 0), furLight, this.catBody, 0.16, 0.015, 0.04 + side * 0.055);
      paw.scale.set(1.6, 0.7, 0.9);
      return paw;
    });

    this.catHead = new THREE.Group();
    this.catHead.position.set(0.2, 0.1, 0.1);
    this.catHead.rotation.set(0.1, 0.5, -0.25);
    this.catBody.add(this.catHead);
    const head = mesh(new THREE.IcosahedronGeometry(0.105, 0), fur, this.catHead, 0, 0, 0);
    head.scale.set(1.1, 0.9, 1);
    mesh(new THREE.IcosahedronGeometry(0.05, 0), furLight, this.catHead, 0.07, -0.03, 0.03).scale.set(0.8, 0.7, 1);
    // 打哈欠时张开的嘴
    this.catMouth = mesh(new THREE.BoxGeometry(0.02, 0.03, 0.035), mat(0x5a1a2a), this.catHead, 0.1, -0.045, 0.03);
    this.catMouth.scale.y = 0.001;
    this.catMouth.castShadow = false;
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

  // ---------- 房间后半部分：床、书桌、书架、房门（漫游时才看得到） ----------
  buildBackRoom() {
    const s = this.scene;
    const BACK = 6.7;

    // 天花板吊灯
    const cord = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.5, 4), mat(0x101016), s, 0, 3.05, 5.2);
    cord.castShadow = false;
    const pendant = mesh(new THREE.CylinderGeometry(0.08, 0.26, 0.2, 8, 1, true), mat(0x22242e, { side: THREE.DoubleSide, metalness: 0.5, roughness: 0.4 }), s, 0, 2.72, 5.2);
    pendant.castShadow = false;
    this.bulbMat = new THREE.MeshStandardMaterial({ color: 0xffe0b0, emissive: 0xffc070, emissiveIntensity: 0.5 });
    mesh(new THREE.IcosahedronGeometry(0.06, 0), this.bulbMat, s, 0, 2.66, 5.2).castShadow = false;
    this.pendantLight = new THREE.PointLight(0xffc27a, 0, 7, 1.6);
    this.pendantLight.position.set(0, 2.55, 5.2);
    s.add(this.pendantLight);

    // ----- 床（靠左墙，床头抵着后墙） -----
    const bx0 = -3.6;
    const bx1 = -2.05;
    const bz0 = 4.0;
    const frameMat = mat(0x2a2233, { roughness: 0.7 });
    slab(frameMat, s, bx0, 0, bz0, bx1, 0.28, BACK);
    slab(frameMat, s, bx0, 0, BACK - 0.12, bx1, 1.0, BACK);
    slab(mat(0x3a3048), s, bx0 + 0.05, 0.9, BACK - 0.16, bx1 - 0.05, 0.96, BACK - 0.1);
    slab(mat(0xd8d4e6, { roughness: 1 }), s, bx0 + 0.03, 0.28, bz0 + 0.03, bx1 - 0.03, 0.46, BACK - 0.12);
    // 被子：盖住床的下三分之二，边缘垂下来一点
    const blanket = mat(0x5b3f8f, { roughness: 1 });
    slab(blanket, s, bx0 + 0.02, 0.46, bz0 - 0.02, bx1 + 0.02, 0.52, 5.7);
    slab(blanket, s, bx1 - 0.01, 0.3, bz0 - 0.02, bx1 + 0.03, 0.52, 5.7);
    slab(mat(0x7a5cb5, { roughness: 1 }), s, bx0 + 0.02, 0.47, 5.55, bx1 + 0.02, 0.535, 5.75);
    const pillowMat = mat(0xf0ecf6, { roughness: 1 });
    [-3.18, -2.48].forEach((px) => {
      const p = mesh(new THREE.BoxGeometry(0.58, 0.13, 0.36), pillowMat, s, px, 0.53, 6.28);
      p.rotation.x = -0.18;
    });
    // 床底的紫色灯带
    this.bedStripMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x9a4dff, emissiveIntensity: 2 });
    const bedStrip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, BACK - bz0 - 0.15), this.bedStripMat);
    bedStrip.position.set(bx1 + 0.01, 0.04, (bz0 + BACK) / 2 - 0.05);
    s.add(bedStrip);
    this.bedStripLight = new THREE.PointLight(0x9a4dff, 0.4, 2.2, 2);
    this.bedStripLight.position.set(bx1 + 0.25, 0.1, 5.3);
    s.add(this.bedStripLight);
    this.seats.push({ x: bx1 - 0.18, z: 4.9, y: 0.48, yaw: Math.PI / 2, exit: { x: bx1 + 0.5, z: 4.9 }, name: '床边' });

    // 床头柜 + 小夜灯
    const nightstand = mat(0x3b2c3f, { roughness: 0.7 });
    slab(nightstand, s, -1.95, 0, 6.15, -1.45, 0.5, BACK);
    slab(mat(0x33263a), s, -1.9, 0.18, 6.14, -1.5, 0.4, 6.15);
    slab(mat(0xd4af6a, { metalness: 0.6, roughness: 0.4 }), s, -1.73, 0.28, 6.12, -1.67, 0.3, 6.14);
    this.nightLampMat = new THREE.MeshStandardMaterial({ color: 0xffe2c0, emissive: 0xff9d5c, emissiveIntensity: 0.4, flatShading: true });
    mesh(new THREE.IcosahedronGeometry(0.09, 1), this.nightLampMat, s, -1.7, 0.6, 6.42).castShadow = false;
    mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.04, 8), mat(0x1d1d24), s, -1.7, 0.52, 6.42);
    this.nightLight = new THREE.PointLight(0xff9d5c, 0, 3, 2);
    this.nightLight.position.set(-1.7, 0.75, 6.25);
    s.add(this.nightLight);

    // 床上方的两张海报
    const poster = (x, z, w, h, draw) => {
      const tex = canvasTexture(128, Math.round((128 * h) / w), draw);
      const frame = mesh(new THREE.BoxGeometry(0.03, h + 0.04, w + 0.04), mat(0x111118), s, x, 1.75, z);
      frame.castShadow = false;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
      p.rotation.y = Math.PI / 2;
      p.position.set(x + 0.016, 1.75, z);
      s.add(p);
    };
    poster(-3.585, 4.65, 0.55, 0.75, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#2b0f4a');
      g.addColorStop(1, '#ff3fb4');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffd36b';
      c.beginPath();
      c.arc(w / 2, h * 0.55, w * 0.28, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#2b0f4a';
      for (let i = 0; i < 5; i++) c.fillRect(0, h * 0.55 + i * 9, w, 3 + i);
      c.fillStyle = '#fff';
      c.font = 'bold 16px monospace';
      c.textAlign = 'center';
      c.fillText('NEO 2099', w / 2, 24);
    });
    poster(-3.585, 5.55, 0.5, 0.5, (c, w, h) => {
      c.fillStyle = '#0f2a33';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#29e6ff';
      c.lineWidth = 3;
      c.beginPath();
      for (let x = 0; x <= w; x += 2) c.lineTo(x, h / 2 + Math.sin(x * 0.15) * 22 * Math.sin(x * 0.025));
      c.stroke();
      c.fillStyle = '#29e6ff';
      c.font = 'bold 13px monospace';
      c.textAlign = 'center';
      c.fillText('WHITE NOISE', w / 2, h - 12);
    });

    // 床尾的长方形地毯
    const rug = slab(mat(0x3b2a52), s, -2.0, 0, 4.2, -0.6, 0.015, 6.2);
    rug.castShadow = false;

    // ----- 书桌（靠右墙） -----
    const dz0 = 2.3;
    const dz1 = 3.9;
    const dx0 = 2.95;
    const deskMat = mat(0x1e1e28, { roughness: 0.5, metalness: 0.2 });
    slab(mat(0x6d4e37, { roughness: 0.6 }), s, dx0, 0.72, dz0, 3.6, 0.76, dz1);
    slab(deskMat, s, dx0 + 0.04, 0, dz0 + 0.04, dx0 + 0.08, 0.72, dz0 + 0.6);
    slab(deskMat, s, dx0 + 0.04, 0, dz1 - 0.08, dx0 + 0.08, 0.72, dz1 - 0.04);
    slab(deskMat, s, dx0 + 0.08, 0, dz0 + 0.04, 3.58, 0.72, dz0 + 0.55); // 抽屉柜
    slab(mat(0xd4af6a, { metalness: 0.6, roughness: 0.4 }), s, dx0 + 0.07, 0.5, dz0 + 0.25, dx0 + 0.09, 0.52, dz0 + 0.35);

    // 显示器：屏幕是一张代码 + 频谱的发光贴图
    const monitor = new THREE.Group();
    monitor.position.set(3.38, 0.76, 3.15);
    s.add(monitor);
    mesh(new THREE.BoxGeometry(0.16, 0.015, 0.22), deskMat, monitor, 0, 0.008, 0);
    mesh(new THREE.BoxGeometry(0.03, 0.22, 0.04), deskMat, monitor, 0.02, 0.12, 0);
    mesh(new THREE.BoxGeometry(0.035, 0.44, 0.78), deskMat, monitor, 0, 0.42, 0);
    const screenTex = canvasTexture(384, 216, (c, w, h) => {
      c.fillStyle = '#060a14';
      c.fillRect(0, 0, w, h);
      c.font = '11px monospace';
      const lines = [
        ['#ff79c6', 'const'], ['#8be9fd', 'rain'], ['#f8f8f2', '= noise.pink()'],
      ];
      const r = makeRand(3);
      for (let i = 0; i < 12; i++) {
        let x = 10 + Math.floor(r() * 3) * 14;
        for (let j = 0; j < 3; j++) {
          const [col] = lines[(i + j) % 3];
          const len = 20 + r() * 60;
          c.fillStyle = col;
          c.globalAlpha = 0.85;
          c.fillRect(x, 12 + i * 11, len, 5);
          x += len + 8;
        }
      }
      c.globalAlpha = 1;
      for (let i = 0; i < 32; i++) {
        const bh = 10 + Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23)) * 60;
        const g = c.createLinearGradient(0, h - bh, 0, h);
        g.addColorStop(0, '#ff3fb4');
        g.addColorStop(1, '#29e6ff');
        c.fillStyle = g;
        c.fillRect(200 + i * 5.5, h - 12 - bh, 4, bh);
      }
    });
    this.screenMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 1.1 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.4), this.screenMat);
    screen.rotation.y = -Math.PI / 2;
    screen.position.set(-0.019, 0.42, 0);
    monitor.add(screen);
    this.monitorLight = new THREE.PointLight(0x7fb8ff, 0.8, 2.5, 2);
    this.monitorLight.position.set(3.0, 1.2, 3.15);
    s.add(this.monitorLight);
    // 键盘、鼠标、马克杯
    slab(mat(0x2a2a36), s, 3.02, 0.76, 2.95, 3.16, 0.78, 3.4);
    this.keysMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3fb4, emissiveIntensity: 0.8 });
    slab(this.keysMat, s, 3.04, 0.78, 2.97, 3.14, 0.785, 3.38).castShadow = false;
    slab(mat(0x2a2a36), s, 3.07, 0.76, 3.55, 3.13, 0.785, 3.63);
    mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.09, 8), mat(0x2d4a7a), s, 3.35, 0.805, 2.6);

    // 椅子：面朝显示器
    const chair = new THREE.Group();
    chair.position.set(2.62, 0, 3.15);
    s.add(chair);
    const chairMat = mat(0x2b2b38, { roughness: 0.6 });
    const chairSeat = mat(0xff3fb4, { roughness: 0.9 });
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.38, 6), chairMat, chair, 0, 0.23, 0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const leg = mesh(new THREE.BoxGeometry(0.28, 0.025, 0.04), chairMat, chair, Math.cos(a) * 0.13, 0.04, Math.sin(a) * 0.13);
      leg.rotation.y = -a;
    }
    mesh(new THREE.BoxGeometry(0.46, 0.07, 0.46), chairSeat, chair, 0, 0.45, 0);
    const backrest = mesh(new THREE.BoxGeometry(0.06, 0.5, 0.42), chairSeat, chair, -0.24, 0.78, 0);
    backrest.rotation.z = -0.08;
    mesh(new THREE.BoxGeometry(0.04, 0.3, 0.04), chairMat, chair, -0.22, 0.55, 0);
    this.seats.push({ x: 2.6, z: 3.15, y: 0.5, yaw: Math.PI / 2, exit: { x: 2.0, z: 3.15 }, name: '电脑椅' });

    // ----- 书架（靠右墙） -----
    const shelfMat = mat(0x2b2030, { roughness: 0.7 });
    const sz0 = 4.5;
    const sz1 = 5.8;
    const sx0 = 3.22;
    slab(shelfMat, s, sx0, 0, sz0, 3.6, 2.1, sz0 + 0.04);
    slab(shelfMat, s, sx0, 0, sz1 - 0.04, 3.6, 2.1, sz1);
    slab(shelfMat, s, 3.57, 0, sz0, 3.6, 2.1, sz1);
    const palette = [0xd9a441, 0x2d4a7a, 0x8c2f39, 0x3f8f5a, 0xe8dcc0, 0x6a3d8f, 0x29a0a8];
    [0, 0.5, 1.0, 1.5, 2.06].forEach((sy, level) => {
      slab(shelfMat, s, sx0, sy, sz0, 3.6, sy + 0.04, sz1);
      if (level === 4) return;
      let z = sz0 + 0.07;
      while (z < sz1 - 0.12) {
        if (this.rand() < 0.12) {
          z += 0.12; // 留点空位
          continue;
        }
        const w = 0.04 + this.rand() * 0.05;
        const h = 0.24 + this.rand() * 0.16;
        const b = slab(mat(palette[Math.floor(this.rand() * palette.length)]), s, sx0 + 0.04 + this.rand() * 0.04, sy + 0.04, z, 3.55, sy + 0.04 + h, z + w);
        b.castShadow = false;
        z += w + 0.006;
      }
    });
    // 书架顶上的小仙人掌
    mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.1, 7), mat(0xb5654a), s, 3.4, 2.15, 5.2);
    mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.18, 6), mat(0x3f8f5a), s, 3.4, 2.29, 5.2);

    // ----- 后墙：房门、衣帽架、门垫 -----
    const doorX0 = 0.75;
    const doorX1 = 1.7;
    const trim = mat(0x171a26);
    slab(trim, s, doorX0 - 0.08, 0, BACK - 0.04, doorX0, 2.28, BACK);
    slab(trim, s, doorX1, 0, BACK - 0.04, doorX1 + 0.08, 2.28, BACK);
    slab(trim, s, doorX0 - 0.08, 2.2, BACK - 0.04, doorX1 + 0.08, 2.28, BACK);
    const door = mat(0x4a3628, { roughness: 0.6 });
    slab(door, s, doorX0, 0, BACK - 0.03, doorX1, 2.2, BACK);
    slab(mat(0x3d2c21), s, doorX0 + 0.12, 1.2, BACK - 0.035, doorX1 - 0.12, 2.05, BACK - 0.03);
    slab(mat(0x3d2c21), s, doorX0 + 0.12, 0.15, BACK - 0.035, doorX1 - 0.12, 1.0, BACK - 0.03);
    const handle = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 6), mat(0xd4af6a, { metalness: 0.7, roughness: 0.3 }), s, doorX0 + 0.1, 1.0, BACK - 0.07);
    handle.rotation.z = Math.PI / 2;
    // 门上方的小霓虹 "HOME"
    const homeTex = canvasTexture(128, 48, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.strokeStyle = '#ff3fb4';
      c.shadowColor = '#ff3fb4';
      c.shadowBlur = 10;
      c.lineWidth = 3;
      c.font = 'bold 34px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.strokeText('HOME', w / 2, h / 2 + 2);
    });
    this.homeSignMat = new THREE.MeshBasicMaterial({ map: homeTex, transparent: true, color: new THREE.Color(2, 2, 2), depthWrite: false });
    const home = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.19), this.homeSignMat);
    home.rotation.y = Math.PI;
    home.position.set((doorX0 + doorX1) / 2, 2.55, BACK - 0.01);
    s.add(home);
    slab(mat(0x3a2e2a, { roughness: 1 }), s, doorX0 - 0.05, 0, BACK - 0.75, doorX1 + 0.05, 0.015, BACK - 0.1).castShadow = false;

    // 衣帽架 + 挂着的外套
    const rackMat = mat(0x1d1d24, { metalness: 0.4, roughness: 0.5 });
    const rack = new THREE.Group();
    rack.position.set(2.45, 0, 6.35);
    s.add(rack);
    mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.75, 6), rackMat, rack, 0, 0.88, 0);
    mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 8), rackMat, rack, 0, 0.015, 0);
    for (let i = 0; i < 4; i++) {
      const hook = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 4), rackMat, rack, 0, 1.7, 0);
      hook.rotation.set(0.9, (i / 4) * Math.PI * 2, 0, 'YXZ');
    }
    const coat = mesh(new THREE.CylinderGeometry(0.1, 0.2, 0.75, 6), mat(0x2f6f6f, { roughness: 1 }), rack, 0.12, 1.25, 0);
    coat.rotation.z = 0.08;
    const umbrella = mesh(new THREE.ConeGeometry(0.05, 0.85, 6), mat(0x8c2f39), rack, -0.14, 0.43, 0.06);
    umbrella.rotation.z = -0.12;

    // 墙角的大叶盆栽
    const plant = new THREE.Group();
    plant.position.set(-3.2, 0, 3.4);
    s.add(plant);
    mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.4, 8), mat(0xe8dcc0), plant, 0, 0.2, 0);
    const leafA = mat(0x3f8f5a, { roughness: 0.8, side: THREE.DoubleSide });
    const leafB = mat(0x2f6f47, { roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + this.rand();
      const stem = new THREE.Group();
      stem.position.set(0, 0.38, 0);
      stem.rotation.set(0, a, 0.35 + this.rand() * 0.5);
      plant.add(stem);
      const len = 0.6 + this.rand() * 0.5;
      mesh(new THREE.CylinderGeometry(0.008, 0.01, len, 4), leafB, stem, 0, len / 2, 0);
      const leaf = mesh(new THREE.ConeGeometry(0.12, 0.36, 4), i % 2 ? leafA : leafB, stem, 0, len + 0.12, 0);
      leaf.scale.z = 0.25;
    }

    // 后墙也加一段踢脚线
    slab(trim, s, -3.6, 0, BACK - 0.03, doorX0 - 0.08, 0.12, BACK);
    slab(trim, s, doorX1 + 0.08, 0, BACK - 0.03, 3.6, 0.12, BACK);

    // 窗前坐垫也可以坐（背靠窗户，雨声就在耳后）
    this.seats.push({ x: -0.3, z: 0.32, y: BENCH_Y + 0.07, yaw: 0, exit: { x: -0.3, z: 0.95 }, name: '窗边坐垫' });
  }

  // ---------- 吸顶灯 + 墙上开关 ----------
  buildCeilingLight() {
    const s = this.scene;
    // 放在默认镜头的视野之外（镜头上方），开灯后整个房间都亮起来
    const fixture = new THREE.Group();
    fixture.position.set(0, 3.3, 3.1);
    s.add(fixture);
    mesh(new THREE.CylinderGeometry(0.36, 0.32, 0.05, 12), mat(0x1d1d24, { metalness: 0.4, roughness: 0.5 }), fixture, 0, -0.025, 0).castShadow = false;
    this.ceilingMat = new THREE.MeshStandardMaterial({ color: 0xf4efe6, emissive: 0xfff2dc, emissiveIntensity: 0, flatShading: true });
    const diffuser = mesh(new THREE.CylinderGeometry(0.31, 0.26, 0.05, 12), this.ceilingMat, fixture, 0, -0.07, 0);
    diffuser.castShadow = false;
    this.ceilingLight = new THREE.PointLight(0xfff0dc, 0, 11, 1.3);
    this.ceilingLight.position.set(0, 3.05, 3.1);
    s.add(this.ceilingLight);

    // 门边的开关：漫游时按 E 就能开关
    const sw = new THREE.Group();
    sw.position.set(0.42, 1.25, 6.69);
    sw.rotation.y = Math.PI;
    sw.userData.trackId = 'light';
    s.add(sw);
    this.interactive.light = sw;
    mesh(new THREE.BoxGeometry(0.09, 0.13, 0.012), mat(0xe8e4dc, { roughness: 0.5 }), sw, 0, 0, 0.006);
    this.switchRocker = mesh(new THREE.BoxGeometry(0.04, 0.07, 0.014), mat(0xf6f3ec, { roughness: 0.4 }), sw, 0, 0, 0.016);
    // 关灯时开关上有一颗小指示灯，黑暗里也找得到
    this.switchLedMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.6, 1.8) });
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.004), this.switchLedMat);
    led.position.set(0, 0.048, 0.013);
    sw.add(led);
    this.switchPosition = new THREE.Vector3(0.42, 1.25, 6.68);

    this.lightOn = false;
    this.lightLevel = 0;
    this.lightAge = 10;
  }

  setLight(on) {
    if (on === this.lightOn) return;
    this.lightOn = on;
    this.lightAge = 0;
  }

  // ---------- 茶壶、茶杯、马克杯冒出的热气 ----------
  buildSteam() {
    const tex = canvasTexture(64, 64, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    });
    const sources = [
      { p: new THREE.Vector3(0.0, 0.51, 2.25), n: 7, rise: 0.45, size: 0.09 }, // 茶壶嘴
      { p: new THREE.Vector3(0.15, 0.42, 2.3), n: 5, rise: 0.3, size: 0.06 }, // 茶杯
      { p: new THREE.Vector3(0.25, BENCH_Y + 0.11, 0.36), n: 5, rise: 0.32, size: 0.07 }, // 窗台马克杯
      { p: new THREE.Vector3(3.35, 0.86, 2.6), n: 5, rise: 0.3, size: 0.06 }, // 书桌马克杯
    ];
    this.steam = [];
    for (const src of sources) {
      for (let i = 0; i < src.n; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, color: 0xf2ecff }));
        sp.raycast = () => {}; // 不挡点击
        this.scene.add(sp);
        this.steam.push({ sprite: sp, src, offset: i / src.n, seed: this.rand() * 10 });
      }
    }
  }

  // 漫游模式的碰撞体：XZ 平面上的矩形，房间四壁由边界单独处理
  buildColliders() {
    const box = (x0, z0, x1, z1) => this.colliders.push({ x0, z0, x1, z1 });
    box(WINDOW.x0, -1, WINDOW.x1, 0.52); // 窗前矮几
    box(-3.7, -1, -1.85, 0.62); // 壁炉
    box(1.83, -1, 3.7, 0.57); // 矮柜
    box(-0.55, 1.95, 0.55, 2.55); // 茶几
    box(-1.48, 2.36, -0.92, 2.84); // 地板坐垫
    box(-3.7, 4.0, -2.05, 7); // 床
    box(-1.95, 6.15, -1.45, 7); // 床头柜
    box(2.95, 2.3, 3.7, 3.9); // 书桌
    box(2.36, 2.9, 2.86, 3.4); // 椅子
    box(3.22, 4.5, 3.7, 5.8); // 书架
    box(2.3, 6.2, 2.62, 7); // 衣帽架
    box(-3.42, 3.18, -2.98, 3.62); // 盆栽
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

  /** 点猫时它伸个懒腰，再趴回去睡 */
  catStretch() {
    if (this.stretchT === undefined || this.stretchT === null || this.stretchT > 2.6) this.stretchT = 0;
  }

  radioBeat(strength = 1) {
    this.radioPulse = Math.max(this.radioPulse, strength);
  }

  // ---------- 每帧更新 ----------
  update(t, dt, env, params) {
    const { rain, snow = 0, camera, fog, lightning, fireRoar = 0.6, gust = 0.3, catBreath = 0, width, height } = params;

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
    // 吸顶灯：开灯时先闪两下再稳定，关灯时快速熄灭
    this.lightAge += dt;
    let target = this.lightOn ? 1 : 0;
    if (this.lightOn && this.lightAge < 0.3) target = [1, 0.15, 0.9, 0.3, 1][Math.floor(this.lightAge / 0.06)] ?? 1;
    this.lightLevel += (target - this.lightLevel) * Math.min(1, dt * (this.lightOn ? 30 : 12));
    const L = this.lightLevel;
    this.ceilingLight.intensity = L * 9;
    this.ceilingMat.emissiveIntensity = L * 2.2;
    this.hemi.intensity += L * 0.35;
    this.switchLedMat.color.setRGB(0.3, 1.6, 1.8).multiplyScalar(1 - L);
    this.switchRocker.rotation.x = this.lightOn ? -0.25 : 0.25;

    // 房间后半部分的灯：吊灯偏暗，免得冲淡窗边的氛围；开灯时一起亮
    this.pendantLight.intensity = 0.4 + lampOn * 3.2 + L * 2;
    this.bulbMat.emissiveIntensity = 0.3 + lampOn * 2 + L * 2;
    this.nightLight.intensity = lampOn * 1.2;
    this.nightLampMat.emissiveIntensity = 0.3 + lampOn * 1.4;
    this.bedStripMat.emissiveIntensity = 0.5 + neonK * 2;
    this.bedStripLight.intensity = 0.1 + neonK * 0.5;
    this.homeSignMat.color.setScalar(0.8 + neonK * 1.4);
    this.screenMat.emissiveIntensity = 1 + Math.sin(t * 3.1) * 0.05;
    this.monitorLight.intensity = 0.6 + Math.sin(t * 3.1) * 0.04;

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
    // 伸懒腰：趴在垫子上不离开，前爪往前伸、身子拉长压低、抬头打个哈欠、尾巴翘起，持续约 3 秒
    let st = 0;
    if (this.stretchT !== undefined && this.stretchT !== null) {
      this.stretchT += dt;
      const p = this.stretchT / 3.2;
      if (p >= 1) this.stretchT = null;
      else st = Math.pow(Math.sin(Math.PI * Math.min(1, p * 1.15)), 0.6);
    }
    this.catBody.scale.set(1, 1 + breath * 0.06 * (0.6 + purr * 0.6) * (1 - st), 1 + breath * 0.03);
    this.catBody.position.y = 0.07 + (purr && !st ? Math.sin(t * 160) * 0.0012 : 0);
    // 只拉伸躯干，不拉伸整组，免得头被拉变形；压低时躯干底部仍陷在垫子里
    this.catTorso.scale.set(1.25 * (1 + st * 0.18), 0.6 * (1 - st * 0.12), 0.95);
    this.catTorso.position.x = st * 0.025;
    this.catBack.scale.set(1.4 * (1 + st * 0.15), 0.45 * (1 - st * 0.1), 1.1);
    for (const paw of this.catPaws) paw.position.x = 0.16 + st * 0.17;
    this.catHead.position.set(0.2 + st * 0.07, 0.1 - st * 0.01, 0.1);
    const yawn = THREE.MathUtils.smoothstep(st, 0.6, 1);
    this.catMouth.scale.y = Math.max(0.001, yawn);
    this.catTail.rotation.x = Math.PI / 2 - st * 0.5;
    this.catTail.rotation.z = 0.2 + Math.sin(t * (purr ? 1.8 : 0.5)) * (purr ? 0.12 : 0.03) + st * 0.25;
    const twitch = Math.pow(Math.max(0, Math.sin(t * 0.9)), 30);
    this.ears[0].rotation.z = twitch * 0.4 - yawn * 0.3;
    this.ears[1].rotation.z = -yawn * 0.3;
    this.catHead.rotation.z = -0.25 + breath * 0.03 + st * 0.55;
    for (const z of this.zzz) {
      const p = (t * 0.25 + z.offset) % 1;
      z.sprite.position.set(0.28 + p * 0.12, 0.25 + p * 0.35, 0.1 + Math.sin(p * 6 + z.offset * 4) * 0.04);
      z.sprite.material.opacity = purr * (1 - st) * Math.sin(p * Math.PI) * 0.9;
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

    // 热气：一团团往上飘、散开、变淡
    for (const s of this.steam) {
      const { src } = s;
      const p = (t * 0.22 + s.offset) % 1;
      const sway = Math.sin(t * 0.9 + s.seed + p * 4) * 0.04 * p;
      s.sprite.position.set(src.p.x + sway, src.p.y + p * src.rise, src.p.z + Math.cos(t * 0.7 + s.seed) * 0.02 * p);
      s.sprite.scale.setScalar(src.size * (0.4 + p * 1.6));
      s.sprite.material.opacity = Math.sin(Math.PI * Math.min(1, p * 1.3)) * 0.16 * (0.6 + 0.4 * (1 - p));
    }

    // 白天阳光透过落地窗形成的光柱和浮尘
    this.sunbeams.update(t, env, rain * (1 - snow * 0.3), camera.position);

    // 雨滴玻璃
    const u = this.glassMat.uniforms;
    u.uTime.value = t;
    u.uRain.value = rain;
    u.uSnow.value = snow;
    u.uFog.value = fog;
    u.uNight.value = env.night;
    u.uResolution.value.set(width, height);
    u.uInterior.value.setRGB(1.0, 0.5 + 0.1 * fl, 0.28).multiplyScalar(0.4 + fl * 0.8 + lampOn * 0.4 + L * 0.8);
    // 窗外越暗，室内倒影越明显
    this.reflectK = 0.02 + env.night * 0.3 + env.twilight * 0.08;
    u.uReflect.value = this.reflectK;

    // 悬停高亮
    for (const [id, obj] of Object.entries(this.interactive)) {
      if (id === 'rain' || obj.userData.hoverScale === false) continue;
      const target = this.hovered === id ? 1.05 : 1;
      const s = obj.scale.x + (target - obj.scale.x) * Math.min(1, dt * 10);
      obj.scale.setScalar(s);
    }
  }
}
