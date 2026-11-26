// @id kugou
// @name 酷狗音乐（概念版）
// @type source
// @version 2.0.0
// @minHost 0.6.8
// @permissions network, storage
// @author NEKOPLAY
// @desc 酷狗概念版音源（MIT 上游 MakcRe/KuGouMusicApi）：单曲/专辑/歌手/歌单搜索、热搜与联想、v6/v5 概念版高品与无损取流、每日推荐、私人 FM、新碟上架、推荐歌单、排行榜、扫码/Cookie 登录与曲库一键签到领每日 VIP
// @api 2
// @search track,album,artist,playlist
//
// 签名算法、概念版（lite）参数与接口路径参考开源项目 MakcRe/KuGouMusicApi，按 NEKOPLAY Plugin API v2 重写：
//   MIT License, Copyright (c) 2023 MakcRe
//
// 歌曲 id：<文件 hash>:<album_audio_id>:<album_id>（取流需三者配合）
// 专辑 al<album_id>，歌手 ar<author_id>，歌单 <global_collection_id> 或 sp<specialid>，排行榜 rank<rankid>

const APPID = 3116;          // 酷狗概念版（lite）AppID
const CLIENTVER = 11440;     // 酷狗概念版（lite）客户端版本
const SRCAPPID = 2919;
const APIVER = 20;
const SALT_ANDROID = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';
const SALT_KEY = '185672dd44712f60bb1736df5a377e82';
const SALT_WEB = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
const UA = 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi';
const RANK = 'http://mobilecdnbj.kugou.com/api/v3/rank';
const SEARCH = 'complexsearch.kugou.com';

// ---------- 账号 / 设备 ----------
function cred() { return nk.store.get('cred'); }
function saveCred(c) { nk.store.set('cred', c); }
function guid() {
  let g = nk.store.get('guid');
  if (!g) {
    g = nk.md5(String(Math.random()) + ':' + Date.now() + ':nekoplay-kg');
    nk.store.set('guid', g);
  }
  return g;
}
let MID = null;
function mid() {
  if (!MID) MID = BigInt('0x' + nk.md5(guid())).toString();
  return MID;
}

// ---------- 签名 ----------
const valStr = (v) => (v !== null && typeof v === 'object') ? JSON.stringify(v) : String(v);
function signAndroid(p, body) {
  const s = Object.keys(p).sort().map(k => k + '=' + valStr(p[k])).join('');
  return nk.md5(SALT_ANDROID + s + (body || '') + SALT_ANDROID);
}
function signWeb(p, body) {
  const s = Object.keys(p).map(k => k + '=' + valStr(p[k])).sort().join('');
  return nk.md5(SALT_WEB + s + (body || '') + SALT_WEB);
}
function signParamsKey(data, appid, clientver) {
  return nk.md5(`${appid || APPID}${SALT_ANDROID}${clientver || CLIENTVER}${data}`);
}
function signKey(hash, m, uid, appid) {
  return nk.md5(`${hash}${SALT_KEY}${appid || APPID}${m || mid()}${uid || 0}`);
}
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const randomStr = (n) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

/**
 * 概念版网关请求封装：默认注入 dfid / mid / uuid / appid(3116) / clientver(11440) / clienttime + 登录态 token/userid + 签名。
 */
