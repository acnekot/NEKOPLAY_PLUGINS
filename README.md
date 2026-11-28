# NEKOPLAY Plugins

NEKOPLAY 官方插件订阅仓库（包含音源 `source`、功能扩展 `feature`、声明式页面 `page` 与动效引擎 `motion` 插件），本仓库采用 **MIT License** 开源（详见 [LICENSE](LICENSE)）。

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
   - `// @type source | feature | page | motion`（省略默认 `source`）
   - `// @feature <槽位名>`（`feature` 类型必填）
   - `// @version <语义化版本号>`
   - `// @minHost <最低宿主版本>`（可选，如 `0.6.8`）
   - `// @permissions <权限列表>`（可选，如 `network, storage, player.control`）
   - `// @author <作者>`
   - `// @desc <简介>`
   - `// @api 1 | 2 | 3`（新插件请用 3，接口说明见本体仓库 `docs/plugin-api.md`）
   - `// @background true`（可选，常驻插件：App 启动时就运行，用于定时任务）
2. 注册入口：音源插件使用 `nk.register({...})`，功能插件使用 `nk.registerFeature({...})`，页面插件使用 `nk.registerPage({...})`，动效插件使用 `nk.registerMotion({...})`。
3. 修改脚本或版本号后，务必执行以下命令刷新订阅索引：

```bash
python3 gen-index.py
```

## 许可与免责声明

本仓库内的插件脚本按 MIT 协议开源，与 NEKOPLAY 主程序相互独立；脚本仅用于演示 NEKOPLAY 插件接口规范，不隶属于任何第三方服务，亦不提供任何音频文件的托管或分发。
