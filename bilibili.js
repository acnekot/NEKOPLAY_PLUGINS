// @id bilibili
// @name 哔哩哔哩
// @type source
// @version 1.5.0
// @minHost 0.6.7
// @permissions network, storage
// @author NEKOPLAY
// @desc 哔哩哔哩完整音源（参考 BBPlayer）：WBI 签名、视频/UP主/用户搜索、DASH 音频流（支持 Hi-Res FLAC）、分P与UP主合集、每日推荐/随机电台/相似推荐/新歌榜单、CC 字幕歌词、视频评论区（热门/最新/楼中楼/点赞/回复）、用户主页、点赞/关注/收藏夹管理，扫码登录后同步收藏夹与稍后再看
// @api 2
// @search track,artist,user
//
// 接口与 WBI 签名逻辑参考开源项目 bbplayer-app/BBPlayer，按 NEKOPLAY 插件接口（v1）使用 QuickJS 重写。
// 歌曲 id：<bvid> 或 <bvid>:<cid>（多P视频带 cid）；歌手 id：<mid>；歌单 id：rank:<rid> / popular / fav:<media_id> / toview

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REFERER = 'https://www.bilibili.com/';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

// ---------- Cookie & 设备指纹（buvid3 / buvid4） ----------
function getCred() { return nk.store.get('cred') || null; }
function setCred(c) { nk.store.set('cred', c); }

let buvidMem = null;
async function ensureBuvid() {
  if (buvidMem) return buvidMem;
  const saved = nk.store.get('buvid');
  if (saved && saved.b3) { buvidMem = saved; return buvidMem; }
  try {
    const r = await nk.http({
      url: 'https://api.bilibili.com/x/frontend/finger/spi',
      headers: { 'User-Agent': UA, Referer: REFERER },
    });
    const j = r.json();
    if (j && j.code === 0 && j.data && j.data.b_3) {
      buvidMem = { b3: j.data.b_3, b4: j.data.b_4 || '' };
      nk.store.set('buvid', buvidMem);
      return buvidMem;
    }
  } catch (e) {}
  return { b3: '', b4: '' };
}

async function buildCookie() {
  const parts = [];
  const bv = await ensureBuvid();
  if (bv.b3) parts.push('buvid3=' + bv.b3);
  if (bv.b4) parts.push('buvid4=' + bv.b4);
  const c = getCred();
  if (c) {
    if (c.raw) return parts.concat([c.raw]).join('; ');
    if (c.SESSDATA) parts.push('SESSDATA=' + c.SESSDATA);
    if (c.bili_jct) parts.push('bili_jct=' + c.bili_jct);
    if (c.DedeUserID) parts.push('DedeUserID=' + c.DedeUserID);
  }
  return parts.join('; ');
}

// ---------- WBI 签名 ----------
function getMixinKey(orig) {
  let out = '';
  for (let i = 0; i < MIXIN_KEY_ENC_TAB.length && out.length < 32; i++) {
    const ch = orig[MIXIN_KEY_ENC_TAB[i]];
    if (ch) out += ch;
  }
  return out.slice(0, 32);
}

function isSameDay(ts) {
  if (!ts) return false;
  const a = new Date(ts), b = new Date();
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

let wbiCache = null;
async function getWbiKeys() {
  if (wbiCache && isSameDay(wbiCache.ts)) return wbiCache;
  const saved = nk.store.get('wbi_keys');
  if (saved && saved.img_key && saved.sub_key && isSameDay(saved.ts)) {
    wbiCache = saved;
    return wbiCache;
  }
  const j = await biliGet('https://api.bilibili.com/x/web-interface/nav', null, false);
  const imgUrl = j && j.data && j.data.wbi_img && j.data.wbi_img.img_url || '';
  const subUrl = j && j.data && j.data.wbi_img && j.data.wbi_img.sub_url || '';
  const stem = (u) => {
    const file = u.slice(u.lastIndexOf('/') + 1);
    const dot = file.lastIndexOf('.');
    return dot > 0 ? file.slice(0, dot) : file;
  };
  const img_key = stem(imgUrl), sub_key = stem(subUrl);
  if (!img_key || !sub_key) throw new Error('获取 B 站 WBI 密钥失败');
  wbiCache = { img_key, sub_key, ts: Date.now() };
  nk.store.set('wbi_keys', wbiCache);
  return wbiCache;
}

function encWbi(params, imgKey, subKey) {
  const mixinKey = getMixinKey(imgKey + subKey);
  const p = Object.assign({}, params, { wts: Math.round(Date.now() / 1000) });
  const filter = /[!'()*]/g;
  const query = Object.keys(p).sort().map(k => {
    const v = String(p[k] == null ? '' : p[k]).replace(filter, '');
    return encodeURIComponent(k) + '=' + encodeURIComponent(v);
  }).join('&');
  const sign = nk.md5(query + mixinKey);
  return query + '&w_rid=' + sign;
}

// ---------- 网络封装 ----------
function qs(params) {
  if (!params) return '';
  return Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])))
    .join('&');
}