async function req(path, params, o) {
  o = o || {};
  const time = Math.floor(Date.now() / 1000);
  const c = cred();
  const dfid = o.dfid || (c && c.dfid) || '-';
  const p = {};
  if (o.defaults !== false) {
    Object.assign(p, { dfid, mid: mid(), uuid: '-', appid: APPID, clientver: CLIENTVER, clienttime: time });
    if (c && c.token) p.token = c.token;
    if (c && c.userid) p.userid = c.userid;
  }
  if (params) Object.assign(p, params);
  if (o.withKey) p.key = signKey(p.hash || '', p.mid || mid(), p.userid || 0, p.appid || APPID);
  const hasBody = o.body !== undefined && o.body !== null;
  const body = hasBody ? (typeof o.body === 'string' ? o.body : JSON.stringify(o.body)) : '';
  if (!o.noSign) p.signature = o.web ? signWeb(p, body) : signAndroid(p, body);
  const url = (o.base || 'https://gateway.kugou.com') + path + '?' + Object.keys(p).map(k => k + '=' + enc(valStr(p[k]))).join('&');
  const headers = Object.assign({
    'User-Agent': UA,
    dfid,
    mid: mid(),
    clienttime: String(p.clienttime || time),
    'kg-rc': '1',
    'kg-thash': '5d816a0',
    'kg-rec': '1',
    'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
  }, o.headers || {});
  if (o.router) headers['x-router'] = o.router;
  const method = o.method || (hasBody ? 'POST' : 'GET');
  const httpOpt = { url, method, headers };
  if (hasBody) {
    if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
    httpOpt.body = body;
  }
  const r = await nk.http(httpOpt);
  if (r.status < 200 || r.status > 299) throw new Error('酷狗服务返回 ' + r.status);
  let j;
  try { j = r.json(); } catch (e) { throw new Error('酷狗返回的不是 JSON'); }
  if (!o.raw && (j.status === 0 || (j.error_code !== undefined && j.error_code !== 0))) {
    const code = j.error_code || j.errcode;
    if ([20018, 20017, 51002].includes(code)) throw new Error('酷狗登录已过期，请重新登录');
    if (code === 20028) throw new Error('酷狗触发安全验证（请先扫码登录概念版账号或稍后再试）');
    throw new Error('酷狗接口错误（' + code + '）' + ((j.error || j.errmsg || j.err_msg) ? '：' + (j.error || j.errmsg || j.err_msg) : ''));
  }
  return j;
}

async function getJson(url) {
  const r = await nk.http({ url, headers: { 'User-Agent': 'Android15-AndroidPhone-11239-18-0-NetMusic-wifi' } });
  try { return r.json(); } catch (e) { throw new Error('酷狗返回的不是 JSON'); }
}

/** 刷新概念版账号的 VIP 类型与 vip_token（用于 /v6/priv_url 高品/无损鉴权） */
async function syncVipInfo(force) {
  const c = cred();
  if (!c || !c.token || !c.userid) return c;
  if (!force && c.vipSyncedAt && Date.now() - c.vipSyncedAt < 3600_000) return c;
  try {
    const j = await req('/v1/get_union_vip', { busi_type: 'concept', opt_product_types: 'dvip,qvip', product_type: 'svip' }, { base: 'https://kugouvip.kugou.com', raw: true });
    const d = j && j.data;
    if (d) {
      const busi = (d.busi_vip || []).find(v => v && v.is_vip === 1) || (d.busi_vip || [])[0] || {};
      const vipType = d.vip_type || busi.vip_type || (d.is_vip ? 6 : 0) || c.vip_type || 0;
      const vipToken = d.vip_token || busi.vip_token || c.vip_token || '';
      const updated = Object.assign({}, c, { vip_type: vipType, vip_token: vipToken, vipSyncedAt: Date.now() });
      saveCred(updated);
      return updated;
    }
  } catch (e) {}
  return c;
}

// ---------- 数据转换 ----------
const pic = (u, size) => u ? String(u).replace('{size}', String(size || 480)).replace(/^http:/, 'https:') : null;
const songId = (hash, audioId, albumId) => `${String(hash || '').toLowerCase()}:${audioId || 0}:${albumId || 0}`;
const albumRef = (a) => (a && String(a) !== '0') ? 'al' + a : '';

function searchSong(x) {
  return {
    id: songId(x.FileHash || x.SQFileHash || x.HQFileHash, x.MixSongID || x.AlbumAudioID, x.AlbumID),
    title: x.SongName || x.OriSongName || '',
    artist: x.SingerName || '未知艺人',
    album: x.AlbumName || '',
    duration: (x.Duration || 0) * 1000,
    cover: pic(x.Image),
    artists: (x.Singers || []).map(s => ({ id: 'ar' + s.id, name: s.name })),
    albumId: albumRef(x.AlbumID),
    vip: x.Privilege === 10,
  };
}

