/**
 * sessions 服务面测试（批 19 销账笔——03 §4.4/§4.5 + 06 §318 appendEvent 最小面；
 * cs-D1 sessions 完整受理面批 2026-09-15 扩面——只读四件 + storeStateFor 域绑定
 * 三动词 + bind storeState 直连/行籍闸单拍）。
 *
 * 覆盖四维：
 *  - 二道闸①：核心事件词伪造拒写（SESSION_CORE_TYPE_FORBIDDEN）；
 *  - 二道闸②：未注册词汇拒写（SESSION_UNKNOWN_EVENT_TYPE——前置闸与下游
 *    SessionLog.append 同判据，此处验证服务面先拦且错误信息带服务面上下文）；
 *  - 过闸正路：已注册插件词直达 log.append（durable 落账 + 返回值回传）；
 *  - 诚实缺席律：无活体驱动 undefined 降级 + 活引用调用时点解析（/new 热切换
 *    安全——取引用与调用两时点间驱动可能已闭）。
 *
 * 分层纪律：纯单元（真 SessionLog 纯内存形态——零 I/O 零 mock；cs-D1 读四件/
 * store_state 腿以记录桩代 store 层——受局面拼装/审计发射/行籍闸才是本件执法面）。
 */
import { describe, expect, it } from 'vitest';
import { BaseError, registerEventType } from '../contracts/index.js';
import { SessionLog } from '../session/index.js';
import {
  bindSessionsForPlugin,
  createSessionsFace,
  type KvWrittenPayload,
  type PluginSessionsFace,
  type SessionsDriverOf,
} from './sessions-face.js';

// 测试用插件词（过闸正路样本——词汇注册表单源）
registerEventType({
  type: 'sessions-face.test/note',
  category: 'surface',
  owner: 'sessions-face.test',
  tier: 'stable',
  description: 'sessions 服务面测试用事件词',
});

/** 断言抛指定码 */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable('未拒绝');
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
  }
}

/**
 * appendEvent 域最小依赖装配（cs-D1 批签名扩面后旧三段的等价替身——新四
 * 依赖以不触达桩注入：currentSessionId 恒 undefined 只影响只读三件，本域
 * 测试不触；store 桩零副作用）。
 */
function faceDeps(driverOf: SessionsDriverOf) {
  return {
    driverOf,
    currentSessionId: () => undefined,
    queryEvents: () => ({ events: [], nextCursor: null }),
    storeState: {
      get: () => undefined,
      set: () => undefined,
      delete: () => false,
    },
    onStateWritten: () => undefined,
  };
}

/** 内存驱动表（活引用语义的受控样本——按 sessionId 增删） */
function tableOf(): { table: Map<string, { session: SessionLog }>; driverOf: SessionsDriverOf } {
  const table = new Map<string, { session: SessionLog }>();
  return { table, driverOf: (sessionId) => table.get(sessionId) };
}

