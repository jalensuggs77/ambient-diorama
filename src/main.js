import * as THREE from 'three';
import './style.css';
import { DayNight } from './dayNight.js';
import { Outdoor } from './scene/outdoor.js';
import { Room, WINDOW } from './scene/room.js';
import { AudioEngine } from './audio/engine.js';
import { UI } from './ui.js';
import { TRACKS, SPEEDS } from './tracks.js';

const params = new URLSearchParams(location.search);
const widgetMode = params.has('widget');
const debugOutside = params.get('debug') === 'outside';
document.body.classList.toggle('widget', widgetMode);

// ---------- 状态（本地记住用户的混音） ----------
const STORAGE_KEY = 'ambient-diorama:v1';
const defaults = {
  hours: 21.5,
  speed: 'normal',
  rain: 0.7,
  fog: 0.55,
  master: 0.8,
  tracks: Object.fromEntries(TRACKS.map((t) => [t.id, { on: t.id === 'rain' || t.id === 'fire', vol: 0.7 }])),
};
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && saved.tracks) {
      return { ...defaults, ...saved, tracks: { ...defaults.tracks, ...saved.tracks } };
    }
  } catch {
    /* 隐私模式等情况下忽略 */
  }
  return structuredClone(defaults);
}
const state = loadState();
if (params.has('t')) state.hours = parseFloat(params.get('t')) % 24;
if (params.has('rain')) state.rain = parseFloat(params.get('rain'));
let saveTimer = 0;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, 300);
}

// ---------- 渲染器 ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

// 窗外世界渲染到这张带 mipmap 的 HDR 纹理，玻璃着色器再去折射/模糊它
const outsideRT = new THREE.WebGLRenderTarget(4, 4, {
  type: THREE.HalfFloatType,
  samples: 4,
  generateMipmaps: true,
  minFilter: THREE.LinearMipmapLinearFilter,
  magFilter: THREE.LinearFilter,
});

const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1500);
const camBase = new THREE.Vector3(0.3, 2.05, 4.6);
const lookTarget = new THREE.Vector3(0.1, 1.3, 0.4);

const env = new DayNight();
const outdoor = new Outdoor();
const room = new Room(outsideRT.texture);
const audio = new AudioEngine();

// 音源位置 = 场景里物体的位置
const sourcePositions = {
  rain: new THREE.Vector3(WINDOW.cx, WINDOW.cy, WINDOW.glassZ),
  fire: new THREE.Vector3(-2.65, 0.6, 0.4),
  radio: room.interactive.radio.position.clone().add(new THREE.Vector3(0, 0.15, 0)),
  chime: room.interactive.chime.position.clone().add(new THREE.Vector3(0, -0.45, 0)),
  cat: room.interactive.cat.position.clone().add(new THREE.Vector3(0, 0.15, 0)),
};

audio.on('chime', (i, amp) => room.chimeStrike(i, amp));
audio.on('crackle', (n) => room.spawnSparks(n));
audio.on('beat', (s) => room.radioBeat(s));

// ---------- 交互逻辑 ----------
function applyTrack(id) {
  const ts = state.tracks[id];
  room.setActive(id, ts.on);
  if (audio.started) {
    audio.setVolume(id, ts.vol);
    audio.setEnabled(id, ts.on);
  }
}

async function startAudio() {
  if (audio.started) return;
  await audio.start();
  audio.setPositions(sourcePositions);
  audio.setMaster(state.master);
  audio.setRain(state.rain);
  TRACKS.forEach((t) => applyTrack(t.id));
  ui.hideOverlay();
}

function toggleTrack(id) {
  state.tracks[id].on = !state.tracks[id].on;
  applyTrack(id);
  ui.sync();
  saveState();
  startAudio();
}

