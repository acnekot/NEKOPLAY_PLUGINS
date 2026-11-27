// @id netease
// @name 网易云音乐
// @type source
// @version 1.2.0
// @minHost 0.6.7
// @permissions network, storage
// @author NEKOPLAY
// @desc 网易云完整音源：搜索、播放、逐字歌词、日推、私人 FM、歌单广场、排行榜、评论与楼中楼、MV、电台、云盘、个人主页与听歌排行，扫码登录后同步歌单和喜欢
// @api 2
// @search track,album,artist,playlist,user,lyric
//
// 用网页端加密接口（weapi）。为了兼容老数据，网易云的 id 在本体里不加插件前缀。

const NONCE = '0CoJUm6Qyw8W8jud', IV = '0102030405060708';
// 固定会话密钥：encSecKey 只要和 AES 密钥配套即可，省掉每次的 RSA 运算
const SEC_KEY = 'nK7qPz3Wm9XvL2tR';
const ENC_SEC_KEY = '1b217eb9ffc597dcfbaae9a3c0fd2d56f1fa7fdd06f386c789714b426cd102041d4c883ea4ea82439e1aa9d453326b835904a61fbfab07b1266ec5dbda413220e8fe269c0035d839f02187d83dd4803437bf0af13ead1eba669df755a143fbfdd1cb9c1ba709885fd4d388ae586dac2108c6cbeae6b25098afaa44cd6e82eed2';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const LEVELS = ['standard', 'higher', 'exhigh', 'lossless', 'hires'];

// ---------- 请求 ----------
const cookie = () => nk.store.get('cookie') || '';
const loggedIn = () => cookie().includes('MUSIC_U');
const csrf = () => (/__csrf=([^;\s]+)/.exec(cookie()) || [])[1] || '';

async function raw(path, data) {
  data = Object.assign({}, data || {}, { csrf_token: csrf() });
  const params = nk.aes({ data: nk.aes({ data: JSON.stringify(data), key: NONCE, iv: IV }), key: SEC_KEY, iv: IV });
  const r = await nk.http({
    url: `https://music.163.com${path}?csrf_token=${csrf()}`, form: { params, encSecKey: ENC_SEC_KEY },
    headers: { Referer: 'https://music.163.com/', Origin: 'https://music.163.com', 'User-Agent': UA, Cookie: 'os=pc; appver=2.7.1.198277; ' + cookie() },
  });
  if (r.status !== 200) throw new Error('网易云服务返回 ' + r.status);
  let j; try { j = r.json(); } catch (e) { throw new Error('网易云返回的不是 JSON（可能被风控）'); }
  return { j, setCookie: r.headers['set-cookie'] || [] };
}
async function api(path, data) {
  const { j } = await raw(path, data);
  const c = j.code === undefined ? 200 : j.code;
  if (c === -460 || c === -462) throw new Error('被网易云风控拦截（' + c + '），稍后再试');
  if (c !== 200) throw new Error((j.message || j.msg || '接口错误') + '（' + c + '）');
  return j;
}
async function plainGet(path) {
  const r = await nk.http({ url: 'https://music.163.com' + path, headers: { Referer: 'https://music.163.com/', 'User-Agent': UA } });
  try { return r.json(); } catch (e) { return {}; }
}

