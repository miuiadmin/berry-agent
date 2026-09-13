/**
 * pipeline spill 独占写（flag:'wx'）EEXIST 回落形回归锚（pipeline.ts:105-110）。
 *
 * 现状背景：spill 落盘走 `writeFile(path, full, { flag: 'wx' })` 独占写（⑩
 * 146cb9b 安全硬化三件之一）；EEXIST 撞名（随机前缀理论撞 + 共享 tmpdir 同名
 * 种植残留）→ catch → spilled=false → 注记回落形（无「外溢至」路径段——路径
 * 不承诺）。该回落分支此前从未被测试锁过（pipeline.test.ts 锁了成功形/0600/
 * 随机前缀/指路文案，均走写成功路）。
 *
 * 独立成文件的原因：本文件对 node:crypto 做**文件级** vi.mock（randomBytes
 * 钉成定值——铸名可预知，才可能预置同 nonce 路径制造真 EEXIST）；若并入
 * pipeline.test.ts 会破坏其「随机前缀两两不同」用例（那例依赖真随机）。
 * mock 是 passthrough 单点钉值：仅 randomBytes 返回定长定值 Buffer，writeFile
 * 全真——EEXIST 由真文件系统对真预置文件产生，非模拟故障。
 */
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Type } from 'typebox';

import { EventDispatch } from '../context/index.js';
import { TOOL_EVENT_NAMES } from '../contracts/index.js';
import type { TextContent, ToolDefinition } from '../contracts/index.js';
import { createToolPipeline } from './pipeline.js';

/* ---------------- 捕获缝：randomBytes 钉定值（铸名可预知） ---------------- */

// 定值字节 0xab × 6 → nonce 恒 'abababababab'（12 hex 字符——与真随机同形长）
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    // 全局 Buffer（actual 命名空间不恒带 Buffer 导出——node builtin 形差异）
    randomBytes: (size: number) => Buffer.alloc(size, 0xab),
  };
});

/* ---------------- 测试构造件（pipeline.test.ts 同款最小 rig） ---------------- */

/** 最小真工具（typebox schema + 可覆写 execute） */
function makeTool(overrides?: Partial<ToolDefinition>): ToolDefinition {
  return {
    name: 'demo',
    description: '测试工具',
    parameters: Type.Object({ n: Type.Integer() }),
    execute: async () => ({ content: [{ type: 'text', text: 'ok' } satisfies TextContent] }),
    ...overrides,
  };
}

/** 预置 spill 位：按钉值 nonce 推演铸名族（seq 模块级自增——本文件单用例，
 *  1 起跑；铺 1..8 覆盖任何先行自增残余，逐个真预置） */
describe('spill EEXIST 回落：独占写撞名 → spilled=false 注记无路径段', () => {
  const precreated: string[] = [];
  afterAll(() => {
    for (const p of precreated) rmSync(p, { force: true }); // 共享 tmpdir 好公民——预置位收尾清
  });

  it('同 nonce 路径已存在（wx 独占写 EEXIST）→ 截断照做 + 注记回落形（不含外溢路径段）', async () => {
    // 预置同 nonce 铸名位：tool-output-<nonce>-<safeCallId>-<seq>.txt——覆盖
    // seq 1..8（模块级自增在任何残余下均命中既有文件）
    for (let seq = 1; seq <= 8; seq += 1) {
      const p = join(tmpdir(), `tool-output-abababababab-call-eexist-${seq}.txt`);
      writeFileSync(p, '种植位'); // 真预置——wx 写必撞 EEXIST
      precreated.push(p);
    }

    // 最小 rig：分派器真件 + 管道（护栏帽 16 字节——200 字节输出必触发 spill）
    const dispatch = new EventDispatch();
    dispatch.registerEventNames(TOOL_EVENT_NAMES);
    const executor = createToolPipeline(dispatch, { outputGuardBytes: 16 });
    const big = 'x'.repeat(200);
    const tool = makeTool({ execute: async () => ({ content: [{ type: 'text', text: big }] }) });

    const result = await executor(tool, 'call-eexist', { n: 1 });
    const text = (result.content.at(-1) as TextContent).text;

    // 截断照做：保尾 16 字节在注记前（text = 尾段 + 注记——尾是前缀非后缀）
    expect(text.startsWith('x'.repeat(16))).toBe(true);
    expect(text.endsWith('[输出 200 字节超 16 字节上限，已保尾截断]')).toBe(true); // 回落形注记（无；全文外溢至段）
    // spilled=false 的两面：无「外溢至」段、无铸名路径——路径不承诺（wx 撞名
    // 后既有文件内容非本产物，指路即误导）
    expect(text).not.toContain('外溢至');
    expect(text).not.toContain('tool-output-');
    expect(text).not.toContain(tmpdir());
  });
});