describe('sessions 服务面（createSessionsFace——06 §318 appendEvent 最小面）', () => {
  it('二道闸①：核心事件词伪造拒写（核心词写入权属宿主驱动单源）', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-core' });
    table.set('s-core', { session: log });
    const face = createSessionsFace(faceDeps(driverOf));
    const append = face.appendEventFor('s-core');
    expect(append).toBeTypeOf('function');
    // 核心词样本三枚：消息族/请求族各取一 + 会话生命周期词
    expectCode(() => append!('user/message', { content: '伪造' }), 'SESSION_CORE_TYPE_FORBIDDEN');
    expectCode(() => append!('request/header', { systemPrompt: 'x' }), 'SESSION_CORE_TYPE_FORBIDDEN');
    expect(log.events()).toHaveLength(0); // 拒写零落账
  });

  it('二道闸②：未注册词汇拒写（前置闸先于下游——错误信息带服务面上下文）', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-unknown' });
    table.set('s-unknown', { session: log });
    const face = createSessionsFace(faceDeps(driverOf));
    const append = face.appendEventFor('s-unknown')!;
    try {
      append('no-such-thing/event', { any: true });
      expect.unreachable('未拒绝');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      expect((err as BaseError).code).toBe('SESSION_UNKNOWN_EVENT_TYPE');
      expect((err as BaseError).message).toContain('sessions.appendEventFor'); // 服务面上下文可辨
    }
    expect(log.events()).toHaveLength(0);
  });

  it('过闸正路：已注册插件词直达 log.append（同步落账 + 返回值回传）', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-ok' });
    table.set('s-ok', { session: log });
    const face = createSessionsFace(faceDeps(driverOf));
    const append = face.appendEventFor('s-ok')!;
    const returned = append('sessions-face.test/note', { note: '甲' });
    // 返回值 = append 落账事件本体（回传给消费方做溯源）
    expect(returned).toMatchObject({ type: 'sessions-face.test/note', seq: 0, data: { note: '甲' } });
    expect(log.events()).toHaveLength(1);
    expect(log.events()[0]).toMatchObject({ type: 'sessions-face.test/note', data: { note: '甲' } });
  });

  it('诚实缺席律：无活体驱动 undefined 降级（服务照常 provide——不造回库替身）', () => {
    const { driverOf } = tableOf();
    const face = createSessionsFace(faceDeps(driverOf));
    expect(face.appendEventFor('s-absent')).toBeUndefined();
  });

  it('活引用调用时点解析：取引用与调用两时点间驱动闭死 → 闸仍在（append 调用拍执法）', () => {
    const { table, driverOf } = tableOf();
    table.set('s-hot', { session: new SessionLog({ sessionId: 's-hot' }) });
    const face = createSessionsFace(faceDeps(driverOf));
    const append = face.appendEventFor('s-hot')!;
    // /new 热切换形：取引用后驱动表移除该会话（无活体驱动）——已取闭包仍可调
    // （其引用的 log 仍活体——闸执法在调用拍完成，词汇纪律不因热切换失效）
    table.delete('s-hot');
    expectCode(() => append('no-such/word', {}), 'SESSION_UNKNOWN_EVENT_TYPE');
    const log2 = new SessionLog({ sessionId: 's-hot-2' });
    table.set('s-hot-2', { session: log2 });
    const append2 = face.appendEventFor('s-hot-2')!;
    append2('sessions-face.test/note', { note: '乙' });
    expect(log2.events()).toHaveLength(1);
  });
});

