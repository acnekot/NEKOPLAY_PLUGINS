#!/usr/bin/env python3
"""按每个插件开头的 // @key value 生成 index.json（插件订阅列表）。改了插件版本号后跑一下。"""
import json, os, re
here = os.path.dirname(os.path.abspath(__file__))
items = []
for f in sorted(os.listdir(here)):
    if not f.endswith('.js'):
        continue
    meta = {}
    for line in open(os.path.join(here, f), encoding='utf-8').read().splitlines()[:40]:
        m = re.match(r'^\s*//\s*@(\w+)\s+(.*?)\s*$', line)
        if m:
            meta.setdefault(m.group(1), m.group(2))
    if 'id' not in meta:
        continue
    meta.setdefault('type', 'source')
    items.append({k: meta[k] for k in ('id', 'name', 'type', 'version', 'author', 'desc') if k in meta} | {'url': f})
json.dump({'name': 'NEKOPLAY 官方插件', 'plugins': items}, open(os.path.join(here, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f'{len(items)} 个插件写入 index.json')
