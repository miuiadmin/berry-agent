/**
 * 注册表测试（06 §11.3 护栏②——provider 注册序即优先序 / first-wins + collision
 * 诊断 / 快照帽裁尾 + capacity 诊断 / refresh 串行承诺链 / onChange 桥）。
 * provider 用内存桩（scan 真源是发现层——本件锁合并语义）。
 */
import { describe, expect, it, vi } from 'vitest';
import { createSkillsRegistry } from './registry.js';
import { SKILL_SNAPSHOT_CAP } from './types.js';
import type { ProviderScan, Skill, SkillsProvider } from './types.js';

/** 内存技能桩 */
function stubSkill(name: string, providerId: string): Skill {
  return {
    name,
    description: `${name} 描述`,
    filePath: `/${providerId}/${name}/SKILL.md`,
    baseDir: `/${providerId}/${name}`,
    providerId,
    content: `${name} 正文`,
    disableModelInvocation: false,
    sections: [],
  };
}

/** 内存 provider 桩（scan 可注入延迟与副作用——串行锁用） */
function stubProvider(id: string, names: readonly string[], onScan?: () => void): SkillsProvider {
  return {
    id,
    roots: [`/${id}`],
    scan: async (): Promise<ProviderScan> => {
      onScan?.();
      return { skills: names.map((n) => stubSkill(n, id)), diagnostics: [] };
    },
  };
}

describe('createSkillsRegistry 合并语义', () => {
  it('first-wins——注册序在先者压后者 + collision 诊断双路径', async () => {
    const registry = createSkillsRegistry();
    registry.registerProvider(stubProvider('project', ['dup', 'a']));
    registry.registerProvider(stubProvider('user', ['dup', 'b']));
    const report = await registry.refresh();
    expect(report.collisions).toBe(1);
    expect(report.total).toBe(3);
    expect(registry.get('dup')?.providerId).toBe('project');
    const collision = registry.diagnostics().find((d) => d.type === 'collision');
    expect(collision?.message).toContain('project');
    expect(collision?.message).toContain('user');
    expect(collision?.path).toBe('/user/dup/SKILL.md'); // 败者路径
  });

  it('快照帽——超帽按优先序裁尾 + capacity 诊断列被裁计数', async () => {
    const registry = createSkillsRegistry({ cap: 2 });
    registry.registerProvider(stubProvider('hi', ['a', 'b']));
    registry.registerProvider(stubProvider('lo', ['c'])); // 低优先层先出局
    const report = await registry.refresh();
    expect(report.total).toBe(2);
    expect(report.droppedByCap).toBe(1);
    expect(registry.get('c')).toBeUndefined();
    expect(registry.diagnostics().some((d) => d.type === 'capacity' && d.message.includes('1'))).toBe(true);
  });

  it('快照帽缺省 100（规范值回归锁）', async () => {
    const registry = createSkillsRegistry();
    registry.registerProvider(
      stubProvider(
        'bulk',
        Array.from({ length: SKILL_SNAPSHOT_CAP + 5 }, (_, i) => `s${i}`),
      ),
    );
    const report = await registry.refresh();
    expect(report.total).toBe(SKILL_SNAPSHOT_CAP);
    expect(report.droppedByCap).toBe(5);
  });

  it('provider 撞名 → SKILLS_PROVIDER_CONFLICT fail-loud', () => {
    const registry = createSkillsRegistry();
    registry.registerProvider(stubProvider('project', []));
    expect(() => registry.registerProvider(stubProvider('project', ['x']))).toThrowError(/SKILLS_PROVIDER_CONFLICT/);
  });

  it('单 provider 扫描炸——警告诊断降级，其余层照常服务', async () => {
    const registry = createSkillsRegistry();
    registry.registerProvider({
      id: 'bad',
      roots: [],
      scan: async () => {
        throw new Error('disk on fire');
      },
    });
    registry.registerProvider(stubProvider('good', ['fine']));
    const report = await registry.refresh();
    expect(report.total).toBe(1);
    expect(registry.get('fine')).toBeDefined();
    expect(registry.diagnostics().some((d) => d.type === 'warning' && d.message.includes('bad'))).toBe(true);
  });

  it('refresh 并发串行——扫描不交错（承诺链锁）', async () => {
    const order: string[] = [];
    let running = 0; // 并发扫描计数（串行律下恒 ≤1）
    let maxRunning = 0;
    const slow: SkillsProvider = {
      id: 'slow',
      roots: [],
      scan: async (): Promise<ProviderScan> => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push('scan');
        running -= 1;
        return { skills: [], diagnostics: [] };
      },
    };
    const registry = createSkillsRegistry();
    registry.registerProvider(slow);
    await Promise.all([registry.refresh(), registry.refresh(), registry.refresh()]);
    expect(order).toHaveLength(3);
    expect(maxRunning).toBe(1); // 串行——并发 refresh 逐笔落定
  });

  it('onChange 在 refresh 后触发；退订后不再触发', async () => {
    const registry = createSkillsRegistry();
    registry.registerProvider(stubProvider('p', ['x']));
    const listener = vi.fn();
    const unsubscribe = registry.onChange(listener);
    await registry.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await registry.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unregisterProvider——摘除后不再扫描；缺席 id 返回 false', async () => {
    const registry = createSkillsRegistry();
    registry.registerProvider(stubProvider('p', ['x']));
    expect(registry.unregisterProvider('p')).toBe(true);
    expect(registry.unregisterProvider('p')).toBe(false);
    const report = await registry.refresh();
    expect(report.providers).toBe(0);
    expect(report.total).toBe(0);
  });

  it('providerIds / getProvider / scanRoots 面板', () => {
    const registry = createSkillsRegistry();
    registry.registerProvider(stubProvider('project', []));
    registry.registerProvider(stubProvider('user', []));
    expect(registry.providerIds()).toEqual(['project', 'user']);
    expect(registry.getProvider('user')?.roots).toEqual(['/user']);
    expect(registry.scanRoots()).toEqual(['/project', '/user']);
    expect(registry.getProvider('nope')).toBeUndefined();
  });
});
