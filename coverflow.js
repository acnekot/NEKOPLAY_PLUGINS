// @id coverflow
// @name 3D 封面墙
// @type feature
// @feature coverflow
// @version 2.0.0
// @minHost 0.6.8
// @permissions library.read, player.control, sensor.tilt, ui.sidebar
// @author NEKOPLAY
// @desc 经典 3D 透视封面墙（外包透明 CD 塑料壳、无缝亚克力厚边、3D 旋身翻盖放大、桌面一键收起侧栏、手机竖屏直进专辑/横屏自动展开；支持插件内热更新参数与预设）
// @api 2

const DEFAULTS = {
  preset: 'classic',
  wingAngle: 64,
  maxOpenScale: 1.65,
  spinDeg: 22,
  spineRatio: 0.11,
  thicknessDp: 6.5,
  reflectionAlpha: 0.30,
  portraitExpand: false,
  desktopSidebarToggle: true,
};

const PRESETS = {
  classic: { label: '经典 CD 盒', wingAngle: 64, thicknessDp: 6.5, spinDeg: 22, reflectionAlpha: 0.30 },
  deluxe:  { label: '典藏厚盒',   wingAngle: 68, thicknessDp: 9.5, spinDeg: 28, reflectionAlpha: 0.38 },
  minimal: { label: '轻盈极简',   wingAngle: 56, thicknessDp: 3.5, spinDeg: 14, reflectionAlpha: 0.18 },
};

function loadCfg() {
  return Object.assign({}, DEFAULTS, nk.store.get('cfg') || {});
}

nk.registerFeature({
  manifest() {
    return {
      api: 2,
      type: 'feature',
      feature: 'coverflow',
      autoLandscape: true,
      navEntry: true,
    };
  },
  config() {
    return loadCfg();
  },
  render(ctx) {
    const c = loadCfg();
    const p = PRESETS[c.preset] || PRESETS.classic;
    return {
      type: 'column', gap: 14, children: [
        { type: 'tag', text: 'COVER FLOW · PLUGIN API V2' },
        { type: 'text', text: '3D 封面墙参数与预设', size: 22, weight: 800 },
        { type: 'text', text: '所有外观与交互参数均由 coverflow.js 热更新驱动，修改后立刻生效，无需重新安装软件本体。', size: 12, tone: 'sub' },
        {
          type: 'card', gap: 10, children: [
            { type: 'text', text: 'CD 塑料壳视觉预设（当前：' + p.label + '）', size: 14, weight: 700 },
            {
              type: 'row', gap: 8, children: Object.keys(PRESETS).map(k => ({
                type: 'button', text: PRESETS[k].label, primary: c.preset === k, action: 'preset', payload: { key: k },
              })),
            },
          ],
        },
        {
          type: 'card', gap: 10, children: [
            { type: 'text', text: '交互策略', size: 14, weight: 700 },
            { type: 'text', text: '手机竖屏点击中心封面：' + (c.portraitExpand ? '翻开 CD 盒展开曲目' : '直接进入专辑 / 歌单详情页（推荐）'), size: 12, tone: 'sub' },
            {
              type: 'row', gap: 8, children: [
                { type: 'button', text: c.portraitExpand ? '切换为竖屏直进详情' : '切换为竖屏也翻开', action: 'togglePortrait' },
                { type: 'button', text: '恢复默认', action: 'reset' },
              ],
            },
          ],
        },
        {
          type: 'row', gap: 10, children: [
            { type: 'button', text: '立即打开 3D 封面墙', primary: true, action: 'openCoverFlow' },
          ],
        },
      ],
    };
  },
  onAction(act, payload) {
    const c = loadCfg();
    if (act === 'openCoverFlow') return { open: 'coverflow', refresh: false };
    if (act === 'preset' && payload && PRESETS[payload.key]) {
      const next = Object.assign({}, c, PRESETS[payload.key], { preset: payload.key });
      nk.store.set('cfg', next);
      return { toast: '已切换为「' + PRESETS[payload.key].label + '」' };
    }
    if (act === 'togglePortrait') {
      c.portraitExpand = !c.portraitExpand;
      nk.store.set('cfg', c);
      return { toast: c.portraitExpand ? '竖屏已改为点击翻开 CD 盒' : '竖屏已改为点击直进详情页' };
    }
    if (act === 'reset') {
      nk.store.set('cfg', DEFAULTS);
      return { toast: '已恢复默认参数' };
    }
    return null;
  },
  action() {
    return { open: 'coverflow', message: '已打开 3D 封面墙' };
  },
});
