/**
 * 最小代码插件入口——「装得上、挂载得出」的最小完整形。
 *
 * 试跑（零装机——装载计划纯内存注入 `_quick_test` 行，退出即消失）：
 *
 *     berry-agent --plugin-file ./examples/minimal-code-plugin
 *
 * 装机（正式安装进数据目录——enabled.yaml + 装机账本两源落盘）：
 *
 *     berry-agent plugins install local:$(pwd)/examples/minimal-code-plugin
 *
 * 契约要点（03 篇 §1.2/§2.2）：
 * - 入口 = default export 的 async 函数（ctx = 插件上下文；返回清理函数即
 *   unmount disposer——本模板无资源可收，返回 undefined）；
 * - 硬依赖声明在 named export `inject`（数组空 = 零依赖）；软依赖在
 *   `optionalInject`（缺席注入 undefined——诚实降级不拒载）；
 * - 注册动词全部走 ctx 面（本模板只用 ctx.channels.registerCommand + ctx.ui.notify；
 *   工具/提示词段/钩子/触发器等面见 docs/plugins-dev.md）；
 * - 每个注册动词返回 disposer 或记入 ctx.effect（§2.2 回卷律）——本模板
 *   取 ctx.effect 形：包住的注册在换代/unmount 时自动回卷（丢弃 disposer
 *   不接 effect = 跨换代注册残留，属插件侧契约违例）。
 */

/** 硬依赖声明（本模板零依赖——保留空数组示形） */
export const inject = [];

/** 插件本体：装载即执行（apply）——注册面在此打开 */
export default async (ctx) => {
  // ctx.effect 正形：注册记入插件作用域，换代/unmount 自动撤注
  ctx.effect(() =>
    ctx.channels.registerCommand(
      'example-hello',
      (args) => {
        // handler 单参形（03 §2.2 定形）：args.raw = 命令名后的输入原文
        // （引号形态原样）、args.argv = 引号感知切分的词数组。
        const text = args.raw.trim() === '' ? '（无参）' : args.raw;
        // ctx.ui.notify = 一次性通知原语（07 §4.3 档位 1——无会话位恒可）
        ctx.ui.notify(`最小代码插件应答：${text}`);
      },
      '最小代码插件示例命令——/example-hello [任意文本]',
    ),
  );
};
