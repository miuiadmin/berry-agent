/**
 * host/dump-config 诊断入口测试——:memory: 同构纪律（07 §5）的行为证据。
 *
 * 核心回归锁：**同构真读**——memory+dataDir 诊断形下 enabled.yaml/装机账本
 * 走真盘读侧（区别于纯 memory 形的缺席同义）；主库 :memory: 零落盘、不占
 * 活跃标记。输出为 stdout 单 JSON 对象（机器可读面——解析断言非文本比对）。
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { ACTIVE_MARKER_BASENAME } from './single-instance.js';
import { runDumpConfigEntry } from './dump-config.js';
import type { CorePluginReference } from './loader.js';

/** 旗标速记（DumpConfigFlags 必填两布尔——缺省关） */
const FLAGS = { noPlugins: false, debug: false } as const;

/** 临时数据目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 新临时目录速记 */
function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** 输出面速记（捕获行族） */
function capture(): { out: string[]; err: string[]; writeOut: (t: string) => void; writeErr: (t: string) => void } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, writeOut: (t) => void out.push(t), writeErr: (t) => void err.push(t) };
}

describe('runDumpConfigEntry 同构诊断（07 §5 :memory: 纪律）', () => {
  it('好形：JSON 全形输出（database :memory: + 真数据目录 + 主库零落盘 + 不占标记）', async () => {
    const dir = tmpDir('dump-cfg-ok-');
    const io = capture();
    const code = await runDumpConfigEntry({ flags: FLAGS, version: '9.9.9-test', dataDir: dir, ...io });
    expect(code).toBe(0);
    const doc = JSON.parse(io.out.join('\n')) as {
      version: string;
      dataDir: string;
      database: string;
      model: string;
      flags: { noPlugins: boolean; port: string | null };
      plugins: { activated: unknown[]; failed: unknown[]; skipped: unknown[] };
      counts: { total: number; enabled: number; failed: number };
    };
    expect(doc.version).toBe('9.9.9-test');
    expect(doc.dataDir).toBe(dir); // 真数据目录（读侧归属地如实报告）
    expect(doc.database).toBe(':memory:'); // 同构诊断形注记——主库零落盘
    expect(doc.model.length).toBeGreaterThan(0); // 栈内模型缺省解析产物
    expect(doc.flags).toEqual({ noPlugins: false, port: null }); // --port 收下不起监听（缺席如实注记 null）
    // 批 19a 起 core 注册表非空（exec/web/skills/memory/subagent/scheduler/mcp/
    // browser/lsp/goal/checkpoint/sdk/webui/obs/issue 入册——19e 四件齐册 15 件
    // + c-3 credentials 增席 16 件〔空闲占席无主闸恒装〕）
    // ——清单缺席 = 全 core 内置态：activated 见 core 行（装载态集成回归锁
    // ——件数随逐纵切笔增长）。
    // :memory: 座上 sqlite() 在场 → memory/scheduler/goal 件照装；dataDir 真值
    // + 两 seam 恒接线 → checkpoint 件同装；exec 管道 + web-fetch + dataDir
    // 三主闸齐备 → 三桥（mcp/browser/lsp）照装（零 config 惰性形——零 spawn）；
    // sdk/webui 两 seam 恒接线（装配闭包真身）→ 两件照装（apply 只 provide
    // kit 零监听零网络）；obs 双主闸齐备（dataDir + obsEvents 恒接线）→ 照装
    // （rollup.db 落 data/obs/ 子目录——03 §10.8 容忍条款，顶层 .db 断言不破）；
    // issue 主闸链 config 缺席 → apply 早退仍计 activated（counts 口径）
    // （同构诊断形走真装载面——禁侧门律；引擎构造不自启——诊断进程不起钟
    // 零定时器残留）
    expect((doc.plugins.activated as { id?: string }[]).map((row) => row.id)).toEqual([
      'core:exec',
      'core:web',
      'core:skills',
      'core:memory',
      'core:subagent',
      'core:scheduler',
      'core:mcp',
      'core:browser',
      'core:lsp',
      'core:goal',
      'core:checkpoint',
      'core:sdk',
      'core:webui',
      'core:obs',
      'core:issue',
      'core:credentials',
    ]);
    expect(doc.plugins.failed).toEqual([]);
    expect(doc.plugins.skipped).toEqual([]);
    expect(doc.counts).toEqual({ total: 16, enabled: 16, failed: 0 });
    // 同构纪律副作用边界：不占标记 + 无 .db 落盘
    expect(existsSync(join(dir, ACTIVE_MARKER_BASENAME))).toBe(false);
    expect(readdirSync(dir).filter((name) => name.endsWith('.db'))).toEqual([]);
  });

  it('同构真读（核心回归锁）：enabled.yaml 磁盘行无账本 → failed 面见「装机账本无此 id」', async () => {
    const dir = tmpDir('dump-cfg-read-');
    // 真盘启用清单：用户磁盘行（非 core: 前缀）——纯 memory 形下此读侧缺席同义，
    // 诊断形必须真读（07 §5「禁侧门」：报告真实装载会走到的路）
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins:\n  - id: user-demo\n');
    const io = capture();
    const code = await runDumpConfigEntry({ flags: FLAGS, version: 'x', dataDir: dir, ...io });
    expect(code).toBe(0); // 行级隔离——装载失败不入退出档（区别于清单损坏 fail-loud）
    const doc = JSON.parse(io.out.join('\n')) as {
      plugins: { failed: Array<{ id: string; message: string }>; activated: unknown[]; skipped: unknown[] };
      counts: { failed: number };
    };
    expect(doc.plugins.failed.length).toBe(1);
    const failedRow = doc.plugins.failed[0];
    if (failedRow === undefined) throw new Error('failed 行缺席');
    expect(failedRow.id).toBe('user-demo');
    expect(failedRow.message).toContain('装机账本无此 id'); // 账本读侧真达（读真盘 ledger.json 缺席）
    // core 注册表非空（批 19a—19e——exec/web/skills/memory/subagent/scheduler/
    // mcp/browser/lsp/goal/checkpoint/sdk/webui/obs/issue 十五件 + c-3
    // credentials 增席十六件齐册）与
    // 用户行分立：core 照装、坏用户行照 fail
    expect((doc.plugins.activated as { id?: string }[]).map((row) => row.id)).toEqual([
      'core:exec',
      'core:web',
      'core:skills',
      'core:memory',
      'core:subagent',
      'core:scheduler',
      'core:mcp',
      'core:browser',
      'core:lsp',
      'core:goal',
      'core:checkpoint',
      'core:sdk',
      'core:webui',
      'core:obs',
      'core:issue',
      'core:credentials',
    ]);
    expect(doc.counts.failed).toBe(1);
  });

  it('corePlugins 注入面：core 件全装（装载管线真跑——apply 执行后报告）', async () => {
    const dir = tmpDir('dump-cfg-core-');
    const applied: string[] = [];
    const ref: CorePluginReference = { name: 'demo', apply: async () => void applied.push('demo') };
    const io = capture();
    const code = await runDumpConfigEntry({ flags: FLAGS, version: 'x', dataDir: dir, corePlugins: [ref], ...io });
    expect(code).toBe(0);
    expect(applied).toEqual(['demo']); // 诊断命令跑真装载（非清单快照）
    const doc = JSON.parse(io.out.join('\n')) as { plugins: { activated: Array<{ id: string }> } };
    expect(doc.plugins.activated.map((a) => a.id)).toEqual(['core:demo']);
  });

  it('坏形 enabled.yaml：退 1 + stderr 启动失败与修复指引（不写 crash.log）', async () => {
    const dir = tmpDir('dump-cfg-bad-');
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins: [ Oops');
    const io = capture();
    const code = await runDumpConfigEntry({ flags: FLAGS, version: 'x', dataDir: dir, ...io });
    expect(code).toBe(1);
    expect(io.err.join('\n')).toContain('启动失败');
    expect(io.err.join('\n')).toContain('修复或删除');
    expect(existsSync(join(dir, 'crash.log'))).toBe(false); // 干净退出档不取证
  });

  it('--no-plugins：装载面整跳——清单在场也短路（counts 全 0）', async () => {
    const dir = tmpDir('dump-cfg-noplug-');
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins:\n  - id: user-demo\n');
    const io = capture();
    const code = await runDumpConfigEntry({
      flags: { noPlugins: true, debug: false },
      version: 'x',
      dataDir: dir,
      ...io,
    });
    expect(code).toBe(0);
    const doc = JSON.parse(io.out.join('\n')) as {
      plugins: { activated: unknown[]; failed: unknown[]; skipped: unknown[] };
      counts: { total: number; enabled: number; failed: number };
      flags: { noPlugins: boolean };
    };
    expect(doc.flags.noPlugins).toBe(true); // 旗标如实回显
    expect(doc.plugins).toEqual({ activated: [], failed: [], skipped: [] }); // 整跳（磁盘行不读不停）
    expect(doc.counts).toEqual({ total: 0, enabled: 0, failed: 0 });
  });
});