describe('surfaceOp 信封参数腿（03 §4.5 修缝批——改道 appendWithSurfaceOp 正门）', () => {
  it('正路：携带信封经正门落账——指令事件携带 surfaceOp + 溯源数组 + 投影遮蔽生效', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-surf' });
    table.set('s-surf', { session: log });
    const face = createSessionsFace(faceDeps(driverOf));
    const append = face.appendEventFor('s-surf')!;
    // 底座两条真投影事件（宿主侧直 append——核心词写入权属宿主，测试即宿主位）
    log.append('user/message', { content: '旧消息一' });
    log.append('user/message', { content: '旧消息二' });
    const charsBefore = log.projectedChars();
    expect(charsBefore).toBeGreaterThan(0);
    // 遮 [0,1]：插件自定义压缩类操作形（受理注入词携信封——区间起点 0 对齐
    // turn 边界、无 tool 对可切，通用形全判据过）
    const returned = append(
      'sessions-face.test/note',
      { note: '归并摘要' },
      { op: 'replace', start: 0, end: 1 },
      [0, 1],
    );
    // 返回值 = 正门落账事件本体（信封随事件携带——回传消费方做溯源）
    expect(returned).toMatchObject({
      type: 'sessions-face.test/note',
      seq: 2,
      surfaceOp: { op: 'replace', start: 0, end: 1 },
      sourceEventSeqs: [0, 1],
    });
    expect(log.events()).toHaveLength(3);
    // 增量遮蔽摘除已在正门内执行（chars 减法腿——两条被遮消息的字符数已扣）
    expect(log.projectedChars()).toBeLessThan(charsBefore);
    expect(log.projection().some((m) => m.type === 'user')).toBe(false); // 被遮消息离投影
  });

  it('surfaceOp 路同过二道闸：核心词携信封照拦（词面收窄）+ 未注册词携信封照拦', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-gate' });
    table.set('s-gate', { session: log });
    const face = createSessionsFace(faceDeps(driverOf));
    const append = face.appendEventFor('s-gate')!;
    append('sessions-face.test/note', { note: '底座' });
    // 宿主核心词（compaction/surface 是宿主件词汇）携信封——受理面闸一先拦
    expectCode(
      () => append('compaction/surface', { summarySeq: 0 }, { op: 'replace', start: 0, end: 0 }, [0]),
      'SESSION_CORE_TYPE_FORBIDDEN',
    );
    expectCode(
      () => append('no-such/word', {}, { op: 'replace', start: 0, end: 0 }, [0]),
      'SESSION_UNKNOWN_EVENT_TYPE',
    );
    expect(log.events()).toHaveLength(1); // 两拒零落账（信封不豁免词汇闸）
  });

  it('正门同码执法：非法区间/溯源缺列经 SESSION_SURFACE_OP_INVALID 拒（受理面无第二校验面）', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-inv' });
    table.set('s-inv', { session: log });
    const face = createSessionsFace(faceDeps(driverOf));
    const append = face.appendEventFor('s-inv')!;
    append('sessions-face.test/note', { note: '底座' });
    // 区间越界（end 超日志尾）
    expectCode(
      () => append('sessions-face.test/note', {}, { op: 'replace', start: 0, end: 5 }),
      'SESSION_SURFACE_OP_INVALID',
    );
    // 溯源缺列（sourceEventSeqs 未传——溯源完整性律正门执法）
    expectCode(
      () => append('sessions-face.test/note', {}, { op: 'replace', start: 0, end: 0 }),
      'SESSION_SURFACE_OP_INVALID',
    );
    expect(log.events()).toHaveLength(1);
  });

  it('不携信封形零变化：旧调用面（两参）行为与返回值同前', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-plain' });
    table.set('s-plain', { session: log });
    const face = createSessionsFace(faceDeps(driverOf));
    const append = face.appendEventFor('s-plain')!;
    const returned = append('sessions-face.test/note', { note: '普通' });
    expect(returned).toMatchObject({ type: 'sessions-face.test/note', seq: 0 });
    expect(log.events()[0]).not.toHaveProperty('surfaceOp');
  });
});

describe('PluginSessionsFace 类型收窄（caller 位结构性缺席——归因闸闭包铸造）', () => {
  it('类型守卫：插件道类型面无 caller 参数位——自报归因须编译红（@ts-expect-error 执法在门禁一 tsc，vitest 不查类型）', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-type' });
    table.set('s-type', { session: log });
    // 绑定面产物即插件道消费面（PluginSessionsFace）：单参取引用正路照常可用
    const bound: PluginSessionsFace = bindSessionsForPlugin('demo', createSessionsFace(faceDeps(driverOf)));
    const append = bound.appendEventFor('s-type')!;
    append('sessions-face.test/note', { note: '类型笔' });
    // 归因键由绑定面闭包铸造（宿主单方拼装）——运行时腿：落账 data 恒带
    // source: plugin:demo（非自报，与类型收窄同一防冒名意图的行为面）
    expect(log.events()[0]).toMatchObject({ data: { note: '类型笔', source: 'plugin:demo' } });
    // caller 自报位在插件道类型面结构性不存在：传第二参须 TS2554 编译红
    // @ts-expect-error 插件道消费面已收窄无 caller 参数位——伪造归因在类型层即拒
    bound.appendEventFor('s-type', { kind: 'plugin', pluginId: 'fake' });
  });
});

// ═══ cs-D1 sessions 完整受理面批（2026-09-15——03 §4.4 只读四件落码定形注 +
// §4.5 store_state 兑现注）═══

