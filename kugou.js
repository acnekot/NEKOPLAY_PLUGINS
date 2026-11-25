// @id kugou
// @name 酷狗音乐
// @type source
// @version 1.1.0
// @author NEKOPLAY
// @desc 酷狗音源：搜索（单曲/专辑/歌单/热搜/联想）、播放、歌词、推荐歌单、新歌速递、每日推荐、排行榜，扫码登录后看自己的歌单
// @api 1
// @search track,album,playlist
//
// 签名算法、接口路径和参数参考 MakcRe/KuGouMusicApi，按 NEKOPLAY 插件接口用 JS 重写。原项目版权声明：
//   MIT License, Copyright (c) 2023 MakcRe
//
// 歌曲 id：<128k 文件 hash>:<album_audio_id>:<album_id>（拿播放地址三样都要）
// 专辑 al<album_id>，歌手 ar<singer_id>，歌单 <global_collection_id>，排行榜 rank<rankid>

const APPID = 1005, CLIENTVER = 20489, SRCAPPID = 2919;
const SALT_ANDROID = 'OIlwieks28dk2k092lksi2UIkp';
const SALT_WEB = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
const SALT_KEY = '57ae12eb6890223e355ccfcb74edf70d';
const UA = 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi';
const RANK = 'http://mobilecdnbj.kugou.com/api/v3/rank';

// ---------- 账号 / 设备 ----------
function cred() { return nk.store.get('cred'); }
function guid() {
  let g = nk.store.get('guid');
  if (!g) { g = nk.md5(String(Math.random()) + Date.now()); nk.store.set('guid', g); }
  return g;
}
let MID = null;
function mid() { if (!MID) MID = BigInt('0x' + nk.md5(guid())).toString(); return MID; }  // MD5(guid) 当 16 进制大整数转十进制

// ---------- 签名 ----------
const valStr = (v) => (v !== null && typeof v === 'object') ? JSON.stringify(v) : String(v);
function signAndroid(p, body) { return nk.md5(SALT_ANDROID + Object.keys(p).sort().map(k => k + '=' + valStr(p[k])).join('') + body + SALT_ANDROID); }
function signWeb(p, body) { return nk.md5(SALT_WEB + Object.keys(p).map(k => k + '=' + valStr(p[k])).sort().join('') + (body || '') + SALT_WEB); }
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const randomStr = (n) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

/**
 * 发请求：默认参数（dfid / mid / appid / clientver / clienttime，登录后加 token / userid）+ 签名。
 * o.web = 网页版签名（登录二维码用），否则安卓版签名。
 */
async function req(path, params, o) {
  o = o || {};
  const time = Math.floor(Date.now() / 1000);
  const dfid = o.dfid || '-';
  const p = {};
  if (o.defaults !== false) {
    Object.assign(p, { dfid, mid: mid(), uuid: '-', appid: APPID, clientver: CLIENTVER, clienttime: time });
    const c = cred(); if (c) Object.assign(p, { token: c.token, userid: c.userid });
  }
  Object.assign(p, params);
  if (o.withKey) p.key = nk.md5(`${p.hash}${SALT_KEY}${p.appid}${p.mid}${p.userid || 0}`);
  const body = o.body ? JSON.stringify(o.body) : '';
  p.signature = o.web ? signWeb(p, body) : signAndroid(p, body);
  const url = (o.base || 'https://gateway.kugou.com') + path + '?' + Object.keys(p).map(k => k + '=' + enc(valStr(p[k]))).join('&');
  const headers = Object.assign({ 'User-Agent': UA, dfid, mid: mid(), clienttime: String(p.clienttime || time), 'kg-rc': '1', 'kg-thash': '5d816a0', 'kg-rec': '1', 'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F' }, o.headers || {});
  if (o.router) headers['x-router'] = o.router;
  const r = await nk.http(o.body ? { url, headers: Object.assign(headers, { 'Content-Type': 'application/json' }), body } : { url, headers });
  if (r.status < 200 || r.status > 299) throw new Error('酷狗服务返回 ' + r.status);
  let j; try { j = r.json(); } catch (e) { throw new Error('酷狗返回的不是 JSON'); }
  if (j.status === 0 || (j.error_code !== undefined && j.error_code !== 0)) {
    const code = j.error_code || j.errcode;
    if ([20018, 20017, 51002].includes(code)) throw new Error('酷狗登录已过期，请重新登录');
    if (code === 20028) throw new Error('酷狗要求安全验证（稍后再试或先登录）');
    throw new Error('酷狗接口错误（' + code + '）' + ((j.error || j.errmsg) ? '：' + (j.error || j.errmsg) : ''));
  }
  return j;
}
async function getJson(url) {
  const r = await nk.http({ url, headers: { 'User-Agent': 'Android15-AndroidPhone-11239-18-0-NetMusic-wifi' } });
  try { return r.json(); } catch (e) { throw new Error('酷狗返回的不是 JSON'); }
}

