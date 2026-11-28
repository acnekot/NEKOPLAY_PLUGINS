// @id kugou
// @name 酷狗音乐（概念版）
// @type source
// @version 2.5.0
// @minHost 0.6.7
// @permissions network, storage
// @author NEKOPLAY
// @desc 酷狗概念版音源：搜索、VIP 取流、日推与私人 FM
// @details 单曲 / 专辑 / 歌手 / 歌单搜索，热搜与联想词
// @details 歌单广场、排行榜、新碟新歌、每日推荐、私人 FM
// @details 评论区与楼中楼、相似歌曲、歌手专辑与 MV、云盘
// @details 歌单管理、喜欢与关注，个人主页与听歌排行，曲库一键签到
// @screenshots screenshots/kugou-1.jpg
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

// 概念版 1024-bit RSA 公钥模数（与 MakcRe/KuGouMusicApi publicLiteRasKey 一致）
const RSA_LITE_N = BigInt('0xc40a2d0da76511f3bb1cc2bbd3afbd8bea83b4d6b05b6c13eb8920c53f1af7679b32ba0d0edb843240ef1b836efed3ee240734c14c1399fd6594d16af22f52525d14d72e0155c6dcc8638d4f7bb94f3a0b1f4c29f991972f2a160a25eb0a9e724336be7f69bbd319ffab1c6dd8470b021dc434f3faba89f4a2a01b33bdbdd08b');
const RSA_LITE_E = 65537n;

function modPow(base, exp, mod) {
  let res = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) res = (res * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return res;
}

/** 概念版零填充原始 RSA 加密（与 MakcRe/KuGouMusicApi cryptoRSAEncrypt 一致），输出大写 hex */
function rsaLiteEncrypt(data) {
  const s = typeof data === 'string' ? data : JSON.stringify(data);
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  while (bytes.length < 128) bytes.push(0);
  const hex = bytes.slice(0, 128).map(b => b.toString(16).padStart(2, '0')).join('');
  return modPow(BigInt('0x' + hex), RSA_LITE_E, RSA_LITE_N).toString(16).padStart(256, '0').toUpperCase();
}

/** 概念版 RSAES-PKCS1-v1_5 加密（与 MakcRe/KuGouMusicApi rsaEncrypt2 一致），输出小写 hex */
function rsaLitePkcs1Encrypt(data) {
  const s = typeof data === 'string' ? data : JSON.stringify(data);
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  const psLen = 128 - 3 - bytes.length;
  const em = [0x00, 0x02];
  for (let i = 0; i < psLen; i++) em.push(1 + Math.floor(Math.random() * 254));
  em.push(0x00);
  for (let i = 0; i < bytes.length; i++) em.push(bytes[i]);
  const hex = em.map(b => b.toString(16).padStart(2, '0')).join('');
  return modPow(BigInt('0x' + hex), RSA_LITE_E, RSA_LITE_N).toString(16).padStart(256, '0');
}

