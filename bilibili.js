// @id bilibili
// @name 哔哩哔哩
// @type source
// @version 1.1.0
// @author NEKOPLAY
// @desc 哔哩哔哩音源（参考 BBPlayer）：WBI 签名、视频/UP主搜索、DASH 音频流（支持 Hi-Res FLAC）、分P与UP主合集、多页加载全部投稿与收藏夹、音乐区排行榜、CC 字幕歌词，扫码登录后同步收藏夹与稍后再看
// @api 1
// @search track,artist
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
  async search(q, type, page) {
    page = page || 1;
    if (type === 'artist') {
      const j = await biliGet('https://api.bilibili.com/x/web-interface/wbi/search/type', {
        search_type: 'bili_user',
        keyword: q,
        page,
        page_size: 20,
      }, true);
      if (j.code !== 0) throw new Error(j.message || ('B 站搜索失败（' + j.code + '）'));
      return ((j.data && j.data.result) || []).map(u => ({
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

  async artistAlbums(mid, page) {
    const pn = page || 1;
    const j = await biliGet('https://api.bilibili.com/x/polymer/web-space/seasons_series_list', {
      mid, page_num: pn, page_size: 20,
    }, false).catch(() => null);
    const box = j && j.code === 0 && j.data && j.data.items_lists;
    if (!box) return [];
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
    return out;
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

  async account() {
    const c = getCred();
    if (!c) return null;
    try {
      const j = await biliGet('https://api.bilibili.com/x/web-interface/nav', null, false);
      if (j && j.code === 0 && j.data && j.data.isLogin) {
        nk.store.set('uid', String(j.data.mid));
        return { name: cleanText(j.data.uname), avatar: pic(j.data.face) };
      }
    } catch (e) {}
    return null;
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
