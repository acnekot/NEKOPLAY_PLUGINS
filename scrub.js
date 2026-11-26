// @id scrub
// @name 长按变速快进
// @type feature
// @feature scrub
// @version 1.0.0
// @minHost 0.6.8
// @permissions player.control, storage
// @author NEKOPLAY
// @desc 长按「上一首 / 下一首」实时变速快进与快退（支持磁带变速变调 / 原调倍速 / 极速巡航预设与长按触发时长热调；关闭或删除插件即恢复纯点击切歌）
// @api 2

const DEFAULTS = {
  preset: 'tape',
  holdMs: 240,
  pitchLinked: true,
  fwdStart: 1.5,
  fwdMax: 3.8,
  fwdRampMs: 2400,
  revStart: 1.85,
  revMax: 3.4,
  revStepMinMs: 680,
  revStepMaxMs: 2180,
};

const PRESETS = {
  tape: {
    label: '磁带变速变调',
    pitchLinked: true,
    fwdStart: 1.5,
    fwdMax: 3.8,
    fwdRampMs: 2400,
    revStart: 1.85,
    revMax: 3.4,
    revStepMinMs: 680,
    revStepMaxMs: 2180,
  },
  podcast: {
    label: '原调倍速快进',
    pitchLinked: false,
    fwdStart: 1.5,
    fwdMax: 3.0,
    fwdRampMs: 1800,
    revStart: 1.5,
    revMax: 2.5,
    revStepMinMs: 800,
    revStepMaxMs: 2400,
  },
  turbo: {
    label: '极速巡航',
    pitchLinked: true,
    fwdStart: 2.0,
    fwdMax: 4.5,
    fwdRampMs: 1600,
    revStart: 2.2,
    revMax: 4.0,
    revStepMinMs: 1000,
    revStepMaxMs: 3200,
  },
};

const HOLD_OPTIONS = [200, 240, 350, 500];

function loadCfg() {
  return Object.assign({}, DEFAULTS, nk.store.get('cfg') || {});
}

nk.registerFeature({
  manifest() {
    return {
      api: 2,
      type: 'feature',
      feature: 'scrub',
    };
  },
  config() {
    return loadCfg();
  },
  render() {
    const c = loadCfg();
    const p = PRESETS[c.preset] || PRESETS.tape;
    return {
      type: 'column', gap: 14, children: [
        { type: 'tag', text: 'HOLD SCRUB · PLUGIN API V2' },
        { type: 'text', text: '长按变速快进 / 快退', size: 22, weight: 800 },
        { type: 'text', text: '启用本插件后，短按「上一首 / 下一首」正常切歌，长按进入实时变速快进 / 快退；关闭或卸载插件后主软件完全恢复普通点击切歌。', size: 12, tone: 'sub' },
        {
          type: 'card', gap: 10, children: [
            { type: 'text', text: '变速曲线预设（当前：' + p.label + '）', size: 14, weight: 700 },
            {
              type: 'text',
              text: '快进 ' + c.fwdStart + '× → ' + c.fwdMax + '× · 快退 ' + c.revStart + '× → ' + c.revMax + '× · ' + (c.pitchLinked ? '同步变调' : '保持原调'),
              size: 11, tone: 'primary', mono: true,
            },
            {
              type: 'row', gap: 8, children: Object.keys(PRESETS).map(k => ({
                type: 'button', text: PRESETS[k].label, primary: c.preset === k, action: 'preset', payload: { key: k },
              })),
            },
          ],
        },
        {
          type: 'card', gap: 10, children: [
            { type: 'text', text: '触发手感与音高策略', size: 14, weight: 700 },
            { type: 'text', text: '长按触发时长：' + c.holdMs + ' ms', size: 12, tone: 'sub' },
            {
              type: 'row', gap: 8, children: HOLD_OPTIONS.map(ms => ({
                type: 'button', text: ms + 'ms', primary: c.holdMs === ms, action: 'holdMs', payload: { ms },
              })),
            },
            {
              type: 'row', gap: 8, children: [
                { type: 'button', text: c.pitchLinked ? '关闭变调（保持原调）' : '开启磁带变调联动', action: 'togglePitch' },
                { type: 'button', text: '恢复默认', action: 'reset' },
              ],
            },
          ],
        },
      ],
    };
  },
  onAction(act, payload) {
    const c = loadCfg();
    if (act === 'preset' && payload && PRESETS[payload.key]) {
      const next = Object.assign({}, c, PRESETS[payload.key], { preset: payload.key });
      nk.store.set('cfg', next);
      return { toast: '已切换为「' + PRESETS[payload.key].label + '」' };
    }
    if (act === 'holdMs' && payload && typeof payload.ms === 'number') {
      c.holdMs = payload.ms;
      nk.store.set('cfg', c);
      return { toast: '长按触发时长已设为 ' + payload.ms + 'ms' };
    }
    if (act === 'togglePitch') {
      c.pitchLinked = !c.pitchLinked;
      nk.store.set('cfg', c);
      return { toast: c.pitchLinked ? '已开启磁带变调联动' : '已切换为原调倍速' };
    }
    if (act === 'reset') {
      nk.store.set('cfg', DEFAULTS);
      return { toast: '已恢复默认参数' };
    }
    return null;
  },
  action() {
    return { open: 'plugin:scrub', message: '已打开长按变速快进设置' };
  },
});
