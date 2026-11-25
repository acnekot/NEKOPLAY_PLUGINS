// @id qqmusic
// @name QQ 音乐
// @type source
// @version 1.7.1
// @author NEKOPLAY
// @desc QQ 音乐完整音源：搜索、播放、QRC 逐字歌词、私人 FM、每日推荐、推荐歌单、歌单广场、新碟/新歌、排行榜、MV 精选、评论与点赞、相似推荐、个人主页、听歌排行与播放上报
// @api 1
// @search track,album,artist,playlist
//
// 接口说明见 docs/plugin-api.md。协议笔记见 docs/qq-protocol.md（只记事实，不含第三方代码）。

const GATE = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const CDN = 'https://isure.stream.qqmusic.qq.com/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ---------- 工具 ----------
// 用 BigInt：普通数字乘 33 会超过 2^53 丢精度，算出的 ptqrtoken 不对，QQ 会直接回 403
function hash33(s, h0) {
  const M = (1n << 48n) - 1n;
  let h = BigInt(h0 || 0);
  for (let i = 0; i < s.length; i++) h = ((h << 5n) + h + BigInt(s.charCodeAt(i))) & M;
  return Number(h & 2147483647n);
}
function guid() {
  let g = nk.store.get('guid');
  if (!g) { g = Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''); nk.store.set('guid', g); }
  return g;
}
function cred() { return nk.store.get('cred'); }
const https = (u) => (typeof u === 'string' ? u : ((u && (u.picurl || u.url)) || '')).replace(/^http:/, 'https:');
const albumPic = (mid, size) => mid ? `https://y.gtimg.cn/music/photo_new/T002R${size || 500}x${size || 500}M000${mid}.jpg` : null;
const singerPic = (mid) => mid ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${mid}.jpg` : null;
const b64 = (s) => { const t = (s || '').trim(); if (!t) return ''; if (t.startsWith('[')) return t; try { return nk.base64.decode(t); } catch (e) { return ''; } };
const uniq = (a) => { const s = {}; return a.filter(x => x && x.id && !s[x.id] && (s[x.id] = 1)); };

function cookieHeader(c) {
  if (!c) return '';
  const parts = [
    `uin=${c.id}`, `qqmusic_uin=${c.id}`, `qm_keyst=${c.key}`, `qqmusic_key=${c.key}`, `tmeLoginType=${c.type}`,
  ];
  if (c.type === 1) {
    parts.push(`wxuin=${c.id}`);
    if (c.openid) parts.push(`wxopenid=${c.openid}`);
  } else if (c.openid) {
    parts.push(`openid=${c.openid}`);
  }
  return parts.join('; ');
}

/** 调网关：返回 req_0.data */
async function call(module, method, param, extraComm) {
  const c = cred();
  const comm = { ct: 19, cv: 2201, platform: '', chid: '0', guid: guid().toUpperCase(), g_tk: c ? hash33(c.key, 5381) : 5381 };
  if (c) {
    Object.assign(comm, { uin: c.id, qq: String(c.id), authst: c.key, tmeLoginType: c.type });
    if (c.openid) comm.openid = c.openid;
  }
  Object.assign(comm, extraComm || {});
  const headers = { 'User-Agent': UA, Referer: 'https://y.qq.com/', Origin: 'https://y.qq.com' };
  if (c) headers.Cookie = cookieHeader(c);
  const r = await nk.http({ url: GATE, json: { comm, req_0: { module, method, param } }, headers });
  if (r.status !== 200) throw new Error('QQ 音乐服务返回 ' + r.status);
  const r0 = r.json().req_0 || {};
  const code = r0.code || 0;
  if (code === 1000) throw new Error('QQ 音乐登录已过期，请重新登录');
  if (code === 2001) throw new Error('触发 QQ 音乐风控，稍后再试或先登录');
  if (code !== 0) throw new Error('QQ 音乐接口错误（' + code + '）');
  return r0.data || {};
}

// 歌曲 mid → 文件信息 / 试听 mid / 是否会员歌 / 数字 id；歌单分类、评论 CmId 与自建歌单 dirId 缓存
const files = {}, trials = {}, vip = {}, ids = {}, alIds = {}, myDirIds = {}, catIds = {}, cmIds = {};
function song(s0) {
  const s = s0.songInfo || s0;
  const mid = s.mid || s.songmid;
  if (s.file) files[mid] = s.file;
  if (s.id) ids[mid] = s.id;
  if (s.vs && s.vs[0]) trials[mid] = s.vs[0];
  const sw = s.action && typeof s.action.switch === 'number' ? s.action.switch : null;
  vip[mid] = !!((s.pay && s.pay.pay_play === 1) || (sw !== null && (sw & 2) === 0));
  const singers = s.singer || [];
  const al = s.album || {};
  const alMid = al.mid || s.albummid || '';
  return {
    id: mid, title: s.name || s.title || s.songname, artist: singers.map(x => x.name).join(' / ') || '未知艺人',
    album: al.name || al.title || '', duration: (s.interval || 0) * 1000,
    cover: albumPic(alMid) || singerPic(singers[0] && singers[0].mid),
    artists: singers.map(x => ({ id: 'ar' + x.mid, name: x.name })), albumId: alMid ? 'al' + alMid : '', vip: vip[mid],
  };
}

// ---------- 搜索 ----------
function searchId() { return String(Math.floor(Math.random() * 20 + 1) * 18014398509481984 + Math.floor(Math.random() * 4194305) * 4294967296 + Date.now() % 86400000); }
async function searchRaw(q, type, page) {
  const d = await call('music.search.SearchCgiService', 'DoSearchForQQMusicDesktop', { searchid: searchId(), query: q, search_type: type, num_per_page: 30, page_num: page || 1, highlight: 0, grp: 1 });
  return d.body || {};
}

// ---------- 播放 ----------
const FMTS = [
  { p: 'C400', ext: 'm4a', size: 'size_96aac', kbps: 96, level: 'standard' },
  { p: 'M500', ext: 'mp3', size: 'size_128mp3', kbps: 128, level: 'standard' },
  { p: 'C600', ext: 'm4a', size: 'size_192aac', kbps: 192, level: 'higher' },
  { p: 'M800', ext: 'mp3', size: 'size_320mp3', kbps: 320, level: 'exhigh' },
  { p: 'F000', ext: 'flac', size: 'size_flac', kbps: 0, level: 'lossless' },
  { p: 'RS01', ext: 'flac', size: 'size_hires', kbps: 0, level: 'hires' },
];
async function details(mids) {
  const d = await call('music.trackInfo.UniformRuleCtrl', 'CgiGetTrackInfo', { mids, types: mids.map(() => 0), modify_stamp: mids.map(() => 0), ctx: 0, client: 1 });
  return (d.tracks || []).map(song);
}
async function vkey(mid, filename) {
  const c = cred();
  const baseParam = {
    uin: c ? String(c.id) : '0',
    filename: [filename],
    guid: guid().toUpperCase(),
    songmid: [mid],
    songtype: [0],
    ctx: 1,
    loginflag: c ? 1 : 0,
    platform: '20',
  };
  let info = ((await call('music.vkey.GetVkey', 'UrlGetVkey', baseParam)).midurlinfo || [])[0] || {};
  if (!info.purl && c) {
    try {
      const alt = ((await call('vkey.GetVkeyServer', 'CgiGetVkey', baseParam)).midurlinfo || [])[0] || {};
      if (alt.purl) info = alt;
    } catch (e) {}
  }
  return info;
}

// ---------- QQ 扫码登录（照官方电脑版登录框的流程，cookie 按域名保存） ----------
const U1 = 'https://graph.qq.com/oauth2.0/login_jump';
let jar = {};
function keep(r, host) {
  (r.headers['set-cookie'] || []).forEach(c => {
    const parts = c.split(';'); const kv = parts[0]; const i = kv.indexOf('='); if (i < 0) return;
    const d = parts.slice(1).map(x => x.trim()).find(x => /^domain=/i.test(x));
    const dom = (d ? d.slice(7) : host).replace(/^\./, '').toLowerCase();
    const k = kv.slice(0, i).trim() + '@' + dom, v = kv.slice(i + 1).trim();
    if (v) jar[k] = v; else delete jar[k];
  });
}
function cookieFor(host) { return Object.keys(jar).filter(k => { const d = k.split('@')[1]; return host === d || host.endsWith('.' + d); }).map(k => k.split('@')[0] + '=' + jar[k]).join('; '); }
function jarGet(name, dom) { const k = Object.keys(jar).find(k => k.split('@')[0] === name && (!dom || k.split('@')[1] === dom)); return k ? jar[k] : null; }
async function req(url, o) {
  const host = url.split('://')[1].split(/[/?]/)[0].toLowerCase();
  const headers = { 'User-Agent': UA, Referer: (o && o.referer) || 'https://xui.ptlogin2.qq.com/' };
  const ck = cookieFor(host); if (ck) headers.Cookie = ck;
  const r = await nk.http(Object.assign({ url, headers, redirect: false }, o && o.form ? { form: o.form } : {}, o && o.binary ? { binary: true } : {}, o && o.timeout ? { timeout: o.timeout } : {}));
  keep(r, host);
  return r;
}
const qs = (o) => Object.keys(o).map(k => k + '=' + encodeURIComponent(o[k])).join('&');
const REDIRECT = 'https://y.qq.com/portal/wx_redirect.html';
const WX_APPID = 'wx48db31d50e334801';
const qrState = (c) => [0, 405].includes(c) ? 'done' : [67, 404].includes(c) ? 'scanned' : [65, 402].includes(c) ? 'expired' : [68, 403].includes(c) ? 'refused' : 'wait';
/** 换到的凭证存起来，顺便取昵称头像 */
async function fetchProfile(c) {
  if (!c || !c.id) return c;
  try {
    const r = await nk.http({
      url: `https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?cid=205360838&userid=${c.id}&reqfrom=1&format=json`,
      headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/', Cookie: `uin=${c.id}; qqmusic_uin=${c.id}; qm_keyst=${c.key}; qqmusic_key=${c.key}; tmeLoginType=${c.type}` },
    });
    const cr = ((r.json() || {}).data || {}).creator || {};
    if (cr.nick || cr.headpic) {
      const next = Object.assign({}, c, { nick: cr.nick || c.nick, avatar: https(cr.headpic) || c.avatar });
      nk.store.set('cred', next);
      return next;
    }
  } catch (e) {}
  return c;
}
async function finish(d, type) {
  const id = Number(d.musicid || d.str_musicid || 0);
  if (!d.musickey || !id) throw new Error('登录失败：没有拿到凭证');
  const base = { id, key: d.musickey, type };
  if (d.openid) base.openid = d.openid;
  if (d.refresh_key) base.refresh = d.refresh_key;
  nk.store.set('cred', base);
  await fetchProfile(base);
}


// ---------- QRC 逐字歌词解密（基于 MIT 协议开源库 qrc-decoder / Copyright (c) apoint123 + 纯 JS RFC 1951 Inflate） ----------
const qrcDecrypt = (() => {
const KEY_1 = new Uint8Array([33,64,35,41,40,42,36,37]);
const KEY_2 = new Uint8Array([49,50,51,90,88,67,33,64]);
const KEY_3 = new Uint8Array([33,64,35,41,40,78,72,76]);
const S_BOXES = [
	[14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
	[15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,15,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
	[10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
	[7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,10,13,8,9,4,5,11,12,7,2,14],
	[2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
	[12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
	[4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
	[13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11]
];
const P_BOX = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25];
const E_BOX_TABLE = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1];
const KEY_RND_SHIFT = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
const KEY_PERM_C = [56,48,40,32,24,16,8,0,57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35];
const KEY_PERM_D = [62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,60,52,44,36,28,20,12,4,27,19,11,3];
const KEY_COMPRESSION = [13,16,10,23,0,4,2,27,14,5,20,9,22,18,11,3,25,7,15,6,26,19,12,1,40,51,30,36,46,54,29,39,50,44,32,47,43,48,38,55,33,52,45,41,49,35,28,31];
let Mode =  function(Mode) {
	Mode[Mode["Encrypt"] = 0] = "Encrypt";
	Mode[Mode["Decrypt"] = 1] = "Decrypt";
	return Mode;
}({});
function permuteFromKeyBytes(key, table) {
	let output = 0n;
	let currentBitMask = 1n << BigInt(table.length - 1);
	for (let i = 0; i < table.length; i++) {
		const pos = table[i];
		const wordIndex = pos >> 5;
		const bitInWord = pos & 31;
		const byteInWord = bitInWord >> 3;
		const bitInByte = bitInWord & 7;
		if (key[wordIndex * 4 + 3 - byteInWord] >> 7 - bitInByte & 1) output |= currentBitMask;
		currentBitMask >>= 1n;
	}
	return output;
}
function rotateLeft28Bit(value, amount) {
	const BITS_28_MASK = 4294967280n;
	const val = value & BITS_28_MASK;
	return (val << BigInt(amount) | val >> BigInt(28 - amount)) & BITS_28_MASK;
}
function keySchedule(key, mode) {
	const schedule = new Int32Array(32);
	const c0 = permuteFromKeyBytes(key, KEY_PERM_C);
	const d0 = permuteFromKeyBytes(key, KEY_PERM_D);
	let c = c0 << 4n;
	let d = d0 << 4n;
	for (let i = 0; i < 16; i++) {
		const shift = KEY_RND_SHIFT[i];
		c = rotateLeft28Bit(c, shift);
		d = rotateLeft28Bit(d, shift);
		const toGen = mode === Mode.Decrypt ? 15 - i : i;
		let subkey48bit = 0n;
		for (let k = 0; k < KEY_COMPRESSION.length; k++) {
			const pos = KEY_COMPRESSION[k];
			if ((pos < 28 ? c >> BigInt(31 - pos) & 1n : d >> BigInt(31 - (pos - 27)) & 1n) === 1n) subkey48bit |= 1n << BigInt(47 - k);
		}
		const b5 = Number(subkey48bit >> 40n & 255n);
		const b4 = Number(subkey48bit >> 32n & 255n);
		const b3 = Number(subkey48bit >> 24n & 255n);
		const high24 = b5 << 16 | b4 << 8 | b3;
		const b2 = Number(subkey48bit >> 16n & 255n);
		const b1 = Number(subkey48bit >> 8n & 255n);
		const b0 = Number(subkey48bit & 255n);
		const low24 = b2 << 16 | b1 << 8 | b0;
		schedule[toGen * 2] = high24;
		schedule[toGen * 2 + 1] = low24;
	}
	return schedule;
}
const IP_RULE = [34,42,50,58,2,10,18,26,36,44,52,60,4,12,20,28,38,46,54,62,6,14,22,30,40,48,56,64,8,16,24,32,33,41,49,57,1,9,17,25,35,43,51,59,3,11,19,27,37,45,53,61,5,13,21,29,39,47,55,63,7,15,23,31];
const INV_IP_RULE = [37,5,45,13,53,21,61,29,38,6,46,14,54,22,62,30,39,7,47,15,55,23,63,31,40,8,48,16,56,24,64,32,33,1,41,9,49,17,57,25,34,2,42,10,50,18,58,26,35,3,43,11,51,19,59,27,36,4,44,12,52,20,60,28];
const IP_LEFT_TABLE = new Int32Array(2048);
const IP_RIGHT_TABLE = new Int32Array(2048);
const INV_IP_LEFT_TABLE = new Int32Array(2048);
const INV_IP_RIGHT_TABLE = new Int32Array(2048);
function generatePermutationTables() {
	const applyPermutation = (input, rule) => {
		let output = 0n;
		for (let i = 0; i < 64; i++) {
			const srcBit1Based = rule[i];
			if (input >> BigInt(64 - srcBit1Based) & 1n) output |= 1n << BigInt(63 - i);
		}
		return output;
	};
	for (let bytePos = 0; bytePos < 8; bytePos++) for (let byteVal = 0; byteVal < 256; byteVal++) {
		const permuted = applyPermutation(BigInt(byteVal) << BigInt(56 - bytePos * 8), IP_RULE);
		const idx = bytePos << 8 | byteVal;
		IP_LEFT_TABLE[idx] = Number(permuted >> 32n & 4294967295n);
		IP_RIGHT_TABLE[idx] = Number(permuted & 4294967295n);
	}
	for (let blockPos = 0; blockPos < 8; blockPos++) for (let blockVal = 0; blockVal < 256; blockVal++) {
		const permuted = applyPermutation(BigInt(blockVal) << BigInt(56 - blockPos * 8), INV_IP_RULE);
		const idx = blockPos << 8 | blockVal;
		INV_IP_LEFT_TABLE[idx] = Number(permuted >> 32n & 4294967295n);
		INV_IP_RIGHT_TABLE[idx] = Number(permuted & 4294967295n);
	}
}
generatePermutationTables();
function calculateSboxIndex(a) {
	return a & 32 | (a & 31) >> 1 | (a & 1) << 4;
}
function applyQqPboxPermutation(input) {
	let output = 0;
	for (let i = 0; i < 32; i++) {
		const sourceBit1Based = P_BOX[i];
		const destBitMask = 1 << 31 - i;
		if ((input & 1 << 32 - sourceBit1Based) !== 0) output |= destBitMask;
	}
	return output;
}
const SP_TABLE = new Int32Array(512);
function generateSpTables() {
	for (let sBoxIdx = 0; sBoxIdx < 8; sBoxIdx++) for (let sBoxInput = 0; sBoxInput < 64; sBoxInput++) {
		const sBoxIndex = calculateSboxIndex(sBoxInput);
		const prePBoxVal = S_BOXES[sBoxIdx][sBoxIndex] << 28 - sBoxIdx * 4;
		SP_TABLE[sBoxIdx << 6 | sBoxInput] = applyQqPboxPermutation(prePBoxVal);
	}
}
generateSpTables();
const EBOX_HIGH_TABLE = new Int32Array(1024);
const EBOX_LOW_TABLE = new Int32Array(1024);
function generateEBoxTables() {
	for (let chunkIdx = 0; chunkIdx < 4; chunkIdx++) {
		const shiftIn32 = (3 - chunkIdx) * 8;
		for (let byteVal = 0; byteVal < 256; byteVal++) {
			let high24 = 0;
			let low24 = 0;
			const input = byteVal << shiftIn32;
			for (let i = 0; i < 24; i++) if (input >>> 32 - E_BOX_TABLE[i] & 1) high24 |= 1 << 23 - i;
			for (let i = 24; i < 48; i++) if (input >>> 32 - E_BOX_TABLE[i] & 1) low24 |= 1 << 47 - i;
			const tableIdx = chunkIdx << 8 | byteVal;
			EBOX_HIGH_TABLE[tableIdx] = high24;
			EBOX_LOW_TABLE[tableIdx] = low24;
		}
	}
}
generateEBoxTables();
function fFunction(state, keyHigh24, keyLow24) {
	const b0 = state >>> 24 & 255;
	const b1 = state >>> 16 & 255;
	const b2 = state >>> 8 & 255;
	const b3 = state & 255;
	const eboxHigh24 = EBOX_HIGH_TABLE[b0] | EBOX_HIGH_TABLE[256 | b1] | EBOX_HIGH_TABLE[512 | b2] | EBOX_HIGH_TABLE[768 | b3];
	const eboxLow24 = EBOX_LOW_TABLE[b0] | EBOX_LOW_TABLE[256 | b1] | EBOX_LOW_TABLE[512 | b2] | EBOX_LOW_TABLE[768 | b3];
	const xorHigh24 = eboxHigh24 ^ keyHigh24;
	const xorLow24 = eboxLow24 ^ keyLow24;
	return SP_TABLE[xorHigh24 >>> 18 & 63] | SP_TABLE[64 | xorHigh24 >>> 12 & 63] | SP_TABLE[128 | xorHigh24 >>> 6 & 63] | SP_TABLE[192 | xorHigh24 & 63] | SP_TABLE[256 | xorLow24 >>> 18 & 63] | SP_TABLE[320 | xorLow24 >>> 12 & 63] | SP_TABLE[384 | xorLow24 >>> 6 & 63] | SP_TABLE[448 | xorLow24 & 63];
}
function desCrypt(input, output, keySchedule) {
	let left = 0;
	let right = 0;
	for (let i = 0; i < 8; i++) {
		const idx = i << 8 | input[i];
		left |= IP_LEFT_TABLE[idx];
		right |= IP_RIGHT_TABLE[idx];
	}
	for (let i = 0; i < 15; i++) {
		const temp = right;
		right = (left ^ fFunction(right, keySchedule[i * 2], keySchedule[i * 2 + 1])) >>> 0;
		left = temp;
	}
	left = (left ^ fFunction(right, keySchedule[30], keySchedule[31])) >>> 0;
	let outLeft = 0;
	let outRight = 0;
	for (let i = 0; i < 4; i++) {
		const idxL = i << 8 | left >>> 24 - i * 8 & 255;
		outLeft |= INV_IP_LEFT_TABLE[idxL];
		outRight |= INV_IP_RIGHT_TABLE[idxL];
		const idxR = i + 4 << 8 | right >>> 24 - i * 8 & 255;
		outLeft |= INV_IP_LEFT_TABLE[idxR];
		outRight |= INV_IP_RIGHT_TABLE[idxR];
	}
	output[0] = outLeft >>> 24 & 255;
	output[1] = outLeft >>> 16 & 255;
	output[2] = outLeft >>> 8 & 255;
	output[3] = outLeft & 255;
	output[4] = outRight >>> 24 & 255;
	output[5] = outRight >>> 16 & 255;
	output[6] = outRight >>> 8 & 255;
	output[7] = outRight & 255;
}
function hexToUint8Array(hex) {
	if (typeof Buffer !== "undefined") return Buffer.from(hex, "hex");
	if (hex.length % 2 !== 0) throw new Error("无效的十六进制字符串: 长度必须是偶数");
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
	return bytes;
}
function uint8ArrayToHex(bytes) {
	if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("hex");
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const DES_BLOCK_SIZE = 8;
var QqMusicCodec = class {
	encryptSchedule;
	decryptSchedule;
	constructor() {
		this.decryptSchedule = [
			keySchedule(KEY_3, Mode.Decrypt),
			keySchedule(KEY_2, Mode.Encrypt),
			keySchedule(KEY_1, Mode.Decrypt)
		];
		this.encryptSchedule = [
			keySchedule(KEY_1, Mode.Encrypt),
			keySchedule(KEY_2, Mode.Decrypt),
			keySchedule(KEY_3, Mode.Encrypt)
		];
	}
	decryptBlock(input, output) {
		const temp1 = new Uint8Array(8);
		const temp2 = new Uint8Array(8);
		desCrypt(input, temp1, this.decryptSchedule[0]);
		desCrypt(temp1, temp2, this.decryptSchedule[1]);
		desCrypt(temp2, output, this.decryptSchedule[2]);
	}
	encryptBlock(input, output) {
		const temp1 = new Uint8Array(8);
		const temp2 = new Uint8Array(8);
		desCrypt(input, temp1, this.encryptSchedule[0]);
		desCrypt(temp1, temp2, this.encryptSchedule[1]);
		desCrypt(temp2, output, this.encryptSchedule[2]);
	}
};
const CODEC = new QqMusicCodec();
  function inflateZlib(src) {
    // 跳过 2 字节 zlib 头（CMF + FLG）
    let p = 2, bitBuf = 0, bitCnt = 0;
    const out = [];
    const bits = (n) => {
      while (bitCnt < n) { if (p >= src.length) throw new Error('inflate eof'); bitBuf |= src[p++] << bitCnt; bitCnt += 8; }
      const v = bitBuf & ((1 << n) - 1); bitBuf >>>= n; bitCnt -= n; return v;
    };
    const buildTree = (lens) => {
      const maxB = 15, cnt = new Int32Array(maxB + 1);
      for (let i = 0; i < lens.length; i++) if (lens[i]) cnt[lens[i]]++;
      const next = new Int32Array(maxB + 1);
      let code = 0;
      for (let b = 1; b <= maxB; b++) { code = (code + cnt[b - 1]) << 1; next[b] = code; }
      const tbl = {};
      for (let i = 0; i < lens.length; i++) {
        const l = lens[i]; if (!l) continue;
        tbl[(l << 16) | next[l]++] = i;
      }
      return tbl;
    };
    const decodeSym = (tbl) => {
      let c = 0;
      for (let l = 1; l <= 15; l++) {
        c = (c << 1) | bits(1);
        const v = tbl[(l << 16) | c];
        if (v !== undefined) return v;
      }
      throw new Error('inflate bad huffman');
    };
    const LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
    const LEN_EXT  = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
    const DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
    const DIST_EXT  = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
    const CL_ORDER  = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
    const fixedLit = buildTree(Array.from({ length: 288 }, (_, i) => i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8));
    const fixedDist = buildTree(Array.from({ length: 32 }, () => 5));
    let bfinal = 0;
    while (!bfinal) {
      bfinal = bits(1);
      const btype = bits(2);
      if (btype === 0) {
        bitBuf = 0; bitCnt = 0;
        const len = src[p] | (src[p + 1] << 8); p += 4;
        for (let i = 0; i < len; i++) out.push(src[p++]);
      } else if (btype === 1 || btype === 2) {
        let litT = fixedLit, distT = fixedDist;
        if (btype === 2) {
          const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
          const clLens = new Array(19).fill(0);
          for (let i = 0; i < hclen; i++) clLens[CL_ORDER[i]] = bits(3);
          const clT = buildTree(clLens);
          const all = [];
          while (all.length < hlit + hdist) {
            const sym = decodeSym(clT);
            if (sym < 16) all.push(sym);
            else if (sym === 16) { const r = bits(2) + 3, prev = all[all.length - 1]; for (let k = 0; k < r; k++) all.push(prev); }
            else if (sym === 17) { const r = bits(3) + 3; for (let k = 0; k < r; k++) all.push(0); }
            else { const r = bits(7) + 11; for (let k = 0; k < r; k++) all.push(0); }
          }
          litT = buildTree(all.slice(0, hlit));
          distT = buildTree(all.slice(hlit));
        }
        while (true) {
          const sym = decodeSym(litT);
          if (sym === 256) break;
          if (sym < 256) { out.push(sym); continue; }
          const li = sym - 257;
          const len = LEN_BASE[li] + bits(LEN_EXT[li]);
          const di = decodeSym(distT);
          const dist = DIST_BASE[di] + bits(DIST_EXT[di]);
          for (let k = 0; k < len; k++) out.push(out[out.length - dist]);
        }
      } else throw new Error('inflate bad btype');
    }
    return new Uint8Array(out);
  }
  function utf8Decode(bytes) {
    let i = (bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) ? 3 : 0, s = '';
    while (i < bytes.length) {
      const c = bytes[i++];
      if (c < 128) s += String.fromCharCode(c);
      else if (c < 224) s += String.fromCharCode(((c & 31) << 6) | (bytes[i++] & 63));
      else if (c < 240) s += String.fromCharCode(((c & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
      else {
        const cp = (((c & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63)) - 0x10000;
        s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      }
    }
    return s;
  }
  return function decryptQrcHex(hex) {
    if (!hex || hex.length < 16 || hex.length % 16 !== 0) return '';
    const enc = hexToUint8Array(hex);
    const dec = new Uint8Array(enc.length);
    for (let i = 0; i < enc.length; i += 8) CODEC.decryptBlock(enc.subarray(i, i + 8), dec.subarray(i, i + 8));
    return utf8Decode(inflateZlib(dec));
  };
})();

/** 把解密出的 QRC XML 转成 NEKOPLAY 原生逐字歌词 yrc 格式：[行开始,行时长](字开始,字时长,0)字 */
function qrcToYrc(xml) {
  if (!xml) return null;
  const m = /LyricContent="([\s\S]*?)"/.exec(xml);
  const raw = (m ? m[1] : xml).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const lm = /^\[(\d+),(\d+)\](.*)$/.exec(line.trim());
    if (!lm) continue;
    const body = lm[3];
    const parts = [];
    const re = /([^()]*?)\((\d+),(\d+)\)/g;
    let wm;
    while ((wm = re.exec(body))) {
      if (wm[1]) parts.push(`(${wm[2]},${wm[3]},0)${wm[1]}`);
    }
    if (parts.length) out.push(`[${lm[1]},${lm[2]}]${parts.join('')}`);
  }
  return out.length ? out.join('\n') : null;
}

nk.register({
  // ---------- 搜索 ----------
  async search(q, type, page) {
    if (type === 'artist') {
      const b = await searchRaw(q, 1, page);
      return ((b.singer && b.singer.list) || b.item_singer || []).map(a => {
        const mid = a.singerMID || a.singermid || a.mid;
        return { id: 'ar' + mid, name: a.singerName || a.name, cover: https(a.singerPic) || singerPic(mid) };
      });
    }
    if (type === 'album') {
      const b = await searchRaw(q, 2, page);
      return ((b.album && b.album.list) || b.item_album || []).map(a => {
        const mid = a.albumMID || a.albummid || a.mid;
        if (a.albumID) alIds[mid] = a.albumID;
        return { id: 'al' + mid, name: a.albumName || a.name, cover: https(a.albumPic) || albumPic(mid), count: a.song_count, year: (a.publicTime || '').slice(0, 4), artist: a.singerName || (a.singer_list || []).map(x => x.name).join(' / ') };
      });
    }
    if (type === 'playlist') {
      const b = await searchRaw(q, 3, page);
      return ((b.songlist && b.songlist.list) || b.item_songlist || []).map(p => ({ id: String(p.dissid), name: p.dissname, count: p.song_count, cover: https(p.imgurl) }));
    }
    const b = await searchRaw(q, 0, page);
    return ((b.song && b.song.list) || b.item_song || []).map(song);
  },
  async hotSearch() {
    const d = await call('music.musicsearch.HotkeyService', 'GetHotkeyForQQMusicMobile', { searchid: searchId(), remoteplace: 'txt.mqq.all' });
    return (d.vec_hotkey || []).map(x => x.query || x.title).filter(Boolean);
  },
  async suggest(q) {
    const r = await nk.http({ url: 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key=' + encodeURIComponent(q) + '&format=json', headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' } });
    const d = (r.json() || {}).data || {};
    const out = [];
    ['song', 'singer', 'album'].forEach(k => ((d[k] && d[k].itemlist) || []).forEach(x => { if (x.name) out.push(x.name); }));
    return [...new Set(out)].slice(0, 10);
  },
  async details(mids) { return details(mids); },

  // ---------- 播放地址：从想要的音质往下试，整首拿不到时放试听 ----------
  async stream(mid, quality) {
    if (!files[mid]) await details([mid]);
    const f = files[mid] || {};
    const media = f.media_mid || mid + mid;
    for (let i = Math.min(Math.max(quality + 1, 1), FMTS.length - 1); i >= 0; i--) {
      const m = FMTS[i];
      if (m.size in f && !(f[m.size] > 0) && i > 0) continue;
      const info = await vkey(mid, `${m.p}${media}.${m.ext}`);
      if (info.purl) return { url: CDN + info.purl, ext: m.ext, kbps: m.kbps, level: m.level };
    }
    if (trials[mid]) {
      const info = await vkey(mid, `RS02${trials[mid]}.mp3`);
      if (info.purl) return { url: CDN + info.purl, ext: 'mp3', kbps: 128, level: 'standard', trial: true, message: cred() ? '这首是会员/数字专辑歌曲，当前账号权限不足或登录已过期，只能放 1 分钟试听（如已开通会员请重新登录）' : '这首是会员歌曲，未登录只能放 1 分钟试听片段' };
    }
    return { error: cred() ? '没有可用的播放地址（这首歌需要 QQ 音乐会员或单独购买）' : '这首歌需要登录 QQ 音乐才能播放' };
  },

  async lyric(mid) {
    let yrc = null, tr = null, lrc = '';
    try {
      if (!ids[mid]) await details([mid]);
      const q = await call('music.musichallSong.PlayLyricInfo', 'GetPlayLyricInfo', {
        songMid: mid, songID: Number(ids[mid] || 0), crypt: 1, ct: 19, cv: 2201,
        lrc_t: 0, qrc: 1, qrc_t: 0, roma: 0, roma_t: 0, trans: 1, trans_t: 0, type: 1,
      });
      if (q.lyric && /^[0-9a-fA-F]+$/.test(q.lyric.slice(0, 32))) {
        yrc = qrcToYrc(qrcDecrypt(q.lyric));
      }
      if (q.trans) {
        tr = /^[0-9a-fA-F]+$/.test(q.trans.slice(0, 32)) ? (qrcDecrypt(q.trans) || null) : (b64(q.trans) || null);
      }
    } catch (e) {}
    if (!yrc) {
      const d = await call('music.musichallSong.PlayLyricInfo', 'GetPlayLyricInfo', {
        songMid: mid, crypt: 0, ct: 19, cv: 2201, lrc_t: 0, qrc: 0, qrc_t: 0, roma: 0, roma_t: 0, trans: 1, trans_t: 0, type: 1,
      });
      lrc = b64(d.lyric);
      if (!tr) tr = b64(d.trans) || null;
    }
    return { lrc, tr, yrc };
  },

  // ---------- 歌单 / 专辑 / 歌手 ----------
  async playlist(id) {
    if (id.startsWith('top')) {
      const d = await call('music.musicToplist.Toplist', 'GetDetail', { topid: Number(id.slice(3)), offset: 0, num: 100, period: '' });
      return (d.songInfoList || []).map(song);
    }
    const liked = id === 'liked', c = cred();
    const out = [];
    for (let begin = 0; out.length < 3000;) {
      const p = { disstid: liked ? 0 : Number(id), dirid: liked ? 201 : 0, tag: 1, song_begin: begin, song_num: 200, userinfo: 1, orderlist: 1, onlysonglist: 0 };
      if (liked) Object.assign(p, { enc_host_uin: '', uin: c ? c.id : 0 });
      const d = await call('music.srfDissInfo.DissInfo', 'CgiGetDiss', p);
      const l = (d.songlist || []).map(song);
      out.push(...l);
      if (!l.length || out.length >= (d.total_song_num || out.length)) break;
      begin += l.length;
    }
    return out;
  },
  async album(id) {
    const mid = id.replace(/^al/, '');
    let info = null; try { info = await call('music.musichallAlbum.AlbumInfoServer', 'GetAlbumDetail', { albumMid: mid }); } catch (e) {}
    const songs = await call('music.musichallAlbum.AlbumSongList', 'GetAlbumSongList', { albumMid: mid, begin: 0, num: 200, order: 2 });
    const tracks = (songs.songList || []).map(song);
    const b = (info && info.basicInfo) || {};
    if (b.albumID) alIds[mid] = b.albumID;
    const singers = (info && info.singer && info.singer.singerList) || [];
    return { album: { id, name: b.albumName || (tracks[0] && tracks[0].album) || '', cover: albumPic(mid), count: songs.totalNum || tracks.length, year: (b.publishDate || '').slice(0, 4), artist: singers.map(x => x.name).join(' / ') }, tracks };
  },
  async artist(id) {
    const mid = id.replace(/^ar/, '');
    const songs = await call('musichall.song_list_server', 'GetSingerSongList', { singerMid: mid, order: 1, number: 50, begin: 0 });
    const tracks = (songs.songList || []).map(song);
    let s = null; try { s = ((await call('music.musichallSinger.SingerInfoInter', 'GetSingerDetail', { singer_mids: [mid], groups: 1, wikis: 1 })).singer_list || [])[0]; } catch (e) {}
    const name = (s && s.basic_info && s.basic_info.name) || ((tracks[0] && tracks[0].artists.find(a => a.id === id)) || {}).name || '';
    return { name, cover: singerPic(mid), desc: (s && s.ex_info && s.ex_info.desc) || '', tracks };
  },
  async artistAlbums(id, offset, limit) {
    const mid = id.replace(/^ar/, '');
    const d = await call('music.musichallAlbum.AlbumListServer', 'GetAlbumList', { singerMid: mid, begin: offset || 0, num: limit || 30, order: 0 });
    const list = (d.albumList || []).map(a => {
      if (a.albumID && a.albumMid) alIds[a.albumMid] = a.albumID;
      return { id: 'al' + a.albumMid, name: a.albumName || '', cover: albumPic(a.albumMid), count: a.totalNum || 0, year: (a.publishDate || '').slice(0, 4), artist: a.singerName || '' };
    });
    return { items: list, more: (offset || 0) + list.length < (d.total || 0) };
  },

  // ---------- 发现：排行榜 / 推荐歌单 / 歌单广场 / 新碟 / 新歌 / 每日推荐 ----------
  async toplists() {
    const d = await call('music.musicToplist.Toplist', 'GetAll', {});
    const out = [];
    (d.group || []).forEach(g => (g.toplist || []).forEach(t => out.push({ id: 'top' + t.topId, name: t.title, count: t.totalNum, cover: https(t.frontPicUrl || t.headPicUrl) })));
    return out;
  },
  async recPlaylists() {
    const d = await call('music.playlist.PlaylistSquare', 'GetRecommendFeed', { From: 0, Size: 30 });
    return uniq((d.List || []).map(x => {
      const b = (x.Playlist && x.Playlist.basic) || {};
      const cv = b.cover || {};
      return { id: String(b.tid || ''), name: b.title || '', count: b.song_cnt || 0, cover: https(cv.big_url || cv.medium_url || cv.default_url || ''), desc: b.desc || '' };
    }));
  },
  async categories() {
    const d = await call('music.playlist.PlaylistSquare', 'GetAllTag', {});
    const out = ['全部'];
    (d.v_group || []).forEach(g => (g.v_item || []).forEach(it => {
      if (it.name && it.id) { catIds[it.name] = it.id; out.push(it.name); }
    }));
    return [...new Set(out)];
  },
  async square(cat, offset) {
    const size = 30, off = offset || 0;
    if (!cat || cat === '全部') {
      const d = await call('music.playlist.PlaylistSquare', 'GetRecommendFeed', { From: off, Size: size });
      const items = uniq((d.List || []).map(x => {
        const b = (x.Playlist && x.Playlist.basic) || {};
        const cv = b.cover || {};
        return { id: String(b.tid || ''), name: b.title || '', count: b.song_cnt || 0, cover: https(cv.big_url || cv.medium_url || cv.default_url || ''), desc: b.desc || '' };
      }));
      return { items, more: !!d.HasMore && items.length > 0 };
    }
    if (!Object.keys(catIds).length) try { await this.categories(); } catch (e) {}
    const cid = catIds[cat] || 3317;
    const curPage = Math.floor(off / size) + 1;
    const d = await call('playlist.PlayListPlazaServer', 'get_playlist_by_category', { id: cid, curPage, size, order: 5, titleid: cid });
    const items = uniq((d.v_playlist || []).map(p => ({
      id: String(p.tid || ''), name: p.title || '', count: (p.song_ids && p.song_ids.length) || 0,
      cover: https(p.cover_url_big || p.cover_url_medium || ''), desc: p.desc || '',
    })));
    return { items, more: items.length >= size };
  },
  async newAlbums(area, offset) {
    const map = { ALL: 1, ZH: 1, EA: 2, KR: 3, JP: 4 };
    const a = typeof area === 'number' ? (area > 0 ? area : 1) : (map[String(area || 'ALL').toUpperCase()] || 1);
    const d = await call('newalbum.NewAlbumServer', 'get_new_album_info', { area: a, sin: offset || 0, num: 30 });
    return uniq((d.albums || []).map(x => {
      if (x.id && x.mid) alIds[x.mid] = x.id;
      return { id: 'al' + x.mid, name: x.name || '', cover: albumPic(x.mid), artist: (x.singers || []).map(s => s.name).join(' / '), year: (x.release_time || '').slice(0, 4), count: 0 };
    }));
  },
  async newSongs(area) {
    const map = { 0: 5, 7: 1, 96: 2, 16: 3, 8: 4 };
    const t = map[Number(area) || 0] || 5;
    const d = await call('newsong.NewSongServer', 'get_new_song_info', { type: t });
    return (d.songlist || []).slice(0, 50).map(song);
  },
  async daily() {
    try {
      const rec = await this.recPlaylists();
      if (rec.length) {
        const list = await this.playlist(rec[0].id);
        if (list.length) return list.slice(0, 30);
      }
    } catch (e) {}
    return (await this.newSongs(0)).slice(0, 30);
  },
  async fm() {
    const d = await call('pf.radiosvr', 'GetRadiosonglist', { id: 99, firstplay: 1, num: 10 });
    return (d.track_list || []).map(song);
  },
  async simiSongs(mid) {
    if (!ids[mid]) await details([mid]);
    if (!ids[mid]) return [];
    const d = await call('music.recommend.TrackRelationServer', 'GetSimilarSongs', { songid: Number(ids[mid]), songtype: 0 });
    return (d.vecSong || []).map(song);
  },
  async simiArtists(id) {
    const mid = id.replace(/^ar/, '');
    const r = await nk.http({ url: `https://c.y.qq.com/v8/fcg-bin/fcg_v8_simsinger.fcg?singer_mid=${encodeURIComponent(mid)}&start=0&num=20&utf8=1&format=json`, headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' } });
    const items = (((r.json() || {}).singers || {}).items) || [];
    return uniq(items.map(a => ({ id: 'ar' + a.mid, name: a.name || '', cover: singerPic(a.mid) || https(a.pic || '') })));
  },
  async simiPlaylists(mid) {
    if (!ids[mid]) await details([mid]);
    if (!ids[mid]) return [];
    const d = await call('music.recommend.TrackRelationServer', 'GetRelatedPlaylist', { songid: Number(ids[mid]) });
    return uniq((d.vecPlaylist || []).map(p => ({ id: String(p.tid || ''), name: p.title || '', count: p.song_cnt || 0, cover: https(p.cover || '') })));
  },
  async comments(mid, hot, offset) {
    if (!ids[mid]) await details([mid]);
    if (!ids[mid]) return { items: [], total: 0 };
    const size = 20, page = Math.floor((offset || 0) / size);
    const param = hot
      ? { BizType: 1, BizId: String(ids[mid]), LastCommentSeqNo: '', PageSize: size, PageNum: page, HotType: 1, WithAirborne: 1 }
      : { BizType: 1, BizId: String(ids[mid]), LastCommentSeqNo: '', PageSize: size, PageNum: page, FromCommentId: '', WithAirborne: 1 };
    const d = await call('music.globalComment.CommentRead', hot ? 'GetHotCommentList' : 'GetNewCommentList', param);
    const cl = d.CommentList || {};
    const items = uniq((cl.Comments || []).map((c, idx) => {
      const rawId = String(c.CmId || c.CommentId || (page + '_' + idx + '_' + (c.PubTime || 0)));
      const numId = hash33(rawId, 5381) || (idx + 1);
      cmIds[numId] = rawId;
      return {
        id: numId,
        user: c.Nick || 'QQ音乐用户',
        uid: String(c.EncryptUin || ''),
        avatar: https(c.Avatar || ''),
        content: c.Content || '',
        liked: c.PraiseNum || 0,
        time: (c.PubTime || 0) * 1000,
        reply: null,
        replies: (c.SubComments && c.SubComments.length) || 0,
        likedByMe: !!c.IsPraised,
      };
    }));
    return { items, total: cl.CommentTotal || items.length };
  },
  async commentLike(mid, cid, on) {
    if (!cred()) throw new Error('请先登录 QQ 音乐');
    const cmId = cmIds[cid];
    if (!cmId) return;
    await call('music.globalComment.CommentWrite', 'DoLikeComment', { CmId: cmId, Praise: on ? 1 : 2 });
  },
  async recMvs() {
    const d = await call('MvService.MvInfoProServer', 'GetAllocMvInfo', { area_id: 15, version_id: 7, start: 0, size: 30, order: 1 });
    return uniq((d.list || []).map(m => ({
      id: String(m.vid || ''), name: m.title || '', cover: https(m.picurl || ''),
      artist: (m.singers || []).map(s => s.name).join(' / '), duration: (m.duration || 0) * 1000, plays: m.playcnt || 0,
    })));
  },
  async topMvs() {
    const d = await call('MvService.MvInfoProServer', 'GetAllocMvInfo', { area_id: 15, version_id: 7, start: 0, size: 50, order: 0 });
    return uniq((d.list || []).map(m => ({
      id: String(m.vid || ''), name: m.title || '', cover: https(m.picurl || ''),
      artist: (m.singers || []).map(s => s.name).join(' / '), duration: (m.duration || 0) * 1000, plays: m.playcnt || 0,
    })));
  },
  async artistMvs(id) {
    const mid = id.replace(/^ar/, '');
    const d = await call('MvService.MvInfoProServer', 'GetSingerMvList', { singermid: mid, start: 0, count: 30, order: 1 });
    return uniq((d.list || []).map(m => ({
      id: String(m.vid || ''), name: m.title || m.name || '', cover: https(m.pic || m.picurl || ''),
      artist: m.singer_name || (m.singers || []).map(s => s.name).join(' / '), duration: (m.duration || 0) * 1000, plays: m.playcnt || m.listenCount || 0,
    })));
  },
  async mvUrl(vid) {
    const d = await call('music.stream.MvUrlProxy', 'GetMvUrls', { vids: [String(vid)], request_type: 10003, addrtype: 3, format: 264 });
    const v = d[String(vid)] || {};
    const mp4 = (v.mp4 || []).filter(x => x.freeflow_url && x.freeflow_url.length);
    const best = mp4[mp4.length - 1];
    return best ? https(best.freeflow_url[0]) : null;
  },

  // ---------- 账号与个人主页 ----------
  async account() {
    let c = cred(); if (!c) return null;
    if (!c.nick || !c.avatar) c = await fetchProfile(c);
    return { uid: String(c.id), name: c.nick || String(c.id), avatar: c.avatar || null };
  },
  async user(id) {
    const c = cred();
    const uin = String(id || (c && c.id) || '');
    if (!uin) throw new Error('未找到用户');
    const headers = { 'User-Agent': UA, Referer: 'https://y.qq.com/' };
    if (c) headers.Cookie = `uin=${c.id}; qqmusic_uin=${c.id}; qm_keyst=${c.key}; qqmusic_key=${c.key}; tmeLoginType=${c.type}`;
    const r = await nk.http({ url: `https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?cid=205360838&userid=${encodeURIComponent(uin)}&reqfrom=1&format=json`, headers });
    const data = (r.json() || {}).data || {};
    const cr = data.creator || {};
    const nums = cr.nums || {};
    const isMe = c && String(c.id) === uin;
    return {
      uid: uin,
      name: cr.nick || (isMe && c.nick) || uin,
      avatar: https(cr.headpic || (isMe && c.avatar) || '') || null,
      bg: https(cr.backpic && cr.backpic.picurl ? cr.backpic.picurl : cr.backpic) || null,
      signature: cr.encrypt_uin ? 'QQ 音乐用户' : '',
      level: 0,
      listened: 0,
      follows: Number(nums.follownum || 0),
      fans: Number(nums.fansnum || 0),
      followed: false,
    };
  },
  async userPlaylists(u) {
    const c = cred();
    if (c && String(c.id) === String(u)) return this.myPlaylists();
    const d = await call('music.musicasset.PlaylistBaseRead', 'GetPlaylistByUin', { uin: String(u) });
    const pic = (p) => https(['picUrl', 'bigpicUrl', 'bigPicUrl', 'coverUrl', 'logo'].map(k => p[k]).find(x => x && x.startsWith('http')));
    return (d.v_playlist || []).map(p => ({ id: p.dirId === 201 ? 'liked' : String(p.tid), name: p.dirId === 201 ? '我喜欢' : p.dirName, count: p.songNum || 0, cover: pic(p), liked: p.dirId === 201, mine: false }));
  },
  async playRecord(u, week) {
    const c = cred();
    const out = [], seen = {};
    // 1. 优先拉取 QQ 音乐云端最近播放（PlayRecentlyRead）
    if (c) {
      try {
        const d = await call('music.musicasset.PlayRecentlyRead', 'GetPlayRecentlyInfo', { uin: String(u || c.id), type: 1, offset: 0, size: 100 });
        const list = (d.data && d.data.songList) || d.songList || [];
        list.forEach((it, idx) => {
          const t = song(it.songInfo || it);
          if (t && t.id && !seen[t.id]) {
            seen[t.id] = 1;
            out.push({ track: t, count: Number(it.playCount || it.count || Math.max(1, list.length - idx)) });
          }
        });
      } catch (e) {}
    }
    // 2. 合并本插件 scrobble 记录的听歌统计（区分最近一周 / 所有时间）
    const stats = nk.store.get('playStats') || {};
    const now = Date.now(), weekAgo = now - 7 * 86400 * 1000;
    const entries = Object.keys(stats).map(mid => {
      const st = stats[mid] || {};
      const cnt = week ? (st.lastAt >= weekAgo ? (st.weekCount || st.count || 0) : 0) : (st.count || 0);
      return { mid, count: cnt, lastAt: st.lastAt || 0 };
    }).filter(x => x.count > 0 && !seen[x.mid]).sort((a, b) => b.count - a.count || b.lastAt - a.lastAt).slice(0, 60);
    if (entries.length) {
      try {
        const tracks = await details(entries.map(e => e.mid));
        const byId = {};
        tracks.forEach(t => { byId[t.id] = t; });
        entries.forEach(e => { if (byId[e.mid]) out.push({ track: byId[e.mid], count: e.count }); });
      } catch (e) {}
    }
    return out.sort((a, b) => b.count - a.count);
  },
  async scrobbleStart(mid) {
    if (!mid) return;
    const stats = nk.store.get('playStats') || {};
    const cur = stats[mid] || { count: 0, weekCount: 0, lastAt: 0 };
    cur.startedAt = Date.now();
    stats[mid] = cur;
    nk.store.set('playStats', stats);
  },
  async scrobble(mid, seconds) {
    if (!mid) return;
    // 1. 持久化听歌次数（供个人主页「听歌排行」最近一周 / 所有时间展示）
    const stats = nk.store.get('playStats') || {};
    const now = Date.now(), weekAgo = now - 7 * 86400 * 1000;
    const cur = stats[mid] || { count: 0, weekCount: 0, lastAt: 0 };
    const nextWeek = cur.lastAt >= weekAgo ? (cur.weekCount || 0) + 1 : 1;
    stats[mid] = { count: (cur.count || 0) + 1, weekCount: nextWeek, lastAt: now };
    const ks = Object.keys(stats);
    if (ks.length > 300) {
      ks.sort((a, b) => (stats[a].lastAt || 0) - (stats[b].lastAt || 0)).slice(0, ks.length - 300).forEach(k => delete stats[k]);
    }
    nk.store.set('playStats', stats);
    // 2. 静默向 QQ 音乐网页端上报听歌时长（不影响正常播放）
    const c = cred();
    if (!c) return;
    try {
      if (!ids[mid]) await details([mid]);
      const sid = ids[mid] || 0;
      const q = qs({
        format: 'json', inCharset: 'utf8', outCharset: 'utf-8',
        g_tk: hash33(c.key, 5381), uin: c.id,
        id: sid, songid: sid, mid, songtype: 0, type: 1,
        playtime: Math.max(1, Math.round(Number(seconds) || 0)), guid: guid().toUpperCase(),
      });
      await nk.http({
        url: 'https://stat6.y.qq.com/pc/fcgi-bin/cgi_music_webreport.fcg?' + q,
        headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/', Cookie: `uin=${c.id}; qqmusic_uin=${c.id}; qm_keyst=${c.key}; qqmusic_key=${c.key}; tmeLoginType=${c.type}` },
      });
    } catch (e) {}
  },
  async subAlbums() {
    const c = cred(); if (!c) return [];
    const d = await call('music.musicasset.AlbumFavRead', 'GetAlbumFavInfo', { uin: String(c.id), offset: 0, size: 100 });
    return (d.v_list || []).map(a => {
      const mid = a.albumMid || a.mid || '';
      if (a.albumId && mid) alIds[mid] = a.albumId;
      return { id: 'al' + mid, name: a.albumName || a.name || '', cover: albumPic(mid), artist: a.singerName || '', year: (a.pubTime || '').slice(0, 4), count: a.songNum || 0 };
    }).filter(a => a.id !== 'al');
  },
  async subArtists() {
    const c = cred(); if (!c) return [];
    const d = await call('music.concern.RelationList', 'GetFollowSingerList', { From: 0, Size: 100 });
    return (d.List || []).map(a => {
      const mid = a.MID || a.mid || a.SingerMid || '';
      return { id: 'ar' + mid, name: a.Name || a.name || '', cover: https(a.Pic || '') || singerPic(mid), songs: a.SongNum || 0, albums: a.AlbumNum || 0, followed: true };
    }).filter(a => a.id !== 'ar');
  },
  async myPlaylists() {
    const c = cred(); if (!c) return [];
    const pic = (p) => https(['picUrl', 'bigpicUrl', 'bigPicUrl', 'coverUrl', 'logo'].map(k => p[k]).find(x => x && x.startsWith('http')));
    const d = await call('music.musicasset.PlaylistBaseRead', 'GetPlaylistByUin', { uin: String(c.id) });
    const mine = (d.v_playlist || []).map(p => {
      if (p.tid && p.dirId) myDirIds[String(p.tid)] = p.dirId;
      return p.dirId === 201 ? { id: 'liked', name: '我喜欢', count: p.songNum, cover: pic(p), liked: true, mine: true } : { id: String(p.tid), name: p.dirName, count: p.songNum, cover: pic(p), mine: true };
    });
    let fav = [];
    try { fav = ((await call('music.musicasset.PlaylistFavRead', 'CgiGetPlaylistFavInfo', { uin: String(c.id), offset: 0, size: 100 })).v_list || []).map(p => ({ id: String(p.tid), name: p.name, count: p.songnum, cover: pic(p) })); } catch (e) {}
    return mine.sort((a, b) => (b.liked ? 1 : 0) - (a.liked ? 1 : 0)).concat(fav);
  },
  async like(mid, on) {
    if (!cred()) return;
    if (!ids[mid]) await details([mid]);
    const d = await call('music.musicasset.PlaylistDetailWrite', on ? 'AddSonglist' : 'DelSonglist', { dirId: 201, tid: 0, bFmtUtf8: true, v_songInfo: [{ songId: ids[mid], songType: 0 }] });
    if (d.retCode && d.retCode !== 80092) throw new Error('QQ 音乐收藏失败（' + d.retCode + '）');
  },
  async createPlaylist(name, priv) {
    if (!cred()) throw new Error('请先登录 QQ 音乐');
    const d = await call('music.musicasset.PlaylistBaseWrite', 'AddPlaylist', { dirName: String(name || '新建歌单'), private: priv ? 1 : 0 });
    const tid = String(d.tid || d.dirId || '');
    if (tid && d.dirId) myDirIds[tid] = d.dirId;
    return tid;
  },
  async deletePlaylist(id) {
    if (!cred()) throw new Error('请先登录 QQ 音乐');
    const dirId = myDirIds[String(id)] || 0;
    await call('music.musicasset.PlaylistBaseWrite', 'DelPlaylist', { dirId, tid: Number(id) || 0 });
  },
  async subscribePlaylist(id, on) {
    if (!cred()) throw new Error('请先登录 QQ 音乐');
    await call('music.musicasset.PlaylistFavWrite', on ? 'FavPlaylist' : 'CancelFavPlaylist', { v_tid: [Number(id)] });
  },
  async followArtist(id, on) {
    if (!cred()) throw new Error('请先登录 QQ 音乐');
    const mid = id.replace(/^ar/, '');
    await call('music.concern.RelationWrite', on ? 'FollowSinger' : 'UnFollowSinger', { SingerMid: mid });
  },
  async editPlaylist(pid, op, mids) {
    if (!cred()) throw new Error('请先登录 QQ 音乐');
    const need = mids.filter(m => !ids[m]);
    if (need.length) await details(need);
    const v_songInfo = mids.map(m => ({ songId: ids[m], songType: 0 })).filter(x => x.songId);
    if (!v_songInfo.length) return;
    const dirId = pid === 'liked' ? 201 : (myDirIds[String(pid)] || 0);
    const tid = pid === 'liked' ? 0 : Number(pid);
    const d = await call('music.musicasset.PlaylistDetailWrite', op === 'add' ? 'AddSonglist' : 'DelSonglist', { dirId, tid, bFmtUtf8: true, v_songInfo });
    if (d.retCode && d.retCode !== 80092) throw new Error('QQ 音乐歌单编辑失败（' + d.retCode + '）');
  },
  async subAlbum(id, on) {
    if (!cred()) throw new Error('请先登录 QQ 音乐');
    const mid = id.replace(/^al/, '');
    if (!alIds[mid]) {
      const info = await call('music.musichallAlbum.AlbumInfoServer', 'GetAlbumDetail', { albumMid: mid });
      if (info && info.basicInfo && info.basicInfo.albumID) alIds[mid] = info.basicInfo.albumID;
    }
    if (!alIds[mid]) throw new Error('未找到该专辑 ID');
    await call('music.musicasset.AlbumFavWrite', on ? 'FavAlbum' : 'CancelFavAlbum', { v_albumId: [Number(alIds[mid])] });
  },
  async setCookie(text) {
    const get = (k) => { const m = new RegExp('(?:^|[;\\s])' + k + '=([^;\\s]+)').exec(text || ''); return m ? m[1] : ''; };
    const uin = Number((get('uin') || get('qqmusic_uin') || '').replace(/^[o0]+/i, ''));
    const key = get('qm_keyst') || get('qqmusic_key') || '';
    const type = Number(get('tmeLoginType') || (key.startsWith('W_X') ? 1 : 2));
    if (!uin || !key) throw new Error('Cookie 里需要包含 uin 和 qm_keyst（或 qqmusic_key）');
    await finish({ musicid: uin, musickey: key }, type);
    return { state: 'done' };
  },
  async logout() { nk.store.set('cred', null); },

  /** 登录方式：网页登录（内嵌 QQ 互联页，手机上能一键拉起手机 QQ）、QQ 扫码、微信扫码 */
  loginModes() { return [{ id: 'web', name: 'QQ 登录', web: true }, { id: 'qq', name: 'QQ 扫码' }, { id: 'wx', name: '微信扫码' }]; },

  /** 扫码登录第一步：返回二维码图片（base64）和查询用的 key */
  async loginQr(mode) {
    if (mode === 'wx') {
      const page = await req('https://open.weixin.qq.com/connect/qrconnect?' + qs({ appid: WX_APPID, redirect_uri: REDIRECT + '?login_type=2&surl=https://y.qq.com/', response_type: 'code', scope: 'snsapi_login', state: 'STATE', href: 'https://y.qq.com/mediastyle/music_v17/src/css/popup_wechat.css#wechat_redirect' }));
      const m = /uuid=(.+?)"/.exec(page.body); if (!m) throw new Error('获取微信二维码失败');
      const img = await req('https://open.weixin.qq.com/connect/qrcode/' + m[1], { binary: true, referer: 'https://open.weixin.qq.com/connect/qrconnect' });
      return { image: img.bodyBase64, key: 'wx:' + m[1], hint: '用微信扫码，并在手机上点确认', poll: 300, saveApp: 'weixin://dl/scan', saveAppName: '微信' };
    }
    jar = {};
    await req('https://xui.ptlogin2.qq.com/cgi-bin/xlogin?' + qs({ appid: '716027609', daid: '383', style: '33', login_text: '登录', hide_title_bar: '1', hide_border: '1', target: 'self', s_url: U1, pt_3rd_aid: '100497308', theme: '2' }), { referer: 'https://graph.qq.com/' });
    const r = await req('https://xui.ptlogin2.qq.com/ssl/ptqrshow?' + qs({ appid: '716027609', e: '2', l: 'M', s: '3', d: '72', v: '4', t: String(Math.random()), daid: '383', pt_3rd_aid: '100497308', u1: U1 }), { binary: true });
    const key = jarGet('qrsig'); if (!key) throw new Error('获取 QQ 二维码失败');
    return { image: r.bodyBase64, key, hint: '用手机 QQ 扫码，并在手机上点确认' };
  },
  /** 扫码登录第二步：轮询状态 wait / scanned / done / expired / refused */
  async loginCheck(key) {
    if (key.startsWith('wx:')) {
      // 微信是长轮询：一次最多挂 30 秒
      let t = '';
      try { t = (await req('https://lp.open.weixin.qq.com/connect/l/qrconnect?uuid=' + key.slice(3) + '&_=' + Date.now(), { referer: 'https://open.weixin.qq.com/', timeout: 35 })).body; } catch (e) { return { state: 'wait' }; }
      const m = /window\.wx_errcode=(\d+);window\.wx_code='([^']*)'/.exec(t); if (!m) return { state: 'wait' };
      const st = qrState(Number(m[1])); if (st !== 'done') return { state: st };
      if (!m[2]) throw new Error('微信登录：获取 code 失败');
      await finish(await call('music.login.LoginServer', 'Login', { code: m[2], strAppid: WX_APPID }, { tmeLoginType: 1 }), 1);
      return { state: 'done' };
    }
    const pr = (await req('https://xui.ptlogin2.qq.com/ssl/ptqrlogin?' + qs({ u1: U1, ptqrtoken: hash33(key), ptredirect: '0', h: '1', t: '1', g: '1', from_ui: '1', ptlang: '2052', action: '0-0-' + Date.now(), js_ver: '25100115', js_type: '1', login_sig: jarGet('pt_login_sig') || '', pt_uistyle: '40', aid: '716027609', daid: '383', pt_3rd_aid: '100497308', o1vId: '', pt_js_version: 'v1.0.0' })));
    const t = pr.body;
    const m = /ptuiCB\((.*?)\)/.exec(t); if (!m) return { state: 'wait', message: pr.status !== 200 ? 'QQ 返回 HTTP ' + pr.status + '，还在重试' : undefined };
    const args = (m[1].match(/'((?:\\.|[^'])*)'/g) || []).map(x => x.slice(1, -1));
    const code = Number(args[0]);
    const st = qrState(code); if (st !== 'done') return { state: st };
    // 确认了：check_sig 拿 p_skey → authorize 拿 code → 换 QQ 音乐凭证
    let r = await req(args[2]);
    for (let i = 0; !jarGet('p_skey') && r.header('location') && i < 4; i++) r = await req(r.header('location'));
    const pskey = jarGet('p_skey', 'graph.qq.com') || jarGet('p_skey');
    if (!pskey) throw new Error('QQ 登录：获取 p_skey 失败');
    const a = await req('https://graph.qq.com/oauth2.0/authorize', { referer: 'https://graph.qq.com/', form: {
      response_type: 'code', client_id: '100497308', redirect_uri: REDIRECT + '?login_type=1&surl=https://y.qq.com/', scope: '', state: 'state', switch: '',
      from_ptlogin: '1', src: '1', update_auth: '1', openapi: '1010', g_tk: String(hash33(pskey, 5381)), auth_time: String(Date.now()),
      ui: Array.from({ length: 32 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('') } });
    const cm = /[?&]code=([^&]+)/.exec(a.header('location') || ''); if (!cm) throw new Error('QQ 登录：获取 code 失败');
    jar = {};
    await finish(await call('QQConnectLogin.LoginServer', 'QQLogin', { code: cm[1] }, { tmeLoginType: 2 }), 2);
    return { state: 'done' };
  },

  // ---------- 网页登录 ----------
  /** done：网页跳到这里就算登录完成；open：这些地址交给系统打开（拉起手机 QQ） */
  loginWeb(env) {
    const pc = !!(env && env.desktop);
    const q = qs({ response_type: 'code', client_id: '100497308', redirect_uri: REDIRECT + '?login_type=1&surl=https://y.qq.com/', state: 'state', display: pc ? 'pc' : 'mobile' });
    return { url: 'https://graph.qq.com/oauth2.0/' + (pc ? 'show?which=Login&' : 'authorize?') + q, pc,
      done: '^https://y\\.qq\\.com/portal/wx_redirect\\.html', open: '^wtloginmqq',
      hint: pc ? '用手机 QQ 扫码，或者电脑上已经登录了 QQ 时直接点头像快捷登录' : '在下面登录 QQ；点「一键登录」会跳到手机 QQ，确认后自动回来' };
  },
  async loginWebDone(url) {
    const m = /[?&]code=([^&#]+)/.exec(url); if (!m) throw new Error('没有拿到登录 code');
    await finish(await call('QQConnectLogin.LoginServer', 'QQLogin', { code: m[1] }, { tmeLoginType: 2 }), 2);
    return { state: 'done' };
  },
  /** 拉起手机 QQ 前改写地址：带上本 App 的包名和回跳 scheme */
  loginWebOpen(u, app) {
    let r = u;
    const m = /([?&]p=)([^&]*)/.exec(r);
    if (m) {
      let inner = decodeURIComponent(m[2]);
      const key = app.ios ? 'pt_bundleid' : 'pt_package';
      if (inner.indexOf(key + '=') < 0) inner += '&' + key + '=' + app.id;
      r = r.slice(0, m.index + m[1].length) + encodeURIComponent(inner) + r.slice(m.index + m[0].length);
    }
    const cb = 'schemacallback=' + encodeURIComponent(app.scheme);
    return /[?&]schemacallback=/.test(r) ? r.replace(/schemacallback=[^&]*/, cb) : r + '&' + cb;
  },
  /** 手机 QQ 跳回来的 nekoplay://… 里取出要继续加载的网页 */
  loginWebBack(cb) {
    const r = cb.replace(/^[a-z]+:\/\//, '').replace(/\(null\)/g, '');
    if (/^https?:\/\//.test(r)) return r;
    const i = r.indexOf('http'); if (i < 0) return null;
    let u = r.slice(i);
    if (/^https?%3A/i.test(u)) u = decodeURIComponent(u);
    return u;
  },
});
