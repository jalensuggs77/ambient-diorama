import * as THREE from 'three';

// 漫游模式里的小人：低多边形、戴耳机穿卫衣的住户。
// 骨架是一层层嵌套的 Group（髋 → 大腿 → 膝 → 小腿……），
// 走、跑、跳、坐和待机全部是程序化动画，不依赖任何模型文件。
// 局部坐标里小人面朝 +Z，脚底在 y = 0。

const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, ...opts });

function part(geo, material, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function joint(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** 圆柱段：从关节处向下延伸 len */
function limb(parent, rTop, rBottom, len, material, segments = 6) {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, len, segments);
  geo.translate(0, -len / 2, 0);
  return part(geo, material, parent);
}

export const HIP_HEIGHT = 0.82;
const THIGH = 0.4;
const SHIN = 0.36;
const UPPER_ARM = 0.27;
const FOREARM = 0.25;

const damp = (k, dt) => 1 - Math.exp(-k * dt);

export class Character {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'character';
    this.phase = 0;
    this.pose = {};

    const skin = mat(0xf2c4a2);
    const hoodie = mat(0x3d4690, { roughness: 0.95 });
    const hoodieDark = mat(0x2a3068, { roughness: 0.95 });
    const pants = mat(0x26252e);
    const shoe = mat(0xeeeef2, { roughness: 0.6 });
    const hair = mat(0x2a1f36, { roughness: 0.7 });
    const neonPink = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3fb4, emissiveIntensity: 1.6 });
    const neonCyan = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x29e6ff, emissiveIntensity: 1.8 });
    const dark = mat(0x15161c, { roughness: 0.5, metalness: 0.3 });

    // 落在地面上的柔和圆影，弥补夜里主光太弱时的“漂浮感”
    this.blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.28, 12),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 1;
    this.root.add(this.blob);

    this.body = joint(this.root);
    this.hips = joint(this.body, 0, HIP_HEIGHT, 0);
    part(new THREE.BoxGeometry(0.3, 0.14, 0.18), pants, this.hips, 0, -0.02, 0);

    // ----- 腿 -----
    const buildLeg = (side) => {
      const thigh = joint(this.hips, side * 0.085, -0.04, 0);
      limb(thigh, 0.07, 0.058, THIGH, pants);
      const knee = joint(thigh, 0, -THIGH, 0);
      limb(knee, 0.056, 0.046, SHIN, pants);
      const ankle = joint(knee, 0, -SHIN, 0);
      part(new THREE.BoxGeometry(0.11, 0.07, 0.22), shoe, ankle, 0, -0.025, 0.04);
      part(new THREE.BoxGeometry(0.115, 0.014, 0.225), neonCyan, ankle, 0, -0.058, 0.04).castShadow = false;
      return { thigh, knee };
    };
    this.legL = buildLeg(1);
    this.legR = buildLeg(-1);

    // ----- 躯干（卫衣） -----
    this.spine = joint(this.hips, 0, 0.05, 0);
    this.chest = joint(this.spine);
    const torsoGeo = new THREE.CylinderGeometry(0.17, 0.15, 0.44, 7);
    torsoGeo.translate(0, 0.22, 0);
    const torso = part(torsoGeo, hoodie, this.chest);
    torso.scale.z = 0.72;
    part(new THREE.BoxGeometry(0.2, 0.09, 0.03), hoodieDark, this.chest, 0, 0.1, 0.11); // 口袋
    part(new THREE.BoxGeometry(0.012, 0.3, 0.012), neonPink, this.chest, 0, 0.27, 0.118).castShadow = false; // 拉链灯条
    const hood = part(new THREE.TorusGeometry(0.1, 0.045, 5, 8), hoodieDark, this.chest, 0, 0.43, -0.07);
    hood.rotation.x = Math.PI / 2 + 0.5;
    part(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 4), mat(0xe8dcc0), this.chest, 0.05, 0.36, 0.11);
    part(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 4), mat(0xe8dcc0), this.chest, -0.05, 0.37, 0.11);

    // ----- 手臂 -----
    const buildArm = (side) => {
      const shoulder = joint(this.chest, side * 0.2, 0.4, 0);
      part(new THREE.IcosahedronGeometry(0.068, 0), hoodie, shoulder);
      limb(shoulder, 0.058, 0.052, UPPER_ARM, hoodie);
      const elbow = joint(shoulder, 0, -UPPER_ARM, 0);
      limb(elbow, 0.052, 0.046, FOREARM - 0.04, hoodie);
      part(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 6), hoodieDark, elbow, 0, -FOREARM + 0.04, 0); // 袖口
      part(new THREE.IcosahedronGeometry(0.045, 0), skin, elbow, 0, -FOREARM - 0.025, 0);
      return { shoulder, elbow };
    };
    this.armL = buildArm(1);
    this.armR = buildArm(-1);

    // ----- 头 -----
    const neck = joint(this.chest, 0, 0.44, 0);
    part(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 6), skin, neck, 0, 0.03, 0);
    this.head = joint(neck, 0, 0.07, 0);
    const headMesh = part(new THREE.IcosahedronGeometry(0.13, 1), skin, this.head, 0, 0.12, 0.005);
    headMesh.scale.set(1, 1.06, 0.98);
    // 头发：后脑勺一大块 + 刘海
    const hairBack = part(new THREE.IcosahedronGeometry(0.138, 1), hair, this.head, 0, 0.15, -0.025);
    hairBack.scale.set(1.03, 0.95, 1.0);
    const bangs = part(new THREE.BoxGeometry(0.24, 0.07, 0.08), hair, this.head, 0, 0.225, 0.085);
    bangs.rotation.x = 0.35;
    const tuft = part(new THREE.ConeGeometry(0.04, 0.1, 4), hair, this.head, 0.04, 0.285, 0.02);
    tuft.rotation.set(-0.4, 0, -0.5);
    // 眼睛和腮红
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1220 });
    this.eyes = [-1, 1].map((side) => part(new THREE.BoxGeometry(0.024, 0.038, 0.02), eyeMat, this.head, side * 0.048, 0.13, 0.13));
    const blush = new THREE.MeshBasicMaterial({ color: 0xff8fa8, transparent: true, opacity: 0.55 });
    [-1, 1].forEach((side) => {
      const b = part(new THREE.CircleGeometry(0.018, 6), blush, this.head, side * 0.075, 0.095, 0.128);
      b.castShadow = false;
      b.rotation.y = side * 0.4;
    });
    // 耳机：头梁 + 两侧发光的耳罩
    const band = part(new THREE.TorusGeometry(0.15, 0.014, 4, 12, Math.PI), dark, this.head, 0, 0.13, -0.01);
    band.rotation.y = 0;
    [-1, 1].forEach((side) => {
      const cup = part(new THREE.CylinderGeometry(0.055, 0.055, 0.045, 8), dark, this.head, side * 0.14, 0.12, -0.01);
      cup.rotation.z = Math.PI / 2;
      const ring = part(new THREE.TorusGeometry(0.04, 0.008, 4, 10), neonCyan, this.head, side * 0.165, 0.12, -0.01);
      ring.rotation.y = Math.PI / 2;
      ring.castShadow = false;
    });

    this.blinkTimer = 2 + Math.random() * 3;
  }

  set visible(v) {
    this.root.visible = v;
  }

  /** 头部（眼睛高度）的世界坐标，第一人称相机放在这里 */
  eyeWorld(target) {
    return target.set(0, 0.13, 0.06).applyMatrix4(this.head.matrixWorld);
  }

  /**
   * @param {number} dt
   * @param {{ speed:number, airborne:boolean, seated:boolean, t:number, lift:number }} s
   *   lift: 小人离地高度（跳跃时用来让地面圆影保持在地上）
   */
  update(dt, s) {
    const { speed, airborne, seated, t, lift = 0 } = s;
    const walk = seated || airborne ? 0 : Math.min(1, speed / 1.5);
    const run = seated || airborne ? 0 : THREE.MathUtils.clamp((speed - 1.9) / 1.4, 0, 1);
    const idle = seated || airborne ? 0 : 1 - walk;

    // 步频：走路一个周期约 1.4 米，跑步步幅更大
    this.phase += dt * speed * THREE.MathUtils.lerp(4.5, 3.1, run);
    const ph = this.phase;
    const sin = Math.sin(ph);
    const cos = Math.cos(ph);

    const legAmp = (0.55 + 0.4 * run) * walk;
    const kneeAmp = 0.95 + 0.7 * run;
    const armAmp = (0.45 + 0.55 * run) * walk;
    const breath = Math.sin(t * 2.1);

    const p = {
      thighL: -sin * legAmp,
      thighR: sin * legAmp,
      kneeL: (Math.max(0, cos) * kneeAmp + 0.08) * walk,
      kneeR: (Math.max(0, -cos) * kneeAmp + 0.08) * walk,
      armLx: sin * armAmp,
      armRx: -sin * armAmp,
      armLz: 0.1 + 0.03 * breath * idle,
      armRz: -0.1 - 0.03 * breath * idle,
      elbowL: -(0.2 + 0.15 * walk + 1.0 * run),
      elbowR: -(0.2 + 0.15 * walk + 1.0 * run),
      spineX: 0.04 * walk + 0.2 * run,
      spineY: sin * 0.08 * walk,
      headX: -0.04 * walk - 0.12 * run,
      headY: Math.sin(t * 0.37) * 0.25 * idle,
      hipsY: HIP_HEIGHT - Math.abs(sin) * 0.035 * walk * (1 + run) + breath * 0.004 * idle,
    };

    if (airborne) {
      Object.assign(p, {
        thighL: -0.7, kneeL: 1.1, thighR: 0.25, kneeR: 0.6,
        armLx: -0.5, armRx: -0.3, armLz: 0.7, armRz: -0.7,
        elbowL: -0.6, elbowR: -0.6, spineX: 0.08, headX: -0.1,
      });
    }

    if (seated) {
      Object.assign(p, {
        thighL: -1.5, thighR: -1.5, kneeL: 1.45, kneeR: 1.45,
        armLx: -0.4, armRx: -0.4, armLz: 0.12, armRz: -0.12,
        elbowL: -0.9, elbowR: -0.9,
        spineX: -0.06 + breath * 0.01, spineY: 0,
        headX: 0.08, headY: Math.sin(t * 0.29) * 0.3,
        hipsY: HIP_HEIGHT,
      });
    }

    // 所有关节平滑地追向目标姿势，动作之间自然过渡
    const k = damp(seated || airborne ? 9 : 20, dt);
    for (const key in p) {
      const cur = this.pose[key] ?? p[key];
      this.pose[key] = cur + (p[key] - cur) * k;
    }
    const q = this.pose;
    this.legL.thigh.rotation.x = q.thighL;
    this.legR.thigh.rotation.x = q.thighR;
    this.legL.knee.rotation.x = q.kneeL;
    this.legR.knee.rotation.x = q.kneeR;
    this.armL.shoulder.rotation.set(q.armLx, 0, q.armLz);
    this.armR.shoulder.rotation.set(q.armRx, 0, q.armRz);
    this.armL.elbow.rotation.x = q.elbowL;
    this.armR.elbow.rotation.x = q.elbowR;
    this.spine.rotation.set(q.spineX, q.spineY, 0);
    this.head.rotation.set(q.headX, q.headY, 0);
    this.hips.position.y = q.hipsY;
    this.chest.scale.set(1, 1 + breath * 0.012, 1 + breath * 0.02);

    // 眨眼
    this.blinkTimer -= dt;
    const blinking = this.blinkTimer < 0.12;
    if (this.blinkTimer < 0) this.blinkTimer = 2 + Math.random() * 4;
    for (const e of this.eyes) e.scale.y = blinking ? 0.15 : 1;

    // 圆影贴在地面上，跳得越高越淡
    this.blob.visible = !seated;
    this.blob.position.y = -lift + 0.028;
    const fade = Math.max(0.2, 1 - lift * 1.2);
    this.blob.material.opacity = 0.35 * fade;
    this.blob.scale.setScalar(0.8 + 0.2 * fade);
  }
}