/**
 * 完整依赖装配（cs-D1——读四件/store_state 腿的桩注入位）。判据真源注记：
 * currentSessionId 的尾键语义（SessionManager 活体 Map 尾键）归装配根与
 * conversation 域测试，本件只验透传；store 层动词以记录桩代真 SQLite
 * （受局面拼装/审计发射/行籍闸才是本件执法面——LRU/ttl 治理归 persist 域测）。
 */
function fullDepsOf(driverOf: SessionsDriverOf, currentId: { value: string | undefined }) {
  const queries: unknown[] = [];
  const kvWrites: KvWrittenPayload[] = [];
  const storeCalls: string[] = [];
  const storeValues = new Map<string, unknown>();
  const deps = {
    driverOf,
    currentSessionId: () => currentId.value,
    queryEvents: (filter: unknown) => {
      queries.push(filter);
      return { events: [], nextCursor: null };
    },
    storeState: {
      get: (key: string) => {
        storeCalls.push(`get ${key}`);
        return storeValues.has(key)
          ? { key, value: storeValues.get(key), kind: 'kv', expiresAt: undefined }
          : undefined;
      },
      set: (key: string, value: unknown) => {
        storeCalls.push(`set ${key}`);
        storeValues.set(key, value);
      },
      delete: (key: string) => {
        storeCalls.push(`delete ${key}`);
        return storeValues.delete(key);
      },
    },
    onStateWritten: (payload: KvWrittenPayload) => {
      kvWrites.push(payload);
    },
  };
  return { deps, queries, kvWrites, storeCalls, storeValues };
}

describe('只读四件（cs-D1——03 §4.4 落码定形注）', () => {
  it('currentSessionId：判据位透传（尾键语义归装配根注入）+ 无活体 undefined 诚实缺席', () => {
    const { table, driverOf } = tableOf();
    table.set('s-cur', { session: new SessionLog({ sessionId: 's-cur' }) });
    const currentId = { value: 's-cur' as string | undefined };
    const { deps } = fullDepsOf(driverOf, currentId);
    const face = createSessionsFace(deps);
    expect(face.currentSessionId()).toBe('s-cur');
    currentId.value = undefined; // 无活体会话——诚实缺席（不造 durable 替身）
    expect(face.currentSessionId()).toBeUndefined();
  });

  it('无活体会话即 SESSION_NO_ACTIVE_SESSION 拒（fail-loud 非静默空数组——「读到 []」与「无会话可读」分立）', () => {
    const { table, driverOf } = tableOf();
    table.set('s-a', { session: new SessionLog({ sessionId: 's-a' }) });
    // 形一：currentSessionId = undefined（无任何活体）
    const face1 = createSessionsFace(fullDepsOf(driverOf, { value: undefined }).deps);
    expectCode(() => face1.eventsOfType('sessions-face.test/note'), 'SESSION_NO_ACTIVE_SESSION');
    expectCode(() => face1.lastClosedBoundary(), 'SESSION_NO_ACTIVE_SESSION');
    // 形二：currentSessionId 指向的会话无活体驱动（判据位与会话表可瞬时分叉）
    const face2 = createSessionsFace(fullDepsOf(driverOf, { value: 's-gone' }).deps);
    expectCode(() => face2.eventsOfType('sessions-face.test/note'), 'SESSION_NO_ACTIVE_SESSION');
  });

  it('eventsOfType 正路：类型过滤 + fromSeq 窗口（锚活体 SessionLog——含在飞尾事件）', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-read' });
    // 宿主位直 append 底座（核心词写入权属宿主——测试即宿主位）
    log.append('user/message', { content: '甲' });
    log.append('sessions-face.test/note', { note: '一' });
    log.append('user/message', { content: '乙' });
    log.append('sessions-face.test/note', { note: '二' });
    table.set('s-read', { session: log });
    const face = createSessionsFace(fullDepsOf(driverOf, { value: 's-read' }).deps);
    const notes = face.eventsOfType('sessions-face.test/note');
    expect(notes).toHaveLength(2);
    expect(notes.map((e) => (e.data as { note: string }).note)).toEqual(['一', '二']);
    // fromSeq 窗口（增量读形）
    expect(face.eventsOfType('sessions-face.test/note', { fromSeq: 3 })).toHaveLength(1);
    // 在飞尾可见（锚活体 log 非 durable——write-behind 未落库窗内照读）
    log.append('sessions-face.test/note', { note: '在飞尾' });
    expect(face.eventsOfType('sessions-face.test/note')).toHaveLength(3);
  });

  it('lastClosedBoundary：-1 哨兵映射 undefined + 真边界 seq 透传（本面签名 number|undefined 单源）', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-b' });
    table.set('s-b', { session: log });
    const face = createSessionsFace(fullDepsOf(driverOf, { value: 's-b' }).deps);
    expect(face.lastClosedBoundary()).toBeUndefined(); // 无闭合 turn（原语 -1 哨兵）
    log.append('user/message', { content: '问' });
    log.append('turn/end', {});
    expect(face.lastClosedBoundary()).toBe(1); // turn/end 的 seq 透传
  });

  it('queryEvents：filter 恒等透传 + 结果透传（帽/游标单源在 persist——受理面零再帽）', () => {
    const { driverOf } = tableOf();
    const { deps, queries } = fullDepsOf(driverOf, { value: undefined });
    const face = createSessionsFace(deps);
    const filter = { sessionId: 's-hist', types: ['user/message'], limit: 500, cursor: 'tok' };
    const result = face.queryEvents(filter);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toBe(filter); // 引用恒等——零拷贝零改写零再帽
    expect(result).toEqual({ events: [], nextCursor: null });
  });
});