// ---------- 数据转换 ----------
const pic = (u) => u ? u.replace(/^http:/, 'https:').split('?')[0] : null;
const year = (ms) => ms > 0 ? String(new Date(ms).getFullYear()) : '';
function song(s) {
  const ar = s.ar || s.artists || [], al = s.al || s.album || {};
  const named = ar.filter(a => a.name);
  return {
    id: String(s.id), title: s.name, artist: named.map(a => a.name).join(' / ') || '未知艺人', album: al.name || '',
    duration: s.dt || s.duration || 0, cover: pic(al.picUrl), artists: named.map(a => ({ id: String(a.id), name: a.name })),
    albumId: al.id ? String(al.id) : '', vip: s.fee === 1 || s.fee === 4,
  };
}
const albumOf = (o) => ({ id: String(o.id), name: o.name, cover: pic(o.picUrl), count: o.size || 0, year: year(o.publishTime), artist: (o.artist && o.artist.name) || ((o.artists || [])[0] || {}).name || '' });
const plOf = (o) => ({ id: String(o.id), name: o.name, count: o.trackCount || 0, cover: pic(o.coverImgUrl || o.picUrl) });
const artistOf = (o, followed) => ({ id: String(o.id), name: o.name, cover: pic(o.picUrl || o.img1v1Url), songs: o.musicSize || 0, albums: o.albumSize || 0, followed: !!followed });
const mvOf = (o) => ({ id: String(o.id), name: o.name, cover: pic(o.imgurl16v9 || o.cover || o.picUrl || o.imgurl), artist: o.artistName || '', duration: o.duration || 0, plays: o.playCount || 0 });
function commentOf(c) {
  const u = c.user || {}, r = (c.beReplied || [])[0];
  return {
    id: c.commentId, user: u.nickname || '', uid: String(u.userId || ''), avatar: pic(u.avatarUrl), content: c.content || '', liked: c.likedCount || 0, time: c.time || 0,
    reply: r ? `@${(r.user && r.user.nickname) || ''}：${r.content}` : null, replies: (c.showFloorComment && c.showFloorComment.replyCount) || c.replyCount || 0, likedByMe: !!c.liked,
  };
}
/** 按 id 取歌曲详情：每 200 首一个请求 */
async function details(ids) {
  // 每批 200 首，最多 4 批同时请求（大歌单快一些，也不至于一下子打太多）
  const by = {}, parts = [];
  for (let i = 0; i < ids.length; i += 200) parts.push(ids.slice(i, i + 200));
  for (let i = 0; i < parts.length; i += 4) {
    const rs = await Promise.all(parts.slice(i, i + 4).map(part => api('/weapi/v3/song/detail', { c: JSON.stringify(part.map(id => ({ id: Number(id) }))) })));
    rs.forEach(r => (r.songs || []).forEach(s => { const t = song(s); by[t.id] = t; }));
  }
  return ids.map(id => by[id]).filter(Boolean);
}
async function searchRes(q, type, page) { return (await api('/weapi/search/get', { s: q, type, limit: 30, offset: ((page || 1) - 1) * 30 })).result || {}; }
let uidCache = null;
async function uid() {
  if (uidCache) return uidCache;
  const p = (await api('/weapi/w/nuser/account/get')).profile; if (!p) throw new Error('登录已失效，请重新登录');
  uidCache = String(p.userId); return uidCache;
}
function saveCookie(text) {
  const m = {}; let x; const re = /(MUSIC_U|__csrf|MUSIC_A_T|MUSIC_R_T|NMTID)=([^;,\s]+)/g;
  while ((x = re.exec(text))) m[x[1]] = x[2];
  if (!m.MUSIC_U) throw new Error('没有拿到 MUSIC_U，请改用粘贴 Cookie');
  nk.store.set('cookie', Object.keys(m).map(k => k + '=' + m[k]).join('; ')); uidCache = null;
}
const weblog = (action, json) => api('/weapi/feedback/weblog', { logs: JSON.stringify([{ action, json }]) });

