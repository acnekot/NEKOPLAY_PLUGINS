# NEKOPLAY Plugins

NEKOPLAY 官方插件订阅仓库（包含音源插件 `source` 与功能扩展插件 `feature`）。

## 订阅地址

在 NEKOPLAY 的「插件中心 → 订阅管理」中已默认内置官方订阅；如需手动添加，可使用以下地址：

```text
https://raw.githubusercontent.com/acnekot/NEKOPLAY_PLUGINS/main/index.json
```

如直连不稳定，客户端会自动回退至 jsDelivr 镜像：

```text
https://cdn.jsdelivr.net/gh/acnekot/NEKOPLAY_PLUGINS@main/index.json
```

## 插件开发与更新规范

1. 每个插件为根目录下的单个 `.js` 文件，文件头需包含元信息注释：
   - `// @id <唯一标识>`
   - `// @name <显示名称>`
   - `// @type source | feature`（省略默认 `source`）
   - `// @feature <槽位名>`（`feature` 类型必填）
   - `// @version <语义化版本号>`
   - `// @author <作者>`
   - `// @desc <简介>`
   - `// @api 1`
2. 音源插件通过 `nk.register({...})` 注册，功能插件通过 `nk.registerFeature({...})` 注册。
3. 修改脚本或版本号后，务必执行以下命令刷新订阅索引：

```bash
python3 gen-index.py
```

## 免责声明

本仓库内的脚本仅用于演示 NEKOPLAY 插件接口规范，不隶属于任何第三方服务，亦不提供任何音频文件的托管或分发。
