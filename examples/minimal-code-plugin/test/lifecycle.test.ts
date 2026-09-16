/**
 * 生命周期最小自持测试（examples/minimal-code-plugin 模板配套——03 §9.5）。
 *
 * 作者引导（完整说明见 docs/plugin-development.md §测试节）：
 * - 本文件是**稳定面**自持形：零宿主 devDep——直测插件入口的导出面形状
 *   与激活/回卷语义，拷走即跑（vitest / node:test 均可——顶层断言形，
 *   不用 runner 注册 API；node:test 用户在自有包置 "type": "module"）；
 * - 完整「装载契约符合性」证明（装得上/挂载得出/事件收得到——宿主
 *   testkit 的生命周期矩阵断言器）现处实验档，合法披露位在
 *   docs/plugin-development.md 测试节〔实验面〕——作者按需自取，实验
 *   符号不入本稳定示例（API 治理查 5：examples 属稳定示例扫描面）。
 *
 * 断言只比形状（函数性/数组性/注册调用名），不比文案内容。
 */
import { deepStrictEqual, ok } from 'node:assert';
import activate, { inject } from '../entry.js';

// —— 锚一：入口导出面形状（default async 函数 + inject 空数组示形）——
ok(typeof activate === 'function', 'default export 须为函数（async 装载形）');
ok(Array.isArray(inject), 'named export inject 须为数组（硬依赖声明位）');
deepStrictEqual(inject, [], '本模板零依赖——保留空数组示形');

// —— 锚二：激活语义（注册动词恰一 + 命令名 + effect 回卷律）——
{
  const registeredNames = [];
  const disposers = [];
  let commandHandler = undefined;
  const notified = [];
  // 最小伪 ctx：仅实现模板消费的三面（作者可复制的最小桩）
  const ctx = {
    effect: (dispose) => disposers.push(dispose),
    channels: {
      registerCommand: (name, handler) => {
        registeredNames.push(name);
        commandHandler = handler;
        return () => {};
      },
    },
    ui: { notify: (text) => notified.push(text) },
  };
  await activate(ctx);
  deepStrictEqual(registeredNames, ['example-hello'], '注册动词恰一次且命令名 = 模板注册面');
  ok(
    disposers.length === 1 && typeof disposers[0] === 'function',
    '注册须被 ctx.effect 包住（回卷律——换代/unmount 自动撤注）',
  );
  // handler 语义冒烟：应答经 ctx.ui.notify 出门（只断言出门事实不比文案）
  commandHandler({ raw: '样张', argv: ['样张'] });
  ok(notified.length === 1, '命令 handler 应答恰经 ctx.ui.notify 出门一次');
}

console.log('lifecycle 自持测试样张：全部形状锚通过');