function listSong(x) {
  if (x.base) {
    const ai = x.audio_info || {}, al = x.album_info || {}, b = x.base;
    return {
      id: songId(ai.hash_128 || ai.hash || ai.hash_320, b.album_audio_id, b.album_id),
      title: b.audio_name || '',
      artist: b.author_name || '未知艺人',
      album: al.album_name || '',
      duration: ai.duration_128 || ai.duration || 0,
      cover: pic(al.cover),
      artists: (x.authors || []).map(a => ({ id: 'ar' + a.author_id, name: a.author_name })),
      albumId: albumRef(b.album_id),
      vip: b.privilege === 10,
    };
  }
  if (x.audio_name !== undefined) {
    const tp = x.trans_param || {};
    return {
      id: songId(x.hash_128 || x.hash, x.album_audio_id, x.album_id),
      title: x.audio_name,
      artist: x.author_name || '未知艺人',
      album: x.album_name || '',
      duration: x.timelength_128 || x.timelength || 0,
      cover: pic(tp.union_cover || x.sizable_cover),
      artists: (x.authors || []).map(a => ({ id: 'ar' + a.author_id, name: a.author_name })),
      albumId: albumRef(x.album_id),
      vip: x.privilege === 10,
    };
  }
  const singers = x.singerinfo || [];
  const full = x.name || x.songname || x.filename || '';
  const title = x.songname || (full.includes(' - ') && singers.length ? full.split(' - ').slice(1).join(' - ') : full);
  const dur = x.timelen || (x.time_length ? x.time_length * 1000 : 0) || (x.duration ? (x.duration > 10000 ? x.duration : x.duration * 1000) : 0);
  return {
    id: songId(x.hash || x.hash_128, x.mixsongid || x.add_mixsongid || x.album_audio_id, x.album_id),
    title,
    artist: x.author_name || singers.map(s => s.name).join(' / ') || (full.includes(' - ') ? full.split(' - ')[0] : '未知艺人'),
    album: (x.albuminfo && x.albuminfo.name) || x.album_name || '',
    duration: dur,
    cover: pic(x.cover || x.sizable_cover || (x.trans_param && x.trans_param.union_cover)),
    artists: singers.map(s => ({ id: 'ar' + s.id, name: s.name })),
    albumId: albumRef(x.album_id),
    vip: x.privilege === 10,
  };
}

function rankSong(x) {
  const au = x.authors || [], full = x.filename || '';
  return {
    id: songId(x.hash, x.album_audio_id || x.mixsongid, x.album_id),
    title: x.songname || full.split(' - ').slice(1).join(' - '),
    artist: au.map(a => a.author_name).join(' / ') || x.author_name || full.split(' - ')[0] || '未知艺人',
    album: x.album_name || '',
    duration: (x.duration || x.time_length || 0) * 1000,
    cover: pic(x.album_sizable_cover || x.sizable_cover || (x.trans_param && x.trans_param.union_cover)),
    artists: au.map(a => ({ id: 'ar' + a.author_id, name: a.author_name })),
    albumId: albumRef(x.album_id),
    vip: x.privilege === 10,
  };
}

// 品质档位映射（0 标准 / 1 较高 / 2 极高 / 3 无损 / 4 Hi-Res）
const QUALITIES = [['128', 'standard'], ['128', 'higher'], ['320', 'exhigh'], ['flac', 'lossless'], ['high', 'hires']];
const LEVEL_BY_Q = { '128': 'standard', '320': 'exhigh', 'flac': 'lossless', 'high': 'hires' };

/** 从 /v6/priv_url 响应里挑选不超过目标档位的最高可用播放地址 */
function pickPrivStream(j, maxIdx) {
  const first = Array.isArray(j && j.data) ? j.data[0] : (j && j.data);
  if (!first) return null;
  const list = first.goods || first.info || (first.tracker_url ? [first] : []);
  const wantOrder = [];
  for (let i = Math.min(Math.max(maxIdx, 0), QUALITIES.length - 1); i >= 0; i--) {
    const q = QUALITIES[i][0];
    if (!wantOrder.includes(q)) wantOrder.push(q);
  }
  const byQ = {};
  (Array.isArray(list) ? list : []).forEach(item => {
    if (!item) return;
    const ti = item.info || item;
    const urls = ti.tracker_url || ti.url || item.tracker_url || item.url || [];
    const u = Array.isArray(urls) ? urls[0] : urls;
    const q = String(item.quality || ti.quality || '').toLowerCase();
    if (u && q) byQ[q] = { url: u, ext: ti.extname || ti.extName || item.extname, br: ti.bitrate || ti.bitRate || 0, trial: ti.is_free_part === 1 || item.is_free_part === 1 };
  });
  for (let i = 0; i < wantOrder.length; i++) {
    const q = wantOrder[i];
    const hit = byQ[q];
    if (hit && hit.url) {
      const br = Number(hit.br) || 0;
      const out = {
        url: hit.url.replace(/^http:/, 'https:'),
        ext: hit.ext || (q === 'flac' || q === 'high' ? 'flac' : 'mp3'),
        kbps: br > 10000 ? Math.round(br / 1000) : br,
        level: LEVEL_BY_Q[q] || 'standard',
      };
      if (hit.trial) {
        out.trial = true;
        out.message = '当前为试听片段，登录酷狗概念版并点击曲库「签到」可领每日免费 VIP';
      }
      return out;
    }
  }
  return null;
}