async function biliGet(url, params, useWbi) {
  let fullUrl = url;
  if (params) {
    if (useWbi) {
      const keys = await getWbiKeys();
      fullUrl += (url.includes('?') ? '&' : '?') + encWbi(params, keys.img_key, keys.sub_key);
    } else {
      const q = qs(params);
      if (q) fullUrl += (url.includes('?') ? '&' : '?') + q;
    }
  }
  const cookie = await buildCookie();
  const headers = { 'User-Agent': UA, Referer: REFERER, Origin: 'https://www.bilibili.com' };
  if (cookie) headers.Cookie = cookie;
  const r = await nk.http({ url: fullUrl, headers });
  if (r.status < 200 || r.status > 299) throw new Error('哔哩哔哩服务返回 ' + r.status);
  let j;
  try { j = r.json(); } catch (e) { throw new Error('哔哩哔哩返回的不是 JSON'); }
  return j;
}

function getCsrf() {
  const c = getCred();
  if (!c) return '';
  if (c.bili_jct) return c.bili_jct;
  if (c.raw) {
    const m = c.raw.match(/(?:^|;\s*)bili_jct=([^;\s]+)/i);
    if (m) return m[1];
  }
  return '';
}

async function biliPostForm(url, form) {
  const cookie = await buildCookie();
  const headers = { 'User-Agent': UA, Referer: REFERER, Origin: 'https://www.bilibili.com' };
  if (cookie) headers.Cookie = cookie;
  const r = await nk.http({ url, method: 'POST', form, headers });
  if (r.status < 200 || r.status > 299) throw new Error('哔哩哔哩服务返回 ' + r.status);
  let j;
  try { j = r.json(); } catch (e) { throw new Error('哔哩哔哩返回的不是 JSON'); }
  return j;
}

// bvid -> aid 缓存与评论游标/楼层根映射
const aidCache = {};
const commentCursors = {};
const commentRootMap = {};

async function resolveAid(id) {
  const bvid = splitId(id).bvid;
  if (!bvid) throw new Error('无效的视频标识');
  if (/^av\d+$/i.test(bvid)) return Number(bvid.slice(2));
  if (/^\d+$/.test(bvid)) return Number(bvid);
  if (aidCache[bvid]) return aidCache[bvid];
  const j = await biliGet('https://api.bilibili.com/x/web-interface/view', { bvid }, false);
  const aid = j && j.code === 0 && j.data && j.data.aid;
  if (!aid) throw new Error((j && j.message) || '获取视频 aid 失败');
  aidCache[bvid] = Number(aid);
  return aidCache[bvid];
}

function mapComment(r) {
  const m = r.member || {};
  const rpid = Number(r.rpid || 0);
  const root = Number(r.root || 0);
  if (rpid) commentRootMap[rpid] = root || rpid;
  const text = (r.content && r.content.message) || '';
  return {
    id: rpid,
    user: cleanText(m.uname || 'B站用户'),
    uid: String(m.mid || ''),
    avatar: pic(m.avatar),
    content: text,
    liked: Number(r.like || 0),
    time: Number(r.ctime || 0) * 1000,
    reply: null,
    replies: Number(r.rcount || 0),
    likedByMe: Number(r.action || 0) === 1,
  };
}

// ---------- 工具与数据转换 ----------
function pic(u) {
  if (!u) return null;
  if (u.startsWith('//')) return 'https:' + u;
  return u.replace(/^http:/, 'https:');
}