const ui = new UI(document.getElementById('ui'), state, {
  onStart: startAudio,
  onToggle: toggleTrack,
  onVolume(id, v) {
    state.tracks[id].vol = v;
    if (v > 0 && !state.tracks[id].on) state.tracks[id].on = true;
    applyTrack(id);
    ui.sync();
    saveState();
  },
  onPreset(p) {
    for (const t of TRACKS) {
      const v = p.tracks[t.id];
      state.tracks[t.id].on = v !== undefined;
      if (v !== undefined) state.tracks[t.id].vol = v;
      applyTrack(t.id);
    }
    state.rain = p.rain;
    audio.started && audio.setRain(state.rain);
    ui.sync();
    saveState();
    startAudio();
  },
  onSpeed(s) {
    state.speed = s;
    saveState();
  },
  onTime(h) {
    state.hours = h;
    if (state.speed === 'real') {
      state.speed = 'pause';
      ui.sync();
    }
    saveState();
  },
  onRain(v) {
    state.rain = v;
    if (audio.started) audio.setRain(v);
    saveState();
  },
  onFog(v) {
    state.fog = v;
    saveState();
  },
  onMaster(v) {
    state.master = v;
    audio.setMaster(v);
    saveState();
  },
});
TRACKS.forEach((t) => room.setActive(t.id, state.tracks[t.id].on));
if (widgetMode || window.innerWidth < 720) ui.collapse(true);
document.getElementById('collapse').addEventListener('click', () => requestAnimationFrame(resize));

// ---------- 指针：视差、悬停、点击、擦玻璃 ----------
const raycaster = new THREE.Raycaster();
raycaster.params.Line.threshold = 0.005;
raycaster.params.Points.threshold = 0;
const pointer = new THREE.Vector2();
const parallax = { x: 0, y: 0, tx: 0, ty: 0, zoom: 1, tzoom: 1, pan: 0 };
let down = null;

function pick(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(room.scene.children, true);
  for (const h of hits) {
    if (h.object.isPoints || (h.object.isMesh && h.object.material.blending === THREE.AdditiveBlending)) continue;
    let o = h.object;
    while (o && !o.userData.trackId) o = o.parent;
    return { id: o ? o.userData.trackId : null, hit: h };
  }
  return { id: null, hit: null };
}

function tooltipFor(id) {
  const t = TRACKS.find((x) => x.id === id);
  if (!t) return '';
  const on = state.tracks[id].on;
  const extra = id === 'rain' ? '<br><small>拖动可擦去玻璃上的雾气</small>' : '';
  return `<b>${t.icon} ${t.name}</b> · ${on ? '正在播放' : '已关闭'}<br><small>点击${on ? '关闭' : '开启'} — ${t.desc}</small>${extra}`;
}

canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  parallax.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
  parallax.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
  const { id, hit } = pick(e.clientX, e.clientY);
  if (down) {
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (down.id === 'rain' && moved > 6) down.wiping = true;
    if (down.wiping && id === 'rain' && hit.uv) {
      // 在两次事件之间插值，划出连续的擦痕
      const last = down.lastUv || hit.uv;
      const steps = Math.ceil(last.distanceTo(hit.uv) * 80) + 1;
      for (let i = 1; i <= steps; i++) room.wipeAt(last.clone().lerp(hit.uv, i / steps));
      down.lastUv = hit.uv.clone();
    }
  }
  room.setHover(id);
  canvas.style.cursor = id ? (down?.wiping ? 'grabbing' : 'pointer') : 'default';
  ui.showTooltip(e.clientX, e.clientY, down?.wiping ? '' : tooltipFor(id));
});

canvas.addEventListener('pointerdown', (e) => {
  const { id, hit } = pick(e.clientX, e.clientY);
  down = { x: e.clientX, y: e.clientY, id, wiping: false, lastUv: hit?.uv?.clone() };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointerup', (e) => {
  if (down && !down.wiping && down.id && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) {
    const { id } = pick(e.clientX, e.clientY);
    if (id === down.id) toggleTrack(id);
    ui.showTooltip(e.clientX, e.clientY, tooltipFor(id));
  }
  down = null;
});

canvas.addEventListener('pointerleave', (e) => {
  room.setHover(null);
  ui.showTooltip(0, 0, '');
  // 触屏上松手后保持当前视角，方便看清两侧的壁炉和猫
  if (e.pointerType !== 'touch') {
    parallax.tx = 0;
    parallax.ty = 0;
  }
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    parallax.tzoom = THREE.MathUtils.clamp(parallax.tzoom * Math.exp(e.deltaY * 0.001), 0.55, 1.15);
  },
  { passive: false },
);

