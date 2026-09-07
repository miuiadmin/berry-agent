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
import { assembleHostStack, readTriggerOpensLive } from './assembly.js';
import type { CorePluginReference } from './loader.js';
import { createHostRuntime } from './runtime.js';
import type { SkillsRegistry } from '../skills/index.js';

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

describe('allowlist 装配期载入（批 12f-4——04 §9 定形块读侧律）', () => {
  it('好形 allowlist.json：装配照常成功（advisory 免问面在场不拦装配序）', async () => {
    const dir = tmpDir('host-asm-al-ok-');
    writeFileSync(join(dir, 'allowlist.json'), JSON.stringify({ entries: [{ tool: 'write', pattern: '/w/a.md' }] }));
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: true,
      debug: false,
      version: 'x',
    });
    expect(assembly.ok).toBe(true);
    if (assembly.ok) await assembly.runtime.shutdown();
  });

  it('文件级坏形：warn 降级视同空清单——装配仍成功（与 enabled.yaml 拒启律分立的回归锁）', async () => {
    const dir = tmpDir('host-asm-al-bad-');
    writeFileSync(join(dir, 'allowlist.json'), '{ Oops'); // JSON 坏形
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: true,
      debug: false,
      version: 'x',
    });
    // advisory 面坏形降级方向 = 更严（多问）不是拒启（fail-closed 同向）——拒启律是 enabled.yaml 专属
    expect(assembly.ok).toBe(true);
    if (assembly.ok) await assembly.runtime.shutdown();
  });

  it('纯 memory 形（dataDir null）：allowlist 双缺不炸——装配照常', async () => {
    const assembly = await assembleHostStack({
      runtime: { memory: true },
      noPlugins: true,
      debug: false,
      version: 'x',
    });
    expect(assembly.ok).toBe(true);
    if (assembly.ok) await assembly.runtime.shutdown();
  });
});

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

  it('skills_change 事件桥（批 19b-1）：registry refresh → dispatch skills_change 发射（载荷 = provider 清单）', async () => {
    const dir = tmpDir('host-asm-skchg-');
    // 缺省 createCorePlugins 真跑形（exec/web/skills 三件——桥只在 skills 服务在场时挂）
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: 'x',
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      const registry = assembly.scope.tryGet<SkillsRegistry>('skills');
      expect(registry).toBeDefined(); // core:skills 装载（真跑形回归锁）
      const received: Array<{ providers?: readonly string[] }> = [];
      assembly.dispatch.on('skills_change', (data) => {
        received.push(data as { providers?: readonly string[] });
      });
      await registry!.refresh(); // runRefresh 尾无条件通知——桥即刻发射
      expect(received).toHaveLength(1);
      expect(received[0]!.providers).toContain('project'); // 载荷 = 现行 provider id 清单（06 §11.3）
      expect(received[0]!.providers).toContain('factory');
    } finally {
      await assembly.runtime.shutdown();
    }
  });

  it('session/event 活体镜像桥（批 19b-2）：durable append → dispatch 发射（载荷镜像）', async () => {
    const dir = tmpDir('host-asm-sevent-');
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: 'x',
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      const received: Array<{ sessionId: string; event: { type: string } }> = [];
      assembly.dispatch.on('session/event', (data) => {
        received.push(data as { sessionId: string; event: { type: string } });
      });
      const log = assembly.runtime.persistence.createSession({ origin: 'conversation' });
      log.append('user/message', { content: '桥验证', source: 'user' });
      expect(received).toHaveLength(1);
      expect(received[0]!.sessionId).toBe(log.sessionId);
      expect(received[0]!.event.type).toBe('user/message');
    } finally {
      await assembly.runtime.shutdown();
    }
  });

  it('session/event 桥守卫：noPlugins 形（词汇未注册）append 不炸——零发射', async () => {
    const dir = tmpDir('host-asm-sevg-');
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: true,
      debug: false,
      version: 'x',
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      const log = assembly.runtime.persistence.createSession({ origin: 'conversation' });
      expect(() => log.append('user/message', { content: 'x', source: 'user' })).not.toThrow(); // isRegistered 守卫
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

describe('触发器开门活体读取（readTriggerOpensLive——C 批 C-3：注册闸与 fire 复检共用源）', () => {
  it('null dataDir → 空集（memory 形全默认关——core: 豁免不经本面）', () => {
    expect(readTriggerOpensLive(null, 'acme')).toEqual(new Set());
  });

  it('文件缺席 → 空集（全 core: 内置态 = 生态插件全默认关）', () => {
    const dir = tmpDir('host-asm-tol-miss-');
    expect(readTriggerOpensLive(dir, 'acme')).toEqual(new Set());
  });

  it('行在场且开 → 授予集现读现判（/reload 撤位语义的数据源）', () => {
    const dir = tmpDir('host-asm-tol-open-');
    writeFileSync(
      join(dir, 'enabled.yaml'),
      'plugins:\n  - id: acme\n    opens:\n      - triggers.start-run\n      - channels.ui-backend\n',
    );
    expect(readTriggerOpensLive(dir, 'acme')).toEqual(new Set(['triggers.start-run', 'channels.ui-backend']));
    // 同文件他插件不受门
    expect(readTriggerOpensLive(dir, 'other')).toEqual(new Set());
  });

  it('行被禁用 → 空集（disabled 即收回——toggle 翻转位）', () => {
    const dir = tmpDir('host-asm-tol-dis-');
    writeFileSync(
      join(dir, 'enabled.yaml'),
      'plugins:\n  - id: acme\n    disabled: true\n    opens:\n      - triggers.start-run\n',
    );
    expect(readTriggerOpensLive(dir, 'acme')).toEqual(new Set());
  });

  it('坏 yaml → 空集（宁拒不误放——与 boot 侧 fail-loud 拒启分立两律的运行期档）', () => {
    const dir = tmpDir('host-asm-tol-bad-');
    writeFileSync(join(dir, 'enabled.yaml'), '{ Oops');
    expect(readTriggerOpensLive(dir, 'acme')).toEqual(new Set());
  });

  it('行校验败（坏行形）→ 空集（fail-closed 不误放）', () => {
    const dir = tmpDir('host-asm-tol-row-');
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins:\n  - id: acme\n    opens: [not-a-grantable]\n');
    expect(readTriggerOpensLive(dir, 'acme')).toEqual(new Set());
  });
});