nk.register({
  // 宿主媒体规则：封面 / 音频 / MV CDN 需要的请求头与封面缩略图尺寸参数（宿主 0.6.9+ 读取）
  media: [
    { hosts: ['126.net', '163.com'], headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
      image: { contains: '/obj/', query: 'imageView=1&thumbnail={s}x{s}&type=webp', sizes: [160, 256, 512, 768], keepHttp: true } },
    { hosts: ['music.126.net'], image: { query: 'param={s}y{s}', sizes: [160, 256, 512, 768], keepHttp: true } },
  ],
  // ---------- 搜索 ----------
  async search(q, type, page) {
    switch (type) {
      case 'album': return ((await searchRes(q, 10, page)).albums || []).map(albumOf);
      case 'playlist': return ((await searchRes(q, 1000, page)).playlists || []).map(plOf);
      case 'artist': return ((await searchRes(q, 100, page)).artists || []).map(o => artistOf(o));
      case 'user': return ((await searchRes(q, 1002, page)).userprofiles || []).map(o => ({ uid: String(o.userId), name: o.nickname, avatar: pic(o.avatarUrl), signature: o.signature || '' }));
      case 'lyric': return details(((await searchRes(q, 1006, page)).songs || []).map(s => String(s.id)));
      default: return details(((await searchRes(q, 1, page)).songs || []).map(s => String(s.id)));   // 搜索结果没有封面，补一次详情
    }
  },
  async suggest(q) { return [...new Set((((await api('/weapi/search/suggest/keyword', { s: q })).result || {}).allMatch || []).map(a => a.keyword).filter(Boolean))]; },
  async hotSearch() { return ((await api('/weapi/hotsearchlist/get')).data || []).map(a => a.searchWord).filter(Boolean); },
  async details(ids) { return details(ids); },

  // ---------- 播放 / 歌词 ----------
  async stream(id, quality) {
    let err = '没有可用的播放地址（无版权或需要 VIP）';
    for (let i = Math.min(Math.max(quality, 0), LEVELS.length - 1); i >= 0; i--) {
      try {
        const d = ((await api('/weapi/song/enhance/player/url/v1', { ids: `[${id}]`, level: LEVELS[i], encodeType: 'flac' })).data || [])[0];
        if (!d || !d.url) continue;
        if (d.freeTrialInfo) { err = '这首歌只有试听片段，需要 VIP'; continue; }
        return { url: d.url.replace(/^http:/, 'https:'), ext: (d.type || '').toLowerCase(), kbps: Math.round((d.br || 0) / 1000), level: d.level || LEVELS[i] };
      } catch (e) { err = e.message || err; }
    }
    return { error: err };
  },
  async lyric(id) {
    const j = await api('/weapi/song/lyric', { id, lv: -1, tv: -1, rv: -1, kv: -1, yv: -1, ytv: -1, _nmclfl: 1 });
    return { lrc: (j.lrc && j.lrc.lyric) || '', tr: (j.tlyric && j.tlyric.lyric) || null, yrc: (j.yrc && j.yrc.lyric) || null };
  },

  // ---------- 歌单 / 专辑 / 歌手 / 用户 ----------
  async playlist(id) {
    const ids = ((await api('/weapi/v6/playlist/detail', { id, n: 0, s: 0 })).playlist || {}).trackIds || [];
    return details(ids.map(x => String(x.id)));
  },
  async playlistSubscribed(id) { return !!(((await api('/weapi/v6/playlist/detail', { id, n: 0, s: 0 })).playlist || {}).subscribed); },
  async album(id) {
    const j = await api('/weapi/v1/album/' + id);
    if (!j.album) throw new Error('没有找到这张专辑');
    const al = albumOf(j.album);
    return { album: al, tracks: (j.songs || []).map(s => { const t = song(s); if (!t.cover) t.cover = al.cover; return t; }) };
  },
  async artist(id) {
    try {
      const j = await api('/weapi/v1/artist/' + id);
      if (!j.artist) throw new Error('没有找到这位歌手');
      const a = j.artist;
      return { name: a.name, cover: pic(a.picUrl), desc: a.briefDesc || '', songs: a.musicSize || 0, albums: a.albumSize || 0, followed: !!a.followed, tracks: (j.hotSongs || []).map(song) };
    } catch (e) {
      // 老接口被拦时，换成 头部信息 + 热门 50 首
      const d = (await api('/weapi/artist/head/info/get', { id })).data; if (!d || !d.artist) throw e;
      const a = d.artist, hot = (await api('/weapi/artist/top/song', { id })).songs || [];
      return { name: a.name, cover: pic(a.cover || a.avatar), desc: a.briefDesc || '', songs: a.musicSize || 0, albums: a.albumSize || 0, followed: !!(d.user && d.user.followed), tracks: hot.map(song) };
    }
  },
  async artistAlbums(id, offset, limit) {
    const j = await api('/weapi/artist/albums/' + id, { limit: limit || 60, offset: offset || 0, total: true });
    return { items: (j.hotAlbums || []).map(albumOf), more: !!j.more };
  },
  async user(id) {
    const j = await api('/weapi/v1/user/detail/' + id), p = j.profile; if (!p) throw new Error('没有找到这个用户');
    return { uid: String(id), name: p.nickname, avatar: pic(p.avatarUrl), bg: pic(p.backgroundUrl), signature: p.signature || '', level: j.level || 0, listened: j.listenSongs || 0, follows: p.follows || 0, fans: p.followeds || 0, followed: !!p.followed };
  },
  async userPlaylists(u) {
    const a = (await api('/weapi/user/playlist', { uid: u, limit: 200, offset: 0, includeVideo: true })).playlist || [];
    return a.map((p, i) => Object.assign(plOf(p), { liked: i === 0 || p.specialType === 5, mine: String((p.creator || {}).userId) === String(u) }));
  },

  // ---------- 发现 ----------
  async daily() {
    if (loggedIn()) try { const d = ((await api('/weapi/v3/discovery/recommend/songs')).data || {}).dailySongs; if (d && d.length) return d.map(song); } catch (e) {}
    const a = (await api('/weapi/v1/discovery/new/songs', { areaId: 0, total: true })).data || [];
    return details(a.slice(0, 30).map(s => String(s.id)));
  },
  async fm() { return ((await api('/weapi/v1/radio/get')).data || []).map(song); },
  async fmTrash(id) { await api('/weapi/radio/trash/add', { songId: id, alg: 'RT', time: 25 }); },
  async toplists() {
    let a; try { a = (await api('/weapi/toplist')).list; } catch (e) {}
    if (!a) a = (await plainGet('/api/toplist')).list || [];
    return a.map(o => Object.assign(plOf(o), { desc: o.updateFrequency || '' }));
  },
  async recPlaylists() { return ((await api('/weapi/personalized/playlist', { limit: 30, total: true, n: 1000 })).result || []).map(plOf); },
  async categories() {
    const l = (await api('/weapi/playlist/catalogue')).sub || [];
    return ['全部'].concat(l.filter(x => x.hot).concat(l.filter(x => !x.hot)).map(x => x.name));
  },
  async square(cat, offset) { const j = await api('/weapi/playlist/list', { cat, order: 'hot', limit: 30, offset, total: true }); return { items: (j.playlists || []).map(plOf), more: !!j.more }; },
  async newAlbums(area, offset) { return ((await api('/weapi/album/new', { limit: 30, offset, total: true, area })).albums || []).map(albumOf); },
  async newSongs(area) {
    const l = ((await api('/weapi/v1/discovery/new/songs', { areaId: area, total: true })).data || []).map(song);
    return l.some(t => !t.cover) ? details(l.map(t => t.id)) : l;
  },
  async historyDates() { if (!loggedIn()) throw new Error('请先登录'); return ((await api('/weapi/discovery/recommend/songs/history/recent')).data || {}).dates || []; },
  async historySongs(date) { return (((await api('/weapi/discovery/recommend/songs/history/detail', { date })).data || {}).songs || []).map(song); },
  async simiSongs(id) { return details(((await api('/weapi/v1/discovery/simiSong', { songid: id, limit: 50, offset: 0 })).songs || []).map(s => String(s.id))); },
  async simiArtists(id) { return ((await api('/weapi/discovery/simiArtist', { artistid: id })).artists || []).map(o => artistOf(o)); },
  async simiPlaylists(id) { return ((await api('/weapi/discovery/simiPlaylist', { songid: id, limit: 50, offset: 0 })).playlists || []).map(plOf); },

  // ---------- 评论 ----------
  async comments(id, hot, offset, before) {
    if (hot) try {
      const d = (await api('/weapi/v2/resource/comments', { threadId: 'R_SO_4_' + id, pageNo: Math.floor(offset / 20) + 1, pageSize: 20, cursor: 'normalHot#' + offset, sortType: 2, showInner: true })).data;
      if (d && d.comments) return { items: d.comments.map(commentOf), total: d.totalCount || 0 };
    } catch (e) {}
    const j = await api(hot ? '/weapi/v1/resource/hotcomments/R_SO_4_' + id : '/weapi/v1/resource/comments/R_SO_4_' + id, { rid: id, limit: 20, offset, beforeTime: before || 0 });
    return { items: ((hot ? j.hotComments : j.comments) || []).map(commentOf), total: j.total || 0 };
  },
  async commentFloor(id, parent, cursor) {
    const d = (await api('/weapi/resource/comment/floor/get', { parentCommentId: parent, threadId: 'R_SO_4_' + id, time: cursor, limit: 20 })).data || {};
    const items = (d.comments || []).map(commentOf);
    return { items, next: d.hasMore ? (d.time || (items.length ? items[items.length - 1].time : -1)) : -1 };
  },
  async commentLike(id, cid, on) { await api(`/weapi/v1/comment/${on ? 'like' : 'unlike'}`, { threadId: 'R_SO_4_' + id, commentId: cid }); },
  async commentPost(id, content, replyTo) {
    const d = { threadId: 'R_SO_4_' + id, content }; if (replyTo) d.commentId = replyTo;
    await api(`/weapi/resource/comments/${replyTo ? 'reply' : 'add'}`, d);
  },

  // ---------- 账号 ----------
  async account() {
    if (!loggedIn()) return null;
    const p = (await api('/weapi/w/nuser/account/get')).profile; if (!p) throw new Error('登录已失效，请重新登录');
    uidCache = String(p.userId);
    return { uid: uidCache, name: p.nickname, avatar: pic(p.avatarUrl) };
  },
  async myPlaylists() { if (!loggedIn()) return []; const u = await uid(); return this.userPlaylists(u); },
  async like(id, on) { await api('/weapi/radio/like', { alg: 'itembased', trackId: id, like: on, time: '3' }); },
  async createPlaylist(name, priv) { const j = await api('/weapi/playlist/create', { name, privacy: priv ? '10' : '0', type: 'NORMAL' }); return String((j.playlist && j.playlist.id) || j.id || ''); },
  async deletePlaylist(id) { await api('/weapi/playlist/remove', { ids: `[${id}]` }); },
  async editPlaylist(pid, op, ids) {
    const { j } = await raw('/weapi/playlist/manipulate/tracks', { op, pid, trackIds: JSON.stringify(ids), imme: 'true' });
    if (j.code === 502) throw new Error('歌曲已经在歌单里了');
    if (j.code !== 200) throw new Error((j.message || '操作失败') + '（' + j.code + '）');
  },
  async subscribePlaylist(id, on) { await api(`/weapi/playlist/${on ? 'subscribe' : 'unsubscribe'}`, { id }); },
  async followArtist(id, on) { await api(`/weapi/artist/${on ? 'sub' : 'unsub'}`, { artistId: id, artistIds: `[${id}]` }); },
  async followUser(id, on) { await api(`/weapi/user/${on ? 'follow' : 'delfollow'}/${id}`); },
  async subAlbum(id, on) { await api(`/weapi/album/${on ? 'sub' : 'unsub'}`, { id }); },
  async subAlbums() { return ((await api('/weapi/album/sublist', { limit: 200, offset: 0, total: true })).data || []).map(albumOf); },
  async subArtists() { return ((await api('/weapi/artist/sublist', { limit: 200, offset: 0, total: true })).data || []).map(o => artistOf(o, true)); },
  async playRecord(u, week) {
    const j = await api('/weapi/v1/play/record', { uid: u, type: week ? 1 : 0 });
    return ((week ? j.weekData : j.allData) || []).map(o => ({ track: song(o.song), count: o.playCount || o.score || 0 }));
  },
  async signin() {
    const { j } = await raw('/weapi/point/dailyTask', { type: 1 });
    switch (j.code) { case 200: return { done: true, message: '签到成功，经验 +' + (j.point || 0) }; case -2: return { done: true, message: '今天已经签到过了' }; case 301: return { done: false, message: '请先登录' }; default: return { done: false, message: j.msg || '签到失败' }; }
  },
  async scrobbleStart(id) { await weblog('startplay', { id, type: 'song', mainsite: '1', mainsiteWeb: '1', content: 'id=' }); },
  async scrobble(id, seconds) { await weblog('play', { download: 0, end: 'playend', id, sourceId: '', time: seconds, type: 'song', wifi: 0, source: 'list', mainsite: '1', mainsiteWeb: '1', content: 'id=' }); },
  async cloud() {
    const out = [];
    for (let off = 0; off <= 3000;) {
      const j = await api('/weapi/v1/cloud/get', { limit: 200, offset: off }); const a = j.data || [];
      a.forEach(o => {
        const sim = o.simpleSong;
        if (sim && sim.name) { const t = song(sim); if (!t.cover && sim.al) t.cover = pic(sim.al.picUrl); out.push(t); }
        else out.push({ id: String(o.songId), title: o.songName || o.fileName, artist: o.artist || '未知艺人', album: o.album || '', duration: 0, cover: null });
      });
      if (!j.hasMore || !a.length) break; off += a.length;
    }
    return out;
  },

  // ---------- MV / 电台 ----------
  async artistMvs(id) { return ((await api('/weapi/artist/mvs', { artistId: id, limit: 30, offset: 0, total: true })).mvs || []).map(mvOf); },
  async recMvs() { return ((await api('/weapi/personalized/mv')).result || []).map(mvOf); },
  async topMvs() { return ((await api('/weapi/mv/toplist', { limit: 50, offset: 0, total: true, area: '' })).data || []).map(mvOf); },
  async mvUrl(id) {
    for (const r of [1080, 720, 480]) { const u = ((await api('/weapi/song/enhance/play/mv/url', { id, r })).data || {}).url; if (u) return u.replace(/^http:/, 'https:'); }
    throw new Error('拿不到 MV 地址');
  },
  async hotRadios(offset) { return ((await api('/weapi/djradio/hot/v1', { limit: 30, offset })).djRadios || []).map(o => ({ id: String(o.id), name: o.name, cover: pic(o.picUrl), desc: o.rcmdtext || o.category || '', count: o.programCount || 0 })); },
  async radioPrograms(rid) {
    return ((await api('/weapi/dj/program/byradio', { radioId: rid, limit: 100, offset: 0, asc: false })).programs || []).filter(o => o.mainSong).map(o => {
      const t = song(o.mainSong);
      return Object.assign(t, { title: o.name || t.title, cover: pic(o.coverUrl) || t.cover, artist: (o.dj && o.dj.nickname) || t.artist, duration: o.duration || o.mainSong.duration || t.duration });
    });
  },

  // ---------- 登录 ----------
  async loginModes() { return [{ id: 'qr', name: '网易云音乐 App 扫码' }]; },
  async loginQr() {
    const key = (await api('/weapi/login/qrcode/unikey', { type: 1 })).unikey; if (!key) throw new Error('获取二维码失败');
    return { text: 'https://music.163.com/login?codekey=' + key, key, hint: '用网易云音乐 App 扫码，并在手机上确认' };
  },
  async loginCheck(key) {
    const { j, setCookie } = await raw('/weapi/login/qrcode/client/login', { key, type: 1 });
    switch (j.code) {
      case 800: return { state: 'expired' };
      case 802: return { state: 'scanned' };
      case 803: saveCookie(setCookie.join('; ') + ';' + (j.cookie || '')); return { state: 'done' };
      default: return { state: 'wait' };
    }
  },
  /** 粘贴 Cookie 登录（至少要有 MUSIC_U） */
  async setCookie(text) { saveCookie(text); return { state: 'done' }; },
  async logout() { nk.store.set('cookie', null); uidCache = null; },
});