// ---------- 数据转换 ----------
const pic = (u, size) => u ? u.replace('{size}', String(size || 480)).replace(/^http:/, 'https:') : null;
const songId = (hash, audioId, albumId) => `${(hash || '').toLowerCase()}:${audioId || 0}:${albumId || 0}`;
const albumRef = (a) => (a && String(a) !== '0') ? 'al' + a : '';

/** 搜索结果里的歌（大写开头的字段） */
function searchSong(x) {
  return {
    id: songId(x.FileHash, x.MixSongID, x.AlbumID), title: x.SongName || x.OriSongName, artist: x.SingerName || '未知艺人', album: x.AlbumName || '',
    duration: (x.Duration || 0) * 1000, cover: pic(x.Image), artists: (x.Singers || []).map(s => ({ id: 'ar' + s.id, name: s.name })),
    albumId: albumRef(x.AlbumID), vip: x.Privilege === 10,
  };
}
/** 歌单 / 专辑里的歌（小写字段） */
function listSong(x) {
  if (x.base) {
    const ai = x.audio_info || {}, al = x.album_info || {}, b = x.base;
    return {
      id: songId(ai.hash_128 || ai.hash, b.album_audio_id, b.album_id), title: b.audio_name, artist: b.author_name || '未知艺人', album: al.album_name || '',
      duration: ai.duration_128 || ai.duration || 0, cover: pic(al.cover), artists: (x.authors || []).map(a => ({ id: 'ar' + a.author_id, name: a.author_name })), albumId: albumRef(b.album_id),
    };
  }
  if (x.audio_name !== undefined) {
    // 歌手页的歌：扁平字段（audio_name / author_name / timelength 毫秒）
    const tp = x.trans_param || {};
    return {
      id: songId(x.hash_128 || x.hash, x.album_audio_id, x.album_id), title: x.audio_name, artist: x.author_name || '未知艺人', album: x.album_name || '',
      duration: x.timelength_128 || x.timelength || 0, cover: pic(tp.union_cover), artists: (x.authors || []).map(a => ({ id: 'ar' + a.author_id, name: a.author_name })),
      albumId: albumRef(x.album_id), vip: x.privilege === 10,
    };
  }
  const singers = x.singerinfo || [];
  const full = x.name || '';
  const title = full.includes(' - ') && singers.length ? full.split(' - ').slice(1).join(' - ') : full;
  return {
    id: songId(x.hash, x.mixsongid || x.add_mixsongid, x.album_id), title, artist: singers.map(s => s.name).join(' / ') || (full.includes(' - ') ? full.split(' - ')[0] : '未知艺人'),
    album: (x.albuminfo && x.albuminfo.name) || '', duration: x.timelen || 0, cover: pic(x.cover), artists: singers.map(s => ({ id: 'ar' + s.id, name: s.name })),
    albumId: albumRef(x.album_id), vip: x.privilege === 10,
  };
}
function rankSong(x) {
  const au = x.authors || [], full = x.filename || '';
  return {
    id: songId(x.hash, x.album_audio_id, x.album_id), title: x.songname || full.split(' - ').slice(1).join(' - '),
    artist: au.map(a => a.author_name).join(' / ') || full.split(' - ')[0] || '未知艺人', album: x.album_name || '', duration: (x.duration || 0) * 1000,
    cover: pic(x.album_sizable_cover || (x.trans_param && x.trans_param.union_cover)), artists: au.map(a => ({ id: 'ar' + a.author_id, name: a.author_name })),
    albumId: albumRef(x.album_id), vip: x.privilege === 10,
  };
}

