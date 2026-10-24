import * as THREE from 'three';
import { Character, HIP_HEIGHT } from './character.js';

// 漫游模式：用键盘操控小人在房间里走动，第一 / 第三人称可切换。
// WASD / 方向键移动，Shift 奔跑，空格跳，V 切换视角，E 或左键开关音源，F 坐下，Esc 暂停。
// 手机上：左下角摇杆移动（推到底就是跑），在屏幕其他地方拖动转视角、双指捏合拉远拉近，按钮见 touchControls.js。

const BOUNDS = { x0: -3.6, x1: 3.6, z0: 0, z1: 6.7 };
const CAM_BOUNDS = { x0: -3.48, x1: 3.48, y0: 0.15, y1: 3.18, z0: 0.12, z1: 6.58 };
const RADIUS = 0.2;
const WALK = 1.5;
const RUN = 3.3;
const JUMP = 3.4;
const GRAVITY = 9.8;
const REACH = 2.4; // 能够到的距离
const SENS = 0.0022;

const clamp = THREE.MathUtils.clamp;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Explorer {
  /**
   * @param {object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {THREE.PerspectiveCamera} o.camera
   * @param {import('../scene/room.js').Room} o.room
   * @param {HTMLElement} o.root           HUD 挂载点
   * @param {(id:string)=>string} o.describe 音轨的显示名与状态
   * @param {(id:string)=>void} o.onInteract
   * @param {()=>void} o.onEnter
   * @param {()=>void} o.onExit
   */
  constructor(o) {
    Object.assign(this, o);
    this.active = false;
    this.paused = false;
    this.locked = false;
    this.lockedOnce = false;

    this.character = new Character();
    this.character.visible = false;
    this.room.scene.add(this.character.root);
    // 跟着镜头走的柔光：房间的光大多来自窗户，第三人称看背影时不至于是一团剪影
    this.fill = new THREE.PointLight(0xc8d0ff, 0, 6, 1);
    this.room.scene.add(this.fill);

    this.pos = new THREE.Vector3(0.6, 0, 3.9);
    this.vel = new THREE.Vector3();
    this.lift = 0;
    this.vy = 0;
    this.yaw = Math.PI; // 小人朝向（面朝 -Z 即窗户）
    this.camYaw = 0;
    this.camPitch = -0.12;
    this.view = 'third';
    this.viewBlend = 0; // 0 = 第三人称，1 = 第一人称
    this.dist = 2.3;
    this.camDist = 2.3;
    this.seat = null;
    this.keys = new Set();
    this.target = null;
    // 虚拟摇杆的输入（-1..1，y 向上为前进），由 TouchControls 写入
    this.stick = { x: 0, y: 0 };
    this.touchMode = matchMedia('(hover: none) and (pointer: coarse)').matches;

    this.raycaster = new THREE.Raycaster();
    this.tmp = new THREE.Vector3();
    this.eye = new THREE.Vector3();
    this.tpPos = new THREE.Vector3();
    this.fpPos = new THREE.Vector3();

    // 相机避障只看大件（墙、壁炉、柜子……），小摆件不会让镜头抖动
    this.pickables = this.room.scene.children.filter((c) => c !== this.character.root);
    this.blockers = [];
    this.room.scene.updateMatrixWorld(true);
    for (const top of this.pickables) {
      top.traverse((m) => {
        if (!m.isMesh) return;
        if (m.material.blending === THREE.AdditiveBlending || m.material.transparent) return;
        m.geometry.computeBoundingSphere();
        const sc = m.getWorldScale(this.tmp);
        if (m.geometry.boundingSphere.radius * Math.max(sc.x, sc.y, sc.z) > 0.28) this.blockers.push(m);
      });
    }

    this.buildHud();
    this.bindEvents();
  }

  // ---------- HUD ----------
  buildHud() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <button class="explore-enter" id="explore-enter" title="操控小人在房间里走走">🚶 漫游模式</button>
      <div class="explore-hud" id="explore-hud">
        <div class="crosshair"></div>
        <div class="explore-prompt" id="explore-prompt"></div>
        <div class="explore-view" id="explore-view"></div>
        <div class="explore-keys only-kbd">
          <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动</span>
          <span><kbd>Shift</kbd> 奔跑</span>
          <span><kbd>空格</kbd> 跳</span>
          <span><kbd>V</kbd> 切换视角</span>
          <span><kbd>E</kbd> 开关音源</span>
          <span><kbd>F</kbd> 坐下</span>
          <span><kbd>L</kbd> 开关灯</span>
          <span><kbd>Esc</kbd> 暂停</span>
        </div>
      </div>
      <div class="explore-pause" id="explore-pause">
        <div class="explore-pause-card">
          <div class="overlay-kicker">PAUSED</div>
          <h2>漫游暂停</h2>
          <ul class="only-touch">
            <li>🕹️ 左下角摇杆　移动，推到底就是跑</li>
            <li>👆 在屏幕其他地方拖动　环顾四周</li>
            <li>🤏 双指捏合　拉远拉近（第三人称）</li>
            <li>✋ 互动　开关准星对准的音源或电灯开关（也可以直接轻点画面）</li>
            <li>🪑 坐下 / 站起来　·　🎥 切换视角　·　💡 开关灯</li>
          </ul>
          <ul class="only-kbd">
            <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / 方向键　移动</li>
            <li><kbd>Shift</kbd>　奔跑　·　<kbd>空格</kbd>　跳</li>
            <li>鼠标　环顾四周　·　滚轮　拉远拉近（第三人称）</li>
            <li><kbd>V</kbd>　第一 / 第三人称</li>
            <li><kbd>E</kbd> / 左键　开关准星对准的音源（雨窗、壁炉、收音机、风铃、猫）或电灯开关</li>
            <li><kbd>F</kbd>　在电脑椅、床边、窗边坐垫坐下 / 站起来</li>
            <li><kbd>L</kbd>　开关房间灯（门边的墙上也有开关）</li>
          </ul>
          <div class="explore-pause-actions">
            <button class="btn-primary" id="explore-resume">继续漫游</button>
            <button class="btn-ghost" id="explore-exit">退出漫游</button>
          </div>
        </div>
      </div>
    `;
    this.root.append(...wrap.children);
    this.$ = (id) => document.getElementById(id);
    this.$('explore-enter').addEventListener('click', () => this.enter());
    this.$('explore-resume').addEventListener('click', () => this.resume());
    this.$('explore-exit').addEventListener('click', () => this.exit());
    this.promptEl = this.$('explore-prompt');
    this.viewEl = this.$('explore-view');
  }

  bindEvents() {
    const c = this.canvas;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      if (this.locked) this.lockedOnce = true;
      else if (this.active && this.lockedOnce) this.pause();
    });
    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
      this.lockFailed = true;
    });

    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.code === 'Escape' && !this.locked) {
        this.paused ? this.resume() : this.pause();
        return;
      }
      if (this.paused) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyV') this.toggleView();
      if (e.code === 'KeyE') this.interact();
      if (e.code === 'KeyF') this.toggleSeat();
      if (e.code === 'Space') this.jump();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    // 指针锁定时用相对位移转视角；锁定不可用时（触屏、或被 iframe 限制）退化为拖动转视角。
    // 拖动按 pointerId 区分手指：摇杆那根手指不会带着视角转，两根手指在画面上就是捏合缩放。
    const drags = new Map();
    let pinch = null;
    c.addEventListener('pointerdown', (e) => {
      if (!this.active || this.paused) return;
      if (this.locked) {
        if (e.button === 0) this.interact();
        return;
      }
      if (e.pointerType !== 'touch' && !this.touchMode && !this.lockFailed && c.requestPointerLock) {
        this.requestLock();
        return;
      }
      drags.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: 0 });
      if (drags.size === 2) {
        const [a, b] = [...drags.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: this.dist };
        for (const d of drags.values()) d.moved = 99; // 捏合不算轻点
      }
    });
    const release = (e) => {
      const d = drags.get(e.pointerId);
      if (!d) return;
      drags.delete(e.pointerId);
      if (drags.size < 2) pinch = null;
      if (e.type === 'pointerup' && d.moved < 8 && this.active && !this.paused) this.interact();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('pointermove', (e) => {
      if (!this.active || this.paused) return;
      if (this.locked) return this.look(e.movementX, e.movementY);
      const d = drags.get(e.pointerId);
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.moved += Math.abs(dx) + Math.abs(dy);
      d.x = e.clientX;
      d.y = e.clientY;
      if (pinch) {
        const [a, b] = [...drags.values()];
        const now = Math.hypot(a.x - b.x, a.y - b.y);
        this.dist = clamp((pinch.dist * pinch.d) / Math.max(20, now), 1.1, 4.2);
      } else {
        const k = e.pointerType === 'touch' ? 2.4 : 1.6;
        this.look(dx * k, dy * k);
      }
    });
    c.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        this.dist = clamp(this.dist * Math.exp(e.deltaY * 0.001), 1.1, 4.2);
      },
      { passive: false },
    );
  }

  requestLock() {
    const c = this.canvas;
    if (!c.requestPointerLock || this.lockFailed) return;
    try {
      const p = c.requestPointerLock();
      p?.catch?.(() => (this.lockFailed = true));
    } catch {
      this.lockFailed = true;
    }
  }

  look(dx, dy) {
    this.camYaw -= dx * SENS;
    const [lo, hi] = this.view === 'first' ? [-1.45, 1.45] : [-1.15, 0.65];
    this.camPitch = clamp(this.camPitch - dy * SENS, lo, hi);
  }

  // ---------- 模式切换 ----------
  enter() {
    if (this.active) return;
    this.active = true;
    this.paused = false;
    document.activeElement?.blur?.();
    document.body.classList.add('exploring');
    this.character.visible = this.view === 'third';
    // 镜头从小人身后开始
    this.camYaw = wrapAngle(this.yaw + Math.PI);
    this.camPitch = -0.12;
    if (!this.touchMode) this.requestLock();
    this.onEnter();
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.paused = false;
    this.keys.clear();
    this.character.visible = false;
    this.fill.intensity = 0;
    document.body.classList.remove('exploring', 'explore-paused');
    if (document.pointerLockElement) document.exitPointerLock();
    this.onExit();
  }

  pause() {
    this.paused = true;
    this.keys.clear();
    this.stick.x = this.stick.y = 0;
    document.body.classList.add('explore-paused');
  }

  resume() {
    this.paused = false;
    document.body.classList.remove('explore-paused');
    if (!this.touchMode) this.requestLock();
  }

  toggleView() {
    this.view = this.view === 'first' ? 'third' : 'first';
    if (this.view === 'third') this.camPitch = clamp(this.camPitch, -1.15, 0.65);
  }

  jump() {
    if (this.seat || this.lift > 0.001) return;
    this.vy = JUMP;
  }

  /** E / 左键：开关准星对准的音源；没对准音源时就近坐下或站起 */
  interact() {
    if (this.target) this.onInteract(this.target);
    else this.toggleSeat();
  }

  /** F：坐下 / 站起来 */
  toggleSeat() {
    if (this.seat) {
      this.pos.set(this.seat.exit.x, 0, this.seat.exit.z);
      this.seat = null;
    } else if (this.nearSeat) {
      this.seat = this.nearSeat;
      this.vel.set(0, 0, 0);
      this.vy = 0;
      this.lift = 0;
    }
  }

  // ---------- 物理 ----------
  resolveCollisions(p) {
    const R = RADIUS;
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.room.colliders) {
        const cx = clamp(p.x, b.x0, b.x1);
        const cz = clamp(p.z, b.z0, b.z1);
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          p.x = cx + (dx / d) * R;
          p.z = cz + (dz / d) * R;
        } else {
          // 圆心已经在矩形里：沿穿透最浅的方向推出去
          const pens = [p.x - b.x0, b.x1 - p.x, p.z - b.z0, b.z1 - p.z];
          const i = pens.indexOf(Math.min(...pens));
          if (i === 0) p.x = b.x0 - R;
          else if (i === 1) p.x = b.x1 + R;
          else if (i === 2) p.z = b.z0 - R;
          else p.z = b.z1 + R;
        }
      }
      p.x = clamp(p.x, BOUNDS.x0 + R, BOUNDS.x1 - R);
      p.z = clamp(p.z, BOUNDS.z0 + R, BOUNDS.z1 - R);
    }
  }

  // ---------- 准星目标 ----------
  findTarget() {
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    this.raycaster.far = 8;
    const hits = this.raycaster.intersectObjects(this.pickables, true);
    for (const h of hits) {
      const o0 = h.object;
      if (o0.isPoints || o0.isLine || o0.isSprite) continue;
      if (o0.isMesh && o0.material.blending === THREE.AdditiveBlending) continue;
      let o = o0;
      while (o && !o.userData.trackId) o = o.parent;
      // 距离按小人的眼睛算，第三人称下镜头远一点也不影响
      if (o && h.point.distanceTo(this.eye) < REACH) return o.userData.trackId;
      break;
    }
    return null;
  }

  findSeat() {
    if (this.seat) return null;
    let best = null;
    let bestD = 1.1;
    for (const s of this.room.seats) {
      const d = Math.hypot(s.x - this.pos.x, s.z - this.pos.z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  // ---------- 每帧 ----------
  update(dt, t) {
    const ch = this.character;
    const k = this.keys;
    let speed = 0;

    if (this.seat) {
      const s = this.seat;
      this.pos.x += (s.x - this.pos.x) * damp(10, dt);
      this.pos.z += (s.z - this.pos.z) * damp(10, dt);
      this.yaw += wrapAngle(s.yaw - this.yaw) * damp(10, dt);
      // 坐下时让髋关节落到座面上
      const sitY = s.y + 0.09 - HIP_HEIGHT;
      this.lift += (sitY - this.lift) * damp(10, dt);
    } else {
      const kf = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      const kr = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      // 键盘是满量程；摇杆是模拟量：轻推慢走，推到底（> 0.92）就跑起来
      const stickMag = Math.min(1, Math.hypot(this.stick.x, this.stick.y));
      const f = kf + this.stick.y;
      const r = kr + this.stick.x;
      const running = k.has('ShiftLeft') || k.has('ShiftRight') || stickMag > 0.92;
      const mag = kf || kr ? 1 : stickMag < 0.12 ? 0 : stickMag;
      const sy = Math.sin(this.camYaw);
      const cy = Math.cos(this.camYaw);
      const dir = this.tmp.set(-sy * f + cy * r, 0, -cy * f - sy * r);
      if (dir.lengthSq() > 0 && mag > 0) dir.normalize().multiplyScalar((running ? RUN : WALK) * Math.max(mag, running ? 1 : 0.35));
      else dir.set(0, 0, 0);
      const grounded = this.lift <= 0.001 && this.vy <= 0;
      this.vel.lerp(dir, damp(grounded ? 10 : 2.5, dt));
      this.pos.addScaledVector(this.vel, dt);
      this.resolveCollisions(this.pos);

      // 跳跃（从坐姿起身后 lift 可能是负的，先把它拉回地面）
      if (this.lift < 0) this.lift = Math.min(0, this.lift + dt * 3);
      else {
        this.vy -= GRAVITY * dt;
        this.lift += this.vy * dt;
        if (this.lift <= 0) {
          this.lift = 0;
          this.vy = 0;
        }
      }

      speed = Math.hypot(this.vel.x, this.vel.z);
      if (this.view === 'first') this.yaw = this.camYaw + Math.PI;
      else if (speed > 0.15) {
        const want = Math.atan2(this.vel.x, this.vel.z);
        this.yaw += wrapAngle(want - this.yaw) * damp(12, dt);
      }
    }

    ch.root.position.set(this.pos.x, this.lift, this.pos.z);
    ch.root.rotation.y = this.yaw;
    ch.update(dt, { speed, airborne: this.lift > 0.02 && !this.seat, seated: !!this.seat && Math.abs(this.lift) > 0.05, t, lift: this.lift });
    ch.root.updateMatrixWorld(true);
    ch.eyeWorld(this.eye);

    // ----- 相机 -----
    this.viewBlend += ((this.view === 'first' ? 1 : 0) - this.viewBlend) * damp(9, dt);
    const cam = this.camera;
    const cp = Math.cos(this.camPitch);
    const back = this.tmp.set(Math.sin(this.camYaw) * cp, -Math.sin(this.camPitch), Math.cos(this.camYaw) * cp);

    // 第一人称：眼睛的位置，再往前一点免得看到自己的脸
    this.fpPos.copy(this.eye).addScaledVector(back, -0.06);

    // 第三人称：头顶偏右肩，向后拉开，被墙或家具挡住时拉近
    const pivot = this.tpPos.copy(this.eye);
    pivot.y += 0.12;
    pivot.x += Math.cos(this.camYaw) * 0.3;
    pivot.z -= Math.sin(this.camYaw) * 0.3;
    let want = this.dist;
    this.raycaster.set(pivot, back);
    this.raycaster.far = want + 0.2;
    const hit = this.raycaster.intersectObjects(this.blockers, false)[0];
    if (hit) want = Math.max(0.25, hit.distance - 0.2);
    this.camDist += (want - this.camDist) * damp(want < this.camDist ? 25 : 4, dt);
    pivot.addScaledVector(back, this.camDist);
    pivot.x = clamp(pivot.x, CAM_BOUNDS.x0, CAM_BOUNDS.x1);
    pivot.y = clamp(pivot.y, CAM_BOUNDS.y0, CAM_BOUNDS.y1);
    pivot.z = clamp(pivot.z, CAM_BOUNDS.z0, CAM_BOUNDS.z1);

    const b = this.viewBlend * this.viewBlend * (3 - 2 * this.viewBlend);
    cam.position.lerpVectors(this.tpPos, this.fpPos, b);
    cam.rotation.set(this.camPitch, this.camYaw, 0, 'YXZ');
    // 竖屏时横向视野太窄：保证横向至少约 56°（竖向最多 90°），横屏体验更好
    const baseFov = THREE.MathUtils.lerp(62, 74, b);
    const portraitFov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(28)) / cam.aspect));
    const fov = Math.max(baseFov, Math.min(90, portraitFov));
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    // 镜头贴得太近或进入第一人称时隐藏小人
    ch.visible = b < 0.6 && cam.position.distanceTo(this.eye) > 0.7;
    this.fill.position.copy(cam.position);
    this.fill.intensity = ch.visible ? 0.9 * (1 - b) : 0;

    // ----- 准星与提示 -----
    this.target = this.paused ? null : this.findTarget();
    this.nearSeat = this.paused ? null : this.findSeat();
    const parts = [];
    // 触屏上提示对应的按钮图标，键盘上提示按键
    const [keyE, keyF] = this.touchMode ? ['✋', '🪑'] : ['<kbd>E</kbd>', '<kbd>F</kbd>'];
    if (this.target) parts.push(`${keyE} ${this.describe(this.target)}`);
    if (this.seat) parts.push(`${keyF} 站起来`);
    else if (this.nearSeat) parts.push(`${keyF} 坐到${this.nearSeat.name}上`);
    const prompt = parts.join('<span class="sep">·</span>');
    if (prompt !== this.lastPrompt) {
      this.lastPrompt = prompt;
      this.promptEl.innerHTML = prompt;
      this.promptEl.classList.toggle('show', !!prompt);
    }
    const viewText = this.view === 'first' ? '第一人称' : '第三人称';
    if (this.viewEl.textContent !== viewText) this.viewEl.textContent = viewText;
    this.touch?.update();
    return this.target;
  }
}
