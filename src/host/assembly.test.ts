/**
 * host/assembly 组合根测试——装配序公共段（批 12f-3 防侧门件：TUI 入口与
 * dump-config / plugins list 诊断命令**同一合成代码路径**的执法证据）。
 *
 * 失败三档归一全景：干净退出档（运行时组装失败）× 启用清单损坏档
 * （PLUGIN_ROW_INVALID 先收口再返回——标记释放即证据）× 崩溃取证档
 * （意外异常 crashed:true + crash.log 按 memory 位跳过——诊断形 dataDir
 * 在场仍跳过）。真盘真库（临时目录）+ 真装载管线（core 件 in-process）。
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { ACTIVE_MARKER_BASENAME } from './single-instance.js';
import { assembleHostStack } from './assembly.js';
import type { CorePluginReference } from './loader.js';
import { createHostRuntime } from './runtime.js';

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

describe('assembleHostStack 成功档', () => {
  it('六柄一匣 + corePlugins 透传面（enabled.yaml 缺席 = core 内置态全装）', async () => {
    const dir = tmpDir('host-asm-ok-');
    const applied: string[] = [];
    const ref: CorePluginReference = { name: 'demo', apply: async () => void applied.push('demo') };
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: '9.9.9-test',
      corePlugins: [ref],
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      expect(applied).toEqual(['demo']); // 装载管线真跑（apply 全执行）
      expect(assembly.runtime.dataDir).toBe(dir);
      expect(assembly.boot.report.activated.map((a) => a.id)).toEqual(['core:demo']);
      expect(assembly.pluginCounts).toEqual({ total: 1, enabled: 1, failed: 0 }); // 披露匣已回写
      expect(typeof assembly.stack.model).toBe('string'); // 栈五层真装配（模型缺省解析在栈内）
      expect(assembly.dispatch).toBeDefined();
      expect(assembly.scope).toBeDefined();
      expect(assembly.logger).toBeDefined();
    } finally {
      await assembly.runtime.shutdown();
    }
  });
});

describe('失败三档归一（不抛——呈报面归调用方）', () => {
  it('运行时组装失败 = 干净退出档（crashed:false——运行时未建成无资源待收）', async () => {
    const dir = tmpDir('host-asm-busy-');
    const first = createHostRuntime({ dataDir: dir }); // 占标记（单活跃机在飞）
    try {
      const assembly = await assembleHostStack({
        runtime: { dataDir: dir },
        noPlugins: true,
        debug: false,
        version: 'x',
      });
      expect(assembly.ok).toBe(false);
      if (!assembly.ok) {
        expect(assembly.exitCode).toBe(1);
        expect(assembly.crashed).toBe(false);
        expect(assembly.message).toContain('启动失败'); // 前缀归一（HOST_DATA_DIR_BUSY 细目在运行时域测）
      }
    } finally {
      await first.shutdown();
    }
  });

  it('启用清单损坏 = 用户可自修档（crashed:false + 修复指引 + 先收口——标记已释放）', async () => {
    const dir = tmpDir('host-asm-invalid-');
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins: [ Oops'); // yaml 坏形 fail-loud
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: 'x',
    });
    expect(assembly.ok).toBe(false);
    if (!assembly.ok) {
      expect(assembly.exitCode).toBe(1);
      expect(assembly.crashed).toBe(false);
      expect(assembly.message).toContain('启动失败');
      expect(assembly.message).toContain('修复或删除'); // 修复指引透出
    }
    // 已建运行时先收口再返回——单活跃标记已释放（接管无残留）
    expect(existsSync(join(dir, ACTIVE_MARKER_BASENAME))).toBe(false);
    expect(existsSync(join(dir, 'crash.log'))).toBe(false); // 干净退出档不取证
  });

  it('意外异常 = 崩溃取证档（crashed:true + 资源收口 + memory 位 crash.log 跳过——诊断形 dataDir 在场仍跳过）', async () => {
    const dir = tmpDir('host-asm-crash-');
    const assembly = await assembleHostStack({
      runtime: { memory: true, dataDir: dir }, // 同构诊断形（与 dump-config 真实用法同形）
      noPlugins: true,
      debug: false,
      version: 'x',
      onRuntime: () => {
        throw new Error('boom'); // 运行时组装后回调内注入意外异常
      },
    });
    expect(assembly.ok).toBe(false);
    if (!assembly.ok) {
      expect(assembly.exitCode).toBe(1);
      expect(assembly.crashed).toBe(true); // 调用方区分文案前缀的依据
      expect(assembly.message).toBe('boom');
    }
    // crash.log 跳过语义跟 memory 位走（诊断形 dataDir 在场也不写——writeCrashLog 首判 memory）
    expect(existsSync(join(dir, 'crash.log'))).toBe(false);
  });
});
