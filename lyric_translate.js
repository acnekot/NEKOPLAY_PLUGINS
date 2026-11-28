// @id lyric_translate
// @name 歌词翻译
// @type feature
// @feature lyric-translate
// @version 1.0.0
// @minHost 0.6.9
// @permissions network, storage, lan
// @author NEKOPLAY
// @desc 没有译文的外语歌词自动翻译成你的语言：可接入大模型逐句意译（Claude、DeepSeek、通义千问、Kimi、智谱、Gemini、OpenRouter、本地 Ollama 等 OpenAI 兼容接口），也可用免 Key 的机器翻译；译文按歌词缓存在本地
// @api 2

/* ---------------- 配置 ---------------- */

const DEFAULTS = {
  engine: 'mymemory',    // mymemory | google | claude | openai
  target: 'auto',        // auto（跟随界面语言）| zh-CN | zh-TW | en | ja | ko
  mode: 'missing',       // missing：原歌词没译文才翻 | always：用插件译文替换
  claude: { apiKey: '', model: 'claude-opus-5-5', baseUrl: 'https://api.anthropic.com' },
  openai: { preset: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat' },
};

const ENGINES = {
  mymemory: '免费 · MyMemory',
  google: '免费 · 谷歌翻译',
  claude: 'Claude',
  openai: 'OpenAI 兼容大模型',
};

/** OpenAI 兼容接口的常用预设（模型名可以在设置里随时改） */
const PRESETS = [
  { key: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { key: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { key: 'kimi', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { key: 'glm', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { key: 'silicon', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
  { key: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { key: 'gemini', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  { key: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { key: 'ollama', label: '本地 Ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
];

const LANGS = {
  'zh-CN': { name: '简体中文', google: 'zh-CN', base: 'zh' },
  'zh-TW': { name: '繁體中文', google: 'zh-TW', base: 'zh' },
  en: { name: 'English', google: 'en', base: 'en' },
  ja: { name: '日本語', google: 'ja', base: 'ja' },
  ko: { name: '한국어', google: 'ko', base: 'ko' },
};

function cfg() {
  const s = nk.store.get('cfg') || {};
  return Object.assign({}, DEFAULTS, s, {
    claude: Object.assign({}, DEFAULTS.claude, s.claude || {}),
    openai: Object.assign({}, DEFAULTS.openai, s.openai || {}),
  });
}
function save(c) { nk.store.set('cfg', c); }

function targetOf(c) {
  if (c.target !== 'auto' && LANGS[c.target]) return c.target;
  const l = String((nk.host && nk.host.lang) || 'zh-CN').toLowerCase();
  if (l.startsWith('zh')) return /tw|hk|hant|mo/.test(l) ? 'zh-TW' : 'zh-CN';
  if (l.startsWith('ja')) return 'ja';
  if (l.startsWith('ko')) return 'ko';
  if (l.startsWith('en')) return 'en';
  return 'zh-CN';
}

/** 引擎签名：换引擎 / 模型后不复用旧译文 */
function engineSig(c) {
  if (c.engine === 'claude') return 'claude:' + c.claude.model;
  if (c.engine === 'openai') return 'openai:' + c.openai.baseUrl + ':' + c.openai.model;
  return c.engine;
}

/* ---------------- 歌词解析 ---------------- */

const TS = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

function parseLrc(s) {
  const out = [];
  String(s || '').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    const tags = [...line.matchAll(TS)];
    if (!tags.length) return;
    const last = tags[tags.length - 1];
    const text = line.slice(last.index + last[0].length).trim();
    tags.forEach((m) => {
      const f = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      out.push({ t: parseInt(m[1], 10) * 60000 + parseInt(m[2], 10) * 1000 + f, text });
    });
  });
  return out.sort((a, b) => a.t - b.t);
}

/** 逐字歌词：[行开始,行时长](字开始,字时长,0)字… */
function parseYrc(s) {
  const out = [];
  String(s || '').split(/\r?\n/).forEach((raw) => {
    const m = raw.trim().match(/^\[(\d+),(\d+)\](.*)$/);
    if (!m) return;
    const text = m[3].replace(/\(\d+,\d+,-?\d+\)/g, '').trim();
    if (text) out.push({ t: parseInt(m[1], 10), text });
  });
  return out;
}

function tag(ms) {
  const mm = Math.floor(ms / 60000), ss = Math.floor((ms % 60000) / 1000), x = ms % 1000;
  return '[' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0') + '.' + String(x).padStart(3, '0') + ']';
}

/* ---------------- 语言判断 ---------------- */

const RE_KANA = /[぀-ヿㇰ-ㇿ]/g;
const RE_HANGUL = /[가-힯ᄀ-ᇿ]/g;
const RE_HAN = /[㐀-鿿]/g;
const RE_LATIN = /[A-Za-zÀ-ɏ]/g;
const cnt = (s, re) => (s.match(re) || []).length;

/** 作词 / 作曲 / 编曲之类的制作信息行不翻 */
const RE_CREDIT = /^\s*(作词|作詞|作曲|编曲|編曲|词|詞|曲|制作人|製作人|制作|監製|监制|混音|母带|录音|錄音|和声|和聲|吉他|贝斯|貝斯|鼓|弦乐|出品|发行|發行|演唱|原唱|翻唱|lyrics?|lyricist|composer|composed|arranger|arranged|producer|produced|mix(ed|ing)?|master(ed|ing)?|vocals?|op|sp)\s*(by)?\s*[:：]/i;

function songLang(lines) {
  let kana = 0, hangul = 0, han = 0, latin = 0;
  lines.forEach(({ text }) => { kana += cnt(text, RE_KANA); hangul += cnt(text, RE_HANGUL); han += cnt(text, RE_HAN); latin += cnt(text, RE_LATIN); });
  const total = kana + hangul + han + latin || 1;
  if (kana / total > 0.05) return 'ja';
  if (hangul / total > 0.2) return 'ko';
  if (latin > han * 2) return 'en';
  if (han > 0) return 'zh';
  return 'other';
}

function needsTranslate(text, song, tgtBase) {
  if (!text || RE_CREDIT.test(text)) return false;
  const kana = cnt(text, RE_KANA), hangul = cnt(text, RE_HANGUL), han = cnt(text, RE_HAN), latin = cnt(text, RE_LATIN);
  if (kana + hangul + han + latin === 0) return false; // 纯符号 / ♪
  if (tgtBase === 'zh') return !(han > 0 && kana === 0 && hangul === 0 && latin === 0 && song !== 'ja');
  if (tgtBase === 'en') return kana + hangul + han > 0;
  if (tgtBase === 'ja') return !(kana > 0 && hangul === 0 && latin === 0);
  if (tgtBase === 'ko') return !(hangul > 0 && han === 0 && kana === 0);
  return true;
}

/* ---------------- 翻译引擎 ---------------- */

function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

function httpErr(r, who) {
  let msg = '';
  try { const j = r.json(); msg = (j.error && (j.error.message || j.error)) || j.message || ''; } catch (_) { msg = String(r.body || '').slice(0, 120); }
  if (r.status === 401 || r.status === 403) return new Error(who + ' 鉴权失败（' + r.status + '），请检查 API Key' + (msg ? '：' + msg : ''));
  if (r.status === 429) return new Error(who + ' 请求太频繁或额度用完（429）' + (msg ? '：' + msg : ''));
  return new Error(who + ' 返回 ' + r.status + (msg ? '：' + msg : ''));
}

/** MyMemory 官方免费接口：匿名每天约 5000 字符；一批用换行拼起来（不超过 450 字），回来按换行拆 */
async function viaMyMemory(texts, tgt) {
  const out = [];
  let batch = [], len = 0;
  const flush = async () => {
    if (!batch.length) return;
    const q = batch.join('\n');
    const r = await nk.http({ url: 'https://api.mymemory.translated.net/get?langpair=' + encodeURIComponent('autodetect|' + LANGS[tgt].google) + '&q=' + encodeURIComponent(q), timeout: 20 });
    if (r.status !== 200) throw httpErr(r, 'MyMemory');
    const j = r.json();
    if (j.quotaFinished) throw new Error('MyMemory 今天的免费额度用完了，明天再试或改用大模型');
    if (String(j.responseStatus) !== '200') throw new Error('MyMemory：' + (j.responseDetails || j.responseStatus));
    const lines = String((j.responseData && j.responseData.translatedText) || '').split('\n');
    if (lines.length !== batch.length) throw new Error('MyMemory 返回的行数对不上（' + lines.length + ' / ' + batch.length + '）');
    lines.forEach((l) => out.push(l.trim()));
    batch = []; len = 0;
  };
  for (const t of texts) {
    if (batch.length && len + t.length > 450) await flush();
    batch.push(t.replace(/\n/g, ' ')); len += t.length + 1;
  }
  await flush();
  return out;
}

async function viaGoogle(texts, tgt) {
  const out = [];
  // 按字数分批，一批里用换行拼起来，回来再按换行拆
  let batch = [], len = 0;
  const flush = async () => {
    if (!batch.length) return;
    const r = await nk.http({
      url: 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=' + LANGS[tgt].google,
      method: 'POST', timeout: 20, form: { q: batch.join('\n') },
    });
    if (r.status !== 200) throw httpErr(r, '谷歌翻译');
    const segs = (r.json()[0] || []).map((s) => (s && s[0]) || '').join('');
    const lines = segs.split('\n');
    if (lines.length !== batch.length) throw new Error('谷歌翻译返回的行数对不上（' + lines.length + ' / ' + batch.length + '）');
    lines.forEach((l) => out.push(l.trim()));
    batch = []; len = 0;
  };
  for (const t of texts) {
    if (batch.length && len + t.length > 1800) await flush();
    batch.push(t.replace(/\n/g, ' ')); len += t.length + 1;
  }
  await flush();
  return out;
}

function prompt(texts, tgt, track) {
  const song = track && track.title ? '《' + track.title + '》' + (track.artist ? ' — ' + track.artist : '') : '';
  const system = '你是专业的歌词译者。把用户给的歌词逐行翻译成' + LANGS[tgt].name + '。' +
    '要求：结合整首歌的情绪与上下文意译，自然、有韵味，像正式发行的译配歌词，不要逐词硬译；' +
    '每一行单独对应一行译文，行数和顺序必须与原文完全一致，不合并、不拆分、不省略；' +
    '人名、品牌等专有名词可保留原文；已经是' + LANGS[tgt].name + '的行原样返回。' +
    '只输出 JSON 对象 {"t": [译文1, 译文2, ...]}，不要任何解释或 Markdown。';
  const user = (song ? '歌曲：' + song + '\n' : '') + '共 ' + texts.length + ' 行，原文（JSON 数组）：\n' + JSON.stringify(texts);
  return { system, user };
}

function parseLlm(text, n) {
  const s = String(text || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  let arr = null;
  if (a >= 0 && b > a) { try { arr = JSON.parse(s.slice(a, b + 1)).t; } catch (_) { arr = null; } }
  if (!Array.isArray(arr)) { const x = s.indexOf('['), y = s.lastIndexOf(']'); if (x >= 0 && y > x) { try { arr = JSON.parse(s.slice(x, y + 1)); } catch (_) { arr = null; } } }
  if (!Array.isArray(arr)) throw new Error('模型没有按格式返回译文');
  if (arr.length !== n) throw new Error('模型返回的行数对不上（' + arr.length + ' / ' + n + '）');
  return arr.map((x) => String(x == null ? '' : x).trim());
}

/** Claude：Messages API（沙箱里没有 SDK，直接走 HTTP） */
async function viaClaude(texts, tgt, track, c) {
  const k = c.claude;
  if (!k.apiKey) throw new Error('还没有填写 Claude API Key');
  const model = k.model || DEFAULTS.claude.model;
  const modern = /^claude-(opus-5|sonnet-5-5|fable-5|haiku-5-5)/.test(model);
  const withFallback = /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model);
  const run = async (part) => {
    const p = prompt(part, tgt, track);
    const body = { model, max_tokens: 16000, system: p.system, messages: [{ role: 'user', content: p.user }] };
    if (modern) body.output_config = { effort: 'low' }; // 翻译是简单任务，低思考强度更快更省
    if (withFallback) body.fallbacks = 'default';
    const headers = { 'x-api-key': k.apiKey, 'anthropic-version': '2026-10-21' };
    if (withFallback) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    const r = await nk.http({ url: (k.baseUrl || DEFAULTS.claude.baseUrl).replace(/\/+$/, '') + '/v1/messages', method: 'POST', timeout: 110, headers, json: body });
    if (r.status !== 200) throw httpErr(r, 'Claude');
    const j = r.json();
    if (j.stop_reason === 'refusal') throw new Error('Claude 拒绝翻译这段歌词');
    if (j.stop_reason === 'max_tokens') throw new Error('Claude 输出被截断');
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return parseLlm(text, part.length);
  };
  return (await Promise.all(chunk(texts, 80).map((part) => retry1(() => run(part))))).flat();
}

/** OpenAI 兼容：/chat/completions（DeepSeek / 通义 / Kimi / 智谱 / Gemini / OpenRouter / Ollama …） */
async function viaOpenAI(texts, tgt, track, c) {
  const o = c.openai;
  const base = String(o.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('还没有填写接口地址（Base URL）');
  const local = /^https?:\/\/(localhost|127\.|192\.168\.|10\.)/.test(base);
  if (!o.apiKey && !local) throw new Error('还没有填写 API Key');
  const run = async (part) => {
    const p = prompt(part, tgt, track);
    const headers = {};
    if (o.apiKey) headers.Authorization = 'Bearer ' + o.apiKey;
    const r = await nk.http({
      url: base + '/chat/completions', method: 'POST', timeout: 110, headers,
      json: { model: o.model, temperature: 0.3, messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }] },
    });
    if (r.status !== 200) throw httpErr(r, o.model || '模型');
    const j = r.json();
    const msg = j.choices && j.choices[0] && j.choices[0].message;
    return parseLlm(msg && msg.content, part.length);
  };
  return (await Promise.all(chunk(texts, 60).map((part) => retry1(() => run(part))))).flat();
}

/** 大模型偶尔不按格式或少一行：同一批重试一次 */
async function retry1(fn) { try { return await fn(); } catch (e) { if (/格式|行数/.test(String(e && e.message))) return fn(); throw e; } }

async function translate(texts, tgt, track, c) {
  switch (c.engine) {
    case 'claude': return viaClaude(texts, tgt, track, c);
    case 'openai': return viaOpenAI(texts, tgt, track, c);
    case 'google': return viaGoogle(texts, tgt);
    default: return viaMyMemory(texts, tgt);
  }
}

/* ---------------- 缓存（最多 300 首） ---------------- */

const CACHE_MAX = 300;
function cacheGet(key) { return nk.store.get('c:' + key); }
function cachePut(key, map) {
  nk.store.set('c:' + key, map);
  const idx = (nk.store.get('cidx') || []).filter((k) => k !== key);
  idx.push(key);
  while (idx.length > CACHE_MAX) nk.store.set('c:' + idx.shift(), null);
  nk.store.set('cidx', idx);
}
function cacheClear() {
  (nk.store.get('cidx') || []).forEach((k) => nk.store.set('c:' + k, null));
  nk.store.set('cidx', []);
}

function setStatus(s) { nk.store.set('status', Object.assign({ at: Date.now() }, s)); }

/* ---------------- 设置页 ---------------- */

const mask = (k) => (k ? k.slice(0, 4) + '••••' + k.slice(-4) : '未填写');
const btn = (text, action, payload, primary, input) => Object.assign({ type: 'button', text, action, payload: payload || {}, primary: !!primary }, input ? { input } : {});
const section = (title, children, note) => ({ type: 'card', gap: 10, children: [{ type: 'text', text: title, size: 14, weight: 700 }].concat(note ? [{ type: 'text', text: note, size: 11, tone: 'sub' }] : [], children) });

function statusNode() {
  const s = nk.store.get('status');
  if (!s) return { type: 'text', text: '还没有翻译过歌词。打开一首外语歌的歌词页就会自动翻译。', size: 12, tone: 'sub' };
  const when = new Date(s.at);
  const hm = String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0');
  if (s.err) return { type: 'text', text: hm + ' 《' + (s.title || '未知') + '》翻译失败：' + s.err, size: 12, tone: 'bad', lines: 4 };
  return { type: 'text', text: hm + ' 《' + (s.title || '未知') + '》' + (s.cached ? '用了缓存的译文' : '翻译了 ' + s.n + ' 句，用时 ' + (s.ms / 1000).toFixed(1) + ' 秒') + ' · ' + s.engine, size: 12, tone: 'primary', lines: 3 };
}

function engineNodes(c) {
  if (c.engine === 'claude') {
    return [section('Claude', [
      { type: 'text', text: '模型：' + c.claude.model + '\nAPI Key：' + mask(c.claude.apiKey), size: 12, mono: true },
      { type: 'row', gap: 8, children: [
        btn('填写 API Key', 'set', { path: 'claude.apiKey' }, !c.claude.apiKey, { title: 'Claude API Key', hint: 'sk-ant-…（只保存在本机）' }),
        btn('更换模型', 'set', { path: 'claude.model' }, false, { title: '模型 ID', hint: '如 claude-opus-5-5、claude-sonnet-5-5、claude-haiku-5-5' }),
      ] },
    ], '在 Anthropic Console 创建 API Key。默认用 Claude Opus 5.5，可换成更便宜的 Sonnet / Haiku。')];
  }
  if (c.engine === 'openai') {
    const o = c.openai;
    return [section('OpenAI 兼容接口', [
      { type: 'flow', gap: 8, children: PRESETS.map((p) => btn(p.label, 'preset', { key: p.key }, o.preset === p.key)) },
      { type: 'text', text: '地址：' + o.baseUrl + '\n模型：' + o.model + '\nAPI Key：' + mask(o.apiKey), size: 12, mono: true, lines: 4 },
      { type: 'row', gap: 8, children: [
        btn('填写 API Key', 'set', { path: 'openai.apiKey' }, !o.apiKey && o.preset !== 'ollama', { title: 'API Key', hint: '在对应平台控制台创建（只保存在本机）' }),
        btn('更换模型', 'set', { path: 'openai.model' }, false, { title: '模型名', hint: '平台文档里的模型 ID' }),
        btn('自定义地址', 'set', { path: 'openai.baseUrl', custom: true }, false, { title: 'Base URL', hint: '如 https://api.example.com/v1（不含 /chat/completions）' }),
      ] },
    ], '选一个平台预设后填 API Key 即可；任何兼容 OpenAI Chat Completions 的服务都能用。本地 Ollama 不需要 Key。')];
  }
  return [{ type: 'text', text: c.engine === 'google'
    ? '谷歌翻译免费接口：无需 Key，但属于非官方用法，国内网络连不上，海外也可能被限流。'
    : 'MyMemory 官方免费接口：无需 Key，国内可直连，但每天只有约 5000 字符（几首歌）的额度，译文是机器直译。想要自然的歌词译文请用大模型。', size: 11, tone: 'sub' }];
}

/* ---------------- 注册 ---------------- */

nk.registerFeature({
  manifest() { return { api: 2, type: 'feature', feature: 'lyric-translate' }; },
  config() { const c = cfg(); return { engine: c.engine, target: targetOf(c), mode: c.mode }; },

  /** 宿主歌词后处理管道：返回带 tr（译文 LRC）的歌词 */
  async transformLyric(track, lyric) {
    const c = cfg();
    if (lyric.tr && c.mode !== 'always') return lyric;
    const lines = lyric.yrc ? parseYrc(lyric.yrc) : parseLrc(lyric.lrc);
    if (!lines.length) return lyric;
    const tgt = targetOf(c), tgtBase = LANGS[tgt].base;
    const song = songLang(lines);
    if (song === tgtBase) return lyric;
    const todo = [...new Set(lines.map((l) => l.text).filter((t) => needsTranslate(t, song, tgtBase)))];
    if (!todo.length) return lyric;
    const title = (track && track.title) || '';
    const key = nk.md5(engineSig(c) + '|' + tgt + '|' + todo.join('\n'));
    let map = cacheGet(key), cached = !!map;
    const t0 = Date.now();
    if (!map) {
      try {
        const res = await translate(todo, tgt, track, c);
        map = {};
        todo.forEach((t, i) => { const v = res[i]; if (v && v !== t) map[t] = v; });
        if (Object.keys(map).length) cachePut(key, map);
      } catch (e) {
        setStatus({ title, err: String((e && e.message) || e) });
        return lyric;
      }
    }
    const tr = lines.filter((l) => map[l.text]).map((l) => tag(l.t) + map[l.text]).join('\n');
    setStatus({ title, n: Object.keys(map).length, ms: Date.now() - t0, cached, engine: ENGINES[c.engine] });
    if (!tr) return lyric;
    return { lrc: lyric.lrc, tr, yrc: lyric.yrc || '' };
  },

  render() {
    const c = cfg(), tgt = targetOf(c);
    return {
      type: 'column', gap: 14, children: [
        { type: 'tag', text: 'LYRIC TRANSLATE' },
        { type: 'text', text: '歌词翻译', size: 22, weight: 800 },
        { type: 'text', text: '外语歌没有译文时自动翻译，译文显示在原句下方（和自带翻译一样）。先出原文，译文好了再补上；同一首歌只翻一次。', size: 12, tone: 'sub' },
        { type: 'card', gap: 8, children: [{ type: 'text', text: '最近一次', size: 11, tone: 'sub', mono: true }, statusNode()] },
        section('翻译引擎', [{ type: 'flow', gap: 8, children: Object.keys(ENGINES).map((k) => btn(ENGINES[k], 'engine', { v: k }, c.engine === k)) }]),
      ].concat(engineNodes(c), [
        section('翻译成', [{ type: 'flow', gap: 8, children: [btn('跟随界面（' + LANGS[targetOf(Object.assign({}, c, { target: 'auto' }))].name + '）', 'target', { v: 'auto' }, c.target === 'auto')]
          .concat(Object.keys(LANGS).map((k) => btn(LANGS[k].name, 'target', { v: k }, c.target === k))) }],
          '和目标语言相同的歌（比如中文歌翻成中文）会自动跳过。当前：' + LANGS[tgt].name),
        section('原歌词自带翻译时', [{ type: 'row', gap: 8, children: [
          btn('保留自带翻译', 'mode', { v: 'missing' }, c.mode === 'missing'),
          btn('换成插件翻译', 'mode', { v: 'always' }, c.mode === 'always'),
        ] }]),
        { type: 'row', gap: 8, children: [btn('测试翻译', 'test', {}, true), btn('清除译文缓存', 'clear')] },
      ]),
    };
  },

  async onAction(action, p) {
    const c = cfg();
    const changed = (toast) => { save(c); return { toast, reloadLyrics: true }; };
    switch (action) {
      case 'engine': c.engine = p.v; return changed('已切换到「' + ENGINES[p.v] + '」，新打开的歌词生效');
      case 'target': c.target = p.v; return changed('翻译成：' + (p.v === 'auto' ? '跟随界面' : LANGS[p.v].name));
      case 'mode': c.mode = p.v; return changed(p.v === 'always' ? '自带翻译也会换成插件译文' : '优先保留歌曲自带的翻译');
      case 'preset': {
        const pr = PRESETS.find((x) => x.key === p.key); if (!pr) return {};
        c.openai = Object.assign({}, c.openai, { preset: pr.key, baseUrl: pr.baseUrl, model: pr.model });
        return changed('已选择 ' + pr.label + (pr.key === 'ollama' ? '（需本机运行 Ollama）' : '，记得填写 API Key'));
      }
      case 'set': {
        if (p.value === undefined) return { toast: '当前 NEKOPLAY 版本不支持在插件里输入，请更新到最新版', refresh: false };
        const v = String(p.value).trim();
        const [grp, field] = String(p.path).split('.');
        if (!c[grp] || !(field in DEFAULTS[grp])) return {};
        if (field === 'baseUrl' && v && !/^https?:\/\//.test(v)) return { toast: '地址要以 http:// 或 https:// 开头', refresh: false };
        c[grp][field] = v;
        if (p.custom) c[grp].preset = 'custom';
        return changed(field === 'apiKey' ? (v ? 'API Key 已保存在本机' : '已清空 API Key') : '已保存');
      }
      case 'clear': cacheClear(); return { toast: '已清除译文缓存', reloadLyrics: true };
      case 'test': {
        const tgt = targetOf(c);
        const sample = tgt.startsWith('zh') ? 'I still remember the night we danced under the city lights' : '街の灯りの下で踊ったあの夜を、今も覚えてる';
        const t0 = Date.now();
        try {
          const r = await translate([sample], tgt, { title: 'Test', artist: '' }, c);
          return { toast: '✓ ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒：' + (r[0] || '（空）'), refresh: false };
        } catch (e) {
          return { toast: '✗ ' + String((e && e.message) || e), refresh: false };
        }
      }
      default: return {};
    }
  },
});