const SEARCH = 'complexsearch.kugou.com';
const QUALITIES = [['128', 'standard'], ['128', 'higher'], ['320', 'exhigh'], ['flac', 'lossless'], ['high', 'hires']];

nk.register({
  async search(q, type, page) {
    if (type === 'playlist') {
      const j = await req('/v1/search/special', { albumhide: 0, iscorrection: 1, keyword: q, nocollect: 0, page: page || 1, pagesize: 30, platform: 'AndroidFilter' }, { router: SEARCH });
      return ((j.data && j.data.lists) || []).map(p => ({ id: String(p.gid), name: p.specialname, count: p.song_count, cover: pic(p.img) }));
    }
    if (type === 'album') {
      const j = await req('/v1/search/album', { keyword: q, page: page || 1, pagesize: 30, platform: 'AndroidFilter', iscorrection: 1, category: '1', sorttype: 0, searchsong: 0 }, { router: SEARCH });
      return ((j.data && j.data.lists) || []).map(a => ({ id: 'al' + a.albumid, name: a.albumname, cover: pic(a.img), count: a.songcount, year: (a.publish_time || '').slice(0, 4), artist: a.singer }));
    }
    const j = await req('/v2/search/song', { keyword: q, page: page || 1, pagesize: 30, platform: 'AndroidFilter', iscorrection: 1, privilegefilter: 0, area_code: 1, dopicfull: 1 }, { router: SEARCH });
    return ((j.data && j.data.lists) || []).map(searchSong);
  },
  async hotSearch() {
    const j = await getJson('http://mobilecdn.kugou.com/api/v3/search/hot?format=json&plat=0&count=20');
    return ((j.data && j.data.info) || []).map(x => x.keyword).filter(Boolean);
  },
  async suggest(q) {
    const j = await getJson('https://searchtip.kugou.com/getSearchTip?MusicTipCount=10&MVTipCount=0&albumcount=0&keyword=' + encodeURIComponent(q));
    const list = (((j.data || [])[0] || {}).RecordDatas) || [];
    return [...new Set(list.map(x => x.HintInfo).filter(Boolean))].slice(0, 10);
  },

  async stream(id, quality) {
    const [hash, audioId, albumId] = id.split(':');
    let err = '没有可用的播放地址（无版权或需要酷狗会员）', last = '';
    for (let i = Math.min(Math.max(quality, 0), QUALITIES.length - 1); i >= 0; i--) {
      const [q, level] = QUALITIES[i];
      if (q === last) continue; last = q;
      try {
        const j = await req('/v5/url', { album_id: Number(albumId) || 0, area_code: 1, hash, ssa_flag: 'is_fromtrack', version: 11430, page_id: 151369488, quality: q,
          album_audio_id: Number(audioId) || 0, behavior: 'play', pid: 2, cmd: 26, pidversion: 3001, IsFreePart: 0, ppage_id: '463467626,350369493,788954147', cdnBackup: 1, module: '', clientver: 11430 },
          { router: 'trackercdn.kugou.com', withKey: true, dfid: randomStr(24) });
        const u = (j.url && j.url[0]) || (j.backupUrl && j.backupUrl[0]);
        if (!u) { err = j.errcode === 20028 ? '酷狗要求安全验证，先登录酷狗或换个网络再试' : j.status === 2 ? '这首歌需要酷狗会员或购买' : err; continue; }
        const br = j.bitRate || 0;
        return { url: u.replace(/^http:/, 'https:'), ext: j.extName || (q === 'flac' || q === 'high' ? 'flac' : 'mp3'), kbps: br > 10000 ? Math.round(br / 1000) : br, level };
      } catch (e) { err = e.message || err; }
    }
    return { error: err };
  },

  async lyric(id) {
    const [hash, audioId] = id.split(':');
    const s = await req('/v1/search', { album_audio_id: audioId || '0', appid: APPID, clientver: CLIENTVER, duration: 0, hash, keyword: '', lrctxt: 1, man: 'no' }, { base: 'https://lyrics.kugou.com', defaults: false });
    const c = (s.candidates || [])[0]; if (!c) return { lrc: '' };
    const d = await req('/download', { ver: 1, client: 'android', id: c.id, accesskey: c.accesskey, fmt: 'lrc', charset: 'utf8' }, { base: 'https://lyrics.kugou.com' });
    let lrc = ''; try { lrc = nk.base64.decode(d.content || ''); } catch (e) {}
    return { lrc };
  },

  async toplists() {
    const j = await getJson(`${RANK}/list?version=9108&plat=0&showtype=2&parentid=0&apiver=6&area_code=1&withsong=0`);
    return ((j.data && j.data.info) || []).map(r => ({ id: 'rank' + r.rankid, name: r.rankname, cover: pic(r.img_9 || r.imgurl || r.banner_9, 240) }));
  },
  async recPlaylists() {
    const j = await getJson('http://mobilecdnbj.kugou.com/api/v5/special/recommend?recommend_expire=0&sign=52186982747e1404d426fa3f2a1e8ee4&plat=0&uid=0&version=9108&page=1&area_code=1&appid=1005&mid=286974383886022203545511837994020015101&_t=1545746286');
    return ((j.data && j.data.list) || []).map(p => ({
      id: p.global_collection_id ? String(p.global_collection_id) : ('sp' + p.specialid),
      name: p.specialname || '', count: p.songcount || 0, cover: pic(p.imgurl), desc: p.intro || '',
    }));
  },
  async newSongs(area) {
    const map = { 0: 31308, 7: 31308, 96: 31310, 8: 31312, 16: 31311 };
    const rid = map[Number(area) || 0] || 31308;
    const d = (await getJson(`${RANK}/song?rankid=${rid}&page=1&pagesize=50&area_code=1&version=9108&plat=0`)).data;
    return ((d && d.info) || []).map(rankSong);
  },
  async daily() {
    const d = (await getJson(`${RANK}/song?rankid=6666&page=1&pagesize=30&area_code=1&version=9108&plat=0`)).data;
    return ((d && d.info) || []).map(rankSong);
  },

  async playlist(id) {
    const out = [];
    if (id.startsWith('rank')) {
      for (let page = 1; page <= 3; page++) {
        const d = (await getJson(`${RANK}/song?rankid=${id.slice(4)}&page=${page}&pagesize=100&area_code=1&version=9108&plat=0`)).data; if (!d) break;
        const l = (d.info || []).map(rankSong); out.push(...l);
        if (!l.length || out.length >= (d.total || out.length)) break;
      }
      return out;
    }
    if (id.startsWith('sp')) {
      for (let page = 1; page <= 3; page++) {
        const d = (await getJson(`http://mobilecdnbj.kugou.com/api/v3/special/song?specialid=${id.slice(2)}&page=${page}&pagesize=100&version=9108&plat=0`)).data; if (!d) break;
        const l = (d.info || []).map(rankSong); out.push(...l);
        if (!l.length || out.length >= (d.total || out.length)) break;
      }
      return out;
    }
    for (let page = 1; out.length < 3000; page++) {
      const j = await req('/pubsongs/v2/get_other_list_file_nofilt', { area_code: 1, begin_idx: (page - 1) * 300, plat: 1, type: 1, mode: 1, personal_switch: 1, extend_fields: 'abtags,hot_cmt,popularization', pagesize: 300, global_collection_id: id });
      const d = j.data; if (!d) break;
      const l = (d.songs || []).map(listSong); out.push(...l);
      if (!l.length || out.length >= (d.count || out.length)) break;
    }
    return out;
  },

  async album(id) {
    const aid = id.replace(/^al/, '');
    const tracks = [];
    for (let page = 1; tracks.length < 1000; page++) {
      const j = await req('/v1/album_audio/lite', {}, { router: 'openapi.kugou.com', body: { album_id: aid, is_buy: '', page, pagesize: 30 }, headers: { 'kg-tid': '255' } });
      const d = j.data; if (!d) break;
      const l = (d.songs || []).map(listSong); tracks.push(...l);
      if (!l.length || tracks.length >= (d.total || j.total || tracks.length)) break;
    }
    const f = tracks[0] || {};
    return { album: { id, name: f.album || '', cover: f.cover, count: tracks.length, artist: f.artist || '' }, tracks };
  },

  async artist(id) {
    const aid = id.replace(/^ar/, '');
    const time = Math.floor(Date.now() / 1000);
    const body = { appid: APPID, clientver: CLIENTVER, mid: mid(), clienttime: time, key: nk.md5(`${APPID}${SALT_ANDROID}${CLIENTVER}${time}`), author_id: aid, pagesize: 50, page: 1, sort: 1, area_code: 'all' };
    const j = await req('/kmr/v1/audio_group/author', {}, { base: 'https://openapi.kugou.com', router: 'openapi.kugou.com', body, headers: { 'kg-tid': '220' } });
    const tracks = (j.data || []).map(listSong);
    // 歌手名：出现在每首歌的歌手里最多的那个
    const count = {};
    tracks.forEach(t => t.artist.split(/[、,/&]| \/ /).map(x => x.trim()).filter(Boolean).forEach(n => { count[n] = (count[n] || 0) + 1; }));
    const name = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || '';
    tracks.forEach(t => { if (!t.artists.length) t.artists = t.artist.split(/[、,/&]| \/ /).map(x => x.trim()).filter(Boolean).map(n => ({ id: n === name ? id : '', name: n })).filter(a => a.id); });
    return { name, cover: tracks[0] && tracks[0].cover, tracks };
  },

  // ---------- 账号 ----------
  async account() { const c = cred(); return c ? { uid: String(c.userid), name: c.nick || String(c.userid), avatar: c.avatar || null } : null; },
  async myPlaylists() {
    const c = cred(); if (!c) return [];
    const j = await req('/v7/get_all_list', { plat: 1 }, { router: 'cloudlist.service.kugou.com', body: { userid: c.userid, token: c.token, total_ver: 979, type: 2, page: 1, pagesize: 100 } });
    return ((j.data && j.data.info) || []).map(p => ({
      id: String(p.global_collection_id), name: p.name, count: p.count, cover: pic(p.pic),
      liked: p.name === '我喜欢' || p.type === 1, mine: (p.list_create_userid || c.userid) === c.userid,
    })).sort((a, b) => (b.liked ? 1 : 0) - (a.liked ? 1 : 0));
  },
  async logout() { nk.store.set('cred', null); },

  async loginQr() {
    const j = await req('/v2/qrcode', { appid: 1001, type: 1, plat: 4, qrcode_txt: `https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=${APPID}&`, srcappid: SRCAPPID }, { base: 'https://login-user.kugou.com', web: true });
    const key = j.data && j.data.qrcode; if (!key) throw new Error('获取酷狗二维码失败');
    return { text: 'https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=' + key, key, hint: '用酷狗音乐 App 扫码，并在手机上确认' };
  },
  async loginCheck(key) {
    const j = await req('/v2/get_userinfo_qrcode', { plat: 4, appid: APPID, srcappid: SRCAPPID, qrcode: key }, { base: 'https://login-user.kugou.com', web: true });
    const d = j.data; if (!d) return { state: 'wait' };
    switch (d.status) {
      case 0: return { state: 'expired' };
      case 2: return { state: 'scanned' };
      case 4: nk.store.set('cred', { userid: d.userid, token: d.token, nick: d.nickname, avatar: pic(d.pic) }); return { state: 'done' };
      default: return { state: 'wait' };
    }
  },
});
