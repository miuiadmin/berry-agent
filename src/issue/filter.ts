/**
 * issue 配置归一与匹配面（03 §10.7 触发面定形注——结构化过滤形）。
 *
 * 过滤形：{ repos: [owner/name 或 glob], labels?, assignees? }——JMESPath
 * 不采（03 §10.7 裁决）；白名单语义 = **至少一命中**（命中任一即入——不
 * 是全命中）。repos 槽双语义：精确串轮询+匹配两用；含 `*` 的 glob 仅匹配
 * 面（轮询无法枚举 glob 域）。
 *
 * 归一律：响亮拒不炸——坏形返回 {ok:false, message}（不发明错误码；配置
 * 是装配期数据、非运行时故障域）。
 */
import type { IssueConfig, IssueRef } from './types.js';
import {
  ISSUE_DEFAULT_SCHEDULE,
  ISSUE_MAX_DELIVERIES_PER_DAY_DEFAULT,
  ISSUE_PER_ISSUE_MESSAGES_DEFAULT,
} from './types.js';

/** repo 串词法（精确形 `owner/name`——与 github.ts REPO_RE 同形，此处独立持有：filter 不依赖取数层） */
const EXACT_REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** schedule 串词法（前缀形粗校验——精校归 scheduler parseSchedule 守卫） */
const SCHEDULE_PREFIX_RE = /^(every:|daily:|weekly:|once:)/;

