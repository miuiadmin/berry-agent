---
name: plugins-quickstart
description: 插件快速上手——最小骨架（package.json 清单 + 入口文件）、清单键白名单、装机双路（CLI 与 TUI 分立）、装后三色体检；完整面指路插件开发文档。
---

# plugins-quickstart（插件快速上手）

一切能力以**插件**装载。本技能给出从零到一个可装机插件的最短路径：
最小骨架 → 零装机试跑 → 正式装机 → 装后体检。

## 最小骨架（三件套）

一个代码插件 = 包目录内两文件：

`package.json`（清单——声明入口与 API 下限）：

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "license": "MIT",
  "keywords": ["berry-agent-plugin"],
  "berryAgent": {
    "api": { "minApiVersion": "1.0" },
    "entry": "entry.js"
  }
}
```

`entry.js`（入口——default export 的 async 函数）：

```js
// 硬依赖声明（零依赖保留空数组示形）
export const inject = [];

export default async (ctx) => {
  // ctx.effect 正形：注册记入插件作用域，换代/unmount 自动撤注
  ctx.effect(() =>
    ctx.channels.registerCommand(
      'my-hello',
      (args) => ctx.ui.notify(`应答：${args.raw}`),
      '/my-hello [任意文本]——示例命令',
    ),
  );
};
```

零代码形（纯技能包）：无 `entry`，改声明 `"skills": ["skills"]`——包内
`skills/` 目录整包为技能载荷，包主入口不执行。

**清单键白名单**：`berryAgent` 下是闭集——`id` / `label` / `entry` /
`grants` / `config` / `configSchema` / `api` / `skills` / `agents`，
未知键拒载（fail-closed）。`keywords` 带 `berry-agent-plugin` 便于生态检索。

## 装机双路（CLI 与 TUI 各司其职）

**试跑（零装机）**——装载计划纯内存注入，退出即消失：

```bash
berry --plugin-file ./my-plugin          # 目录或单文件均可
```

**装机走 CLI**（install / uninstall / update 全在命令面）：

```bash
berry plugins install local:$(pwd)/my-plugin   # 本地绝对路径
berry plugins install npm:<包名>[@<版本>]        # npm 源
berry plugins install git:<url>[#<ref>]         # git 源
berry plugins uninstall my-plugin --confirm     # 卸载双相确认
```

**TUI 面板（`/plugins`）**只管运行面：list / mount / unmount / toggle /
config——install 与 uninstall 不在面板内。生命周期动词统一
install / uninstall / mount / unmount / toggle / update。

## 装后验证（三色体检）

```bash
berry plugins check
```

逐插件输出绿（装载健康）/ 黄（可运行但有警告）/ 红（拒载——附原因）。
装完必跑一次；红件按原因修清单或入口，不改宿主。

## 深入

完整能力面（工具/提示词段/钩子/触发器/凭证代管/ctx 能力面表/回卷律）
见仓库文档 `docs/plugin-development.md`：
<https://github.com/miuiadmin/berry-agent/blob/main/docs/plugin-development.md>