describe('storeStateFor 域绑定三动词（cs-D1——03 §4.5 兑现注）', () => {
  it('域前缀宿主单方拼装：三动词落库键恒 <pluginId>__<裸键名> + set options 透传', () => {
    const { driverOf } = tableOf();
    const { deps, storeCalls, storeValues } = fullDepsOf(driverOf, { value: undefined });
    const face = createSessionsFace(deps);
    const kv = face.storeStateFor('demo');
    kv.set('k1', { n: 1 }, { ttlMs: 60000, kind: 'state' });
    expect(storeCalls).toEqual(['set demo__k1']); // 前缀铸造 + 裸键不透出 store 层以外
    kv.set('k2', 'v2');
    expect(kv.get('k1')).toMatchObject({ key: 'demo__k1', value: { n: 1 }, kind: 'kv' });
    expect(storeCalls).toEqual(['set demo__k1', 'set demo__k2', 'get demo__k1']);
    expect(kv.delete('k2')).toBe(true);
    expect(storeValues.has('demo__k2')).toBe(false);
  });

  it('kv/written 发射形：set 成功尾 {pluginId, key 裸, action:"set"}——载荷恰三键、值与 ttl/kind 恒不入', () => {
    const { driverOf } = tableOf();
    const { deps, kvWrites } = fullDepsOf(driverOf, { value: undefined });
    const face = createSessionsFace(deps);
    face.storeStateFor('demo').set('token-ish', { secret: '值不得入账' }, { ttlMs: 1000 });
    expect(kvWrites).toEqual([{ pluginId: 'demo', key: 'token-ish', action: 'set' }]);
    // 载荷键集恰三枚（值/元数据恒不入——credentials/changed 同律）
    expect(Object.keys(kvWrites[0]!).sort()).toEqual(['action', 'key', 'pluginId']);
  });

  it('delete 落账判据 = 实际移除行：no-op 删除零发射；get 零落账（账记状态变迁非调用意图）', () => {
    const { driverOf } = tableOf();
    const { deps, kvWrites, storeCalls } = fullDepsOf(driverOf, { value: undefined });
    const face = createSessionsFace(deps);
    const kv = face.storeStateFor('demo');
    expect(kv.delete('absent')).toBe(false); // 行不在场——no-op
    expect(kv.get('absent')).toBeUndefined();
    kv.set('real', 1);
    expect(kv.delete('real')).toBe(true); // 实际移除
    expect(kvWrites).toEqual([
      { pluginId: 'demo', key: 'real', action: 'set' },
      { pluginId: 'demo', key: 'real', action: 'delete' },
    ]); // 前两动词（no-op delete/get）零发射
    expect(storeCalls).toEqual(['delete demo__absent', 'get demo__absent', 'set demo__real', 'delete demo__real']);
  });

  it('失败路径零审计：store 层抛即上抛（受理面不吞错）且无发射', () => {
    const { driverOf } = tableOf();
    const { deps, kvWrites } = fullDepsOf(driverOf, { value: undefined });
    deps.storeState.set = () => {
      throw new Error('store down');
    };
    const face = createSessionsFace(deps);
    expect(() => face.storeStateFor('demo').set('k', 1)).toThrow('store down');
    expect(kvWrites).toHaveLength(0); // 成功尾语义——失败零审计
  });
});

