// @id soundcloud
// @name SoundCloud
// @type source
// @version 1.1.2
// @minHost 0.6.8
// @permissions network, storage
// @author NEKOPLAY
// @desc SoundCloud 独立音源：自动提取 client_id、单曲/专辑/歌单/艺人/用户搜索与联想词、HLS/直链音频播放、官方流派趋势榜单与精选歌单、每日推荐/私人 FM/新歌/相似曲目、歌手主页与专辑、曲目评论区；支持内嵌网页直接登录自动捕获凭证或粘贴 Cookie 同步个人喜欢与歌单
// @api 2
// @search track,album,playlist,artist,user

const API = 'https://api-v2.soundcloud.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CID_TTL = 12 * 3600 * 1000;

const GENRE_ZH = {
  'all-genres': '全流派趋势榜',
  'electronic': '电子趋势榜',
  'pop': '流行趋势榜',
  'hip-hop': '嘻哈趋势榜',
  'trap': 'Trap 趋势榜',
  'r-n-b': 'R&B 趋势榜',
  'indie': '独立音乐趋势榜',
  'house': 'House 趋势榜',
  'dubstep': 'Dubstep 趋势榜',
  'ambient': '氛围音乐趋势榜',
  'rock': '摇滚趋势榜',
  'alternative-rock': '另类摇滚趋势榜',
  'alternative-hip-hop': '另类嘻哈趋势榜',
  'folk': '民谣趋势榜',
  'latin': '拉丁趋势榜',
  'metal': '金属趋势榜',
  'downtempo': '缓拍电子趋势榜',
  'reggae': '雷鬼趋势榜',
  'hardcore': '硬核趋势榜',
  'dancehall': '舞厅音乐趋势榜',
};

// ---------- 认证与 client_id 管理 ----------
let cidMem = null;
let cidPending = null;

function getAuth() {
  const c = nk.store.get('sc_auth');
  return c && c.token ? c : null;
}

function setAuth(c) {
  nk.store.set('sc_auth', c || null);
}

function baseHeaders(withAuth) {
  const h = {
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://soundcloud.com',
    Referer: 'https://soundcloud.com/',
  };
  if (withAuth) {
    const a = getAuth();
    if (a && a.token) h.Authorization = 'OAuth ' + a.token;
  }
  return h;
}

async function fetchFreshClientId() {
  if (cidPending) return await cidPending;
  cidPending = (async () => {
    try {
      const home = await nk.http({
        url: 'https://soundcloud.com',
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' },
      });
      if (home.status < 200 || home.status > 299) {
        throw new Error('无法访问 SoundCloud 主页（HTTP ' + home.status + '）');
      }
      const html = home.body || '';
      const scripts = [];
      const re = /https:\/\/a-v2\.sndcdn\.com\/assets\/[^"'\s]+\.js/g;
      let m;
      while ((m = re.exec(html)) !== null) scripts.push(m[0]);
      if (!scripts.length) throw new Error('未能从 SoundCloud 页面提取脚本列表');
      const limit = Math.max(0, scripts.length - 14);
      for (let i = scripts.length - 1; i >= limit; i--) {
        try {
          const r = await nk.http({ url: scripts[i], headers: { 'User-Agent': UA } });
          if (r.status < 200 || r.status > 299 || !r.body) continue;
          const cm = r.body.match(/client_id[:=]["']([a-zA-Z0-9]{20,40})["']/);
          if (cm && cm[1]) {
            cidMem = { id: cm[1], ts: Date.now() };
            nk.store.set('sc_client_id', cidMem);
            return cidMem.id;
          }
        } catch (e) {}
      }
      throw new Error('未能提取 SoundCloud client_id');
    } finally {
      cidPending = null;
    }
  })();
  return await cidPending;
}

async function getClientId(force) {
  const now = Date.now();
  if (!force) {
    if (cidMem && cidMem.id && now - cidMem.ts < CID_TTL) return cidMem.id;
    const saved = nk.store.get('sc_client_id');
    if (saved && saved.id && now - (saved.ts || 0) < CID_TTL) {
      cidMem = saved;
      return saved.id;
    }
  } else {
    cidMem = null;
    nk.store.set('sc_client_id', null);
  }
  return await fetchFreshClientId();
}

function qs(params) {
  if (!params) return '';
  return Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])))
    .join('&');
}

