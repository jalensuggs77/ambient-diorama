import * as THREE from 'three';

// 昼夜循环：根据一天中的时间（小时）和雨量计算天空、太阳/月亮与环境光参数。
// 太阳在窗外（-z 方向）划过一道弧线，因此阳光会透过窗户在室内投下光斑。

const smooth = THREE.MathUtils.smoothstep;
const clamp = THREE.MathUtils.clamp;

const C = (hex) => new THREE.Color(hex);

const PALETTE = {
  nightTop: C(0x03050d),
  nightHorizon: C(0x1c0f33),
  twilightTop: C(0x232a58),
  twilightHorizon: C(0xff7b47),
  dayTop: C(0x2f78d6),
  dayHorizon: C(0xb4d3ef),
  sunLow: C(0xff8a4a),
  sunHigh: C(0xfff3de),
  moon: C(0x8fa8ff),
  groundWarm: C(0x3a2418),
};

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function overcast(color, amount, brightness) {
  const l = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  tmpA.setRGB(l * 0.92 * brightness, l * 0.97 * brightness, l * 1.08 * brightness);
  return color.lerp(tmpA, amount);
}

export class DayNight {
  constructor() {
    this.hours = 21.5;
    this.rain = 0.7;

    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.keyDir = new THREE.Vector3();
    this.skyTop = new THREE.Color();
    this.skyHorizon = new THREE.Color();
    this.sunColor = new THREE.Color();
    this.keyColor = new THREE.Color();
    this.hemiSky = new THREE.Color();
    this.hemiGround = PALETTE.groundWarm.clone();

    this.keyIntensity = 0;
    this.hemiIntensity = 0;
    this.day = 0;
    this.night = 0;
    this.twilight = 0;
    this.neon = 0;
    this.update();
  }

  /** 0..1 当天进度 */
  get phase() {
    return this.hours / 24;
  }

  update() {
    const theta = (this.phase - 0.25) * Math.PI * 2; // 6:00 日出，12:00 正午，18:00 日落
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    this.sunDir.set(c * 0.62, s * 0.58, -0.72).normalize();
    this.moonDir.set(-c * 0.55, -s * 0.5, -0.78).normalize();

    const el = this.sunDir.y;
    const rain = this.rain;
    this.day = smooth(el, -0.1, 0.28);
    this.night = 1 - smooth(el, -0.22, 0.02);
    this.twilight = clamp(1 - Math.abs(el + 0.02) / 0.22, 0, 1) ** 1.5;
    this.neon = 0.25 + 0.75 * (1 - smooth(el, -0.08, 0.18));

    // 天空颜色
    this.skyTop.copy(PALETTE.nightTop).lerp(PALETTE.dayTop, this.day);
    this.skyHorizon.copy(PALETTE.nightHorizon).lerp(PALETTE.dayHorizon, this.day);
    const tw = this.twilight * (1 - rain * 0.55);
    this.skyTop.lerp(PALETTE.twilightTop, tw * 0.6);
    this.skyHorizon.lerp(PALETTE.twilightHorizon, tw * 0.75);
    overcast(this.skyTop, rain * 0.75, 0.8);
    overcast(this.skyHorizon, rain * 0.6, 0.9);

    // 太阳颜色：贴近地平线时偏橙
    this.sunColor.copy(PALETTE.sunLow).lerp(PALETTE.sunHigh, smooth(el, 0.0, 0.45));

    // 主光源：白天是太阳，夜晚切换为月光（两者在地平线附近都接近 0，切换无跳变）
    const sunI = smooth(el, -0.04, 0.3) * 3.2 * (1 - rain * 0.62);
    const moonEl = this.moonDir.y;
    const moonI = smooth(moonEl, -0.02, 0.3) * 0.55 * (1 - rain * 0.45);
    if (el > 0 || sunI > moonI) {
      this.keyDir.copy(this.sunDir);
      this.keyColor.copy(this.sunColor);
      this.keyIntensity = sunI;
    } else {
      this.keyDir.copy(this.moonDir);
      this.keyColor.copy(PALETTE.moon);
      this.keyIntensity = moonI;
    }

    // 环境光
    tmpB.copy(this.skyTop).lerp(this.skyHorizon, 0.5);
    this.hemiSky.copy(tmpB);
    this.hemiIntensity = 0.12 + this.day * 0.9 + this.twilight * 0.15;
    return this;
  }

  /** "21:30" */
  clockText() {
    const h = Math.floor(this.hours) % 24;
    const m = Math.floor((this.hours - Math.floor(this.hours)) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
