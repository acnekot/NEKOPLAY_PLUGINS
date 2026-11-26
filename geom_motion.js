// @id geom_motion
// @name 点线面几何动效
// @type motion
// @version 1.0.1
// @minHost 0.6.8
// @permissions motion.profile, storage
// @author NEKOPLAY
// @desc 独立点线面几何动效插件（内置实机交互演示台）：正方形封面与可选页面容器从左上原点 (0,0) 先拉成顶边光束线，再向下扫面展开（支持切歌/收起反向缩回点与三套 PRTS 风格预设热切换）
// @api 2

const PRESETS = {
  geom_prts: {
    label: 'PRTS 标准',
    desc: '线阶段 OutExpo 极速弹出（34%）、面阶段 OutQuint 干脆扫开，2.4dp 扫描光束线与轻微画面落位缩放',
    quick:     { easing: 'outExpo',  ms: 130 },
    standard:  { easing: 'outQuint', ms: 280 },
    page:      { easing: 'outQuint', ms: 420 },
    crossfade: { easing: 'outQuint', ms: 480 },
    hero:      { easing: 'outExpo',  ms: 360 },
    effects: {
      hoverShiftDp: 4, hoverTint: true, pressScale: 0.975, pageScale: true,
      listStaggerMs: 16, listSlideDp: 20,
      geomReveal: true, geomLineRatio: 0.34, geomLineDp: 2.4,
      geomReverse: true, geomContainer: false, geomAccent: true,
    },
  },
  geom_snap: {
    label: '锐利极速',
    desc: '高响应短行程几何展开（320ms / 28% 拉线），适合高频切歌与轻量日常浏览，干脆零拖尾',
    quick:     { easing: 'outExpo',  ms: 95 },
    standard:  { easing: 'outQuart', ms: 210 },
    page:      { easing: 'outQuart', ms: 300 },
    crossfade: { easing: 'outQuart', ms: 320 },
    hero:      { easing: 'outExpo',  ms: 260 },
    effects: {
      hoverShiftDp: 3, hoverTint: true, pressScale: 0.98, pageScale: true,
      listStaggerMs: 10, listSlideDp: 14,
      geomReveal: true, geomLineRatio: 0.28, geomLineDp: 2.0,
      geomReverse: true, geomContainer: false, geomAccent: true,
    },
  },
  geom_cinema: {
    label: '仪式慢展',
    desc: '清晰呈现「左上原点停顿 → 顶边拉线成边 → 垂直铺面扫开」三段式几何结构（680ms / 3.0dp 光束）',
    quick:     { easing: 'outExpo',  ms: 160 },
    standard:  { easing: 'outQuint', ms: 340 },
    page:      { easing: 'outQuint', ms: 560 },
    crossfade: { easing: 'outQuint', ms: 680 },
    hero:      { easing: 'outQuint', ms: 480 },
    effects: {
      hoverShiftDp: 5, hoverTint: true, pressScale: 0.97, pageScale: true,
      listStaggerMs: 22, listSlideDp: 28,
      geomReveal: true, geomLineRatio: 0.40, geomLineDp: 3.0,
      geomReverse: true, geomContainer: false, geomAccent: true,
    },
  },
};

const DEMO_SLIDES = [
  { title: 'PRTS // 01', sub: '左上原点 (0,0) → 顶线 → 向下扫面' },
  { title: 'NEKO // 02', sub: '支持切歌先反向 面→线→点 缩回' },
  { title: 'GEOM // 03', sub: '纯 GPU 绘制层 120fps 零重组' },
];

let demoSeq = 1;
let demoIdx = 0;

function getState() {
  const saved = nk.store.get('cfg') || {};
  const preset = PRESETS[saved.preset] ? saved.preset : 'geom_prts';
  return {
    preset,
    geomReverse: saved.geomReverse !== false,
    geomContainer: saved.geomContainer === true,
    geomAccent: saved.geomAccent !== false,
  };
}

function saveState(next) {
  nk.store.set('cfg', next);
}