function appendQuery(url, extra) {
  const q = qs(extra);
  if (!q) return url;
  return url + (url.includes('?') ? '&' : '?') + q;
}

async function scReq(pathOrUrl, params, opts) {
  opts = opts || {};
  const method = opts.method || 'GET';
  const withAuth = opts.auth !== false;
  const fullBase = pathOrUrl.startsWith('http') ? pathOrUrl : API + pathOrUrl;

  for (let attempt = 0; attempt < 2; attempt++) {
    const cid = await getClientId(attempt > 0);
    const merged = Object.assign({}, params || {}, { client_id: cid });
    const url = appendQuery(fullBase, merged);
    const req = { url, method, headers: baseHeaders(withAuth) };
    if (opts.json !== undefined) req.json = opts.json;
    const r = await nk.http(req);
    if ((r.status === 401 || r.status === 403) && attempt === 0 && !opts.noRetryCid) {
      continue;
    }
    if (r.status < 200 || r.status > 299) {
      throw new Error('SoundCloud 返回 HTTP ' + r.status);
    }
    if (opts.rawText) return r.body || '';
    if (!r.body || !r.body.trim()) return {};
    try {
      return r.json();
    } catch (e) {
      throw new Error('SoundCloud 返回的不是有效 JSON');
    }
  }
  throw new Error('SoundCloud 请求失败');
}

async function scGet(pathOrUrl, params, opts) {
  return await scReq(pathOrUrl, params, opts);
}

// ---------- 工具与数据结构映射 ----------
function art(u, fallback) {
  const pick = (s) => {
    if (!s || typeof s !== 'string') return null;
    let out = s.trim();
    if (!out) return null;
    if (out.startsWith('//')) out = 'https:' + out;
    out = out.replace(/^http:/, 'https:');
    out = out.replace(/-large\.(jpg|jpeg|png|webp)(\?|$)/i, '-t500x500.$1$2');
    return out;
  };
  return pick(u) || pick(fallback) || null;
}

function clean(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

function yearOf(s) {
  const m = String(s || '').match(/^(\d{4})/);
  return m ? m[1] : '';
}

function fmtStamp(ms) {
  const sec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function mapTrack(t, albumName, albumId) {
  if (!t || !t.id) return null;
  const u = t.user || {};
  const pm = t.publisher_metadata || {};
  const artist = clean(pm.artist || u.username || u.full_name || 'SoundCloud');
  const dur = Number(t.full_duration || t.duration || 0);
  const isVip = t.policy === 'SNIP' || t.monetization_model === 'SUB_HIGH_TIER';
  return {
    id: String(t.id),
    title: clean(t.title || ('Track ' + t.id)),
    artist,
    album: clean(albumName || pm.album_title || t.genre || 'SoundCloud'),
    albumId: albumId ? String(albumId) : '',
    duration: dur,
    cover: art(t.artwork_url, u.avatar_url),
    artists: u.id ? [{ id: String(u.id), name: clean(u.username || artist) }] : [],
    vip: isVip,
  };
}

function mapPlaylist(p) {
  if (!p || !p.id) return null;
  const u = p.user || {};
  const firstCover = (p.tracks && p.tracks[0] && p.tracks[0].artwork_url) || null;
  return {
    id: String(p.id),
    name: clean(p.title || 'SoundCloud Playlist'),
    count: Number(p.track_count || (p.tracks && p.tracks.length) || 0),
    cover: art(p.artwork_url || p.calculated_artwork_url, firstCover || u.avatar_url),
    desc: clean(p.description || (u.username ? 'by ' + u.username : '')),
    mine: false,
  };
}

function mapAlbum(p) {
  if (!p || !p.id) return null;
  const u = p.user || {};
  const firstCover = (p.tracks && p.tracks[0] && p.tracks[0].artwork_url) || null;
  return {
    id: String(p.id),
    name: clean(p.title || 'SoundCloud Album'),
    cover: art(p.artwork_url || p.calculated_artwork_url, firstCover || u.avatar_url),
    count: Number(p.track_count || (p.tracks && p.tracks.length) || 0),
    year: yearOf(p.release_date || p.display_date || p.created_at),
    artist: clean(u.username || u.full_name || ''),
  };
}

function mapArtist(u) {
  if (!u || !u.id) return null;
  return {
    id: String(u.id),
    name: clean(u.username || u.full_name || ('User ' + u.id)),
    cover: art(u.avatar_url),
    desc: clean(u.description || ''),
    songs: Number(u.track_count || 0),
    albums: Number(u.playlist_count || 0),
  };
}

function mapUserBrief(u) {
  if (!u || !u.id) return null;
  return {
    uid: String(u.id),
    name: clean(u.username || u.full_name || ('User ' + u.id)),
    avatar: art(u.avatar_url),
    signature: clean(u.description || ''),
  };
}

function mapComment(c) {
  const u = c.user || {};
  const rawBody = String(c.body || '').trim();
  const stamp = Number(c.timestamp || 0);
  const content = stamp > 0 ? `[${fmtStamp(stamp)}] ${rawBody}` : rawBody;
  const ts = c.created_at ? Date.parse(c.created_at) : 0;
  return {
    id: Number(c.id || 0),
    user: clean(u.username || u.full_name || 'SoundCloud User'),
    uid: String(u.id || c.user_id || ''),
    avatar: art(u.avatar_url),
    content,
    liked: 0,
    time: isNaN(ts) ? 0 : ts,
    reply: null,
    replies: 0,
    likedByMe: false,
  };
}

async function hydrateTracks(rawList, albumName, albumId) {
  const list = Array.isArray(rawList) ? rawList : [];
  if (!list.length) return [];
  const byId = {};
  const missing = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t || !t.id) continue;
    const sid = String(t.id);
    if (t.title) byId[sid] = t;
    else missing.push(sid);
  }
  for (let i = 0; i < missing.length && i < 200; i += 50) {
    const chunk = missing.slice(i, i + 50);
    try {
      const got = await scGet('/tracks', { ids: chunk.join(',') });
      const arr = Array.isArray(got) ? got : (got.collection || []);
      for (let j = 0; j < arr.length; j++) {
        if (arr[j] && arr[j].id) byId[String(arr[j].id)] = arr[j];
      }
    } catch (e) {}
  }
  const out = [];
  const seen = {};
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t || !t.id) continue;
    const sid = String(t.id);
    if (seen[sid]) continue;
    seen[sid] = 1;
    const full = byId[sid];
    if (full && full.title) {
      const mapped = mapTrack(full, albumName, albumId);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}

