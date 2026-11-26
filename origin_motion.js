// @id origin_motion
// @name 源点空间动效
// @type motion
// @version 1.0.0
// @minHost 0.6.8
// @permissions motion.profile, storage
// @author NEKOPLAY
// @desc 独立源点空间动效插件：点哪个就从哪展开、返回原路缩回原入口（从哪来回哪去），支持列表点击邻近物理波纹联动与多级动量方向继承
// @api 2

const PRESETS = {
  origin_fluid: {
    label: '丝滑源点',
    desc: '均衡自然的源点容器展开与原路回缩（18dp 圆角变形）、邻近物理避让波纹与选中微放大',
    quick:     { easing: 'outExpo',  ms: 150 },
    standard:  { easing: 'outQuint', ms: 300 },
    page:      { easing: 'spring',   ms: 360, damping: 0.86, stiffness: 420 },
    crossfade: { easing: 'outQuint', ms: 400 },
    hero:      { easing: 'spring',   ms: 380, damping: 0.86, stiffness: 400 },
    effects: {
      hoverShiftDp: 5, hoverTint: true, pressScale: 0.965, pageScale: true,
      listStaggerMs: 22, listSlideDp: 34,
      originExpand: true, originRipple: true, originInherit: true,
      originCornerDp: 18, selectCoverScale: 1.10, selectFontScale: 1.06,
    },
  },
  origin_elastic: {
    label: '灵动弹性',
    desc: '更富物理张力的柔和弹簧回弹、明显选中封面/字号微放大（1.12× / 1.07×）与 22dp 流畅圆角',
    quick:     { easing: 'outExpo',  ms: 170 },
    standard:  { easing: 'outQuint', ms: 340 },
    page:      { easing: 'spring',   ms: 420, damping: 0.78, stiffness: 360 },
    crossfade: { easing: 'outQuint', ms: 440 },
    hero:      { easing: 'spring',   ms: 440, damping: 0.76, stiffness: 340 },
    effects: {
      hoverShiftDp: 6, hoverTint: true, pressScale: 0.955, pageScale: true,
      listStaggerMs: 26, listSlideDp: 42,
      originExpand: true, originRipple: true, originInherit: true,
      originCornerDp: 22, selectCoverScale: 1.12, selectFontScale: 1.07,
    },
  },
  origin_crisp: {
    label: '轻盈极速',
    desc: '干脆利落的高刚度响应（14ms 源点继承入场），保留完整空间方向感且零多余拖尾',
    quick:     { easing: 'outQuart', ms: 110 },
    standard:  { easing: 'outQuart', ms: 220 },
    page:      { easing: 'spring',   ms: 270, damping: 0.92, stiffness: 580 },
    crossfade: { easing: 'outQuart', ms: 280 },
    hero:      { easing: 'spring',   ms: 280, damping: 0.92, stiffness: 560 },
    effects: {
      hoverShiftDp: 4, hoverTint: true, pressScale: 0.975, pageScale: true,
      listStaggerMs: 14, listSlideDp: 24,
      originExpand: true, originRipple: true, originInherit: true,
      originCornerDp: 14, selectCoverScale: 1.08, selectFontScale: 1.05,
    },
  },
};

function getState() {
  const saved = nk.store.get('cfg') || {};
  const preset = PRESETS[saved.preset] ? saved.preset : 'origin_fluid';
  return {
    preset,
    originExpand: saved.originExpand !== false,
    originRipple: saved.originRipple !== false,
    originInherit: saved.originInherit !== false,
  };
}

function saveState(next) {
  nk.store.set('cfg', next);
}

function buildProfile() {
  const st = getState();
  const p = PRESETS[st.preset] || PRESETS.origin_fluid;
  const fx = Object.assign({}, p.effects, {
    originExpand: st.originExpand,
    originRipple: st.originRipple,
    originInherit: st.originInherit,
    listStaggerMs: st.originInherit ? p.effects.listStaggerMs : 0,
    listSlideDp: st.originInherit ? p.effects.listSlideDp : 0,
  });
  return {
    name: '源点空间',
    preset: st.preset,
    presetLabel: p.label,
    quick: p.quick,
    standard: p.standard,
    page: p.page,
    crossfade: p.crossfade,
    hero: p.hero,
    effects: fx,
  };
}

