#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const files = fs.readdirSync(root).filter((f) => f.endsWith('.js')).sort();
if (!files.length) throw new Error('No .js plugin files found');

const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
const byId = new Map((index.plugins || []).map((p) => [p.id, p]));

let checked = 0;
for (const file of files) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const meta = {};
  for (const line of src.split(/\r?\n/).slice(0, 40)) {
    const m = line.match(/^\s*\/\/\s*@(\w+)\s+(.*?)\s*$/);
    if (m && !(m[1] in meta)) meta[m[1]] = m[2];
  }
  const stem = file.replace(/\.js$/, '');
  if (!meta.id || meta.id !== stem) throw new Error(`${file}: @id (${meta.id}) must match filename (${stem})`);
  if (!meta.name) throw new Error(`${file}: missing @name`);
  if (!/^\d+\.\d+\.\d+$/.test(meta.version || '')) throw new Error(`${file}: invalid semver @version (${meta.version})`);
  const type = (meta.type || 'source').toLowerCase();

  const entry = byId.get(meta.id);
  if (!entry) throw new Error(`${file}: missing from index.json`);
  if (entry.version !== meta.version) throw new Error(`${file}: index.json version mismatch (${entry.version} != ${meta.version})`);

  const store = new Map();
  let reg = null;
  let regKind = null;
  const nk = {
    http: async () => { throw new Error('Network disabled in CI smoke test'); },
    md5: () => 'd41d8cd98f00b204e9800998ecf8427e',
    md5Base64: () => 'd41d8cd98f00b204e9800998ecf8427e',
    aes: () => '',
    base64: { encode: (s) => Buffer.from(String(s)).toString('base64'), decode: (s) => Buffer.from(String(s), 'base64').toString('utf8') },
    store: {
      get: (k) => (store.has(String(k)) ? JSON.parse(store.get(String(k))) : null),
      set: (k, v) => { if (v === undefined || v === null) store.delete(String(k)); else store.set(String(k), JSON.stringify(v)); },
    },
    log: () => {},
    register: (o) => { reg = o; regKind = 'source'; },
    registerFeature: (o) => { reg = o; regKind = 'feature'; },
    registerPage: (o) => { reg = o; regKind = 'page'; },
    registerMotion: (o) => { reg = o; regKind = 'motion'; },
    host: { version: '0.6.8', platform: 'desktop', lang: 'zh-CN' },
  };
  const ctx = vm.createContext({ nk, console: { log: () => {}, warn: () => {}, error: () => {} } });
  vm.runInContext(src, ctx, { filename: file, timeout: 3000 });

  if (!reg || typeof reg !== 'object') throw new Error(`${file}: did not call nk.register*`);
  const fns = Object.keys(reg).filter((k) => typeof reg[k] === 'function');
  if (!fns.length) throw new Error(`${file}: registered object exports no functions`);

  if (type === 'source') {
    if (!fns.includes('search') || !fns.includes('stream')) {
      throw new Error(`${file}: @type source must export search() and stream()`);
    }
  } else if (type === 'motion') {
    if (!fns.includes('profile')) throw new Error(`${file}: @type motion must export profile()`);
    const prof = await reg.profile();
    if (!prof || typeof prof !== 'object' || !prof.name) throw new Error(`${file}: profile() must return object with name`);
  } else if (type === 'page') {
    if (!fns.includes('render')) throw new Error(`${file}: @type page must export render()`);
    const tree = await reg.render({ hostVersion: '0.6.8', platform: 'desktop', lang: 'zh-CN', wide: true, landscape: false, playing: false, playlistCount: 0, recentCount: 0 });
    if (!tree || typeof tree !== 'object') throw new Error(`${file}: render() must return declarative node object`);
  } else if (type === 'feature') {
    if (fns.includes('config')) {
      const cfg = await reg.config();
      if (!cfg || typeof cfg !== 'object') throw new Error(`${file}: config() must return object`);
    }
  }
  console.log(`OK  ${file.padEnd(20)} type=${type.padEnd(8)} reg=${regKind.padEnd(8)} v${meta.version} (${fns.length} exports)`);
  checked++;
}

if (checked !== (index.plugins || []).length) {
  throw new Error(`Plugin count mismatch: ${checked} files vs ${(index.plugins || []).length} in index.json`);
}
console.log(`ALL ${checked} PLUGINS PASSED SMOKE TEST`);