// 缓存 mixed-selections（10 分钟）避免首页多模块重复请求
let mixedCache = null;
async function getMixedSelections() {
  if (mixedCache && Date.now() - mixedCache.ts < 10 * 60 * 1000) return mixedCache.data;
  const j = await scGet('/mixed-selections', { limit: 10 });
  const col = (j && j.collection) || [];
  mixedCache = { data: col, ts: Date.now() };
  return col;
}

function scoreTranscoding(tc, quality) {
  const fmt = tc.format || {};
  const proto = String(fmt.protocol || '').toLowerCase();
  const mime = String(fmt.mime_type || '').toLowerCase();
  const preset = String(tc.preset || '').toLowerCase();
  const q = String(tc.quality || '').toLowerCase();
  let score = tc.snipped ? 0 : 1000;
  // abr_sq 经常返回 404，放到所有常规流后面作兜底
  if (preset.includes('abr') || mime === 'audio/mpegurl') return score + 10;
  if (quality <= 1) {
    if (proto === 'progressive' && mime.includes('mpeg')) score += 450;
    else if (preset.includes('aac_160') || (mime.includes('mp4') && q === 'sq')) score += 400;
    else if (proto === 'hls' && mime.includes('mpeg')) score += 350;
    else if (preset.includes('aac_96') || (mime.includes('mp4') && q === 'lq')) score += 300;
    else if (mime.includes('ogg') || mime.includes('opus')) score += 200;
    else score += 100;
  } else {
    if (q === 'hq' || preset.includes('256')) score += 500;
    else if (preset.includes('aac_160') || (mime.includes('mp4') && q === 'sq')) score += 460;
    else if (proto === 'progressive' && mime.includes('mpeg')) score += 420;
    else if (proto === 'hls' && mime.includes('mpeg')) score += 360;
    else if (preset.includes('aac_96') || (mime.includes('mp4') && q === 'lq')) score += 280;
    else if (mime.includes('ogg') || mime.includes('opus')) score += 220;
    else score += 100;
  }
  return score;
}

