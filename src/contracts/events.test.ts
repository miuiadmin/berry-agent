import { describe, expect, it } from 'vitest';
import {
  BaseError,
  CORE_EVENT_TYPE_NAMES,
  EVENT_CATEGORIES,
  getEventTypeMeta,
  isKnownEventType,
  listEventTypes,
  parseEventSource,
  registerEventType,
} from './index.js';

describe('事件词汇注册表', () => {
  it('核心 34 词全注册（05 篇 §1.1 表格全列——逐词点名；compaction 三词 2026-09-06 纵切批增补、session/thinking-level 2026-09-06 遗漏审计批回填、plugin/opens·capability/used 2026-09-08 U3 落码批入册〔开门制两审计词——载体 = 进程级 audit_events 审计流非会话流，入册值 = 核心词身份双闸〕、compaction/fallback 2026-09-09 U4 落码批入册〔回落三律第 3 律审计词〕、生命周期五词 2026-09-09 audit 落账批入册〔plugin/installed·mounted·unmounted·toggled·updated——05 §1.1 生命周期归因面；uninstall 词已随装机面落码批先行落 audit_events 载体——六词同面〕、doors/updated 2026-09-09 开门制扩展批入册〔05 §1.1 行 72——doors 段进程级开门位授予面切换事实，boot diff 幂等同 plugin/opens 律〕、hook/registered·kv/written 2026-09-09 T9 案一批入册〔常规行为归因两词——钩子受理账 + 键值写历史；前者发射位在 ctx.on 受理壳成功尾、后者词先锚定而发射位随 ctx.sessions 受理制写面批（规范已裁代码未落）〕、preset/applied 2026-09-11 审批分档批 ap-3 入册〔05 §1.1 权限预设切换审计词——载体 = audit_events；写点 = TUI /approval preset 执行尾恰一笔、CLI --preset 逐次形零审计〕、session/paused 2026-09-11 无人值守深化批 u-3 入册〔04 §5 停靠升格定形注②——会话停靠词；载体 = 会话流；fold 语义 = 尾条即停靠；恢复不设对称词〕、credentials/changed 2026-09-11 ix-4 补注册〔c-1 规范立词而注册表漏行——/plugins config 表单腿 e2e 走真装配 audit 词汇闸 fail-loud 抓出；05 §1.1 行 74 勘正注同笔〕）', () => {
    const expected = [
      'turn/start',
      'turn/end',
      'user/message',
      'assistant/message',
      'tool/call',
      'tool/result',
      'todo/write',
      'request/header',
      'session/end-seed',
      'approval/asked',
      'approval/decided',
      'gate/decision',
      'sandbox/mode',
      'session/thinking-level',
      'session/paused',
      'llm/usage',
      'llm/retry',
      'plugin/uninstalled',
      'plugin/opens',
      'capability/used',
      'plugin/installed',
      'plugin/mounted',
      'plugin/unmounted',
      'plugin/toggled',
      'plugin/updated',
      'compaction/start',
      'compaction/surface',
      'compaction/end',
      'compaction/fallback',
      'doors/updated',
      'hook/registered',
      'kv/written',
      'preset/applied',
      'credentials/changed',
    ];
    expect([...CORE_EVENT_TYPE_NAMES].sort()).toEqual([...expected].sort());
    for (const type of expected) expect(isKnownEventType(type)).toBe(true);
  });

  it('类别四分法闭集与核心词类别锚（structure/snapshot/log-only/surface 各点名）', () => {
    expect([...EVENT_CATEGORIES]).toEqual(['surface', 'snapshot', 'log-only', 'structure']);
    expect(getEventTypeMeta('turn/end')?.category).toBe('structure');
    expect(getEventTypeMeta('request/header')?.category).toBe('snapshot');
    expect(getEventTypeMeta('llm/usage')?.category).toBe('log-only');
    expect(getEventTypeMeta('user/message')?.category).toBe('surface');
  });

  it('owner 归属按表注（gate/decision→tools、llm/usage→llm、llm/retry→session、plugin/uninstalled→host）', () => {
    expect(getEventTypeMeta('gate/decision')?.owner).toBe('tools');
    expect(getEventTypeMeta('llm/usage')?.owner).toBe('llm');
    expect(getEventTypeMeta('llm/retry')?.owner).toBe('session');
    expect(getEventTypeMeta('plugin/uninstalled')?.owner).toBe('host');
    expect(getEventTypeMeta('todo/write')?.owner).toBe('conversation');
    // 开门制两审计词：写入者 = host 装配根（boot 装载序 / 门检接线位——
    // U3-0 台账；audit 流单写者律，插件面零写入位）
    expect(getEventTypeMeta('plugin/opens')?.owner).toBe('host');
    expect(getEventTypeMeta('capability/used')?.owner).toBe('host');
    // 两审计词类别锚：log-only（永不进模型历史——审计流词汇）
    expect(getEventTypeMeta('plugin/opens')?.category).toBe('log-only');
    expect(getEventTypeMeta('capability/used')?.category).toBe('log-only');
    // T9 案一批常规行为归因两词：写入者 = host（audit 流单写者律——ctx.on
    // 受理壳 / ctx.sessions 受理面均在宿主注入侧）；kv/written 发射位随写面批
    expect(getEventTypeMeta('hook/registered')?.owner).toBe('host');
    expect(getEventTypeMeta('hook/registered')?.category).toBe('log-only');
    expect(getEventTypeMeta('kv/written')?.owner).toBe('host');
    expect(getEventTypeMeta('kv/written')?.category).toBe('log-only');
  });

  it('核心词全部不 ignorable（读侧必须认识）', () => {
    for (const meta of listEventTypes()) {
      if (CORE_EVENT_TYPE_NAMES.includes(meta.type)) expect(meta.ignorable).toBeUndefined();
    }
  });

  it('registerEventType 扩展入口：插件词注册后可查（双入口纪律的第二入口）', () => {
    registerEventType({
      type: 'test-plugin/custom',
      category: 'log-only',
      owner: 'test-plugin',
      tier: 'stable',
      description: '测试用例临时词',
      ignorable: true,
    });
    expect(isKnownEventType('test-plugin/custom')).toBe(true);
    expect(getEventTypeMeta('test-plugin/custom')?.ignorable).toBe(true);
  });

  it('核心词身份拒装载面注册（SESSION_CORE_TYPE_FORBIDDEN——双闸之一）', () => {
    expect(() =>
      registerEventType({
        type: 'user/message',
        category: 'surface',
        owner: 'evil-plugin',
        tier: 'stable',
        description: '伪造核心词',
      }),
    ).toThrowError(BaseError);
    try {
      registerEventType({
        type: 'turn/end',
        category: 'structure',
        owner: 'evil-plugin',
        tier: 'stable',
        description: '伪造核心词',
      });
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('SESSION_CORE_TYPE_FORBIDDEN');
        expect(err.message).toContain('核心词汇');
        return;
      }
      expect.unreachable();
    }
  });

  it('同型重复注册抛 PLUGIN_EVENT_TYPE_CONFLICT（03 §2.7 指派——装载面统一插件域码）', () => {
    try {
      registerEventType({
        type: 'test-plugin/custom',
        category: 'log-only',
        owner: 'another',
        tier: 'stable',
        description: '撞型',
      });
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('PLUGIN_EVENT_TYPE_CONFLICT');
        expect(err.message).toContain('test-plugin/custom');
        return;
      }
      expect.unreachable();
    }
  });
});

