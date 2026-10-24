// 手机上的漫游操作：左下角浮动摇杆 + 右下角动作按钮 + 右上角暂停。
// 摇杆区域占左下一大块，手指按在哪里摇杆就出现在哪里，松开后回到默认位置；
// 推得越远走得越快，推到底就跑。视角拖动和捏合缩放由 Explorer 在画布上处理。

const RADIUS = 52; // 摇杆最大位移（px）

export class TouchControls {
  /**
   * @param {import('./explorer.js').Explorer} explorer
   * @param {HTMLElement} root
   * @param {{ onLight: () => void }} handlers
   */
  constructor(explorer, root, handlers) {
    this.ex = explorer;
    this.h = handlers;
    explorer.touch = this;

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="touch-ui" id="touch-ui">
        <div class="stick-zone" id="stick-zone">
          <div class="stick-base" id="stick-base"><div class="stick-knob" id="stick-knob"></div></div>
        </div>
        <div class="touch-actions">
          <button class="tbtn" data-act="light" aria-label="开关灯">💡</button>
          <button class="tbtn" data-act="view" aria-label="切换视角">🎥</button>
          <button class="tbtn" data-act="seat" aria-label="坐下或站起来">🪑</button>
          <button class="tbtn" data-act="interact" aria-label="互动">✋</button>
          <button class="tbtn tbtn-big" data-act="jump" aria-label="跳">⤒</button>
        </div>
        <button class="tbtn tbtn-pause" data-act="pause" aria-label="暂停">⏸</button>
        <div class="rotate-hint">📱 横过来玩更舒服</div>
      </div>
    `;
    root.append(...wrap.children);
    const $ = (id) => document.getElementById(id);
    this.zone = $('stick-zone');
    this.base = $('stick-base');
    this.knob = $('stick-knob');
    this.buttons = Object.fromEntries([...document.querySelectorAll('#touch-ui [data-act]')].map((b) => [b.dataset.act, b]));

    // 按钮用 pointerdown 触发，比 click 少 300ms 延迟，也不会和视角拖动抢事件
    const actions = {
      jump: () => this.ex.jump(),
      interact: () => this.ex.interact(),
      seat: () => this.ex.toggleSeat(),
      view: () => this.ex.toggleView(),
      light: () => this.h.onLight(),
      pause: () => this.ex.pause(),
    };
    for (const [act, btn] of Object.entries(this.buttons)) {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('pressed');
        actions[act]();
        navigator.vibrate?.(8);
      });
      const up = () => btn.classList.remove('pressed');
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    }

    this.bindStick();
  }

  bindStick() {
    let active = null;
    const setKnob = (dx, dy) => {
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const reset = () => {
      active = null;
      this.ex.stick.x = this.ex.stick.y = 0;
      this.base.style.removeProperty('left');
      this.base.style.removeProperty('top');
      this.base.classList.remove('held', 'running');
      setKnob(0, 0);
    };

    this.zone.addEventListener('pointerdown', (e) => {
      if (active !== null || this.ex.paused) return;
      e.preventDefault();
      active = e.pointerId;
      this.zone.setPointerCapture(e.pointerId);
      // 摇杆移到手指按下的位置
      const r = this.zone.getBoundingClientRect();
      this.center = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX - r.left}px`;
      this.base.style.top = `${e.clientY - r.top}px`;
      this.base.classList.add('held');
    });
    this.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== active) return;
      let dx = e.clientX - this.center.x;
      let dy = e.clientY - this.center.y;
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) {
        dx *= RADIUS / len;
        dy *= RADIUS / len;
      }
      setKnob(dx, dy);
      this.ex.stick.x = dx / RADIUS;
      this.ex.stick.y = -dy / RADIUS;
      this.base.classList.toggle('running', len > RADIUS * 0.92);
    });
    const end = (e) => {
      if (e.pointerId === active) reset();
    };
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
    this.reset = reset;
  }

  /** 每帧由 Explorer 调用：根据准星目标和附近座位点亮对应按钮 */
  update() {
    const ex = this.ex;
    this.buttons.interact.classList.toggle('ready', !!ex.target);
    this.buttons.seat.classList.toggle('ready', !!ex.seat || !!ex.nearSeat);
    this.buttons.seat.textContent = ex.seat ? '🧍' : '🪑';
    if (ex.paused && this.ex.stick.x + this.ex.stick.y !== 0) this.reset();
  }
}