function streamMeta(tc) {
  const fmt = tc.format || {};
  const mime = String(fmt.mime_type || '').toLowerCase();
  const preset = String(tc.preset || '').toLowerCase();
  const q = String(tc.quality || '').toLowerCase();
  if (preset.includes('256') || q === 'hq') return { ext: 'aac', kbps: 256, level: 'exhigh' };
  if (preset.includes('160') || (mime.includes('mp4') && q === 'sq')) return { ext: 'aac', kbps: 160, level: 'higher' };
  if (preset.includes('96') || (mime.includes('mp4') && q === 'lq')) return { ext: 'aac', kbps: 96, level: 'standard' };
  if (mime.includes('mpeg')) return { ext: 'mp3', kbps: 128, level: 'standard' };
  if (mime.includes('opus') || mime.includes('ogg')) return { ext: 'opus', kbps: 64, level: 'standard' };
  return { ext: 'aac', kbps: 128, level: 'standard' };
}

function parseToken(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/(?:^|;\s*)oauth_token=([^;\s]+)/i);
  if (m && m[1]) return decodeURIComponent(m[1].trim()).replace(/^"+|"+$/g, '');
  const m2 = s.match(/^OAuth\s+(\S+)/i);
  if (m2 && m2[1]) return m2[1].trim().replace(/^"+|"+$/g, '');
  if (/^[0-9]+-[0-9]+-[A-Za-z0-9_\-]+$/.test(s)) return s;
  return '';
}