let dfidMem = null;
/** 向酷狗设备风控接口 /risk/v3/r_register_dev 注册真实 dfid（避免假 dfid 触发 20028 风控或 VIP 鉴权失败） */
async function ensureDfid(force) {
  const c = cred();
  if (!force && c && c.dfid && c.dfid !== '-') return c.dfid;
  if (!force && dfidMem && dfidMem !== '-') return dfidMem;
  const saved = nk.store.get('dfid');
  if (!force && saved && saved !== '-') { dfidMem = saved; return dfidMem; }
  try {
    const aesSecret = randomStr(6);
    const km = nk.md5(aesSecret);
    const aesKey = km.slice(0, 16);
    const aesIv = km.slice(16, 32);
    const g = guid();
    const devPayload = {
      availableRamSize: 4983533568, availableRomSize: 48114719, availableSDSize: 48114717,
      basebandVer: '', batteryLevel: 100, batteryStatus: 3, brand: 'Redmi',
      buildSerial: 'unknown', device: 'marble', imei: g, imsi: '',
      manufacturer: 'Xiaomi', uuid: g, accelerometer: false, accelerometerValue: '',
      gravity: false, gravityValue: '', gyroscope: false, gyroscopeValue: '',
      light: false, lightValue: '', magnetic: false, magneticValue: '',
      orientation: false, orientationValue: '', pressure: false, pressureValue: '',
      step_counter: false, step_counterValue: '', temperature: false, temperatureValue: '',
    };
    const encBody = nk.aes({ data: JSON.stringify(devPayload), key: aesKey, iv: aesIv, mode: 'cbc', padding: true });
    const pRsa = rsaLitePkcs1Encrypt({ aes: aesSecret, uid: (c && c.userid) || 0, token: (c && c.token) || '' });
    const time = Math.floor(Date.now() / 1000);
    const p = { dfid: '-', mid: mid(), uuid: '-', appid: APPID, clientver: CLIENTVER, clienttime: time, part: 1, platid: 1, p: pRsa };
    if (c && c.token) p.token = c.token;
    if (c && c.userid) p.userid = c.userid;
    p.signature = signAndroid(p, encBody);
    const url = 'https://userservice.kugou.com/risk/v3/r_register_dev?' + Object.keys(p).map(k => k + '=' + enc(valStr(p[k]))).join('&');
    const r = await nk.http({
      url,
      method: 'POST',
      body: encBody,
      binary: true,
      headers: {
        'User-Agent': UA,
        'Content-Type': 'text/plain',
        dfid: '-',
        mid: mid(),
        clienttime: String(time),
        'kg-rc': '1',
        'kg-thash': '5d816a0',
        'kg-rec': '1',
        'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
      },
    });
    if (r.status >= 200 && r.status < 300 && r.bodyBase64) {
      const decB64 = nk.aes({ dataBase64: r.bodyBase64, key: aesKey, iv: aesIv, mode: 'cbc', padding: true, decrypt: true });
      const j = JSON.parse(nk.base64.decode(decB64));
      const d = j && j.status === 1 && j.data && j.data.dfid;
      if (d && d !== '-') {
        dfidMem = String(d);
        nk.store.set('dfid', dfidMem);
        return dfidMem;
      }
    }
  } catch (e) {}
  return '-';
}

/**
 * 概念版网关请求封装：默认注入 dfid / mid / uuid / appid(3116) / clientver(11440) / clienttime + 登录态 token/userid + 签名。
 */
async function req(path, params, o) {
  o = o || {};
  const time = Math.floor(Date.now() / 1000);
  const c = cred();
  const dfid = o.dfid || (c && c.dfid) || dfidMem || nk.store.get('dfid') || '-';
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
  const method = String(o.method || (hasBody ? 'POST' : 'GET')).toUpperCase();
  const httpOpt = { url, method, headers };
  if (hasBody || method === 'POST') {
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = hasBody ? 'application/json' : 'application/x-www-form-urlencoded';
    }
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
        url: hit.url,
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

let userAuthCache = null;

/** 概念版用户播放授权（/v1/user_verify -> auth），用于 /v1/authorization + /tracker/v5/url */
async function getUserAuth(force, dfid) {
  const c = cred();
  if (!c || !c.token || !c.userid) return '';
  if (!force && userAuthCache && userAuthCache.uid === String(c.userid) && userAuthCache.auth && Date.now() - userAuthCache.ts < 600_000) {
    return userAuthCache.auth;
  }
  try {
    const j = await req('/v1/user_verify', { module_id: 51 }, {
      base: 'https://gateway.kugou.com',
      router: 'trackercdngz.kugou.com',
      dfid,
      raw: true,
    });
    const auth = j && j.status === 1 && j.data && j.data.auth ? String(j.data.auth) : '';
    if (auth) {
      userAuthCache = { uid: String(c.userid), auth, ts: Date.now() };
      return auth;
    }
  } catch (e) {}
  return '';
}

/** 概念版单曲授权（/v1/authorization -> { auth, open_time }） */
async function getSongAuth(hash, audioId, dfid) {
  let uAuth = await getUserAuth(false, dfid);
  if (!uAuth) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const j = await req('/v1/authorization', {
        authorization: uAuth,
        module_id: 51,
        album_audio_id: Number(audioId) || 0,
        clientver: 11561,
        hash,
      }, {
        base: 'https://gateway.kugou.com',
        router: 'trackercdngz.kugou.com',
        dfid,
        raw: true,
      });
      if (j && j.status === 1 && j.data && j.data.auth) {
        return { auth: String(j.data.auth), open_time: j.data.open_time || 0 };
      }
    } catch (e) {}
    if (attempt === 0) {
      uAuth = await getUserAuth(true, dfid);
      if (!uAuth) break;
    }
  }
  return null;
}