/** glob → 正则：`*` 通配段内任意（不含 `/`——段级通配）；锚定全配 */
export function repoMatchesGlob(pattern: string, repo: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`).test(repo);
}

/**
 * 归一配置（坏形 {ok:false, message} 响亮拒）。输入来自 mount config——
 * 用户可配域，一切缺省在此落定（缺省值单源 = types.ts 常量）。
 */
export function normalizeIssueConfig(raw: unknown): { ok: true; config: IssueConfig } | { ok: false; message: string } {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, message: `issue 配置须对象形（得 ${typeof raw}）` };
  }
  const obj = raw as Record<string, unknown>;

  // repos：必填非空数组；元素 owner/name 精确形或含 * 的 glob 形
  if (!Array.isArray(obj.repos) || obj.repos.length === 0) {
    return { ok: false, message: 'issue 配置 repos 须非空数组（监听仓库域）' };
  }
  const repos: string[] = [];
  for (const r of obj.repos) {
    if (typeof r !== 'string' || r === '') {
      return { ok: false, message: `issue 配置 repos 元素须非空串（得 ${JSON.stringify(r)}）` };
    }
    if (r.includes('*')) {
      // glob 形：`*` 不越段（段级通配）——形如 owner/* 或 */name 或 */* 皆合法
      const globOk = r.split('/').length === 2 && r.split('/').every((seg) => seg.length > 0);
      if (!globOk)
        return { ok: false, message: `issue 配置 repos glob 坏形：${r}（须 owner/name 两段、* 为段级通配）` };
    } else if (!EXACT_REPO_RE.test(r)) {
      return { ok: false, message: `issue 配置 repos 元素坏形：${r}（须 owner/name 或含 * 的 glob）` };
    }
    repos.push(r);
  }

  // labels/assignees：可选数组；元素非空串；空数组 = 该维不约束
  const normalizeList = (key: string): { ok: true; value?: string[] } | { ok: false; message: string } => {
    const v = obj[key];
    if (v === undefined) return { ok: true };
    if (!Array.isArray(v)) return { ok: false, message: `issue 配置 ${key} 须数组（得 ${typeof v}）` };
    for (const item of v) {
      if (typeof item !== 'string' || item === '') {
        return { ok: false, message: `issue 配置 ${key} 元素须非空串（得 ${JSON.stringify(item)}）` };
      }
    }
    return { ok: true, value: v as string[] };
  };
  const labels = normalizeList('labels');
  if (!labels.ok) return labels;
  const assignees = normalizeList('assignees');
  if (!assignees.ok) return assignees;

  // mode：缺省 'draft'（fail-closed 缺省律——全自动显式 opt-in）
  let mode: 'draft' | 'auto' = 'draft';
  if (obj.mode !== undefined) {
    if (obj.mode !== 'draft' && obj.mode !== 'auto') {
      return { ok: false, message: `issue 配置 mode 须 'draft'|'auto'（得 ${JSON.stringify(obj.mode)}）` };
    }
    mode = obj.mode;
  }

  // schedule：缺省 every:120s；前缀粗校验（精校归 scheduler 守卫）
  let schedule = ISSUE_DEFAULT_SCHEDULE;
  if (obj.schedule !== undefined) {
    if (typeof obj.schedule !== 'string' || !SCHEDULE_PREFIX_RE.test(obj.schedule)) {
      return {
        ok: false,
        message: `issue 配置 schedule 坏形：${JSON.stringify(obj.schedule)}（every:/daily:/weekly:/once: 前缀四形）`,
      };
    }
    schedule = obj.schedule;
  }

  // perIssueBudgetMessages：缺省 400；正整数帽
  let perIssueBudgetMessages = ISSUE_PER_ISSUE_MESSAGES_DEFAULT;
  if (obj.perIssueBudgetMessages !== undefined) {
    const n = obj.perIssueBudgetMessages;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 100_000) {
      return { ok: false, message: `issue 配置 perIssueBudgetMessages 须 1..100000 整数（得 ${JSON.stringify(n)}）` };
    }
    perIssueBudgetMessages = n;
  }

  // baseBranch：缺省 'main'；非空串
  let baseBranch = 'main';
  if (obj.baseBranch !== undefined) {
    if (typeof obj.baseBranch !== 'string' || obj.baseBranch === '') {
      return { ok: false, message: `issue 配置 baseBranch 须非空串（得 ${JSON.stringify(obj.baseBranch)}）` };
    }
    baseBranch = obj.baseBranch;
  }

  // maxDeliveriesPerDay：缺省 10（04 §13 mandate maxPerDay 原料）；正整数律
  // ——空帽即坏形（0/负数/坏形拒；彻底关停走 HALT 哨兵或撤 consent，不走空帽）
  let maxDeliveriesPerDay = ISSUE_MAX_DELIVERIES_PER_DAY_DEFAULT;
  if (obj.maxDeliveriesPerDay !== undefined) {
    const n = obj.maxDeliveriesPerDay;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 100_000) {
      return {
        ok: false,
        message: `issue 配置 maxDeliveriesPerDay 须 1..100000 正整数（得 ${JSON.stringify(n)}）——彻底关停走 HALT 哨兵或撤 consent，不走空帽`,
      };
    }
    maxDeliveriesPerDay = n;
  }

  return {
    ok: true,
    config: {
      mode,
      schedule,
      repos,
      labels: labels.value,
      assignees: assignees.value,
      perIssueBudgetMessages,
      baseBranch,
      maxDeliveriesPerDay,
    },
  };
}

/**
 * issue 是否命中过滤（白名单语义：命中任一 repo 即过；labels/assignees 维
 * 缺席不约束、在场须至少一命中）。closed 一律不匹配（终态 issue 不再入队）。
 */
export function issueMatchesFilter(issue: IssueRef, config: IssueConfig): boolean {
  if (issue.state !== 'open') return false;
  const repoHit = config.repos.some((p) => (p.includes('*') ? repoMatchesGlob(p, issue.repo) : p === issue.repo));
  if (!repoHit) return false;
  if (config.labels !== undefined && config.labels.length > 0) {
    if (!config.labels.some((l) => issue.labels.includes(l))) return false;
  }
  if (config.assignees !== undefined && config.assignees.length > 0) {
    if (!config.assignees.some((a) => issue.assignees.includes(a))) return false;
  }
  return true;
}

/** 精确 repo 集（轮询面消费——glob 形不入轮询域，调用方计数 globSkipped） */
export function exactRepos(config: IssueConfig): string[] {
  return config.repos.filter((r) => !r.includes('*'));
}