describe('bindSessionsForPlugin storeState 直连（cs-D1——行籍闸单拍形）', () => {
  it('插件面三动词直连：域前缀随绑定闭包铸造 + 类型面 storeStateFor 结构性缺席（防冒名单源）', () => {
    const { table, driverOf } = tableOf();
    table.set('s-kv', { session: new SessionLog({ sessionId: 's-kv' }) });
    const { deps, storeCalls } = fullDepsOf(driverOf, { value: 's-kv' });
    const bound = bindSessionsForPlugin('demo', createSessionsFace(deps));
    bound.storeState.set('k', { v: 1 });
    bound.storeState.set('k2', 2);
    expect(storeCalls).toEqual(['set demo__k', 'set demo__k2']); // 前缀 = 绑定行 id（闭包铸造）
    expect(bound.storeState.get('k')).toMatchObject({ key: 'demo__k' });
    // 域绑定面在插件道类型面结构性缺席：自选 pluginId 须编译红（@ts-expect-error
    // 执法在门禁一 tsc）；运行时面同证——成员本身不存在（防冒名单源双面同律）
    // @ts-expect-error 插件道消费面无 storeStateFor 成员——冒名铸域在类型层即拒
    expect(bound.storeStateFor).toBeUndefined();
  });

  it('行籍闸单拍：行死 set/delete 拒 PLUGIN_WINDOW_CLOSED、get 读径无闸（读不是写径——§4.4 同律）', () => {
    const { table, driverOf } = tableOf();
    table.set('s-g', { session: new SessionLog({ sessionId: 's-g' }) });
    const { deps, storeCalls } = fullDepsOf(driverOf, { value: 's-g' });
    let active = true;
    const bound = bindSessionsForPlugin('demo', createSessionsFace(deps), () => active);
    bound.storeState.set('k', 1); // 行活期正写
    active = false; // 装载代回卷（scope 回卷/换代）
    expectCode(() => bound.storeState.set('k', 2), 'PLUGIN_WINDOW_CLOSED');
    expectCode(() => bound.storeState.delete('k'), 'PLUGIN_WINDOW_CLOSED');
    expect(bound.storeState.get('k')).toMatchObject({ key: 'demo__k' }); // 读径无闸——残柄读无害
    expect(storeCalls).toEqual(['set demo__k', 'get demo__k']); // 两拒零触达 store 层
  });

  it('跨插件域隔离：同名裸键经不同绑定落不同前缀（结构性隔离——插件读不到兄弟插件键值）', () => {
    const { driverOf } = tableOf();
    const { deps, storeValues } = fullDepsOf(driverOf, { value: undefined });
    const face = createSessionsFace(deps);
    const kvA = face.storeStateFor('plugin-a');
    const kvB = face.storeStateFor('plugin-b');
    kvA.set('shared', '甲的值');
    kvB.set('shared', '乙的值');
    expect(storeValues.get('plugin-a__shared')).toBe('甲的值');
    expect(storeValues.get('plugin-b__shared')).toBe('乙的值');
    expect(kvA.get('shared')).toMatchObject({ value: '甲的值' }); // 各自域内互不可见
  });
});