const CMT_CODE = 'fc4be23b4e972707f36b8a828a93ba8a';
const cmtSpecialMap = {};
const tagIdMap = {};
const plListIdMap = {};
const plFileIdMap = {};
const trackMetaMap = {};

function rememberTrackMeta(t) {
  if (t && t.id) trackMetaMap[t.id] = { title: t.title || '', artist: t.artist || '' };
  return t;
}

function parseKugouTime(s) {
  if (!s) return 0;
  if (typeof s === 'number') return s > 1e12 ? s : s * 1000;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5], +m[6]);
}

function mapKgComment(x) {
  const cid = Number(x.id || 0);
  if (cid && x.special_id) cmtSpecialMap[cid] = String(x.special_id);
  const lk = x.like || {};
  return {
    id: cid,
    user: x.user_name || '酷狗用户',
    uid: String(x.user_id || ''),
    avatar: pic(x.user_pic, 165),
    content: x.content || '',
    liked: Number(lk.count || lk.likenum || 0),
    time: parseKugouTime(x.addtime),
    reply: x.pcontent ? ('@' + (x.puser || '用户') + '：' + x.pcontent) : null,
    replies: Number(x.reply_num || 0),
    likedByMe: !!lk.haslike,
  };
}

/** 酷狗 AES-128-CBC 加密（16 字符随机 key，hex 输出，用于关注/取消关注） */
function kgAesHex(obj) {
  const keyStr = randomStr(16);
  const md5Key = nk.md5(keyStr);
  const b64 = nk.aes({ data: JSON.stringify(obj), key: md5Key.slice(0, 32), iv: md5Key.slice(16, 32), mode: 'cbc', padding: true });
  const raw = nk.base64.decode(b64);
  let hex = '';
  for (let i = 0; i < raw.length; i++) hex += (raw.charCodeAt(i) & 0xff).toString(16).padStart(2, '0');
  return { key: keyStr, str: hex };
}

