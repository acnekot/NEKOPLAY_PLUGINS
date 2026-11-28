#!/usr/bin/env python3
"""按每个插件开头的 // @key value 生成 index.json（插件订阅列表）。改了插件版本号后跑一下。

详情页字段：
  // @details 一段介绍（可写多行，每行一段）
  // @screenshots screenshots/xxx-1.jpg, screenshots/xxx-2.jpg（相对本仓库根目录）
"""
import json, os, re
here = os.path.dirname(os.path.abspath(__file__))
items = []
for f in sorted(os.listdir(here)):
    if not f.endswith('.js'):
        continue
    meta, details = {}, []
    for line in open(os.path.join(here, f), encoding='utf-8').read().splitlines()[:80]:
        m = re.match(r'^\s*//\s*@(\w+)\s+(.*?)\s*$', line)
        if not m:
            continue
        if m.group(1) == 'details':
            details.append(m.group(2))
        else:
            meta.setdefault(m.group(1), m.group(2))
    if 'id' not in meta:
        continue
    meta.setdefault('type', 'source')
    it = {k: meta[k] for k in ('id', 'name', 'type', 'version', 'author', 'desc', 'minHost', 'permissions') if k in meta} | {'url': f}
    if details:
        it['details'] = '\n'.join(details)
    shots = [s.strip() for s in meta.get('screenshots', '').split(',') if s.strip()]
    for s in shots:
        if not s.startswith('http') and not os.path.exists(os.path.join(here, s)):
            raise SystemExit(f'{f}: 展示图不存在 {s}')
    if shots:
        it['screenshots'] = shots
    items.append(it)
json.dump({'name': 'NEKOPLAY 官方插件', 'plugins': items}, open(os.path.join(here, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f'{len(items)} 个插件写入 index.json')
