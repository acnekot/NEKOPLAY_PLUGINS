// @id osu_motion
// @name osu!lazer 动效引擎
// @type motion
// @version 2.0.0
// @minHost 0.6.8
// @permissions motion.profile, storage
// @author NEKOPLAY
// @desc 规范化外置动效插件：基于 osu-framework 解析缓动重做，主打瞬间爆发 + 超长丝滑留尾刹停（OutExpoTail / OutQuint / OutPow10 / OutElasticQuarter），内置四套预设与留尾时长调节，更新插件即可热更
// @api 2

const PRESETS = {
  lazer_tail: {
    label: '经典长留尾',
    desc: '前 20% 瞬间冲出 85%+，后 80% 丝滑飘停零回弹（OutExpoTail）',
    quick:     { easing: 'outExpo',     ms: 240 },
    standard:  { easing: 'outExpoTail', ms: 460 },
    page:      { easing: 'outExpoTail', ms: 620 },
    crossfade: { easing: 'outQuint',    ms: 640 },
    hero:      { easing: 'outExpoTail', ms: 650 },
    effects:   { hoverShiftDp: 8, hoverTint: true, pressScale: 0.96, pageScale: true },
  },
  lazer_quint: {
    label: '五次留尾 OutQuint',
    desc: '经典 osu!lazer 默认五次方缓出曲线，顺滑匀称、柔和长尾',
    quick:     { easing: 'outExpo',  ms: 220 },
    standard:  { easing: 'outQuint', ms: 420 },
    page:      { easing: 'outQuint', ms: 560 },
    crossfade: { easing: 'outQuint', ms: 580 },
    hero:      { easing: 'outQuint', ms: 580 },
    effects:   { hoverShiftDp: 7, hoverTint: true, pressScale: 0.955, pageScale: true },
  },
  lazer_elastic: {
    label: '微弹律动',
    desc: '常规交互保留长留尾，弹窗与主视觉叠加轻微弹性回弹（OutElasticQuarter）',
    quick:     { easing: 'outExpo',           ms: 200 },
    standard:  { easing: 'outQuint',          ms: 400 },
    page:      { easing: 'outExpo',           ms: 540 },
    crossfade: { easing: 'outQuint',          ms: 560 },
    hero:      { easing: 'outElasticQuarter', ms: 620 },
    effects:   { hoverShiftDp: 8, hoverTint: true, pressScale: 0.945, pageScale: true },
  },
  lazer_snappy: {
    label: '竞技极速留尾',
    desc: '十次方瞬发（OutPow10），80ms 内极速到位，保留细腻干脆的收尾滑行',
    quick:     { easing: 'outPow10', ms: 180 },
    standard:  { easing: 'outPow10', ms: 360 },
    page:      { easing: 'outPow10', ms: 460 },
    crossfade: { easing: 'outQuint', ms: 480 },
    hero:      { easing: 'outPow10', ms: 480 },
    effects:   { hoverShiftDp: 6, hoverTint: true, pressScale: 0.965, pageScale: true },
  },
};

const TAILS = [
  { key: 'compact', label: '干脆 0.85×', mult: 0.85 },
  { key: 'normal',  label: '标准 1.0×',  mult: 1.00 },
  { key: 'velvet',  label: '极致留尾 1.25×', mult: 1.25 },
];

function getState() {
  return Object.assign({ preset: 'lazer_tail', tail: 'normal' }, nk.store.get('cfg') || {});
}

function buildProfile() {
  const st = getState();
  const p = PRESETS[st.preset] || PRESETS.lazer_tail;
  const tail = TAILS.find(t => t.key === st.tail) || TAILS[1];
  const scale = (ch) => ({ easing: ch.easing, ms: Math.round(ch.ms * tail.mult) });
  return {
    name: 'osu!lazer',
    preset: st.preset,
    presetLabel: p.label,
    quick: scale(p.quick),
    standard: scale(p.standard),
    page: scale(p.page),
    crossfade: scale(p.crossfade),
    hero: scale(p.hero),
    effects: p.effects,
  };
}

nk.registerMotion({
  manifest() {
    return { api: 2, type: 'motion', name: 'osu!lazer 动效引擎' };
  },
  profile() {
    return buildProfile();
  },
  render(ctx) {
    const st = getState();
    const p = PRESETS[st.preset] || PRESETS.lazer_tail;
    const prof = buildProfile();
    return {
      type: 'column', gap: 14, children: [
        { type: 'tag', text: 'MOTION PLUGIN · PLUGIN API V2' },
        { type: 'text', text: 'osu!lazer 动效引擎', size: 22, weight: 800 },
        { type: 'text', text: '基于解析数学缓动彻底重做的外置动效包，强调「极速起手 + 超长丝滑留尾刹停」，所有通道均由本插件独立热更新驱动。', size: 12, tone: 'sub' },
        {
          type: 'card', gap: 10, children: [
            { type: 'text', text: '动效曲线预设（当前：' + p.label + '）', size: 14, weight: 700 },
            { type: 'text', text: p.desc, size: 12, tone: 'sub' },
            {
              type: 'row', gap: 8, children: Object.keys(PRESETS).map(k => ({
                type: 'button', text: PRESETS[k].label, primary: st.preset === k, action: 'preset', payload: { key: k },
              })),
            },
          ],
        },
        {
          type: 'card', gap: 10, children: [
            { type: 'text', text: '留尾滑行长度', size: 14, weight: 700 },
            { type: 'text', text: '拉长留尾倍率可让页面与侧栏滑出更绵长的丝滑阻尼停顿感', size: 12, tone: 'sub' },
            {
              type: 'row', gap: 8, children: TAILS.map(t => ({
                type: 'button', text: t.label, primary: st.tail === t.key, action: 'tail', payload: { key: t.key },
              })),
            },
          ],
        },
        {
          type: 'card', gap: 6, children: [
            { type: 'text', text: '当前各通道参数（实时生效）', size: 13, weight: 700 },
            { type: 'text', text: 'QUICK: ' + prof.quick.easing + ' · ' + prof.quick.ms + 'ms  |  STD: ' + prof.standard.easing + ' · ' + prof.standard.ms + 'ms', size: 11, tone: 'primary', mono: true },
            { type: 'text', text: 'PAGE: ' + prof.page.easing + ' · ' + prof.page.ms + 'ms  |  HERO: ' + prof.hero.easing + ' · ' + prof.hero.ms + 'ms', size: 11, tone: 'primary', mono: true },
            { type: 'text', text: '悬停位移 ' + prof.effects.hoverShiftDp + 'dp  ·  按压缩放 ' + prof.effects.pressScale, size: 11, tone: 'sub', mono: true },
          ],
        },
        {
          type: 'row', gap: 8, children: [
            { type: 'button', text: '恢复默认', action: 'reset' },
          ],
        },
      ],
    };
  },
  onAction(act, payload) {
    const st = getState();
    if (act === 'preset' && payload && PRESETS[payload.key]) {
      st.preset = payload.key;
      nk.store.set('cfg', st);
      return { toast: '已切换为「' + PRESETS[payload.key].label + '」' };
    }
    if (act === 'tail' && payload && TAILS.some(t => t.key === payload.key)) {
      st.tail = payload.key;
      nk.store.set('cfg', st);
      return { toast: '留尾长度已更新' };
    }
    if (act === 'reset') {
      nk.store.set('cfg', { preset: 'lazer_tail', tail: 'normal' });
      return { toast: '已恢复 osu!lazer 默认长留尾配置' };
    }
    return null;
  },
  action() {
    return { open: 'plugin:osu_motion', message: '已打开 osu!lazer 动效设置' };
  },
});