nk.register({
  // 宿主媒体规则：封面缩略图尺寸参数（宿主 0.6.9+ 读取）
  media: [
    { hosts: ['kugou.com'], image: { from: '/480/', to: '/{s}/', sizes: [150, 240, 480] } },
  ],
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
    const realDfid = await ensureDfid(false);
    const dfid = (realDfid && realDfid !== '-') ? realDfid : randomStr(24);
    let err = '没有可用的播放地址（无版权或需要酷狗概念版 VIP）';

    // 1) 已登录优先走概念版三段式 Auth 授权取流（user_verify -> authorization -> /tracker/v5/url）
    if (token && uid) {
      const sa = await getSongAuth(hash, audioId, dfid);
      if (sa && sa.auth) {
        let last = '';
        for (let i = maxIdx; i >= 0; i--) {
          const [q, level] = QUALITIES[i];
          if (q === last) continue;
          last = q;
          try {
            const j = await req('/tracker/v5/url', {
              album_id: Number(albumId) || 0,
              area_code: 1,
              module: '',
              hash,
              need_m: 0,
              ssa_flag: 'is_fromtrack',
              version: 11430,
              open_time: sa.open_time || 0,
              ptype: 0,
              need_ogg: 1,
              page_id: 967177915,
              auth: sa.auth,
              mtype: 0,
              quality: q,
              album_audio_id: Number(audioId) || 0,
              behavior: 'play',
              pid: 411,
              module_id: 51,
              cmd: 26,
              ppage_id: '356753938,823673182,967485191',
              clientver: 11561,
              pidversion: 3001,
              cdnBackup: 1,
            }, { withKey: true, dfid, raw: true });
            const u = (j.url && j.url[0]) || (j.backupUrl && j.backupUrl[0]);
            if (u) {
              const br = j.bitRate || 0;
              const res = {
                url: u,
                ext: j.extName || (q === 'flac' || q === 'high' ? 'flac' : 'mp3'),
                kbps: br > 10000 ? Math.round(br / 1000) : br,
                level,
              };
              if (j.priv_status === 1) {
                res.trial = true;
                res.message = '当前为试听片段，请确认酷狗概念版 VIP 有效或点击曲库「签到」领免费 VIP';
              }
              return res;
            }
            const code = j.error_code || j.errcode;
            if (code === 20028) err = '酷狗触发安全验证，请稍后再试';
          } catch (e) { err = e.message || err; }
        }
      }

      // 2) 回退概念版 /v6/priv_url（一次返回多音质）
      try {
        const j6 = await req('/v6/priv_url', {}, {
          base: 'https://gateway.kugou.com',
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

    // 3) 回退概念版 /v5/url（pid=411, page_id=967177915）逐级降档取流
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
              url: u,
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
          else if (j.status === 2 || j.status === 3) {
            err = (token && c && c.appid !== APPID)
              ? '当前登录态来自旧版标准端，请退出酷狗后重新扫码登录概念版'
              : '这首歌需要酷狗概念版 VIP（可在曲库点「签到」领每日免费 VIP）';
          }
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

  async newAlbums(area, offset) {
    const c = cred();
    const page = Math.floor((offset || 0) / 30) + 1;
    const j = await req('/musicadservice/v1/mobile_newalbum_sp', {}, {
      body: { apiver: APIVER, token: (c && c.token) || '', page, pagesize: 30, withpriv: 1 },
    });
    const d = j.data || {};
    const a = String(area || 'ALL').toUpperCase();
    const raw = a === 'ZH' ? (d.chn || [])
      : a === 'EA' ? (d.eur || [])
      : a === 'JP' ? (d.jpn || [])
      : a === 'KR' ? (d.kor || [])
      : [].concat(d.chn || [], d.eur || [], d.jpn || [], d.kor || [], d.list || []);
    const seen = {};
    return raw.filter(x => x && x.albumid && !seen[x.albumid] && (seen[x.albumid] = 1)).slice(0, 30).map(x => ({
      id: 'al' + x.albumid,
      name: x.albumname || '',
      cover: pic(x.imgurl),
      count: x.songcount || 0,
      year: (x.publishtime || '').slice(0, 4),
      artist: x.singername || '',
    }));
  },

  async categories() {
    const j = await req('/pubsongs/v1/get_tags_by_type', {}, { body: { tag_type: 'collection', tag_id: 0, source: 3 } });
    const out = ['全部', 'Hi-Res'];
    tagIdMap['全部'] = 0;
    tagIdMap['Hi-Res'] = 11292;
    (j.data || []).forEach(g => {
      (g.son || []).forEach(t => {
        if (t && t.tag_name && t.tag_id) {
          tagIdMap[t.tag_name] = Number(t.tag_id);
          if (!out.includes(t.tag_name)) out.push(t.tag_name);
        }
      });
    });
    return out.slice(0, 32);
  },

  async square(cat, offset) {
    const page = Math.floor((offset || 0) / 30) + 1;
    if (cat && !tagIdMap[cat] && cat !== '全部') await this.categories().catch(() => {});
    const cid = tagIdMap[cat] || 0;
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
        page,
        pagesize: 30,
        key: signParamsKey(t),
        special_recommend: { withtag: 1, withsong: 1, sort: 1, ugc: 1, is_selected: 0, withrecommend: 1, area_code: 1, categoryid: cid },
        req_multi: 1,
        retrun_min: 5,
        return_special_falg: 1,
      },
    });
    const list = (j.data && j.data.special_list) || [];
    const items = list.map(p => ({
      id: p.global_collection_id ? String(p.global_collection_id) : ('sp' + p.specialid),
      name: p.specialname || '',
      count: p.songcount || (p.songs && p.songs.length) || 0,
      cover: pic(p.flexible_cover || p.imgurl),
      desc: p.intro || '',
    }));
    return { items, more: items.length >= 20 };
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
      const l = (d.songs || []).map(x => {
        const s = rememberTrackMeta(listSong(x));
        if (x.fileid) plFileIdMap[id + '|' + s.id] = Number(x.fileid);
        return s;
      });
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

  async artistAlbums(id, offset, limit) {
    const aid = String(id || '').replace(/^ar/, '');
    const ps = limit || 30;
    const page = Math.floor((offset || 0) / ps) + 1;
    const j = await req('/kmr/v1/author/albums', {}, {
      router: 'openapi.kugou.com',
      headers: { 'kg-tid': '36' },
      body: { author_id: aid, pagesize: ps, page, sort: 1, category: 1, area_code: 'all' },
    });
    const list = (j.data || []).map(a => ({
      id: 'al' + a.album_id,
      name: a.album_name || '',
      cover: pic(a.sizable_cover),
      count: a.song_count || 0,
      year: String(a.publish_date || '').slice(0, 4),
      artist: a.author_name || '',
    }));
    return { items: list, more: (offset || 0) + list.length < Number(j.total || 0) };
  },

  async artistMvs(id) {
    const aid = String(id || '').replace(/^ar/, '');
    const j = await req('/kmr/v1/author/videos', { author_id: aid, is_fanmade: '', tag_idx: '', pagesize: 30, page: 1 }, {
      base: 'https://openapicdn.kugou.com',
    });
    return (j.data || []).map(v => {
      const h = v.mkv_qhd_hash || v.mkv_sd_hash || v.hd_hash || v.mv_hash || '';
      return {
        id: h || String(v.video_id || ''),
        name: v.video_name || '',
        cover: pic(v.hdpic || v.img),
        artist: v.author_name || '',
        duration: Number(v.timelength || 0),
        plays: Number(v.play_count || v.history_heat || 0),
      };
    }).filter(v => v.id && v.name);
  },

  async mvUrl(hash) {
    const j = await req('/v2/interface/index', { backupdomain: 1, cmd: 123, ext: 'mp4', ismp3: 0, hash: String(hash || ''), pid: 1, type: 1 }, {
      router: 'trackermv.kugou.com',
      withKey: true,
      raw: true,
    });
    const d = j.mvdata || {};
    const pick = d.rq || d.sq || d.hd || d.le || {};
    return pick.downurl || (pick.backupdownurl && pick.backupdownurl[0]) || null;
  },

  async simiSongs(id) {
    const [, audioId] = String(id || '').split(':');
    if (!audioId || audioId === '0') return [];
    const p = {
      album_audio_id: Number(audioId),
      appid: 1005,
      area_code: 1,
      clientver: 12329,
      page: 1,
      pagesize: 20,
      show_input: 1,
      show_type: 0,
      sort: 1,
      type: 0,
      version: 1,
    };
    const salt = 'OIlwieks28dk2k092lksi2UIkp';
    p.signature = nk.md5(salt + Object.keys(p).sort().map(k => k + '=' + p[k]).join('') + salt);
    const url = 'https://listkmrp3cdnretry.kugou.com/v3/album_audio/related?' + Object.keys(p).map(k => k + '=' + enc(String(p[k]))).join('&');
    const r = await nk.http({ url, headers: { 'User-Agent': UA } });
    let j;
    try { j = r.json(); } catch (e) { return []; }
    const list = (j && j.data && (j.data.lists || j.data.list || j.data)) || [];
    return (Array.isArray(list) ? list : []).map(listSong).filter(t => t.title);
  },

  async comments(id, hot, offset) {
    const [, audioId] = String(id || '').split(':');
    if (!audioId || audioId === '0') return { items: [], total: 0 };
    const page = Math.floor((offset || 0) / 20) + 1;
    const j = await req('/mcomment/v1/cmtlist', {
      ver: 6,
      mixsongid: Number(audioId),
      need_show_image: 1,
      p: page,
      pagesize: 20,
      show_classify: 1,
      show_hotword_list: 1,
      extdata: '0',
      code: CMT_CODE,
    }, { method: 'POST', raw: true });
    if (!j || j.status !== 1) return { items: [], total: 0 };
    const raw = (hot && page === 1 && Array.isArray(j.weightList) && j.weightList.length)
      ? j.weightList
      : (j.list || []);
    return { items: raw.map(mapKgComment), total: Number(j.count || j.combine_count || raw.length) };
  },

  async commentFloor(id, parent, cursor) {
    const [, audioId] = String(id || '').split(':');
    const page = cursor && cursor > 0 ? Number(cursor) : 1;
    const specialId = cmtSpecialMap[Number(parent)] || '';
    const params = {
      need_show_image: 1,
      p: page,
      pagesize: 20,
      show_classify: 1,
      show_hotword_list: 1,
      code: CMT_CODE,
      tid: Number(parent),
    };
    if (specialId) params.childrenid = specialId;
    if (audioId && audioId !== '0') params.mixsongid = Number(audioId);
    const j = await req('/mcomment/v1/hot_replylist', params, { method: 'POST', raw: true });
    const raw = (j && j.list) || [];
    const items = raw.map(mapKgComment);
    const total = Number((j && (j.count || j.total)) || 0);
    return { items, next: items.length >= 20 && page * 20 < total ? page + 1 : -1 };
  },

  // ---------- 账号、用户主页与概念版每日领 VIP ----------
  async account() {
    const c = cred();
    if (!c || !c.token) return null;
    await syncVipInfo(false);
    return { uid: String(c.userid), name: c.nick || String(c.userid), avatar: c.avatar || null };
  },

  async user(id) {
    const c = cred();
    const uid = String(id || (c && c.userid) || '');
    if (!uid) throw new Error('请先登录酷狗概念版账号');
    const isMe = !!(c && c.token && String(c.userid) === uid);
    let d = {};
    if (isMe) {
      try {
        const t = Math.floor(Date.now() / 1000);
        const pk = rsaLiteEncrypt({ token: c.token, clienttime: t });
        const j = await req('/v3/get_my_info', { plat: 1 }, {
          router: 'usercenter.kugou.com',
          body: { visit_time: t, usertype: 1, p: pk, userid: Number(c.userid) },
          raw: true,
        });
        if (j && j.status === 1 && j.data) d = j.data;
      } catch (e) {}
    }
    const vipTag = c && c.vip_type ? '酷狗概念版 VIP' : '酷狗概念版用户';
    return {
      uid,
      name: d.nickname || (isMe && c.nick) || uid,
      avatar: pic(d.pic) || (isMe && c.avatar) || null,
      bg: pic(d.bg_pic || d.background) || null,
      signature: d.descri || d.signature || vipTag,
      level: Number(d.p_grade || d.grade || d.level || 0),
      listened: Number(d.listen_songs || d.total_listen || 0),
      follows: Number(d.follows || d.follow_num || 0),
      fans: Number(d.fans || d.fans_num || 0),
      followed: false,
    };
  },

  async userPlaylists(id) {
    const c = cred();
    if (c && c.token && (!id || String(id) === String(c.userid))) {
      return await this.myPlaylists();
    }
    return [];
  },

  async playRecord(id, week) {
    const c = cred();
    if (!c || !c.token || !c.userid) return [];
    const uid = Number(id || c.userid);
    const t = Math.floor(Date.now() / 1000);
    const p = rsaLiteEncrypt({ clienttime: t, token: c.token });
    const j = await req('/v2/get_list', { clienttime: t, plat: 0 }, {
      base: 'https://listenservice.kugou.com',
      body: { t_userid: uid, userid: Number(c.userid), list_type: week ? 1 : 0, area_code: 1, cover: 2, p },
      raw: true,
    });
    const list = (j && j.data && (j.data.lists || j.data.list || j.data.info)) || [];
    return list.map(x => ({
      track: listSong(x),
      count: Number(x.pc || x.play_count || x.count || 0),
    })).filter(x => x.track && x.track.title);
  },

  async subArtists() {
    const c = cred();
    if (!c || !c.token || !c.userid) return [];
    const t = Math.floor(Date.now() / 1000);
    const j = await req('/v4/follow_list', { plat: 1 }, {
      router: 'relationuser.kugou.com',
      body: {
        merge: 2,
        need_iden_type: 1,
        ext_params: 'k_pic,jumptype,singerid,score',
        userid: Number(c.userid),
        type: 0,
        id_type: 0,
        p: rsaLiteEncrypt({ clienttime: t, token: c.token }),
      },
      raw: true,
    });
    const list = (j && j.data && (j.data.lists || j.data.list)) || [];
    return list.filter(x => x && (x.singerid || x.userid)).map(x => ({
      id: 'ar' + (x.singerid || x.userid),
      name: x.nickname || x.author_name || '',
      cover: pic(x.pic || x.k_pic, 240),
      followed: true,
    }));
  },

  async myPlaylists() {
    const c = cred();
    if (!c || !c.token) return [];
    const j = await req('/v7/get_all_list', { plat: 1, userid: Number(c.userid), token: c.token }, {
      router: 'cloudlist.service.kugou.com',
      body: { userid: c.userid, token: c.token, total_ver: 979, type: 2, page: 1, pagesize: 100 },
    });
    return ((j.data && j.data.info) || []).map(p => {
      const gid = String(p.global_collection_id || '');
      if (gid && p.listid) plListIdMap[gid] = Number(p.listid);
      return {
        id: gid,
        name: p.name,
        count: p.count,
        cover: pic(p.pic),
        liked: p.name === '我喜欢' || p.type === 1,
        mine: (p.list_create_userid || c.userid) === c.userid,
      };
    }).sort((a, b) => (b.liked ? 1 : 0) - (a.liked ? 1 : 0));
  },

  async createPlaylist(name, priv) {
    const c = cred();
    if (!c || !c.token || !c.userid) throw new Error('请先登录酷狗概念版账号');
    const t = Math.floor(Date.now() / 1000);
    const j = await req('/cloudlist.service/v5/add_list', { last_time: t, last_area: 'gztx', userid: c.userid, token: c.token }, {
      body: {
        userid: c.userid, token: c.token, total_ver: 0, name: String(name || '新建歌单'),
        type: 0, source: 1, is_pri: priv ? 1 : 0, list_create_userid: c.userid,
        list_create_listid: 0, list_create_gid: '', from_shupinmv: 0,
      },
    });
    const d = (j.data && j.data.info) || j.data || {};
    const gid = String(d.global_collection_id || d.listid || '');
    if (gid && d.listid) plListIdMap[gid] = Number(d.listid);
    return gid;
  },

  async editPlaylist(id, op, ids) {
    const c = cred();
    if (!c || !c.token || !c.userid) throw new Error('请先登录酷狗概念版账号');
    if (!plListIdMap[id]) await this.myPlaylists();
    const listid = plListIdMap[id];
    if (!listid) throw new Error('未找到目标歌单 listid');
    const list = Array.isArray(ids) ? ids : [ids];
    if (op === 'del') {
      const fileids = list.map(tid => plFileIdMap[id + '|' + tid]).filter(Boolean).map(fid => ({ fileid: fid }));
      if (!fileids.length) throw new Error('请先打开歌单加载歌曲后再移除');
      await req('/v4/delete_songs', {}, {
        router: 'cloudlist.service.kugou.com',
        body: { listid, userid: c.userid, data: fileids, type: 0, token: c.token, list_ver: 0 },
      });
      return;
    }
    const t = Math.floor(Date.now() / 1000);
    const resource = list.map(tid => {
      const [hash, audioId, albumId] = String(tid || '').split(':');
      const m = trackMetaMap[tid] || {};
      return {
        number: 1,
        name: m.artist && m.title ? `${m.artist} - ${m.title}` : (m.title || hash || ''),
        hash: (hash || '').toUpperCase(),
        size: 0, sort: 0, timelen: 0, bitrate: 0,
        album_id: Number(albumId) || 0,
        mixsongid: Number(audioId) || 0,
      };
    });
    await req('/cloudlist.service/v6/add_song', { last_time: t, last_area: 'gztx', userid: c.userid, token: c.token }, {
      body: { userid: c.userid, token: c.token, listid, list_ver: 0, type: 0, slow_upload: 1, scene: 'false;null', data: resource },
    });
  },

  async like(id, on) {
    const c = cred();
    if (!c || !c.token) throw new Error('请先登录酷狗概念版账号');
    const pls = await this.myPlaylists();
    const likedPl = pls.find(p => p.liked);
    if (!likedPl) throw new Error('未找到酷狗「我喜欢」歌单');
    await this.editPlaylist(likedPl.id, on ? 'add' : 'del', [id]);
  },

  async followArtist(id, on) {
    const c = cred();
    if (!c || !c.token || !c.userid) throw new Error('请先登录酷狗概念版账号');
    const singerid = Number(String(id || '').replace(/^ar/, ''));
    const t = Math.floor(Date.now() / 1000);
    const encData = kgAesHex({ singerid, token: c.token });
    await req(on ? '/followservice/v3/follow_singer' : '/followservice/v3/unfollow_singer', { clienttime: t }, {
      body: {
        plat: 0, userid: Number(c.userid), singerid, source: 7,
        p: rsaLitePkcs1Encrypt({ clienttime: t, key: encData.key }),
        params: encData.str,
      },
    });
  },

  async cloud() {
    const c = cred();
    if (!c || !c.token || !c.userid) return [];
    const aesSecret = randomStr(6);
    const km = nk.md5(aesSecret);
    const aesKey = km.slice(0, 16), aesIv = km.slice(16, 32);
    const encB64 = nk.aes({ data: JSON.stringify({ page: 1, pagesize: 50, getkmr: 1 }), key: aesKey, iv: aesIv, mode: 'cbc', padding: true });
    const t = Math.floor(Date.now() / 1000);
    const p = rsaLitePkcs1Encrypt({ aes: aesSecret, uid: Number(c.userid), token: c.token }).toUpperCase();
    const q = { clienttime: t, mid: mid(), key: signParamsKey(String(t)), clientver: CLIENTVER, appid: APPID, p };
    const url = 'https://mcloudservice.kugou.com/v1/get_list?' + Object.keys(q).map(k => k + '=' + enc(String(q[k]))).join('&');
    const r = await nk.http({ url, method: 'POST', body: encB64, binary: true, headers: { 'User-Agent': UA, 'Content-Type': 'application/octet-stream' } });
    if (r.status !== 200 || !r.bodyBase64) return [];
    try {
      const dec = nk.aes({ dataBase64: r.bodyBase64, key: aesKey, iv: aesIv, mode: 'cbc', padding: true, decrypt: true });
      const j = JSON.parse(nk.base64.decode(dec));
      return ((j.data && j.data.list) || []).map(listSong);
    } catch (e) { return []; }
  },

  async loginModes() { return [{ id: 'qr', name: '酷狗概念版扫码' }]; },

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
      appid: APPID,
      userid,
      token,
      nick: parsed.nickname || parsed.nick || String(userid),
      avatar: parsed.pic ? pic(parsed.pic) : null,
      dfid: parsed.dfid || undefined,
      vip_type: Number(parsed.vip_type || 0),
      vip_token: parsed.vip_token || '',
    });
    userAuthCache = null;
    await syncVipInfo(true);
  },

  async logout() { userAuthCache = null; saveCred(null); },

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
        saveCred({ appid: APPID, userid: d.userid, token: d.token, nick: d.nickname, avatar: pic(d.pic) });
        userAuthCache = null;
        await ensureDfid(true);
        await syncVipInfo(true);
        return { state: 'done' };
      default: return { state: 'wait' };
    }
  },
});
