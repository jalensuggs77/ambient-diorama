import { TRACKS, PRESETS, SPEEDS } from './tracks.js';

// 混音面板：音轨开关/音量、时间、雨量、起雾、预设
export class UI {
  constructor(root, state, handlers) {
    this.state = state;
    this.h = handlers;
    this.rows = {};
    root.innerHTML = `
      <div class="overlay" id="overlay">
        <div class="overlay-card">
          <div class="overlay-kicker">AMBIENT DIORAMA</div>
          <h1>雨夜窗台</h1>
          <p>一个会呼吸的白噪音微缩世界。<br/>点击房间里的物体开关不同音轨，在玻璃上拖动可以擦去雾气。</p>
          <button class="btn-primary" id="start">🎧 戴上耳机，进入</button>
        </div>
      </div>
      <div class="tooltip" id="tooltip"></div>
      <aside class="panel" id="panel">
        <header class="panel-head">
          <button class="collapse" id="collapse" aria-label="收起或展开面板">☰</button>
          <div>
            <div class="title">雨夜窗台</div>
            <div class="subtitle">白噪音混音台</div>
          </div>
          <div class="clock" id="clock">--:--</div>
        </header>
        <div class="panel-body">
          <section>
            <div class="section-title">音轨 <span class="muted">· 也可直接点击场景中的物体</span></div>
            <div id="tracks"></div>
          </section>
          <section>
            <div class="section-title">预设</div>
            <div class="presets" id="presets"></div>
          </section>
          <section>
            <div class="section-title">环境</div>
            <label class="field">
              <span>时间</span>
              <input type="range" id="time" min="0" max="24" step="0.01" />
            </label>
            <label class="field">
              <span>流速</span>
              <select id="speed"></select>
            </label>
            <label class="field">
              <span>天气</span>
              <select id="weather">
                <option value="rain">🌧️ 雨夜</option>
                <option value="snow">❄️ 雪夜</option>
              </select>
            </label>
            <label class="field">
              <span id="rain-label">雨量</span>
              <input type="range" id="rain" min="0" max="1" step="0.01" />
            </label>
            <label class="field">
              <span>起雾</span>
              <input type="range" id="fog" min="0" max="1" step="0.01" />
            </label>
            <div class="field">
              <span>灯光</span>
              <button class="chip light-toggle" id="light"></button>
            </div>
            <label class="field">
              <span>总音量</span>
              <input type="range" id="master" min="0" max="1" step="0.01" />
            </label>
          </section>
          <div class="hint">
            <span class="only-kbd">🖱️ 移动鼠标看看四周 · 滚轮缩放 · 拖动玻璃擦雾<br/>💡 <kbd>L</kbd> 开关房间灯<br/>🚶 左下角「漫游模式」可以用键盘在房间里走动</span>
            <span class="only-touch">👆 左右拖动看看四周 · 轻点物体开关声音 · 在玻璃上拖动擦雾<br/>🚶 左下角「漫游模式」用摇杆在房间里走动，横屏更舒服</span>
          </div>
        </div>
      </aside>
    `;
    this.$ = (id) => root.querySelector('#' + id);

    const tracksEl = this.$('tracks');
    for (const t of TRACKS) {
      const row = document.createElement('div');
      row.className = 'track';
      row.innerHTML = `
        <button class="toggle" title="${t.desc}">
          <span class="icon">${t.icon}</span>
          <span class="name">${t.name}</span>
          <span class="meter"><i></i></span>
        </button>
        <input type="range" min="0" max="1" step="0.01" aria-label="${t.name}音量" />
      `;
      const btn = row.querySelector('button');
      const slider = row.querySelector('input');
      btn.addEventListener('click', () => this.h.onToggle(t.id));
      slider.addEventListener('input', () => this.h.onVolume(t.id, parseFloat(slider.value)));
      tracksEl.appendChild(row);
      this.rows[t.id] = { row, btn, slider, meter: row.querySelector('.meter i') };
    }

    const presetsEl = this.$('presets');
    for (const p of PRESETS) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = p.name;
      b.addEventListener('click', () => this.h.onPreset(p));
      presetsEl.appendChild(b);
    }

    const speed = this.$('speed');
    for (const s of SPEEDS) {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.label;
      speed.appendChild(o);
    }
    speed.addEventListener('change', () => this.h.onSpeed(speed.value));
    this.$('time').addEventListener('input', (e) => this.h.onTime(parseFloat(e.target.value)));
    this.$('rain').addEventListener('input', (e) => this.h.onRain(parseFloat(e.target.value)));
    this.$('weather').addEventListener('change', (e) => this.h.onWeather(e.target.value));
    this.$('light').addEventListener('click', () => this.h.onLight());
    this.$('fog').addEventListener('input', (e) => this.h.onFog(parseFloat(e.target.value)));
    this.$('master').addEventListener('input', (e) => this.h.onMaster(parseFloat(e.target.value)));
    this.$('collapse').addEventListener('click', () => this.$('panel').classList.toggle('collapsed'));
    this.$('start').addEventListener('click', () => this.h.onStart());

    this.tooltip = this.$('tooltip');
    this.sync();
  }

  collapse(on) {
    this.$('panel').classList.toggle('collapsed', on);
  }

  hideOverlay() {
    this.$('overlay').classList.add('hidden');
  }

  /** 状态 -> 控件 */
  sync() {
    const s = this.state;
    for (const t of TRACKS) {
      const r = this.rows[t.id];
      const ts = s.tracks[t.id];
      r.row.classList.toggle('on', ts.on);
      r.slider.value = ts.vol;
    }
    // 下雪时“雨声”这条音轨变成风雪声
    const snow = s.weather === 'snow';
    this.rows.rain.btn.querySelector('.name').textContent = snow ? '风雪' : '雨声';
    this.rows.rain.btn.querySelector('.icon').textContent = snow ? '❄️' : '🌧️';
    this.$('rain-label').textContent = snow ? '雪量' : '雨量';
    this.$('weather').value = s.weather;
    const light = this.$('light');
    light.textContent = s.light ? '💡 关灯' : '💡 开灯';
    light.classList.toggle('on', s.light);
    this.$('time').value = s.hours;
    this.$('speed').value = s.speed;
    this.$('rain').value = s.rain;
    this.$('fog').value = s.fog;
    this.$('master').value = s.master;
  }

  frame(clockText, hours, levels) {
    this.$('clock').textContent = clockText;
    const time = this.$('time');
    if (document.activeElement !== time) time.value = hours;
    for (const t of TRACKS) {
      const lv = Math.min(1, (levels[t.id] || 0) * 6);
      this.rows[t.id].meter.style.transform = `scaleX(${lv.toFixed(3)})`;
    }
  }

  showTooltip(x, y, html) {
    const tt = this.tooltip;
    if (!html) {
      tt.classList.remove('show');
      return;
    }
    tt.innerHTML = html;
    tt.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
    tt.classList.add('show');
  }
}