// ---------- 尺寸 ----------
const bufferSize = new THREE.Vector2();
function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  renderer.getDrawingBufferSize(bufferSize);
  outsideRT.setSize(bufferSize.x, bufferSize.y);
  // 面板展开时，把画面构图中心移到面板左侧的空白区域
  const panel = document.getElementById('panel');
  const reserve = w > 720 && panel && !panel.classList.contains('collapsed') ? panel.offsetWidth + 24 : 0;
  camera.aspect = (w + reserve) / h;
  camera.setViewOffset(w + reserve, h, reserve, 0, w, h);
  // 窄屏时加大视角，保证壁炉和猫都在画面里
  const freeAspect = (w - reserve) / h;
  const needHalfW = 3.5;
  const hfov = 2 * Math.atan(needHalfW / camBase.distanceTo(lookTarget));
  const vfovForWidth = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / freeAspect));
  camera.fov = THREE.MathUtils.clamp(Math.max(48, vfovForWidth), 48, 84);
  camera.updateProjectionMatrix();
  // 竖屏放不下整个房间时，允许左右平移视角
  const visibleHalfW = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * freeAspect * camBase.distanceTo(lookTarget);
  parallax.pan = Math.max(0, needHalfW - visibleHalfW);
}
window.addEventListener('resize', resize);
resize();

// ---------- 闪电 ----------
const flashes = [];
let forceFlash = false;
function maybeLightning(t, dt) {
  const chance = Math.max(0, state.rain - 0.55) * 0.14 * dt;
  if (Math.random() < chance || forceFlash) {
    forceFlash = false;
    const amp = 0.6 + Math.random() * 0.8;
    flashes.push({ t, amp }, { t: t + 0.09 + Math.random() * 0.1, amp: amp * 0.6 });
    if (Math.random() < 0.5) flashes.push({ t: t + 0.3 + Math.random() * 0.2, amp: amp * 0.4 });
    const delay = 0.4 + Math.random() * 2.6;
    audio.started && audio.thunder(delay, Math.min(1, 1.15 - delay / 3.5));
  }
  let v = 0;
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    const age = t - f.t;
    if (age > 1.5) flashes.splice(i, 1);
    else if (age >= 0) v += f.amp * Math.exp(-age * 16);
  }
  return v;
}

// ---------- 主循环 ----------
const lookAt = new THREE.Vector3();
const timer = new THREE.Timer();
timer.connect(document);
let time = 0;
let uiTimer = 0;
function frame() {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  time += dt;

  const speed = SPEEDS.find((s) => s.id === state.speed) || SPEEDS[0];
  if (speed.id === 'real') {
    const d = new Date();
    state.hours = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  } else {
    state.hours = (state.hours + speed.hoursPerSecond * dt) % 24;
  }
  env.hours = state.hours;
  env.rain = state.rain;
  env.update();
  const lightning = maybeLightning(time, dt);

  // 镜头随鼠标轻微视差
  parallax.x += (parallax.tx - parallax.x) * Math.min(1, dt * 2.5);
  parallax.y += (parallax.ty - parallax.y) * Math.min(1, dt * 2.5);
  parallax.zoom += (parallax.tzoom - parallax.zoom) * Math.min(1, dt * 4);
  const panX = parallax.x * parallax.pan;
  camera.position.set(
    camBase.x + panX + parallax.x * 0.45 + Math.sin(time * 0.11) * 0.03,
    camBase.y - parallax.y * 0.2 + Math.sin(time * 0.17) * 0.015,
    camBase.z,
  );
  lookAt.copy(lookTarget).x += panX;
  camera.position.lerp(lookAt, 1 - parallax.zoom);
  camera.lookAt(lookAt);
  camera.updateMatrixWorld();

  outdoor.update(time, dt, env, state.rain, lightning);
  room.update(time, dt, env, {
    rain: state.rain,
    fog: state.fog,
    lightning,
    width: bufferSize.x,
    height: bufferSize.y,
    ...audio.visualState(),
  });
  audio.updateListener(camera);

  renderer.setRenderTarget(outsideRT);
  renderer.render(outdoor.scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(debugOutside ? outdoor.scene : room.scene, camera);

  uiTimer += dt;
  if (uiTimer > 0.08) {
    uiTimer = 0;
    ui.frame(env.clockText(), state.hours, audio.levels());
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 方便调试
window.__diorama = { state, env, room, outdoor, audio, renderer, camera, flash: () => (forceFlash = true) };