function buildProfile() {
  const st = getState();
  const p = PRESETS[st.preset] || PRESETS.geom_prts;
  const fx = Object.assign({}, p.effects, {
    geomReverse: st.geomReverse,
    geomContainer: st.geomContainer,
    geomAccent: st.geomAccent,
  });
  return {
    name: '点线面几何',
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
    return { api: 2, type: 'motion', name: '点线面几何动效' };
  },
  profile() {
    return buildProfile();
  },
  render(ctx) {
    const st = getState();
    const p = PRESETS[st.preset] || PRESETS.geom_prts;
    const fx = buildProfile().effects;
    const lang = (ctx && ctx.lang) || (nk.host && nk.host.lang) || 'zh-CN';
    const isEn = String(lang).startsWith('en');
    const curTrack = ctx && ctx.track;
    const slide = DEMO_SLIDES[demoIdx % DEMO_SLIDES.length];
    const demoUrl = (demoIdx === 0 && curTrack && curTrack.cover) ? curTrack.cover : '';
    const demoTitle = (demoIdx === 0 && curTrack && curTrack.title) ? curTrack.title : slide.title;
    const demoSub = (demoIdx === 0 && curTrack && curTrack.artist) ? curTrack.artist : slide.sub;
    const revealKey = st.preset + ':' + demoIdx + ':' + demoSeq + ':' + (st.geomReverse ? '1' : '0') + ':' + (st.geomAccent ? '1' : '0');

    return {
      type: 'column', gap: 14, children: [
        { type: 'tag', text: 'GEOM MOTION · POINT → LINE → PLANE' },
        { type: 'text', text: isEn ? 'Point → Line → Plane Motion' : '点线面几何动效', size: 22, weight: 800 },
        {
          type: 'text',
          text: isEn
            ? 'Unfolds square covers (and optionally page/player containers) from the top-left origin (0,0) into a sharp top hairline, then sweeps straight downward into a full plane.'
            : '以正方形封面左上角 (0, 0) 为原点：先极速横向拉成一条锐利顶边光束线，再垂直向下扫开完整封面；开启本插件后播放页切歌、歌单/专辑头图均自动生效。',
          size: 12, tone: 'sub',
        },
        {
          type: 'card', gap: 12, children: [
            { type: 'tag', text: isEn ? 'LIVE ON-DEVICE DEMO' : '实机交互演示台（120fps 原生 GPU 渲染）' },
            {
              type: 'row', gap: 14, children: [
                { type: 'cover', url: demoUrl, size: 156, title: demoTitle, revealKey: revealKey, geomPreview: true },
                {
                  type: 'column', grow: true, gap: 8, children: [
                    { type: 'text', text: demoTitle, size: 16, weight: 800, lines: 2 },
                    { type: 'text', text: demoSub, size: 12, tone: 'sub', lines: 2 },
                    { type: 'text', text: 'STAGE: ● 点 → ━ 线 (' + Math.round(fx.geomLineRatio * 100) + '%) → ■ 面', size: 11, tone: 'primary', mono: true },
                    {
                      type: 'row', gap: 8, children: [
                        { type: 'button', text: isEn ? 'Replay' : '重播点→线→面', primary: true, action: 'demo_replay' },
                        { type: 'button', text: isEn ? 'Next Cover' : '切封面测试', action: 'demo_next' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'card', gap: 10, children: [
            { type: 'text', text: (isEn ? 'Preset: ' : '几何预设（当前：') + p.label + (isEn ? '' : '）'), size: 14, weight: 700 },
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
            { type: 'text', text: isEn ? 'Geometry Controls' : '几何参数热开关（无需重启）', size: 14, weight: 700 },
            {
              type: 'row', gap: 8, children: [
                { type: 'button', text: (st.geomReverse ? '✓ ' : '') + (isEn ? 'Reverse to Point' : '切歌/收起反向回点'), primary: st.geomReverse, action: 'toggle', payload: { field: 'geomReverse' } },
                { type: 'button', text: (st.geomContainer ? '✓ ' : '') + (isEn ? 'Page & Player Containers' : '封面 + 页面容器同步'), primary: st.geomContainer, action: 'toggle', payload: { field: 'geomContainer' } },
                { type: 'button', text: (st.geomAccent ? '✓ ' : '') + (isEn ? 'Accent Scanline' : '主题色扫描光束'), primary: st.geomAccent, action: 'toggle', payload: { field: 'geomAccent' } },
              ],
            },
            {
              type: 'text',
              text: '拉线占比 ' + Math.round(fx.geomLineRatio * 100) + '% · 光束线宽 ' + fx.geomLineDp + 'dp · 封面展开 ' + p.crossfade.ms + 'ms · 作用域：' + (st.geomContainer ? '封面 + 容器' : '仅封面'),
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
    if (action === 'demo_replay') {
      demoSeq++;
      return { refresh: true };
    }
    if (action === 'demo_next') {
      demoIdx = (demoIdx + 1) % DEMO_SLIDES.length;
      demoSeq++;
      return { refresh: true };
    }
    if (action === 'preset' && payload && PRESETS[payload.key]) {
      st.preset = payload.key;
      saveState(st);
      demoSeq++;
      return { toast: '已切换点线面预设：' + PRESETS[payload.key].label, refresh: true };
    }
    if (action === 'toggle' && payload && ['geomReverse', 'geomContainer', 'geomAccent'].includes(payload.field)) {
      st[payload.field] = !st[payload.field];
      saveState(st);
      demoSeq++;
      return { toast: '已更新点线面几何配置', refresh: true };
    }
    if (action === 'reset') {
      saveState({ preset: 'geom_prts', geomReverse: true, geomContainer: false, geomAccent: true });
      demoSeq++;
      return { toast: '已恢复点线面几何动效默认配置', refresh: true };
    }
    return { refresh: true };
  },
});