nk.registerMotion({
  manifest() {
    return { api: 2, type: 'motion', name: '源点空间动效' };
  },
  profile() {
    return buildProfile();
  },
  render(ctx) {
    const st = getState();
    const p = PRESETS[st.preset] || PRESETS.origin_fluid;
    const fx = buildProfile().effects;
    const lang = (ctx && ctx.lang) || (nk.host && nk.host.lang) || 'zh-CN';
    const isEn = String(lang).startsWith('en');
    return {
      type: 'column', gap: 14, children: [
        { type: 'tag', text: 'ORIGIN MOTION · PLUGIN API V2' },
        { type: 'text', text: isEn ? 'Origin Spatial Motion' : '源点空间动效', size: 22, weight: 800 },
        {
          type: 'text',
          text: isEn
            ? 'Expands pages, player, and popups directly from the tapped element, collapses back to the exact origin on return, and inherits tap direction & neighbor ripples.'
            : '点哪个就从哪展开、返回原路缩回原入口（从哪来回哪去）；每次点击同步触发邻近控件波纹联动，并将源点方向与动量继承到目标页内容中。',
          size: 12, tone: 'sub',
        },
        {
          type: 'card', gap: 10, children: [
            { type: 'text', text: (isEn ? 'Preset: ' : '动效预设（当前：') + p.label + (isEn ? '' : '）'), size: 14, weight: 700 },
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
            { type: 'text', text: isEn ? 'Spatial Links' : '联动能力热开关（无需重启）', size: 14, weight: 700 },
            {
              type: 'row', gap: 8, children: [
                { type: 'button', text: (st.originExpand ? '✓ ' : '') + (isEn ? 'Origin Expand' : '源点展开与回缩'), primary: st.originExpand, action: 'toggle', payload: { field: 'originExpand' } },
                { type: 'button', text: (st.originRipple ? '✓ ' : '') + (isEn ? 'Neighbor Ripple' : '邻近波纹联动'), primary: st.originRipple, action: 'toggle', payload: { field: 'originRipple' } },
                { type: 'button', text: (st.originInherit ? '✓ ' : '') + (isEn ? 'Motion Inherit' : '多级联动继承'), primary: st.originInherit, action: 'toggle', payload: { field: 'originInherit' } },
              ],
            },
            {
              type: 'text',
              text: '圆角变形 ' + fx.originCornerDp + 'dp · 选中封面 ' + fx.selectCoverScale + '× · 选中字体 ' + fx.selectFontScale + '× · 继承入场 ' + fx.listStaggerMs + 'ms / ' + fx.listSlideDp + 'dp',
              size: 11, tone: 'sub', mono: true,
            },
          ],
        },
        {
          type: 'row', gap: 8, children: [
            { type: 'button', text: isEn ? 'Reset Defaults' : '恢复默认配置', action: 'reset' },
          ],
        },
      ],
    };
  },
  onAction(action, payload) {
    const st = getState();
    if (action === 'preset' && payload && PRESETS[payload.key]) {
      st.preset = payload.key;
      saveState(st);
      return { toast: '已切换源点预设：' + PRESETS[payload.key].label, refresh: true };
    }
    if (action === 'toggle' && payload && ['originExpand', 'originRipple', 'originInherit'].includes(payload.field)) {
      st[payload.field] = !st[payload.field];
      saveState(st);
      return { toast: '已更新源点联动配置', refresh: true };
    }
    if (action === 'reset') {
      saveState({ preset: 'origin_fluid', originExpand: true, originRipple: true, originInherit: true });
      return { toast: '已恢复源点空间动效默认配置', refresh: true };
    }
    return { refresh: true };
  },
});
