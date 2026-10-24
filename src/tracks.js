// 音轨与预设定义（视觉、音频、界面共用）
export const TRACKS = [
  { id: 'rain', name: '雨声', icon: '🌧️', where: '窗玻璃', desc: '玻璃上的雨点、窗台滴水与远处雷声' },
  { id: 'fire', name: '壁炉', icon: '🔥', where: '壁炉', desc: '低沉的火焰呼吸与木柴噼啪' },
  { id: 'radio', name: '收音机', icon: '📻', where: '收音机', desc: '电台沙沙底噪 + lo-fi 和弦' },
  { id: 'chime', name: '风铃', icon: '🎐', where: '风铃', desc: '随阵风敲响的五音铜管' },
  { id: 'cat', name: '猫咪呼噜', icon: '🐈', where: '猫', desc: '与胸口起伏同步的呼噜声' },
];

export const PRESETS = [
  { name: '专注', tracks: { rain: 0.7, radio: 0.55 }, rain: 0.6 },
  { name: '入眠', tracks: { rain: 0.8, fire: 0.45, cat: 0.7 }, rain: 0.85 },
  { name: '雨夜电台', tracks: { rain: 0.6, radio: 0.8, chime: 0.35, fire: 0.4 }, rain: 0.7 },
  { name: '晴日微风', tracks: { chime: 0.8, cat: 0.5 }, rain: 0.0 },
];

export const SPEEDS = [
  { id: 'pause', label: '暂停', hoursPerSecond: 0 },
  { id: 'real', label: '跟随本地时间', hoursPerSecond: 0 },
  { id: 'slow', label: '一天 = 20 分钟', hoursPerSecond: 24 / 1200 },
  { id: 'normal', label: '一天 = 5 分钟', hoursPerSecond: 24 / 300 },
  { id: 'fast', label: '一天 = 1 分钟', hoursPerSecond: 24 / 60 },
];
