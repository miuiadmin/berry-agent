/**
 * 技能注册表（06 §11.3 护栏②注册表层 + 03 skills_change 事件面）。
 *
 * - provider 注册序即优先序（06 §11.3）；同名 first-wins 由扫描序表达，冲突带
 *   collision 诊断（winner/loser 双路径）；
 * - 快照数帽 100：超帽裁尾 + capacity 诊断列被裁计数（provider 注册序即裁序
 *   ——最低优先层先出局）；
 * - refresh() 全量重扫（/reload 正口与 skill_manage 写后自动刷新共用一径）；
 * - onChange 监听面 = 03 skills_change 事件的装配桥（载荷 = 现行 provider id
 *   清单，消费 = 渐进披露清单重物化）；
 * - 并发 refresh 串行化（承诺链——后到刷新在先到落定后重扫，末笔即最新快照；
 *   与 exec 登记簿持久化链同律）。
 */
import { BaseError } from '../contracts/index.js';
import { SKILL_SNAPSHOT_CAP } from './types.js';
import type { Skill, SkillDiagnostic, SkillsProvider, SkillsRefreshReport } from './types.js';

/** 注册表选项 */
export interface SkillsRegistryOptions {
  /** 快照数帽（缺省 100——06 §11.3 护栏②） */
  readonly cap?: number;
}

/** 注册表公开面（ctx.skills 的件内真身——装配经 scope.provide 暴露给插件） */
export interface SkillsRegistry {
  /** 注册 provider（注册序即优先序；撞 id fail-loud——装配期错误） */
  registerProvider(provider: SkillsProvider): void;
  /** 摘除 provider（unmount 对称面——03 §6.2 技能层摘除）；返回是否在场 */
  unregisterProvider(id: string): boolean;
  /** 现行 provider id 清单（skills_change 事件载荷） */
  providerIds(): readonly string[];
  /** provider 查询（skill_manage patch 域判定——writable 标记消费位） */
  getProvider(id: string): SkillsProvider | undefined;
  /** 全部扫描根并集（skill_manage create 同名盘上判据面） */
  scanRoots(): readonly string[];
  /** 全量重扫（/reload 与写后自动刷新共用；返回计数报告） */
  refresh(): Promise<SkillsRefreshReport>;
  /** 按名取技能（显式激活面——含 disable-model-invocation 隐藏件） */
  get(name: string): Skill | undefined;
  /** 快照全量（帽后；含隐藏件——模型清单渲染面自行滤除） */
  list(): readonly Skill[];
  /** 最近一次 refresh 的诊断（作者侧反馈面——装载警告/冲突/容量裁尾） */
  diagnostics(): readonly SkillDiagnostic[];
  /**
   * 变更监听（refresh 快照变化即通知——装配桥接 skills_change 事件与清单重物化）。
   * 返回退订函数。
   */
  onChange(listener: (report: SkillsRefreshReport) => void): () => void;
}

/**
 * 创建技能注册表。
 *
 * @param options.cap 快照数帽（缺省 100）
 */
export function createSkillsRegistry(options: SkillsRegistryOptions = {}): SkillsRegistry {
  const cap = options.cap ?? SKILL_SNAPSHOT_CAP;
  const providers: SkillsProvider[] = [];
  const providerById = new Map<string, SkillsProvider>();
  let snapshot: Skill[] = [];
  let lastDiagnostics: SkillDiagnostic[] = [];
  let lastReport: SkillsRefreshReport = { providers: 0, total: 0, droppedByCap: 0, collisions: 0 };
  const listeners = new Set<(report: SkillsRefreshReport) => void>();
  let refreshChain: Promise<SkillsRefreshReport> = Promise.resolve(lastReport);

  const runRefresh = async (): Promise<SkillsRefreshReport> => {
    const merged = new Map<string, Skill>(); // name → skill（first-wins）
    const diagnostics: SkillDiagnostic[] = [];
    let collisions = 0;
    for (const provider of providers) {
      let scan: { skills: readonly Skill[]; diagnostics: readonly SkillDiagnostic[] };
      try {
        scan = await provider.scan();
      } catch (error) {
        // 单 provider 扫描炸不拖垮其余层（坏层诊断降级——其余层技能照常服务）
        diagnostics.push({
          type: 'warning',
          message: `provider ${provider.id} 扫描失败：${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }
      for (const diagnostic of scan.diagnostics) diagnostics.push(diagnostic);
      for (const skill of scan.skills) {
        const existing = merged.get(skill.name);
        if (existing !== undefined) {
          collisions += 1;
          diagnostics.push({
            type: 'collision',
            message: `技能同名冲突：${skill.name}（${existing.providerId} 层 ${existing.filePath} 压过 ${skill.providerId} 层 ${skill.filePath}）`,
            path: skill.filePath,
          });
          continue; // first-wins：扫描序（即 provider 注册序）在先者胜
        }
        merged.set(skill.name, skill);
      }
    }
    // 快照帽：按优先序裁尾（最低优先层先出局）+ capacity 诊断（作者侧反馈）
    let droppedByCap = 0;
    if (merged.size > cap) {
      droppedByCap = merged.size - cap;
      const kept = [...merged.entries()].slice(0, cap);
      diagnostics.push({
        type: 'capacity',
        message: `技能快照超帽 ${cap}——按优先序裁尾 ${droppedByCap} 件（低优先层先出局；同名覆盖或精简低优先层）`,
      });
      snapshot = kept.map(([, skill]) => skill);
    } else {
      snapshot = [...merged.values()];
    }
    lastDiagnostics = diagnostics;
    lastReport = {
      providers: providers.length,
      total: snapshot.length,
      droppedByCap,
      collisions,
    };
    for (const listener of listeners) listener(lastReport);
    return lastReport;
  };

  return {
    registerProvider(provider: SkillsProvider): void {
      if (providerById.has(provider.id)) {
        throw new BaseError(
          'SKILLS_PROVIDER_CONFLICT',
          `[SKILLS_PROVIDER_CONFLICT] 技能 provider 撞名：${provider.id} 已注册——provider id 即层身份（skills_change 载荷成员），装配序须唯一`,
        );
      }
      providerById.set(provider.id, provider);
      providers.push(provider); // 注册序即优先序——后注册者优先级低
    },
    unregisterProvider(id: string): boolean {
      const provider = providerById.get(id);
      if (provider === undefined) return false;
      providerById.delete(id);
      providers.splice(providers.indexOf(provider), 1);
      return true;
    },
    providerIds(): readonly string[] {
      return providers.map((p) => p.id);
    },
    getProvider(id: string): SkillsProvider | undefined {
      return providerById.get(id);
    },
    scanRoots(): readonly string[] {
      const roots: string[] = [];
      for (const provider of providers) roots.push(...provider.roots);
      return roots;
    },
    refresh(): Promise<SkillsRefreshReport> {
      // 串行承诺链：并发 refresh 按到达序逐笔重扫，末笔即最新快照
      refreshChain = refreshChain.then(runRefresh, runRefresh);
      return refreshChain;
    },
    get(name: string): Skill | undefined {
      return snapshot.find((skill) => skill.name === name);
    },
    list(): readonly Skill[] {
      return snapshot;
    },
    diagnostics(): readonly SkillDiagnostic[] {
      return lastDiagnostics;
    },
    onChange(listener: (report: SkillsRefreshReport) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