describe('source 归因闭集判别（05 §3.1）', () => {
  it('六字面量各归其位', () => {
    expect(parseEventSource('user')).toEqual({ kind: 'user', raw: 'user', treatedAsUser: true });
    expect(parseEventSource('schedule')).toEqual({ kind: 'schedule', raw: 'schedule', treatedAsUser: true });
    expect(parseEventSource('subagent-settled')).toEqual({
      kind: 'subagent-settled',
      raw: 'subagent-settled',
      treatedAsUser: true,
    });
    // background 委派审批挂起通知：UserMessage 注入位（04 §10——与 subagent-settled
    // 同通道同型），投影同视用户话语；纯信息位（应答权钉死用户）
    expect(parseEventSource('subagent-approval-pending')).toEqual({
      kind: 'subagent-approval-pending',
      raw: 'subagent-approval-pending',
      treatedAsUser: true,
    });
    // 预算扩展唤醒（04 §5 第六字面量——2026-09-06 技术调研消化批增补、代码侧
    // 漏落随成熟度缺口 #5 唤醒接线批补齐）：与 schedule 同形（机器注入的
    // 起跑输入位）——投影同视用户话语
    expect(parseEventSource('budget-extended')).toEqual({
      kind: 'budget-extended',
      raw: 'budget-extended',
      treatedAsUser: true,
    });
    // compaction 是摘要载体：不以用户话语位展开
    expect(parseEventSource('compaction')).toEqual({ kind: 'compaction', raw: 'compaction', treatedAsUser: false });
  });

  it('channel: 前缀任意后缀按通道行展开——投影同视 user', () => {
    const parsed = parseEventSource('channel:webui');
    expect(parsed.kind).toBe('channel');
    expect(parsed.treatedAsUser).toBe(true);
    // 已知前缀的未知后缀（未来通道）同样合法
    expect(parseEventSource('channel:future-gateway').kind).toBe('channel');
  });

  it('plugin: 前缀任意后缀按插件行展开——投影不视为用户话语', () => {
    expect(parseEventSource('plugin:core:memory').kind).toBe('plugin');
    expect(parseEventSource('plugin:core:memory').treatedAsUser).toBe(false);
    // 已知前缀的未知后缀（未来插件）同样合法——前缀自描述承载注入者 id
    expect(parseEventSource('plugin:future-plugin').kind).toBe('plugin');
  });

  it('session: 前缀任意后缀按跨会话操控行展开——投影不视为用户话语（05 §3.1 e-4）', () => {
    // 前缀自描述送话会话 id（审计免查表）
    const parsed = parseEventSource('session:s-abc123');
    expect(parsed.kind).toBe('session');
    expect(parsed.raw).toBe('session:s-abc123');
    expect(parsed.treatedAsUser).toBe(false);
    // 已知前缀的未知后缀（未来会话 id 形）同样合法
    expect(parseEventSource('session:future-id').kind).toBe('session');
    // 与 plugin: 同判 false（agent 互搏注入非用户话语）；与 user 字面量对拍
    expect(parseEventSource('user').treatedAsUser).toBe(true);
  });

  it('未知字面量按 user 同视（旧日志向前兼容——读侧宽容）', () => {
    const parsed = parseEventSource('legacy-unknown-value');
    expect(parsed).toEqual({ kind: 'user', raw: 'legacy-unknown-value', treatedAsUser: true });
  });
});
