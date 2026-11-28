// @id later
// @name 稍后再听
// @type feature
// @version 1.0.0
// @api 3
// @minHost 0.6.9
// @permissions storage, player.control
// @author NEKOPLAY
// @desc 把歌收进「稍后再听」，攒着一起播
// @details 任意曲目的菜单（列表里长按、播放页「更多」）多出「稍后再听」，点一下就收进清单
// @details 侧栏（手机在曲库页）有「稍后再听」入口：点一首从这首开始播，或者全部播放、随机播放
// @details 可选「听完自动移出」：清单里的歌播完一首就从清单删掉一首
// @details 只用插件接口 v3 实现（入口、菜单动作、曲目列表、切歌监听），不需要更新本体

// 旧版本体没有插件接口 v3（入口、菜单动作、播放控制），直接报错，导入时会提示更新
if (!nk.host.has || !nk.host.has('actions.track')) throw new Error('需要更新 NEKOPLAY：这个插件用到插件接口 v3');

/* 清单里存的是宿主给的曲目（宿主 id），播放时原样交回 nk.player.playTracks */
const MAX = 500;
const load = () => nk.store.get('list') || [];
const save = (l) => nk.store.set('list', l.slice(0, MAX));
const opt = () => Object.assign({ autoRemove: false }, nk.store.get('opt') || {});
let editing = false;
let last = null; // 上一首正在放的歌（用于「听完自动移出」）

function add(t) {
  if (!t || !t.id) return { toast: '这首歌不能加入' };
  const l = load();
  if (l.some(x => x.id === t.id)) return { toast: '「' + t.title + '」已经在清单里了' };
  l.unshift({ id: t.id, title: t.title, artist: t.artist, album: t.album, duration: t.duration, cover: t.cover });
  save(l);
  return { toast: '已加入「稍后再听」（共 ' + l.length + ' 首）' };
}

function header(l) {
  return { type: 'column', gap: 6, children: [
    { type: 'tag', text: 'LATER' },
    { type: 'text', text: '稍后再听', size: 28, weight: 800 },
    { type: 'text', text: l.length ? l.length + ' 首 · 在任意曲目的菜单里点「稍后再听」继续添加' : '还没有歌。在任意曲目的菜单里点「稍后再听」，歌就会出现在这里。', tone: 'sub', size: 13 },
  ] };
}

nk.registerFeature({
  entries: [{ id: 'later', title: '稍后再听', icon: 'clock', where: ['nav'] }],
  actions: [{ id: 'add', title: '稍后再听' }],

  render() {
    const l = load();
    const o = opt();
    const kids = [header(l)];
    if (l.length) {
      kids.push({ type: 'row', gap: 8, children: [
        { type: 'button', text: '全部播放', primary: true, action: 'play' },
        { type: 'button', text: '随机播放', action: 'shuffle' },
        { type: 'button', text: editing ? '完成' : '整理', action: 'edit' },
      ] });
      if (editing) {
        kids.push({ type: 'column', gap: 0, children: l.map((t, i) => ({
          type: 'item', title: t.title, sub: t.artist, cover: t.cover, trailing: '移出', action: 'remove', payload: { id: t.id },
        })) });
        kids.push({ type: 'button', text: '清空清单', action: 'clear' });
      } else {
        kids.push({ type: 'tracks', tracks: l });
      }
    }
    kids.push({ type: 'divider' });
    kids.push({ type: 'switch', label: '听完自动移出', sub: '清单里的歌放完一首，就把它从清单里删掉', value: o.autoRemove, action: 'autoRemove' });
    return { type: 'column', gap: 16, children: kids };
  },

  async onAction(a, p) {
    p = p || {};
    if (a === 'add') return Object.assign(add(p.track), { refresh: false });
    const l = load();
    if (a === 'play' || a === 'shuffle') {
      if (!l.length) return { toast: '清单是空的' };
      nk.player.playTracks(l, 0, a === 'shuffle');
      return { toast: a === 'shuffle' ? '随机播放「稍后再听」' : '开始播放「稍后再听」', refresh: false };
    }
    if (a === 'edit') { editing = !editing; return {}; }
    if (a === 'remove') { save(l.filter(t => t.id !== p.id)); return {}; }
    if (a === 'clear') { save([]); editing = false; return { toast: '已清空' }; }
    if (a === 'autoRemove') { nk.store.set('opt', Object.assign(opt(), { autoRemove: !!p.value })); return { refresh: false }; }
    return {};
  },

  onTrackChange(t) {
    const prev = last;
    last = t && t.id;
    if (!prev || prev === last || !opt().autoRemove) return;
    const l = load();
    if (l.some(x => x.id === prev)) { save(l.filter(x => x.id !== prev)); nk.ui.refresh(); }
  },
});
