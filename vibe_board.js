// @id vibe_board
// @name 听歌氛围看板 (v2 Demo)
// @type page
// @version 1.0.0
// @minHost 0.6.8
// @permissions library.read, player.control, storage
// @author NEKOPLAY
// @desc 声明式页面插件示例：听歌氛围看板
// @details 实时显示当前播放的封面与曲库概况
// @details 记录听歌心情打卡，可联动打开 3D 封面墙
// @details 整个页面由插件 JS 生成、原生界面渲染，改脚本即可热更新（Plugin API v2 示例）
// @screenshots screenshots/vibe_board-1.jpg
// @api 2

const MOODS = [
  { key: 'focus', label: '专注编码' },
  { key: 'chill', label: '深夜放空' },
  { key: 'hype',  label: '高能提神' },
  { key: 'cozy',  label: '治愈摸鱼' },
];

function getState() {
  return nk.store.get('state') || { mood: 'focus', count: 0, log: [] };
}

nk.registerPage({
  manifest() {
    return { api: 2, type: 'page', title: '听歌氛围看板' };
  },
  render(ctx) {
    const st = getState();
    const t = ctx && ctx.track ? ctx.track : null;
    const curMood = (MOODS.find(m => m.key === st.mood) || MOODS[0]).label;
    return {
      type: 'column', gap: 14, children: [
        { type: 'tag', text: 'PLUGIN API V2 · DEMO PAGE' },
        { type: 'text', text: '听歌氛围看板', size: 22, weight: 800 },
        { type: 'text', text: '这个页面完全由 vibe_board.js 在 QuickJS 中实时生成，由 NEKOPLAY 原生 Compose 渲染；修改插件脚本后无需更新软件本体即可热更新界面。', size: 12, tone: 'sub' },
        {
          type: 'card', gap: 10, children: t ? [
            { type: 'text', text: ctx.playing ? 'NOW PLAYING · 正在播放' : 'PAUSED · 已暂停', size: 10, tone: 'primary', weight: 800, mono: true },
            {
              type: 'row', gap: 12, children: [
                { type: 'cover', url: t.cover || '', size: 68, title: t.title || '' },
                {
                  type: 'column', grow: true, gap: 4, children: [
                    { type: 'text', text: t.title || '未知曲目', size: 16, weight: 800, lines: 1 },
                    { type: 'text', text: (t.artist || '未知艺人') + (t.album ? ' · ' + t.album : ''), size: 12, tone: 'sub', lines: 1 },
                    { type: 'text', text: '当前氛围：' + curMood + '  ·  已打卡 ' + st.count + ' 次', size: 11, tone: 'primary', mono: true },
                  ],
                },
              ],
            },
          ] : [
            { type: 'text', text: '当前还没有正在播放的歌曲', size: 14, weight: 700 },
            { type: 'text', text: '去放一首歌再点下方「刷新看板」，这里会实时同步封面与歌名。', size: 12, tone: 'sub' },
          ],
        },
        {
          type: 'card', gap: 10, children: [
            { type: 'text', text: '今日听歌心情打卡', size: 14, weight: 700 },
            {
              type: 'row', gap: 8, children: MOODS.map(m => ({
                type: 'button', text: m.label, primary: st.mood === m.key, action: 'checkin', payload: { key: m.key, label: m.label, song: t ? t.title : '' },
              })),
            },
            {
              type: 'text',
              text: st.log.length ? ('最近记录：' + st.log.slice(0, 3).join('  /  ')) : '点击上方按钮即可记录此刻听歌心情（持久化在插件独立存储 nk.store 中）。',
              size: 11, tone: 'sub', lines: 3,
            },
          ],
        },
        {
          type: 'row', gap: 8, children: [
            { type: 'button', text: '打开 3D 封面墙', primary: true, action: 'openCoverFlow' },
            { type: 'button', text: '刷新看板', action: 'refresh' },
            { type: 'button', text: '清空打卡', action: 'clear' },
          ],
        },
        { type: 'divider' },
        {
          type: 'text',
          text: 'HOST v' + (ctx.hostVersion || '?') + ' · ' + String(ctx.platform || '').toUpperCase() + ' · 歌单 ' + (ctx.playlistCount || 0) + ' 个 · 最近播放 ' + (ctx.recentCount || 0) + ' 首',
          size: 11, tone: 'sub', mono: true,
        },
      ],
    };
  },
  onAction(act, payload) {
    if (act === 'openCoverFlow') return { open: 'coverflow', refresh: false };
    if (act === 'refresh') return { toast: '看板已刷新' };
    if (act === 'clear') {
      nk.store.set('state', { mood: 'focus', count: 0, log: [] });
      return { toast: '已清空心情记录' };
    }
    if (act === 'checkin' && payload && payload.key) {
      const st = getState();
      st.mood = payload.key;
      st.count = (st.count || 0) + 1;
      const entry = payload.label + (payload.song ? '《' + payload.song + '》' : '');
      st.log = [entry].concat(st.log || []).slice(0, 6);
      nk.store.set('state', st);
      return { toast: '已打卡：' + entry };
    }
    return null;
  },
  action() {
    return { open: 'plugin:vibe_board', message: '已打开听歌氛围看板' };
  },
});