function cleanText(s) {
  return String(s || '')
    .replace(/<em[^>]*>|<\/em>/gi, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseDur(d) {
  if (typeof d === 'number') return d > 100000 ? d : d * 1000;
  const parts = String(d || '0').split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  let sec = 0;
  for (let i = 0; i < parts.length; i++) sec = sec * 60 + parts[i];
  return sec * 1000;
}

function splitId(id) {
  const s = String(id || '');
  const idx = s.indexOf(':');
  if (idx > 0) return { bvid: s.slice(0, idx), cid: Number(s.slice(idx + 1)) || 0 };
  return { bvid: s, cid: 0 };
}

function mapSearchVideo(v) {
  const bvid = v.bvid || ('av' + v.aid);
  if (v.bvid && v.aid) aidCache[v.bvid] = Number(v.aid);
  const artist = cleanText(v.author || 'UP主');
  return {
    id: bvid,
    title: cleanText(v.title),
    artist,
    album: cleanText(v.typename || '哔哩哔哩'),
    albumId: bvid,
    duration: parseDur(v.duration),
    cover: pic(v.pic),
    artists: v.mid ? [{ id: String(v.mid), name: artist }] : [],
  };
}

function mapArchiveVideo(v) {
  const bvid = v.bvid || ('av' + v.aid);
  if (v.bvid && v.aid) aidCache[v.bvid] = Number(v.aid);
  const owner = v.owner || {};
  const artist = cleanText(owner.name || v.author || 'UP主');
  const mid = owner.mid || v.mid;
  return {
    id: v.cid ? `${bvid}:${v.cid}` : bvid,
    title: cleanText(v.title),
    artist,
    album: cleanText(v.tname || '哔哩哔哩'),
    albumId: bvid,
    duration: parseDur(v.duration || v.length),
    cover: pic(v.pic || v.cover),
    artists: mid ? [{ id: String(mid), name: artist }] : [],
  };
}

function fmtLrcTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return '[' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(cs).padStart(2, '0') + ']';
}

// ---------- 注册 NEKOPLAY 插件 ----------
nk.register({
  // 宿主媒体规则：封面 / 音频 CDN 需要的请求头（宿主 0.6.9+ 读取）
  media: [
    { hosts: ['bilibili.com', 'hdslb.com', 'bilivideo.com', 'bilivideo.cn', 'akamaized.net'],
      headers: { Referer: 'https://www.bilibili.com/', Origin: 'https://www.bilibili.com', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' } },
  ],
  async search(q, type, page) {
    page = page || 1;
    if (type === 'artist' || type === 'user') {
      const j = await biliGet('https://api.bilibili.com/x/web-interface/wbi/search/type', {
        search_type: 'bili_user',
        keyword: q,
        page,
        page_size: 20,
      }, true);
      if (j.code !== 0) throw new Error(j.message || ('B 站搜索失败（' + j.code + '）'));
      const list = (j.data && j.data.result) || [];
      if (type === 'user') {
        return list.map(u => ({ uid: String(u.mid), name: cleanText(u.uname), avatar: pic(u.upic), signature: cleanText(u.usign || '') }));
      }
      return list.map(u => ({
        id: String(u.mid),
        name: cleanText(u.uname),
        cover: pic(u.upic),
      }));
    }
    const j = await biliGet('https://api.bilibili.com/x/web-interface/wbi/search/type', {
      search_type: 'video',
      keyword: q,
      page,
      page_size: 25,
    }, true);
    if (j.code !== 0) throw new Error(j.message || ('B 站搜索失败（' + j.code + '）'));
    const list = (j.data && j.data.result) || [];
    return list.filter(v => v && v.type !== 'ketang' && (v.bvid || v.aid)).map(mapSearchVideo);
  },

  async hotSearch() {
    const j = await biliGet('https://api.bilibili.com/x/web-interface/search/square', { limit: 15 }, false);
    const list = (j && j.data && j.data.trending && j.data.trending.list) || [];
    return list.map(x => cleanText(x.show_name || x.keyword)).filter(Boolean);
  },

  async suggest(q) {
    const r = await nk.http({
      url: 'https://s.search.bilibili.com/main/suggest?' + qs({ term: q, main_ver: 'v1' }),
      headers: { 'User-Agent': UA, Referer: REFERER },
    });
    const j = r.json();
    const tags = (j && j.result && j.result.tag) || [];
    return tags.map(t => cleanText(t.value || t.name)).filter(Boolean);
  },

  async stream(id, quality) {
    let { bvid, cid } = splitId(id);
    if (!cid) {
      const pl = await biliGet('https://api.bilibili.com/x/player/pagelist', { bvid }, false);
      if (!pl || pl.code !== 0 || !pl.data || !pl.data.length) {
        return { error: (pl && pl.message) || '未找到该视频的分P信息' };
      }
      cid = pl.data[0].cid;
    }
    const j = await biliGet('https://api.bilibili.com/x/player/wbi/playurl', {
      bvid,
      cid,
      fnval: 4048,
      fnver: 0,
      fourk: 1,
    }, true);
    if (!j || j.code !== 0 || !j.data) {
      return { error: (j && j.message) || '获取哔哩哔哩音频流失败' };
    }
    const dash = j.data.dash;
    if (dash) {
      // 优先 Hi-Res FLAC（quality >= 3）
      if (quality >= 3 && dash.flac && dash.flac.audio && (dash.flac.audio.baseUrl || dash.flac.audio.base_url)) {
        const f = dash.flac.audio;
        return {
          url: f.baseUrl || f.base_url,
          ext: 'flac',
          kbps: Math.round((f.bandwidth || 1000000) / 1000),
          level: 'Hi-Res',
        };
      }
      const audios = (dash.audio || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0));
      if (audios.length) {
        // B 站音质档位：30280(192k) / 30232(132k) / 30216(64k)
        const targetId = quality <= 0 ? 30216 : (quality === 1 ? 30232 : 30280);
        const chosen = audios.find(a => a.id <= targetId) || audios[0];
        const url = chosen.baseUrl || chosen.base_url || (chosen.backupUrl && chosen.backupUrl[0]) || (chosen.backup_url && chosen.backup_url[0]);
        if (url) {
          const kbps = Math.round((chosen.bandwidth || 192000) / 1000);
          const level = chosen.id >= 30280 ? '极高' : (chosen.id >= 30232 ? '较高' : '标准');
          return { url, ext: 'm4a', kbps, level };
        }
      }
    }
    if (j.data.durl && j.data.durl.length && j.data.durl[0].url) {
      return { url: j.data.durl[0].url, ext: 'mp4', kbps: 192, level: '标准' };
    }
    return { error: '该视频没有可用的音频流' };
  },

  async lyric(id) {
    let { bvid, cid } = splitId(id);
    if (!cid) {
      const pl = await biliGet('https://api.bilibili.com/x/player/pagelist', { bvid }, false);
      cid = pl && pl.data && pl.data[0] && pl.data[0].cid;
    }
    if (!cid) return { lrc: '' };
    const j = await biliGet('https://api.bilibili.com/x/player/wbi/v2', { bvid, cid }, true);
    const subs = (j && j.data && j.data.subtitle && j.data.subtitle.subtitles) || [];
    if (!subs.length) return { lrc: '' };
    const chosen = subs.find(s => /zh/i.test(s.lan || '')) || subs[0];
    const subUrl = pic(chosen.subtitle_url);
    if (!subUrl) return { lrc: '' };
    const r = await nk.http({ url: subUrl, headers: { 'User-Agent': UA, Referer: REFERER } });
    const sj = r.json();
    const body = (sj && sj.body) || [];
    const lrc = body.map(line => fmtLrcTime(line.from) + cleanText(line.content)).join('\n');
    return { lrc };
  },

  async album(id) {
    const s = String(id || '');
    if (s.startsWith('season:')) {
      const [, mid, seasonId] = s.split(':');
      const all = [];
      let meta = {};
      for (let pn = 1; pn <= 5; pn++) {
        const j = await biliGet('https://api.bilibili.com/x/polymer/web-space/seasons_archives_list', {
          mid, season_id: seasonId, sort_reverse: false, page_num: pn, page_size: 100,
        }, false);
        if (!j || j.code !== 0 || !j.data) break;
        if (pn === 1 && j.data.meta) meta = j.data.meta;
        const arcs = j.data.archives || [];
        arcs.forEach(a => all.push(mapArchiveVideo(a)));
        const total = (j.data.page && j.data.page.total) || all.length;
        if (arcs.length < 100 || all.length >= total) break;
      }
      return {
        album: {
          id: s,
          name: cleanText(meta.name || '合集'),
          cover: pic(meta.cover || (all[0] && all[0].cover)),
          artist: '',
          year: '',
          count: all.length,
        },
        tracks: all,
      };
    }
    if (s.startsWith('series:')) {
      const [, mid, seriesId] = s.split(':');
      const all = [];
      for (let pn = 1; pn <= 5; pn++) {
        const j = await biliGet('https://api.bilibili.com/x/series/archives', {
          mid, series_id: seriesId, only_normal: true, sort: 'desc', pn, ps: 100,
        }, false);
        if (!j || j.code !== 0 || !j.data) break;
        const arcs = j.data.archives || [];
        arcs.forEach(a => all.push(mapArchiveVideo(a)));
        const total = (j.data.page && j.data.page.total) || all.length;
        if (arcs.length < 100 || all.length >= total) break;
      }
      return {
        album: {
          id: s,
          name: '视频系列',
          cover: pic(all[0] && all[0].cover),
          artist: '',
          year: '',
          count: all.length,
        },
        tracks: all,
      };
    }
    const cleanBvid = splitId(s).bvid;
    const j = await biliGet('https://api.bilibili.com/x/web-interface/view', { bvid: cleanBvid }, false);
    if (!j || j.code !== 0 || !j.data) throw new Error((j && j.message) || '获取视频详情失败');
    const v = j.data;
    if (v.bvid && v.aid) aidCache[v.bvid] = Number(v.aid);
    const owner = v.owner || {};
    const artist = cleanText(owner.name || 'UP主');
    const cover = pic(v.pic);
    const pages = v.pages || [];
    const tracks = pages.map((p, idx) => ({
      id: `${v.bvid}:${p.cid}`,
      title: pages.length > 1 ? `P${idx + 1} ${cleanText(p.part || v.title)}` : cleanText(v.title),
      artist,
      album: cleanText(v.title),
      albumId: v.bvid,
      duration: (p.duration || v.duration || 0) * 1000,
      cover,
      artists: owner.mid ? [{ id: String(owner.mid), name: artist }] : [],
    }));
    const year = v.pubdate ? String(new Date(v.pubdate * 1000).getFullYear()) : '';
    return {
      album: {
        id: v.bvid,
        name: cleanText(v.title),
        cover,
        artist,
        year,
        count: tracks.length,
      },
      tracks,
    };
  },

  async artist(mid) {
    const infoRes = await biliGet('https://api.bilibili.com/x/space/wbi/acc/info', { mid }, true).catch(() => null);
    const info = (infoRes && infoRes.code === 0 && infoRes.data) || {};
    const all = [];
    let total = 0;
    // 分页拉取 UP 主投稿（每页 50 条，最多拉 6 页共 300 条）
    for (let pn = 1; pn <= 6; pn++) {
      const arcRes = await biliGet('https://api.bilibili.com/x/space/wbi/arc/search', { mid, pn, ps: 50, order: 'pubdate' }, true).catch(() => null);
      if (!arcRes || arcRes.code !== 0 || !arcRes.data) break;
      const vlist = (arcRes.data.list && arcRes.data.list.vlist) || [];
      if (arcRes.data.page && arcRes.data.page.count) total = arcRes.data.page.count;
      vlist.forEach(v => {
        const upName = cleanText(info.name || v.author || 'UP主');
        all.push({
          id: v.bvid,
          title: cleanText(v.title),
          artist: upName,
          album: 'UP主投稿',
          albumId: v.bvid,
          duration: parseDur(v.length),
          cover: pic(v.pic),
          artists: [{ id: String(mid), name: upName }],
        });
      });
      if (vlist.length < 50 || (total > 0 && all.length >= total)) break;
    }
    return {
      name: cleanText(info.name || (all[0] && all[0].artist) || ('UP主 ' + mid)),
      cover: pic(info.face),
      desc: cleanText(info.sign || ''),
      songs: total || all.length,
      tracks: all,
    };
  },

  async artistAlbums(mid, offset, limit) {
    const ps = limit || 20;
    const pn = Math.floor((offset || 0) / ps) + 1;
    const j = await biliGet('https://api.bilibili.com/x/polymer/web-space/seasons_series_list', {
      mid, page_num: pn, page_size: ps,
    }, false).catch(() => null);
    const box = j && j.code === 0 && j.data && j.data.items_lists;
    if (!box) return { items: [], more: false };
    const out = [];
    (box.seasons_list || []).forEach(s => {
      const m = s.meta || {};
      if (m.season_id) {
        out.push({
          id: `season:${mid}:${m.season_id}`,
          name: cleanText(m.name || '合集'),
          cover: pic(m.cover),
          count: m.total || 0,
        });
      }
    });
    (box.series_list || []).forEach(s => {
      const m = s.meta || {};
      if (m.series_id) {
        out.push({
          id: `series:${mid}:${m.series_id}`,
          name: cleanText(m.name || '视频列表'),
          cover: pic((s.archives && s.archives[0] && s.archives[0].pic) || null),
          count: m.total || 0,
        });
      }
    });
    const total = Number((box.page && box.page.total) || out.length);
    return { items: out, more: (offset || 0) + out.length < total };
  },

  async recPlaylists() { return await this.toplists(); },

  async daily() {
    if (getCred()) {
      const j = await biliGet('https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd', { ps: 20, fresh_type: 3 }, true).catch(() => null);
      const list = (j && j.code === 0 && j.data && j.data.item) || [];
      if (list.length) return list.filter(v => v && (v.bvid || v.id)).map(mapArchiveVideo);
    }
    return await this.playlist('rank:3');
  },

  async fm() {
    const list = await this.playlist('rank:3');
    return list.slice().sort(() => Math.random() - 0.5).slice(0, 12);
  },

  async newSongs(area) {
    const map = { 0: 'rank:3', 7: 'rank:28', 96: 'rank:31', 8: 'rank:30', 16: 'rank:59' };
    return await this.playlist(map[Number(area) || 0] || 'rank:3');
  },

  async simiSongs(id) {
    const bvid = splitId(id).bvid;
    const j = await biliGet('https://api.bilibili.com/x/web-interface/archive/related', { bvid }, false).catch(() => null);
    if (!j || j.code !== 0) return [];
    return (j.data || []).slice(0, 20).map(mapArchiveVideo);
  },

  async like(id, on) {
    const csrf = getCsrf();
    if (!csrf) throw new Error('请先登录 B 站账号后再点赞');
    const aid = await resolveAid(id);
    const j = await biliPostForm('https://api.bilibili.com/x/web-interface/archive/like', { aid: String(aid), like: on ? '1' : '2', csrf });
    if (!j || (j.code !== 0 && j.code !== 65006)) throw new Error((j && j.message) || '点赞操作失败');
  },

  async followArtist(mid, on) {
    const csrf = getCsrf();
    if (!csrf) throw new Error('请先登录 B 站账号后再关注');
    const j = await biliPostForm('https://api.bilibili.com/x/relation/modify', { fid: String(mid), act: on ? '1' : '2', re_src: '11', csrf });
    if (!j || j.code !== 0) throw new Error((j && j.message) || '关注操作失败');
  },

  async followUser(mid, on) { return await this.followArtist(mid, on); },

  async subArtists() {
    const uid = String(nk.store.get('uid') || '');
    if (!uid) return [];
    const j = await biliGet('https://api.bilibili.com/x/relation/followings', { vmid: uid, pn: 1, ps: 50 }, false).catch(() => null);
    const list = (j && j.code === 0 && j.data && j.data.list) || [];
    return list.map(u => ({ id: String(u.mid), name: cleanText(u.uname), cover: pic(u.face), desc: cleanText(u.sign || ''), followed: true }));
  },

  async createPlaylist(name, priv) {
    const csrf = getCsrf();
    if (!csrf) throw new Error('请先登录 B 站账号后再新建收藏夹');
    const j = await biliPostForm('https://api.bilibili.com/x/v3/fav/folder/add', { title: String(name || '新建收藏夹'), privacy: priv ? '1' : '0', csrf });
    if (!j || j.code !== 0 || !j.data) throw new Error((j && j.message) || '新建收藏夹失败');
    return 'fav:' + j.data.id;
  },

  async deletePlaylist(id) {
    const csrf = getCsrf();
    if (!csrf) throw new Error('请先登录 B 站账号');
    const fid = String(id || '').replace(/^fav:/, '');
    const j = await biliPostForm('https://api.bilibili.com/x/v3/fav/folder/del', { media_ids: fid, csrf });
    if (!j || j.code !== 0) throw new Error((j && j.message) || '删除收藏夹失败');
  },

  async editPlaylist(id, op, ids) {
    const csrf = getCsrf();
    if (!csrf) throw new Error('请先登录 B 站账号');
    const fid = String(id || '').replace(/^fav:/, '');
    const list = Array.isArray(ids) ? ids : [ids];
    for (let i = 0; i < list.length; i++) {
      const aid = await resolveAid(list[i]);
      const form = { rid: String(aid), type: '2', csrf };
      if (op === 'del') form.del_media_ids = fid;
      else form.add_media_ids = fid;
      const j = await biliPostForm('https://api.bilibili.com/x/v3/fav/resource/deal', form);
      if (!j || j.code !== 0) throw new Error((j && j.message) || '修改收藏夹失败');
    }
  },

  async toplists() {
    return [
      { id: 'rank:3', name: 'B 站音乐综合榜', desc: '音乐区实时热门排行' },
      { id: 'rank:28', name: '原创音乐榜', desc: 'B 站原创音乐热门投稿' },
      { id: 'rank:31', name: '翻唱热榜', desc: '音乐区翻唱排行' },
      { id: 'rank:30', name: 'VOCALOID·UTAU 榜', desc: '虚拟歌姬与调教精选' },
      { id: 'rank:59', name: '演奏榜', desc: '乐器实拍与纯音乐演奏' },
      { id: 'rank:193', name: 'MV 排行榜', desc: '官方与二创音乐 MV' },
      { id: 'popular', name: '全站综合热门', desc: '哔哩哔哩当前全站热门' },
    ];
  },

  async playlist(id) {
    const s = String(id || '');
    if (s.startsWith('rank:')) {
      const rid = s.slice(5);
      const j = await biliGet('https://api.bilibili.com/x/web-interface/ranking/v2', { rid, type: 'all' }, true);
      if (!j || j.code !== 0) throw new Error((j && j.message) || '获取排行榜失败');
      return ((j.data && j.data.list) || []).map(mapArchiveVideo);
    }
    if (s === 'popular') {
      const j = await biliGet('https://api.bilibili.com/x/web-interface/popular', { pn: 1, ps: 40 }, false);
      if (!j || j.code !== 0) throw new Error((j && j.message) || '获取热门列表失败');
      return ((j.data && j.data.list) || []).map(mapArchiveVideo);
    }
    if (s === 'toview') {
      const j = await biliGet('https://api.bilibili.com/x/v2/history/toview', null, false);
      if (!j || j.code !== 0) throw new Error((j && j.message) || '请先登录 B 站账号');
      return ((j.data && j.data.list) || []).map(mapArchiveVideo);
    }
    if (s.startsWith('fav:')) {
      const mediaId = s.slice(4);
      const out = [];
      for (let pn = 1; pn <= 10; pn++) {
        const j = await biliGet('https://api.bilibili.com/x/v3/fav/resource/list', {
          media_id: mediaId,
          pn,
          ps: 40,
          platform: 'web',
        }, false);
        if (!j || j.code !== 0 || !j.data) {
          if (pn === 1) throw new Error((j && j.message) || '获取收藏夹内容失败');
          break;
        }
        const title = cleanText((j.data.info && j.data.info.title) || 'B 站收藏夹');
        ((j.data.medias) || [])
          .filter(m => m && m.attr !== 9 && (m.bvid || m.bv_id))
          .forEach(m => {
            const bvid = m.bvid || m.bv_id;
            const up = m.upper || {};
            const artist = cleanText(up.name || 'UP主');
            out.push({
              id: bvid,
              title: cleanText(m.title),
              artist,
              album: title,
              albumId: bvid,
              duration: (m.duration || 0) * 1000,
              cover: pic(m.cover),
              artists: up.mid ? [{ id: String(up.mid), name: artist }] : [],
            });
          });
        if (!j.data.has_more) break;
      }
      return out;
    }
    return [];
  },

  // ---------- 评论区 ----------
  async comments(id, hot, offset) {
    const aid = await resolveAid(id);
    const key = `${aid}:${hot ? 'hot' : 'new'}`;
    let cursorOffset = '';
    if (offset > 0) {
      const st = commentCursors[key];
      if (!st || st.isEnd || !st.nextOffset) return { items: [], total: (st && st.total) || 0 };
      cursorOffset = st.nextOffset;
    } else {
      delete commentCursors[key];
    }
    const mode = hot ? 3 : 2;
    let j = await biliGet('https://api.bilibili.com/x/v2/reply/wbi/main', {
      oid: aid,
      type: 1,
      mode,
      pagination_str: JSON.stringify({ offset: cursorOffset }),
      plat: 1,
      web_location: 1315875,
    }, true).catch(() => null);
    if (!j || j.code !== 0 || !j.data) {
      // 兜底非 WBI 旧接口
      const nextNum = offset > 0 ? ((commentCursors[key] && commentCursors[key].nextNum) || 0) : 0;
      j = await biliGet('https://api.bilibili.com/x/v2/reply/main', { oid: aid, type: 1, mode, next: nextNum, ps: 20 }, false);
    }
    if (!j || j.code !== 0) {
      if (j && j.code === 12002) return { items: [], total: 0 }; // 评论区已关闭
      throw new Error((j && j.message) || '获取 B 站评论失败');
    }
    const d = j.data || {};
    const cur = d.cursor || {};
    const total = Number(cur.all_count || 0);
    const nextOffset = (cur.pagination_reply && cur.pagination_reply.next_offset) || '';
    const isEnd = !!cur.is_end || (!nextOffset && !(cur.next > 0));
    commentCursors[key] = { nextOffset, nextNum: cur.next || 0, isEnd, total };
    const seen = {};
    const items = [];
    const pushRep = (r) => {
      if (!r || !r.rpid || seen[r.rpid]) return;
      seen[r.rpid] = 1;
      items.push(mapComment(r));
    };
    if (offset === 0) {
      const tops = (d.top_replies || []).concat((d.top && d.top.upper) ? [d.top.upper] : []);
      tops.forEach(pushRep);
    }
    (d.replies || []).forEach(pushRep);
    return { items, total };
  },

  async commentFloor(id, parent, cursor) {
    const aid = await resolveAid(id);
    const pn = cursor && cursor > 0 ? Number(cursor) : 1;
    const ps = 20;
    const j = await biliGet('https://api.bilibili.com/x/v2/reply/reply', {
      type: 1,
      oid: aid,
      root: parent,
      pn,
      ps,
    }, false);
    if (!j || j.code !== 0) throw new Error((j && j.message) || '获取楼中楼回复失败');
    const d = j.data || {};
    const replies = d.replies || [];
    const items = replies.map(mapComment);
    const page = d.page || {};
    const totalCount = Number(page.count || 0);
    const hasMore = replies.length > 0 && (pn * ps < totalCount);
    return { items, next: hasMore ? pn + 1 : -1 };
  },

  async commentLike(id, cid, on) {
    const csrf = getCsrf();
    if (!csrf) throw new Error('请先登录 B 站账号后再点赞');
    const aid = await resolveAid(id);
    const j = await biliPostForm('https://api.bilibili.com/x/v2/reply/action', {
      type: '1',
      oid: String(aid),
      rpid: String(cid),
      action: on ? '1' : '0',
      csrf,
    });
    if (!j || j.code !== 0) throw new Error((j && j.message) || '点赞操作失败');
  },

  async commentPost(id, content, replyTo) {
    const csrf = getCsrf();
    if (!csrf) throw new Error('请先登录 B 站账号后再发表评论');
    const aid = await resolveAid(id);
    const form = {
      type: '1',
      oid: String(aid),
      message: String(content || ''),
      plat: '1',
      csrf,
    };
    if (replyTo) {
      const root = commentRootMap[Number(replyTo)] || Number(replyTo);
      form.root = String(root);
      form.parent = String(replyTo);
    }
    const j = await biliPostForm('https://api.bilibili.com/x/v2/reply/add', form);
    if (!j || j.code !== 0) throw new Error((j && j.message) || '发送评论失败');
  },

  async account() {
    const c = getCred();
    if (!c) return null;
    try {
      const j = await biliGet('https://api.bilibili.com/x/web-interface/nav', null, false);
      if (j && j.code === 0 && j.data && j.data.isLogin) {
        const uid = String(j.data.mid);
        nk.store.set('uid', uid);
        return { uid, name: cleanText(j.data.uname), avatar: pic(j.data.face) };
      }
    } catch (e) {}
    return null;
  },

  async user(id) {
    let mid = String(id || '').trim();
    if (!mid || !/^\d+$/.test(mid)) mid = String(nk.store.get('uid') || '');
    if (!mid) throw new Error('未找到有效的 B 站用户 ID');
    const j = await biliGet('https://api.bilibili.com/x/web-interface/card', { mid, photo: 'true' }, false);
    if (j && j.code === 0 && j.data && j.data.card) {
      const d = j.data;
      const card = d.card;
      const sp = d.space || {};
      return {
        uid: String(card.mid || mid),
        name: cleanText(card.name || ('UP主 ' + mid)),
        avatar: pic(card.face),
        bg: pic(sp.l_img || sp.s_img),
        signature: cleanText(card.sign || ''),
        level: Number((card.level_info && card.level_info.current_level) || 0),
        listened: Number(d.archive_count || 0),
        follows: Number(card.attention || 0),
        fans: Number(card.fans || d.follower || 0),
        followed: !!d.following,
      };
    }
    const infoRes = await biliGet('https://api.bilibili.com/x/space/wbi/acc/info', { mid }, true).catch(() => null);
    const info = infoRes && infoRes.code === 0 && infoRes.data;
    if (info) {
      return {
        uid: String(info.mid || mid),
        name: cleanText(info.name || ('UP主 ' + mid)),
        avatar: pic(info.face),
        bg: pic(info.top_photo),
        signature: cleanText(info.sign || ''),
        level: Number(info.level || 0),
        listened: 0,
        follows: 0,
        fans: 0,
        followed: !!info.is_followed,
      };
    }
    throw new Error((j && j.message) || '获取 B 站用户信息失败');
  },

  async userPlaylists(id) {
    const myUid = String(nk.store.get('uid') || '');
    const mid = String(id || myUid).trim();
    if (!mid || !/^\d+$/.test(mid)) return myUid ? await this.myPlaylists() : [];
    if (myUid && mid === myUid) return await this.myPlaylists();
    const created = await biliGet('https://api.bilibili.com/x/v3/fav/folder/created/list-all', { up_mid: mid }, false).catch(() => null);
    if (!created || created.code !== 0 || !created.data || !created.data.list) return [];
    return created.data.list.map((f, idx) => ({
      id: 'fav:' + f.id,
      name: cleanText(f.title),
      count: f.media_count || 0,
      liked: idx === 0,
      mine: true,
    }));
  },

  async myPlaylists() {
    let uid = nk.store.get('uid');
    if (!uid) {
      const acc = await biliGet('https://api.bilibili.com/x/web-interface/nav', null, false);
      if (!acc || acc.code !== 0 || !acc.data || !acc.data.isLogin) return [];
      uid = String(acc.data.mid);
      nk.store.set('uid', uid);
    }
    const out = [{ id: 'toview', name: '稍后再看', mine: true, desc: 'B 站稍后再看列表' }];
    const created = await biliGet('https://api.bilibili.com/x/v3/fav/folder/created/list-all', { up_mid: uid }, false);
    if (created && created.code === 0 && created.data && created.data.list) {
      created.data.list.forEach((f, idx) => {
        out.push({
          id: 'fav:' + f.id,
          name: cleanText(f.title),
          count: f.media_count || 0,
          liked: idx === 0,
          mine: true,
        });
      });
    }
    const collected = await biliGet('https://api.bilibili.com/x/v3/fav/folder/collected/list', {
      up_mid: uid,
      pn: 1,
      ps: 20,
      platform: 'web',
    }, false).catch(() => null);
    if (collected && collected.code === 0 && collected.data && collected.data.list) {
      collected.data.list.forEach(f => {
        if (f && f.id) {
          out.push({
            id: 'fav:' + f.id,
            name: cleanText(f.title),
            count: f.media_count || 0,
            cover: pic(f.cover),
            mine: false,
          });
        }
      });
    }
    return out;
  },

  async loginModes() {
    return [{ id: 'qr', name: '哔哩哔哩 App 扫码' }];
  },

  async loginQr() {
    const r = await nk.http({
      url: 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate',
      headers: { 'User-Agent': UA, Referer: REFERER },
    });
    const j = r.json();
    if (!j || j.code !== 0 || !j.data) throw new Error((j && j.message) || '获取 B 站登录二维码失败');
    return {
      text: j.data.url,
      key: j.data.qrcode_key,
      hint: '打开哔哩哔哩 App 扫一扫登录，可同步收藏夹与解锁高音质',
      poll: 2500,
    };
  },

  async loginCheck(key) {
    const r = await nk.http({
      url: 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=' + encodeURIComponent(key),
      headers: { 'User-Agent': UA, Referer: REFERER },
    });
    const j = r.json();
    const code = j && j.data ? j.data.code : -1;
    if (code === 86101) return { state: 'wait' };
    if (code === 86090) return { state: 'scanned', message: '已扫码，请在哔哩哔哩 App 上确认登录' };
    if (code === 86038) return { state: 'expired', message: '二维码已过期，请刷新' };
    if (code === 0) {
      const ck = r.cookies();
      if (ck.SESSDATA) {
        setCred({ SESSDATA: ck.SESSDATA, bili_jct: ck.bili_jct || '', DedeUserID: ck.DedeUserID || '' });
        if (ck.DedeUserID) nk.store.set('uid', ck.DedeUserID);
        wbiCache = null;
        return { state: 'done' };
      }
      // 兜底从回调 URL 参数里取 SESSDATA
      const cbUrl = (j.data && j.data.url) || '';
      const pick = (name) => {
        const m = cbUrl.match(new RegExp('[?&]' + name + '=([^&]+)'));
        return m ? decodeURIComponent(m[1]) : '';
      };
      const sess = pick('SESSDATA');
      if (!sess) throw new Error('登录成功但未拿到 SESSDATA');
      setCred({ SESSDATA: sess, bili_jct: pick('bili_jct'), DedeUserID: pick('DedeUserID') });
      if (pick('DedeUserID')) nk.store.set('uid', pick('DedeUserID'));
      wbiCache = null;
      return { state: 'done' };
    }
    return { state: 'wait' };
  },

  async setCookie(raw) {
    const text = String(raw || '').trim();
    if (!/SESSDATA=/i.test(text)) throw new Error('Cookie 里没有找到 SESSDATA，请复制完整的 bilibili.com Cookie');
    setCred({ raw: text });
    wbiCache = null;
    const acc = await biliGet('https://api.bilibili.com/x/web-interface/nav', null, false);
    if (!acc || acc.code !== 0 || !acc.data || !acc.data.isLogin) {
      setCred(null);
      throw new Error('Cookie 无效或已过期');
    }
    nk.store.set('uid', String(acc.data.mid));
  },

  async logout() {
    setCred(null);
    nk.store.set('uid', null);
    wbiCache = null;
  },
});