nk.register({
  async search(q, type, page) {
    page = page || 1;
    if (type === 'playlist') {
      const j = await req('/v1/search/special', { albumhide: 0, iscorrection: 1, keyword: q, nocollect: 0, page, pagesize: 30, platform: 'AndroidFilter' }, { router: SEARCH });
      return ((j.data && j.data.lists) || []).map(p => ({ id: String(p.gid), name: p.specialname, count: p.song_count, cover: pic(p.img) }));
    }
    if (type === 'album') {
      const j = await req('/v1/search/album', { keyword: q, page, pagesize: 30, platform: 'AndroidFilter', iscorrection: 1, category: '1', sorttype: 0, searchsong: 0, clientver: 201 }, { router: SEARCH });
      return ((j.data && j.data.lists) || []).map(a => ({ id: 'al' + a.albumid, name: a.albumname, cover: pic(a.img), count: a.songcount, year: (a.publish_time || '').slice(0, 4), artist: a.singer }));
    }
    if (type === 'artist') {
      const j = await req('/v1/search/author', { albumhide: 0, iscorrection: 1, keyword: q, nocollect: 0, page, pagesize: 30, platform: 'AndroidFilter' }, { router: SEARCH });
      return ((j.data && j.data.lists) || []).map(a => ({
        id: 'ar' + a.AuthorId,
        name: a.AuthorName || '',
        cover: pic(a.Avatar, 240),
        songs: a.AudioCount || 0,
        albums: a.AlbumCount || 0,
      }));
    }
    const j = await req('/v2/search/song', { keyword: q, page, pagesize: 30, platform: 'AndroidFilter', iscorrection: 1, privilegefilter: 0, area_code: 1, dopicfull: 1, clientver: 201 }, { router: SEARCH });
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
    const [rawHash, audioId, albumId] = String(id || '').split(':');
    const hash = (rawHash || '').toLowerCase();
    const maxIdx = Math.min(Math.max(Number(quality) || 0, 0), QUALITIES.length - 1);
    const c = await syncVipInfo(false);
    const uid = Number((c && c.userid) || 0);
    const token = (c && c.token) || '';
    const dfid = (c && c.dfid) || randomStr(24);
    let err = '没有可用的播放地址（无版权或需要酷狗概念版 VIP）';

    // 1) 已登录优先走概念版 /v6/priv_url（一次返回多音质）
    if (token && uid) {
      try {
        const j6 = await req('/v6/priv_url', {}, {
          base: 'http://gateway.kugou.com',
          router: 'tracker.kugou.com',
          dfid,
          raw: true,
          body: {
            area_code: '1',
            behavior: 'play',
            qualities: ['128', '320', 'flac', 'high'],
            resource: {
              album_audio_id: Number(audioId) || 0,
              collect_list_id: '3',
              collect_time: Date.now(),
              hash,
              id: 0,
              page_id: 1,
              type: 'audio',
            },
            token,
            tracker_param: {
              all_m: 1,
              auth: '',
              is_free_part: 0,
              key: signKey(hash, mid(), uid, APPID),
              module_id: 0,
              need_climax: 1,
              need_xcdn: 1,
              open_time: '',
              pid: '411',
              pidversion: '3001',
              priv_vip_type: '6',
              viptoken: (c && c.vip_token) || '',
            },
            userid: String(uid),
            vip: (c && c.vip_type) || 0,
          },
        });
        const picked = pickPrivStream(j6, maxIdx);
        if (picked && !picked.trial) return picked;
      } catch (e) { err = e.message || err; }
    }

    // 2) 概念版 /v5/url（pid=411, page_id=967177915）逐级降档取流
    const tryV5 = async (freePart) => {
      let last = '';
      for (let i = freePart ? 0 : maxIdx; i >= 0; i--) {
        const [q, level] = QUALITIES[i];
        if (q === last) continue;
        last = q;
        try {
          const j = await req('/v5/url', {
            album_id: Number(albumId) || 0,
            area_code: 1,
            hash,
            ssa_flag: 'is_fromtrack',
            version: 11430,
            page_id: 967177915,
            quality: q,
            album_audio_id: Number(audioId) || 0,
            behavior: 'play',
            pid: 411,
            cmd: 26,
            pidversion: 3001,
            IsFreePart: freePart ? 1 : 0,
            ppage_id: '356753938,823673182,967485191',
            cdnBackup: 1,
            module: '',
            clientver: 11430,
          }, { router: 'trackercdn.kugou.com', withKey: true, dfid, raw: true });
          const u = (j.url && j.url[0]) || (j.backupUrl && j.backupUrl[0]);
          if (u) {
            const br = j.bitRate || 0;
            const res = {
              url: u.replace(/^http:/, 'https:'),
              ext: j.extName || (q === 'flac' || q === 'high' ? 'flac' : 'mp3'),
              kbps: br > 10000 ? Math.round(br / 1000) : br,
              level,
            };
            if (freePart || j.priv_status === 1) {
              res.trial = true;
              res.message = '当前只能放试听片段，登录酷狗概念版并点击曲库「签到」可领每日免费 VIP';
            }
            return res;
          }
          const code = j.error_code || j.errcode;
          if (code === 20028) err = '酷狗触发安全验证，请先扫码登录概念版账号或稍后再试';
          else if (j.status === 2 || j.status === 3) err = '这首歌需要酷狗概念版 VIP（可在曲库点「签到」领每日免费 VIP）';
        } catch (e) { err = e.message || err; }
      }
      return null;
    };

    const full = await tryV5(false);
    if (full) return full;
    const trial = await tryV5(true);
    if (trial) return trial;
    return { error: err };
  },

  async lyric(id) {
    const [hash, audioId] = String(id || '').split(':');
    const s = await req('/v1/search', { album_audio_id: audioId || '0', appid: APPID, clientver: CLIENTVER, duration: 0, hash, keyword: '', lrctxt: 1, man: 'no' }, { base: 'https://lyrics.kugou.com', defaults: false });
    const c = (s.candidates || [])[0];
    if (!c) return { lrc: '' };
    const d = await req('/download', { ver: 1, client: 'android', id: c.id, accesskey: c.accesskey, fmt: 'lrc', charset: 'utf8' }, { base: 'https://lyrics.kugou.com' });
    let lrc = '';
    try { lrc = nk.base64.decode(d.content || ''); } catch (e) {}
    return { lrc };
  },

  async toplists() {
    const j = await getJson(`${RANK}/list?version=9108&plat=0&showtype=2&parentid=0&apiver=6&area_code=1&withsong=0`);
    return ((j.data && j.data.info) || []).map(r => ({ id: 'rank' + r.rankid, name: r.rankname, cover: pic(r.img_9 || r.imgurl || r.banner_9, 240) }));
  },

  async recPlaylists() {
    try {
      const t = String(Math.floor(Date.now() / 1000));
      const j = await req('/v2/special_recommend', {}, {
        router: 'specialrec.service.kugou.com',
        body: {
          appid: APPID,
          mid: mid(),
          clientver: CLIENTVER,
          platform: 'android',
          clienttime: t,
          userid: (cred() && cred().userid) || 0,
          module_id: 1,
          page: 1,
          pagesize: 30,
          key: signParamsKey(t),
          special_recommend: { withtag: 1, withsong: 1, sort: 1, ugc: 1, is_selected: 0, withrecommend: 1, area_code: 1, categoryid: 0 },
          req_multi: 1,
          retrun_min: 5,
          return_special_falg: 1,
        },
      });
      const list = (j.data && j.data.special_list) || [];
      if (list.length) {
        return list.map(p => ({
          id: p.global_collection_id ? String(p.global_collection_id) : ('sp' + p.specialid),
          name: p.specialname || '',
          count: p.songcount || (p.songs && p.songs.length) || 0,
          cover: pic(p.flexible_cover || p.imgurl),
          desc: p.intro || '',
        }));
      }
    } catch (e) {}
    const j = await getJson('http://mobilecdnbj.kugou.com/api/v5/special/recommend?recommend_expire=0&sign=52186982747e1404d426fa3f2a1e8ee4&plat=0&uid=0&version=9108&page=1&area_code=1&appid=1005&mid=286974383886022203545511837994020015101&_t=1545746286');
    return ((j.data && j.data.list) || []).map(p => ({
      id: p.global_collection_id ? String(p.global_collection_id) : ('sp' + p.specialid),
      name: p.specialname || '', count: p.songcount || 0, cover: pic(p.imgurl), desc: p.intro || '',
    }));
  },

  async newAlbums() {
    const c = cred();
    const j = await req('/musicadservice/v1/mobile_newalbum_sp', {}, {
      body: { apiver: APIVER, token: (c && c.token) || '', page: 1, pagesize: 30, withpriv: 1 },
    });
    const d = j.data || {};
    const raw = [].concat(d.chn || [], d.eur || [], d.jpn || [], d.kor || [], d.list || []);
    const seen = {};
    return raw.filter(a => a && a.albumid && !seen[a.albumid] && (seen[a.albumid] = 1)).slice(0, 30).map(a => ({
      id: 'al' + a.albumid,
      name: a.albumname || '',
      cover: pic(a.imgurl),
      count: a.songcount || 0,
      year: (a.publishtime || '').slice(0, 4),
      artist: a.singername || '',
    }));
  },

  async newSongs(area) {
    const map = { 0: 31308, 7: 31308, 96: 31310, 8: 31312, 16: 31311 };
    const rid = map[Number(area) || 0] || 31308;
    const d = (await getJson(`${RANK}/song?rankid=${rid}&page=1&pagesize=50&area_code=1&version=9108&plat=0`)).data;
    return ((d && d.info) || []).map(rankSong);
  },

  async daily() {
    const c = cred();
    if (c && c.token && c.userid) {
      try {
        const j = await req('/everyday_song_recommend', { platform: 'ios' }, { router: 'everydayrec.service.kugou.com', method: 'POST' });
        const list = (j.data && (j.data.song_list || j.data.songs || j.data.info)) || [];
        if (list.length) return list.map(listSong);
      } catch (e) {}
    }
    const d = (await getJson(`${RANK}/song?rankid=6666&page=1&pagesize=30&area_code=1&version=9108&plat=0`)).data;
    return ((d && d.info) || []).map(rankSong);
  },

  async fm() {
    const c = cred();
    const now = Date.now();
    const body = {
      appid: APPID,
      clienttime: now,
      mid: mid(),
      action: 'play',
      recommend_source_locked: 0,
      song_pool_id: 0,
      callerid: 0,
      m_type: 1,
      platform: 'ios',
      area_code: 1,
      remain_songcnt: 0,
      clientver: CLIENTVER,
      is_overplay: 0,
      mode: 'normal',
      fakem: 'ca981cfc583a4c37f28d2d49000013c16a0a',
      key: signParamsKey(now),
    };
    if (c && c.userid) { body.userid = c.userid; body.kguid = c.userid; }
    if (c && c.token) body.token = c.token;
    if (c && c.vip_type) body.vip_type = c.vip_type;
    const j = await req('/v2/personal_recommend', {}, { router: 'persnfm.service.kugou.com', body });
    return ((j.data && j.data.song_list) || []).map(listSong);
  },

  async playlist(id) {
    const out = [];
    if (id.startsWith('rank')) {
      for (let page = 1; page <= 3; page++) {
        const d = (await getJson(`${RANK}/song?rankid=${id.slice(4)}&page=${page}&pagesize=100&area_code=1&version=9108&plat=0`)).data;
        if (!d) break;
        const l = (d.info || []).map(rankSong);
        out.push(...l);
        if (!l.length || out.length >= (d.total || out.length)) break;
      }
      return out;
    }
    if (id.startsWith('sp')) {
      for (let page = 1; page <= 3; page++) {
        const d = (await getJson(`http://mobilecdnbj.kugou.com/api/v3/special/song?specialid=${id.slice(2)}&page=${page}&pagesize=100&version=9108&plat=0`)).data;
        if (!d) break;
        const l = (d.info || []).map(rankSong);
        out.push(...l);
        if (!l.length || out.length >= (d.total || out.length)) break;
      }
      return out;
    }
    for (let page = 1; out.length < 3000; page++) {
      const j = await req('/pubsongs/v2/get_other_list_file_nofilt', { area_code: 1, begin_idx: (page - 1) * 300, plat: 1, type: 1, mode: 1, personal_switch: 1, extend_fields: 'abtags,hot_cmt,popularization', pagesize: 300, global_collection_id: id });
      const d = j.data;
      if (!d) break;
      const l = (d.songs || []).map(listSong);
      out.push(...l);
      if (!l.length || out.length >= (d.count || out.length)) break;
    }
    return out;
  },

  async album(id) {
    const aid = String(id || '').replace(/^al/, '');
    const tracks = [];
    for (let page = 1; tracks.length < 1000; page++) {
      const j = await req('/v1/album_audio/lite', {}, { router: 'openapi.kugou.com', body: { album_id: aid, is_buy: '', page, pagesize: 30 }, headers: { 'kg-tid': '255' } });
      const d = j.data;
      if (!d) break;
      const l = (d.songs || []).map(listSong);
      tracks.push(...l);
      if (!l.length || tracks.length >= (d.total || j.total || tracks.length)) break;
    }
    const f = tracks[0] || {};
    return { album: { id, name: f.album || '', cover: f.cover, count: tracks.length, artist: f.artist || '' }, tracks };
  },

  async artist(id) {
    const aid = String(id || '').replace(/^ar/, '');
    const time = Math.floor(Date.now() / 1000);
    const body = { appid: APPID, clientver: CLIENTVER, mid: mid(), clienttime: time, key: signParamsKey(time), author_id: aid, pagesize: 50, page: 1, sort: 1, area_code: 'all' };
    const [detailRes, tracksRes] = await Promise.all([
      req('/kmr/v3/author', {}, { router: 'openapi.kugou.com', body: { author_id: aid }, headers: { 'kg-tid': '36' } }).catch(() => null),
      req('/kmr/v1/audio_group/author', {}, { base: 'https://openapi.kugou.com', router: 'openapi.kugou.com', body, headers: { 'kg-tid': '220' } }),
    ]);
    const info = (detailRes && detailRes.data) || {};
    const tracks = (tracksRes.data || []).map(listSong);
    let name = info.author_name || '';
    if (!name) {
      const count = {};
      tracks.forEach(t => t.artist.split(/[、,/&]| \/ /).map(x => x.trim()).filter(Boolean).forEach(n => { count[n] = (count[n] || 0) + 1; }));
      name = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || '';
    }
    tracks.forEach(t => {
      if (!t.artists.length) t.artists = t.artist.split(/[、,/&]| \/ /).map(x => x.trim()).filter(Boolean).map(n => ({ id: n === name ? id : '', name: n })).filter(a => a.id);
    });
    const desc = (Array.isArray(info.long_intro) && info.long_intro[0] && info.long_intro[0].content) || info.intro || '';
    return {
      name,
      cover: pic(info.sizable_avatar) || (tracks[0] && tracks[0].cover) || null,
      desc,
      albums: info.album_count || 0,
      tracks,
    };
  },

  // ---------- 账号与概念版每日领 VIP ----------
  async account() {
    const c = cred();
    if (!c || !c.token) return null;
    await syncVipInfo(false);
    return { uid: String(c.userid), name: c.nick || String(c.userid), avatar: c.avatar || null };
  },

  async myPlaylists() {
    const c = cred();
    if (!c || !c.token) return [];
    const j = await req('/v7/get_all_list', { plat: 1, userid: Number(c.userid), token: c.token }, {
      router: 'cloudlist.service.kugou.com',
      body: { userid: c.userid, token: c.token, total_ver: 979, type: 2, page: 1, pagesize: 100 },
    });
    return ((j.data && j.data.info) || []).map(p => ({
      id: String(p.global_collection_id),
      name: p.name,
      count: p.count,
      cover: pic(p.pic),
      liked: p.name === '我喜欢' || p.type === 1,
      mine: (p.list_create_userid || c.userid) === c.userid,
    })).sort((a, b) => (b.liked ? 1 : 0) - (a.liked ? 1 : 0));
  },

  /** 概念版每日签到领免费 VIP + 自动尝试升级概念版 VIP */
  async signin() {
    const c = cred();
    if (!c || !c.token || !c.userid) throw new Error('请先登录酷狗概念版账号');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const msgs = [];
    let ok = false;
    try {
      const r1 = await req('/youth/v1/recharge/receive_vip_listen_song', { source_id: 90139, receive_day: today }, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        raw: true,
      });
      if (r1.status === 1 || r1.error_code === 0) {
        ok = true;
        msgs.push('已领取今日概念版 VIP');
      } else if (r1.error_code === 131001 || /已领取|重复/.test(String(r1.error_msg || r1.errmsg || ''))) {
        ok = true;
        msgs.push('今日已领取过概念版 VIP');
      } else {
        msgs.push(r1.error_msg || r1.errmsg || ('领取返回 ' + (r1.error_code || r1.status)));
      }
    } catch (e) { msgs.push(e.message); }
    try {
      const r2 = await req('/youth/v1/listen_song/upgrade_vip_reward', { kugouid: Number(c.userid), ad_type: 1 }, { method: 'POST', raw: true });
      if (r2.status === 1 || r2.error_code === 0) {
        ok = true;
        msgs.push('概念版 VIP 已升级');
      }
    } catch (e) {}
    await syncVipInfo(true);
    return { done: ok, message: msgs.join(' · ') || '概念版签到完成' };
  },

  async setCookie(raw) {
    const text = String(raw || '').trim();
    let parsed = null;
    if (text.startsWith('{')) {
      try { parsed = JSON.parse(text); } catch (e) {}
    }
    if (!parsed) {
      const kv = {};
      text.split(/[;\n]+/).forEach(seg => {
        const i = seg.indexOf('=');
        if (i > 0) kv[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
      });
      parsed = kv;
    }
    const token = parsed.token || parsed.KUGOU_TOKEN;
    const userid = Number(parsed.userid || parsed.uid || 0);
    if (!token || !userid) throw new Error('请粘贴包含 token=...; userid=... 的酷狗 Cookie 或 JSON');
    saveCred({
      userid,
      token,
      nick: parsed.nickname || parsed.nick || String(userid),
      avatar: parsed.pic ? pic(parsed.pic) : null,
      dfid: parsed.dfid || undefined,
      vip_type: Number(parsed.vip_type || 0),
      vip_token: parsed.vip_token || '',
    });
    await syncVipInfo(true);
  },

  async logout() { saveCred(null); },

  async loginQr() {
    const j = await req('/v2/qrcode', {
      appid: 1001,
      type: 1,
      plat: 4,
      qrcode_txt: `https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=${APPID}&`,
      srcappid: SRCAPPID,
    }, { base: 'https://login-user.kugou.com', web: true });
    const key = j.data && j.data.qrcode;
    if (!key) throw new Error('获取酷狗概念版二维码失败');
    return {
      text: 'https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=' + key,
      key,
      hint: '用酷狗概念版 / 酷狗音乐 App 扫码确认登录（登录后可在曲库点「签到」领每日 VIP）',
    };
  },

  async loginCheck(key) {
    const j = await req('/v2/get_userinfo_qrcode', { plat: 4, appid: APPID, srcappid: SRCAPPID, qrcode: key }, { base: 'https://login-user.kugou.com', web: true });
    const d = j.data;
    if (!d) return { state: 'wait' };
    switch (d.status) {
      case 0: return { state: 'expired' };
      case 2: return { state: 'scanned' };
      case 4:
        saveCred({ userid: d.userid, token: d.token, nick: d.nickname, avatar: pic(d.pic) });
        await syncVipInfo(true);
        return { state: 'done' };
      default: return { state: 'wait' };
    }
  },
});
