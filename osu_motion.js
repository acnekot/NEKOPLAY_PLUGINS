// @id osu_motion
// @name osu!stable 动效引擎
// @type motion
// @version 2.3.0
// @minHost 0.6.8
// @permissions motion.profile, storage
// @author NEKOPLAY
// @desc 选歌架式瀑布入场与侧栏留尾滑出
// @details 列表逐项瀑布入场，悬停时弹出位移
// @details 设置侧栏留尾滑出
// @details 预设、留尾倍率与瀑布强度可在插件里热调
// @screenshots screenshots/osu_motion-1.jpg
// @api 2

const PRESETS = {
  stable_classic: {
    label: 'osu!stable 经典',
    desc: '还原经典 osu!stable 选歌架逐项瀑布滑入（28ms/48dp）、设置栏留尾滑出与 10dp 悬停弹出',
    quick:     { easing: 'outCubic', ms: 180 },
    standard:  { easing: 'outQuart', ms: 340 },
    page:      { easing: 'outExpo',  ms: 440 },
    crossfade: { easing: 'outQuad',  ms: 500 },
    hero:      { easing: 'outQuart', ms: 380 },
    effects:   { hoverShiftDp: 10, hoverTint: true, pressScale: 0.965, pageScale: true, listStaggerMs: 28, listSlideDp: 48 },
  },
  stable_tail: {
    label: 'stable 选歌长留尾',
    desc: '强化选歌架滑行留尾感（OutExpoTail）与更深瀑布滑入（34ms/56dp），悬停弹出 11dp',
    quick:     { easing: 'outQuart',    ms: 220 },
    standard:  { easing: 'outExpo',     ms: 440 },
    page:      { easing: 'outExpoTail', ms: 560 },
    crossfade: { easing: 'outCubic',    ms: 540 },
    hero:      { easing: 'outExpo',     ms: 480 },
    effects:   { hoverShiftDp: 11, hoverTint: true, pressScale: 0.96, pageScale: true, listStaggerMs: 34, listSlideDp: 56 },
  },
  stable_snappy: {
    label: 'stable 极速干脆',
    desc: '纯正经典 OutCubic / OutQuad 短平快响应，18ms 极速瀑布加载，零多余拖影',
    quick:     { easing: 'outQuad',  ms: 140 },
    standard:  { easing: 'outCubic', ms: 260 },
    page:      { easing: 'outQuart', ms: 340 },
    crossfade: { easing: 'outQuad',  ms: 420 },
    hero:      { easing: 'outCubic', ms: 300 },
    effects:   { hoverShiftDp: 9, hoverTint: true, pressScale: 0.97, pageScale: true, listStaggerMs: 18, listSlideDp: 36 },
  },
  lazer_quint: {
    label: 'lazer 五次留尾',
    desc: '附带 osu!lazer 风格 OutQuint 长尾缓动预设供对比切换',
    quick:     { easing: 'outExpo',  ms: 220 },
    standard:  { easing: 'outQuint', ms: 420 },
    page:      { easing: 'outQuint', ms: 560 },
    crossfade: { easing: 'outQuint', ms: 580 },
    hero:      { easing: 'outQuint', ms: 580 },
    effects:   { hoverShiftDp: 7, hoverTint: true, pressScale: 0.955, pageScale: true, listStaggerMs: 26, listSlideDp: 42 },
  },
};

const TAILS = [
  { key: 'compact', label: '干脆 0.85×', mult: 0.85 },
  { key: 'normal',  label: '标准 1.0×',  mult: 1.00 },
  { key: 'velvet',  label: '加长留尾 1.25×', mult: 1.25 },
];

const CASCADES = [
  { key: 'off',     label: '关闭瀑布', msScale: 0,    slideScale: 0 },
  { key: 'soft',    label: '轻柔 0.6×', msScale: 0.6, slideScale: 0.6 },
  { key: 'classic', label: '经典 1.0×', msScale: 1.0, slideScale: 1.0 },
];

function getState() {
  const saved = nk.store.get('cfg') || {};
  const preset = PRESETS[saved.preset] ? saved.preset : 'stable_classic';
  const tail = TAILS.some(t => t.key === saved.tail) ? saved.tail : 'normal';
  const cascade = CASCADES.some(c => c.key === saved.cascade) ? saved.cascade : 'classic';
  return { preset, tail, cascade };
}