// ---------- 注册 NEKOPLAY 插件 ----------
nk.register({
  async search(q, type, page) {
    const keyword = String(q || '').trim();
    if (!keyword) return [];
    const p = Math.max(1, Number(page || 1));
    const limit = 25;
    const offset = (p - 1) * limit;

    if (type === 'album') {
      const j = await scGet('/search/albums', { q: keyword, limit, offset });
      return ((j && j.collection) || []).map(mapAlbum).filter(Boolean);
    }
    if (type === 'playlist') {
      const j = await scGet('/search/playlists_without_albums', { q: keyword, limit, offset });
      return ((j && j.collection) || []).map(mapPlaylist).filter(Boolean);
    }
    if (type === 'artist') {
      const j = await scGet('/search/users', { q: keyword, limit, offset });
      return ((j && j.collection) || []).map(mapArtist).filter(Boolean);
    }
    if (type === 'user') {
      const j = await scGet('/search/users', { q: keyword, limit, offset });
      return ((j && j.collection) || []).map(mapUserBrief).filter(Boolean);
    }
    const j = await scGet('/search/tracks', { q: keyword, limit, offset });
    return ((j && j.collection) || []).map(t => mapTrack(t)).filter(Boolean);
  },

  async suggest(q) {
    const keyword = String(q || '').trim();
    if (!keyword) return [];
    const j = await scGet('/search/queries', { q: keyword, limit: 10 }).catch(() => null);
    return ((j && j.collection) || []).map(x => clean(x.output || x.query)).filter(Boolean);
  },

  async hotSearch() {
    try {
      const j = await scGet('/charts', { kind: 'trending', genre: 'soundcloud:genres:all-music', limit: 12 });
      const titles = ((j && j.collection) || [])
        .map(x => x && x.track && clean(x.track.title))
        .filter(Boolean);
      if (titles.length) return titles;
    } catch (e) {}
    return ['Electronic', 'Lo-Fi', 'Phonk', 'Hip-Hop', 'Synthwave', 'Ambient', 'House', 'Indie', 'Drum & Bass', 'Anime'];
  },

  async details(ids) {
    const list = (Array.isArray(ids) ? ids : [ids]).map(x => String(x || '').trim()).filter(x => /^\d+$/.test(x));
    if (!list.length) return [];
    return await hydrateTracks(list.map(id => ({ id })));
  },

  async stream(id, quality) {
    const tid = String(id || '').trim();
    if (!tid) return { error: '无效的曲目 ID' };
    const track = await scGet('/tracks/' + encodeURIComponent(tid));
    if (!track || !track.id) return { error: '未找到该 SoundCloud 曲目' };
    if (track.policy === 'BLOCK') return { error: '该曲目在当前地区或版权政策下无法播放' };

    const tcs = ((track.media && track.media.transcodings) || []).filter(tc => tc && tc.url);
    if (!tcs.length) return { error: '该曲目没有可用的音频流' };

    const qNum = Number(quality == null ? 2 : quality);
    const ranked = tcs.slice().sort((a, b) => scoreTranscoding(b, qNum) - scoreTranscoding(a, qNum));
    const authParam = track.track_authorization || '';

    for (let i = 0; i < ranked.length; i++) {
      const tc = ranked[i];
      try {
        const res = await scGet(tc.url, authParam ? { track_authorization: authParam } : {});
        if (res && res.url) {
          const meta = streamMeta(tc);
          const snipped = !!tc.snipped || track.policy === 'SNIP';
          const out = {
            url: res.url,
            ext: meta.ext,
            kbps: meta.kbps,
            level: meta.level,
          };
          if (snipped) {
            out.trial = true;
            out.message = '该曲目为 SoundCloud Go+ 会员专享，当前仅播放 30 秒试听';
          }
          return out;
        }
      } catch (e) {}
    }
    return { error: '获取 SoundCloud 音频流失败（所有转码地址均不可用）' };
  },

  async toplists() {
    const out = [
      {
        id: 'chart:all-music',
        name: 'SoundCloud 全球热歌趋势榜',
        desc: 'SoundCloud 全站实时热门单曲',
        count: 50,
        mine: false,
      },
    ];
    try {
      const sels = await getMixedSelections();
      for (let i = 0; i < sels.length; i++) {
        const sel = sels[i];
        if (!sel || sel.id !== 'soundcloud:selections:trending-by-genre-playlists') continue;
        const items = (sel.items && sel.items.collection) || [];
        for (let j = 0; j < items.length; j++) {
          const it = items[j];
          const urn = it && (it.urn || it.id);
          if (!urn) continue;
          const slug = String(urn).split(':').pop() || '';
          const zh = GENRE_ZH[slug];
          const cover = art(it.artwork_url || it.calculated_artwork_url);
          if (slug === 'all-genres' && cover && !out[0].cover) out[0].cover = cover;
          out.push({
            id: 'sys:' + urn,
            name: zh ? `${zh} · ${clean(it.title || slug)}` : `SoundCloud ${clean(it.title || slug)}`,
            cover,
            count: Number((it.tracks && it.tracks.length) || 50),
            desc: 'SoundCloud 官方流派实时趋势榜',
            mine: false,
          });
        }
      }
    } catch (e) {}
    return out;
  },

  async recPlaylists() {
    const out = [];
    const seen = {};
    try {
      const sels = await getMixedSelections();
      for (let i = 0; i < sels.length; i++) {
        const sel = sels[i];
        if (!sel || sel.id === 'soundcloud:selections:trending-by-genre-playlists') continue;
        const items = (sel.items && sel.items.collection) || [];
        for (let j = 0; j < items.length; j++) {
          const it = items[j];
          if (!it || it.kind !== 'playlist' || !it.id || seen[it.id]) continue;
          seen[it.id] = 1;
          const mapped = mapPlaylist(it);
          if (mapped) {
            if (!mapped.desc && sel.title) mapped.desc = clean(sel.title);
            out.push(mapped);
          }
        }
      }
    } catch (e) {}
    if (!out.length) return await this.toplists();
    return out;
  },

  async categories() {
    return ['全部', 'Electronic', 'Lo-Fi', 'Hip-Hop', 'Pop', 'Indie', 'House', 'Ambient', 'Phonk', 'R&B', 'Rock', 'Drum & Bass', 'Synthwave', 'Anime', 'Jazz'];
  },

  async square(cat, offset) {
    const off = Math.max(0, Number(offset || 0));
    const tag = String(cat || '全部').trim();
    if ((!tag || tag === '全部') && off === 0) {
      const curated = await this.recPlaylists().catch(() => []);
      if (curated.length) return { items: curated, more: true };
    }
    const query = (!tag || tag === '全部') ? 'music mix' : tag;
    const limit = 20;
    const j = await scGet('/search/playlists_without_albums', { q: query, limit, offset: off });
    const items = ((j && j.collection) || []).map(mapPlaylist).filter(Boolean);
    return { items, more: Boolean(j && j.next_href && items.length >= 10) };
  },

  async playlist(id) {
    const s = String(id || '').trim();
    if (!s) return [];

    if (s === 'chart:all-music') {
      const j = await scGet('/charts', { kind: 'trending', genre: 'soundcloud:genres:all-music', limit: 50 });
      return ((j && j.collection) || [])
        .map(x => x && mapTrack(x.track || x))
        .filter(Boolean);
    }

    if (s.startsWith('sys:')) {
      const urn = s.slice(4);
      const j = await scGet('/system-playlists/' + encodeURIComponent(urn));
      return await hydrateTracks((j && j.tracks) || [], clean((j && j.title) || 'SoundCloud'));
    }

    if (s === 'liked') {
      const uid = nk.store.get('sc_uid');
      if (!uid) throw new Error('请先通过 Cookie 登录 SoundCloud');
      const j = await scGet('/users/' + encodeURIComponent(uid) + '/track_likes', { limit: 100 });
      return ((j && j.collection) || []).map(x => mapTrack(x && (x.track || x))).filter(Boolean);
    }

    if (s.startsWith('ulikes:')) {
      const uid = s.slice(7);
      const j = await scGet('/users/' + encodeURIComponent(uid) + '/track_likes', { limit: 60 });
      return ((j && j.collection) || []).map(x => mapTrack(x && (x.track || x))).filter(Boolean);
    }

    const j = await scGet('/playlists/' + encodeURIComponent(s));
    return await hydrateTracks((j && j.tracks) || [], clean((j && j.title) || 'SoundCloud'), s);
  },

  async album(id) {
    const s = String(id || '').trim();
    const j = await scGet('/playlists/' + encodeURIComponent(s));
    const al = mapAlbum(j) || { id: s, name: 'SoundCloud Album', cover: null, count: 0, year: '', artist: '' };
    const tracks = await hydrateTracks((j && j.tracks) || [], al.name, al.id);
    al.count = tracks.length || al.count;
    if (!al.cover && tracks[0]) al.cover = tracks[0].cover;
    if (!al.artist && tracks[0]) al.artist = tracks[0].artist;
    return { album: al, tracks };
  },

  async artist(id) {
    const uid = String(id || '').trim();
    const [u, topRes, trRes] = await Promise.all([
      scGet('/users/' + encodeURIComponent(uid)).catch(() => ({})),
      scGet('/users/' + encodeURIComponent(uid) + '/toptracks', { limit: 50 }).catch(() => ({ collection: [] })),
      scGet('/users/' + encodeURIComponent(uid) + '/tracks', { limit: 50, offset: 0 }).catch(() => ({ collection: [] })),
    ]);
    const seen = {};
    const tracks = [];
    const pushAll = (arr) => {
      for (let i = 0; i < arr.length; i++) {
        const mapped = mapTrack(arr[i]);
        if (!mapped || seen[mapped.id]) continue;
        seen[mapped.id] = 1;
        tracks.push(mapped);
      }
    };
    pushAll((topRes && topRes.collection) || []);
    pushAll((trRes && trRes.collection) || []);
    return {
      id: uid,
      name: clean((u && (u.username || u.full_name)) || (tracks[0] && tracks[0].artist) || ('Artist ' + uid)),
      cover: art((u && u.avatar_url), tracks[0] && tracks[0].cover),
      desc: clean((u && u.description) || ''),
      songs: Number((u && u.track_count) || tracks.length),
      albums: Number((u && u.playlist_count) || 0),
      tracks,
      followed: false,
    };
  },

  async artistAlbums(id, offset, limit) {
    const uid = String(id || '').trim();
    const lim = Math.min(50, Math.max(10, Number(limit || 20)));
    const off = Math.max(0, Number(offset || 0));
    const j = await scGet('/users/' + encodeURIComponent(uid) + '/albums', { limit: lim, offset: off }).catch(() => null);
    const items = ((j && j.collection) || []).map(mapAlbum).filter(Boolean);
    return { items, more: Boolean(j && j.next_href && items.length >= lim) };
  },

  async user(id) {
    let uid = String(id || '').trim();
    if (!uid) uid = String(nk.store.get('sc_uid') || '');
    if (!uid) throw new Error('无效的 SoundCloud 用户 ID');
    const u = await scGet('/users/' + encodeURIComponent(uid));
    const vis = u && u.visuals && u.visuals.visuals && u.visuals.visuals[0];
    return {
      uid: String((u && u.id) || uid),
      name: clean((u && (u.username || u.full_name)) || ('User ' + uid)),
      avatar: art(u && u.avatar_url),
      bg: art(vis && vis.visual_url),
      signature: clean((u && u.description) || ''),
      level: 0,
      listened: Number((u && u.track_count) || 0),
      follows: Number((u && u.followings_count) || 0),
      fans: Number((u && u.followers_count) || 0),
      followed: false,
    };
  },

  async userPlaylists(id) {
    let uid = String(id || '').trim();
    const myUid = String(nk.store.get('sc_uid') || '');
    if (!uid) uid = myUid;
    if (!uid) return [];
    if (myUid && uid === myUid) return await this.myPlaylists();
    const [u, j] = await Promise.all([
      scGet('/users/' + encodeURIComponent(uid)).catch(() => null),
      scGet('/users/' + encodeURIComponent(uid) + '/playlists_without_albums', { limit: 30 }).catch(() => null),
    ]);
    const out = [];
    if (u && Number(u.likes_count || 0) > 0) {
      out.push({
        id: 'ulikes:' + uid,
        name: '喜欢的曲目',
        count: Number(u.likes_count || 0),
        cover: art(u.avatar_url),
        liked: true,
        mine: false,
      });
    }
    ((j && j.collection) || []).forEach(p => {
      const m = mapPlaylist(p);
      if (m) out.push(m);
    });
    return out;
  },

  async daily() {
    if (getAuth()) {
      const feed = await scGet('/stream', { limit: 30 }).catch(() => null);
      const tracks = ((feed && feed.collection) || [])
        .map(x => x && x.track && mapTrack(x.track))
        .filter(Boolean);
      if (tracks.length >= 5) return tracks;
    }
    const list = await this.playlist('sys:soundcloud:system-playlists:trending-by-genre:all-genres').catch(() => []);
    if (list.length) return list.slice(0, 30);
    return await this.playlist('chart:all-music');
  },

  async fm() {
    const base = await this.playlist('chart:all-music').catch(() => []);
    if (!base.length) return [];
    const shuffled = base.slice().sort(() => Math.random() - 0.5);
    const seed = shuffled[0];
    if (seed && seed.id) {
      const rel = await this.simiSongs(seed.id).catch(() => []);
      if (rel.length) return [seed].concat(rel).slice(0, 15);
    }
    return shuffled.slice(0, 15);
  },

  async newSongs(area) {
    const code = Number(area || 0);
    if (code === 0) return await this.playlist('sys:soundcloud:system-playlists:trending-by-genre:all-genres').catch(() => this.playlist('chart:all-music'));
    if (code === 96) return await this.playlist('sys:soundcloud:system-playlists:trending-by-genre:pop').catch(() => this.playlist('chart:all-music'));
    const queryMap = { 7: 'chinese mandopop', 8: 'japanese anime jpop', 16: 'korean kpop' };
    const q = queryMap[code] || 'new music';
    const j = await scGet('/search/tracks', { q, limit: 30, offset: 0 });
    return ((j && j.collection) || []).map(t => mapTrack(t)).filter(Boolean);
  },

  async newAlbums(area, offset) {
    const a = String(area || 'ALL').toUpperCase();
    const off = Math.max(0, Number(offset || 0));
    const qMap = { ALL: 'electronic indie album', ZH: 'chinese album', EA: 'pop hip hop album', JP: 'japanese album', KR: 'kpop album' };
    const j = await scGet('/search/albums', { q: qMap[a] || 'album', limit: 20, offset: off });
    return ((j && j.collection) || []).map(mapAlbum).filter(Boolean);
  },

  async simiSongs(id) {
    const tid = String(id || '').trim();
    if (!tid) return [];
    const j = await scGet('/tracks/' + encodeURIComponent(tid) + '/related', { limit: 20 }).catch(() => null);
    return ((j && j.collection) || []).map(t => mapTrack(t)).filter(Boolean);
  },

  async comments(id, hot, offset) {
    const tid = String(id || '').trim();
    if (!tid) return { items: [], total: 0 };
    const off = Math.max(0, Number(offset || 0));
    const limit = 20;
    const sort = hot ? 'track_timestamp' : 'newest';
    const j = await scGet('/tracks/' + encodeURIComponent(tid) + '/comments', {
      threaded: 0,
      filter_replies: 0,
      sort,
      limit,
      offset: off,
    }).catch(() => null);
    if (!j) return { items: [], total: 0 };
    const items = (j.collection || []).map(mapComment);
    let total = off + items.length + (j.next_href ? limit : 0);
    if (off === 0) {
      const tr = await scGet('/tracks/' + encodeURIComponent(tid)).catch(() => null);
      if (tr && Number(tr.comment_count || 0) >= items.length) total = Number(tr.comment_count);
    }
    return { items, total };
  },

  // ---------- 可选账号功能（粘贴 oauth_token Cookie 登录） ----------
  async account() {
    if (!getAuth()) return null;
    try {
      const me = await scGet('/me', {}, { noRetryCid: false });
      if (me && me.id) {
        const uid = String(me.id);
        nk.store.set('sc_uid', uid);
        return {
          uid,
          name: clean(me.username || me.full_name || 'SoundCloud'),
          avatar: art(me.avatar_url),
        };
      }
    } catch (e) {}
    return null;
  },

  async myPlaylists() {
    let uid = nk.store.get('sc_uid');
    let likesCount = 0;
    let avatar = null;
    if (getAuth()) {
      const me = await scGet('/me').catch(() => null);
      if (me && me.id) {
        uid = String(me.id);
        nk.store.set('sc_uid', uid);
        likesCount = Number(me.likes_count || 0);
        avatar = art(me.avatar_url);
      }
    }
    if (!uid) return [];
    const out = [
      {
        id: 'liked',
        name: '我喜欢的音乐',
        count: likesCount,
        cover: avatar,
        liked: true,
        mine: true,
        desc: 'SoundCloud 喜欢列表',
      },
    ];
    const j = await scGet('/users/' + encodeURIComponent(uid) + '/playlists_without_albums', { limit: 50 }).catch(() => null);
    ((j && j.collection) || []).forEach(p => {
      const m = mapPlaylist(p);
      if (m) {
        m.mine = String((p.user && p.user.id) || '') === String(uid);
        out.push(m);
      }
    });
    return out;
  },

  async like(id, on) {
    const uid = nk.store.get('sc_uid');
    if (!getAuth() || !uid) throw new Error('请先粘贴 SoundCloud oauth_token 登录后再收藏');
    await scReq('/users/' + encodeURIComponent(uid) + '/track_likes/' + encodeURIComponent(String(id)), {}, {
      method: on ? 'PUT' : 'DELETE',
    });
  },

  async followArtist(id, on) {
    if (!getAuth()) throw new Error('请先粘贴 SoundCloud oauth_token 登录后再关注');
    await scReq('/me/followings/' + encodeURIComponent(String(id)), {}, {
      method: on ? 'PUT' : 'DELETE',
    });
  },

  async followUser(id, on) {
    return await this.followArtist(id, on);
  },

  loginModes() {
    return [{ id: 'web', name: '网页直接登录', web: true }];
  },

  loginWeb(env) {
    const pc = !!(env && env.desktop);
    return {
      url: pc ? 'https://soundcloud.com/signin' : 'https://m.soundcloud.com/signin',
      pc,
      cookieUrl: pc ? 'https://soundcloud.com' : 'https://m.soundcloud.com',
      cookieMatch: '(?:^|;\\s*)oauth_token=[^;\\s]+',
      clearCookie: 'oauth_token',
      hint: '在下方网页直接登录 SoundCloud（支持邮箱密码及 Google/Apple 第三方登录弹窗），成功后自动捕获凭证完成绑定；也可切到上方「Cookie 粘贴」',
    };
  },

  async loginWebDone(url, cookie) {
    const raw = String(cookie || '') || String(url || '');
    await this.setCookie(raw);
    return { state: 'done' };
  },

  async setCookie(raw) {
    const token = parseToken(raw);
    if (!token) {
      throw new Error('未找到 oauth_token：请从浏览器 soundcloud.com 复制包含 oauth_token=... 的 Cookie，或直接粘贴 oauth_token 值');
    }
    setAuth({ token });
    try {
      const me = await scGet('/me');
      if (!me || !me.id) throw new Error('Cookie 无效或已过期');
      nk.store.set('sc_uid', String(me.id));
    } catch (e) {
      setAuth(null);
      nk.store.set('sc_uid', null);
      throw new Error('SoundCloud oauth_token 无效或已过期');
    }
  },

  async logout() {
    setAuth(null);
    nk.store.set('sc_uid', null);
  },
});