function buildProfile() {
  const st = getState();
  const p = PRESETS[st.preset] || PRESETS.stable_classic;
  const tail = TAILS.find(t => t.key === st.tail) || TAILS[1];
  const cas = CASCADES.find(c => c.key === st.cascade) || CASCADES[2];
  const scale = (ch) => ({ easing: ch.easing, ms: Math.round(ch.ms * tail.mult) });
  const fx = Object.assign({}, p.effects, {
    listStaggerMs: Math.round((p.effects.listStaggerMs || 0) * cas.msScale),
    listSlideDp: Math.round((p.effects.listSlideDp || 0) * cas.slideScale),
  });
  return {
    name: 'osu!stable',
    preset: st.preset,
    presetLabel: p.label,
    quick: scale(p.quick),
    standard: scale(p.standard),
    page: scale(p.page),
    crossfade: scale(p.crossfade),
    hero: scale(p.hero),
    effects: fx,
  };
}

nk.registerMotion({
  manifest() {
    return { api: 2, type: 'motion', name: 'osu!stable 动效引擎' };
  },
  profile() {
    return buildProfile();
  },
  render(ctx) {
    const st = getState();
    const p = PRESETS[st.preset] || PRESETS.stable_classic;
    const prof = buildProfile();
    return {
      type: 'column', gap: 14, children: [
        { type: 'tag', text: 'OSU!STABLE MOTION · PLUGIN API V2' },
        { type: 'text', text: 'osu!stable 动效引擎', size: 22, weight: 800 },
        { type: 'text', text: '还原经典 osu!stable 的选歌架悬停弹出、设置栏留尾滑出与 500ms 背景切歌淡入；本次仅更新插件脚本即刻生效，无需更新软件本体。', size: 12, tone: 'sub' },
        {
          type: 'card', gap: 10, children: [
            { type: 'text', text: '动效预设（当前：' + p.label + '）', size: 14, weight: 700 },
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
            { type: 'text', text: '留尾滑行倍率', size: 14, weight: 700 },
            { type: 'text', text: '想让选歌架/切页的收尾滑行更绵长可选「加长留尾 1.25×」', size: 12, tone: 'sub' },
            {
              type: 'row', gap: 8, children: TAILS.map(t => ({
                type: 'button', text: t.label, primary: st.tail === t.key, action: 'tail', payload: { key: t.key },
              })),
            },
          ],
        },
        {
          type: 'card', gap: 10, children: [
            { type: 'text', text: '列表瀑布入场强度', size: 14, weight: 700 },
            { type: 'text', text: '瀑布入场仅由动效插件提供，关闭后列表将即时呈现', size: 12, tone: 'sub' },
            {
              type: 'row', gap: 8, children: CASCADES.map(c => ({
                type: 'button', text: c.label, primary: st.cascade === c.key, action: 'cascade', payload: { key: c.key },
              })),
            },
          ],
        },
        {
          type: 'card', gap: 6, children: [
            { type: 'text', text: '当前通道参数', size: 13, weight: 700 },
            { type: 'text', text: 'QUICK: ' + prof.quick.easing + ' · ' + prof.quick.ms + 'ms  |  STD: ' + prof.standard.easing + ' · ' + prof.standard.ms + 'ms', size: 11, tone: 'primary', mono: true },
            { type: 'text', text: 'PAGE: ' + prof.page.easing + ' · ' + prof.page.ms + 'ms  |  BG: ' + prof.crossfade.easing + ' · ' + prof.crossfade.ms + 'ms', size: 11, tone: 'primary', mono: true },
            { type: 'text', text: '悬停弹出 ' + prof.effects.hoverShiftDp + 'dp · 瀑布 ' + prof.effects.listStaggerMs + 'ms/' + prof.effects.listSlideDp + 'dp · 按压 ' + prof.effects.pressScale, size: 11, tone: 'sub', mono: true },
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
      return { toast: '留尾倍率已更新' };
    }
    if (act === 'cascade' && payload && CASCADES.some(c => c.key === payload.key)) {
      st.cascade = payload.key;
      nk.store.set('cfg', st);
      return { toast: '瀑布入场强度已更新' };
    }
    if (act === 'reset') {
      nk.store.set('cfg', { preset: 'stable_classic', tail: 'normal', cascade: 'classic' });
      return { toast: '已恢复 osu!stable 经典默认配置' };
    }
    return null;
  },
  action() {
    return { open: 'plugin:osu_motion', message: '已打开 osu!stable 动效设置' };
  },
});
