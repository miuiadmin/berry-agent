/**
 * 结构兼容互证测试（05 §5.3 批 15d 词面独立律 / 04 §7 守门载荷补注）——
 *  - checkpoint 件自铸 RewindForkFace ↔ SessionManager：type-level 双向互赋
 *    （SessionManager.fork 参数逆变 + 返回超集结构兼容——组合根可直赋）
 *    + 真管理器跑 restoreRewind 三步序第③腿的运行时互操作（真库真驱动）；
 *  - SessionContextFace 组合根闭包形态互证：活体日志 lastClosedBoundary +
 *    列表面 workspaceRoot 组装（词面独立、结构兼容——零转换注入）。
 *
 * 本件是「词面独立、结构兼容」的执法锚——漂移即 typecheck/断言红。
 * （*.test.ts 拓扑豁免——checkpoint↔conversation 跨面互证唯一合法位。）
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventDispatch, Scope } from '../context/index.js';
import type { AgentMessage, Message } from '../contracts/index.js';
import { isStandardMessage } from '../contracts/index.js';
import { Persistence } from '../persist/persistence.js';
import { ephemeralSecretKey } from '../persist/secret-box.js';
import { ConversationDriver } from '../conversation/driver.js';
import { SessionManager } from '../conversation/sessions.js';
import type { SessionLog } from '../session/index.js';
import { createCapture } from './capture.js';
import { restoreRewind } from './restore.js';
import { openCheckpointStore, type CheckpointStore } from './store.js';
import { createCheckpointGate } from './gate.js';
import type { GateInput } from '../contracts/index.js';
import type { RewindForkFace, SessionContextFace } from './types.js';

// ── type-level 互赋（编译期即验——结构漂移 typecheck 红） ────────────────────
// SessionManager 整体可作 RewindForkFace 用（fork 方法参数 upToSeq 收窄 +
// 返回 ForkOutcome 超集——组合根注入位零包装直赋）。
const _managerAcceptsForkFace: RewindForkFace = null as unknown as SessionManager;
void _managerAcceptsForkFace;
// 反向：自铸面形态可被声明为同一结构（双向无窄化）
const _faceShape: RewindForkFace = null as unknown as {
  fork: (
    sourceSessionId: string,
    options: { upToSeq: number; title?: string },
  ) => Promise<
    | { status: 'forked'; sessionId: string; lineage?: { parentId: string; seedLength: number } }
    | { status: 'vetoed'; reason: string }
  >;
};
void _faceShape;

// ── 运行时互操作（真库 + 真管理器 + 真快照仓） ─────────────────────────────

let dir: string;
let ws: string;
let persistence: Persistence;
let store: CheckpointStore;

/** 缺省 convertToLlm：标准直通 */
const passthrough = (m: AgentMessage): Message | null => (isStandardMessage(m) ? m : null);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-checkpoint-compat-'));
  ws = mkdtempSync(join(tmpdir(), 'berry-checkpoint-compat-ws-'));
  writeFileSync(join(ws, 'file.txt'), 'v1', 'utf8');
  persistence = Persistence.open({
    dbPath: join(dir, 'main.db'),
    dataDir: join(dir, 'data'),
    secretKey: ephemeralSecretKey(),
  });
  store = openCheckpointStore(join(dir, 'cp-data'));
});

afterEach(async () => {
  await persistence.close().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
  rmSync(ws, { recursive: true, force: true });
});

/** 真管理器（sessions.test 同款测试台——dispatch/驱动工厂真形） */
function makeManager(): SessionManager {
  const dispatch = new EventDispatch();
  return new SessionManager({
    persistence,
    dispatch,
    createDriver: ({ session }) =>
      new ConversationDriver({
        session,
        scope: Scope.createRoot(),
        dispatch,
        streamFn: async () => {
          throw new Error('本测试面不驱动 run（纯编排断言）');
        },
        convertToLlm: passthrough,
        model: 'test/model',
      }),
  });
}

/** 一轮闭合 turn 的 durable 形态（推进 lastClosedBoundary） */
function closedTurn(log: SessionLog, text: string): void {
  log.append('turn/start', {});
  log.append('user/message', { content: text, source: 'user' });
  log.append('assistant/message', {
    content: [{ type: 'text', text: '答' }],
    usage: { input: 0, output: 0, cacheRead: 0, totalTokens: 0 },
    stopReason: 'stop',
  });
  log.append('turn/end', { reason: 'completed' });
}

/** 组合根形态的会话语境闭包（词面独立律的注入面——活体边界 + 列表面锚） */
function contextFaceOf(manager: SessionManager): SessionContextFace {
  return {
    contextOf: (sessionId) => {
      if (!manager.isOpen(sessionId)) return undefined;
      const log = manager.driverOf(sessionId)!.session;
      const root = manager.list().find((row) => row.id === sessionId)?.workspaceRoot ?? '';
      return { lastClosedBoundary: log.lastClosedBoundary(), workspaceRoot: root };
    },
  };
}

describe('checkpoint 面 ↔ 真 SessionManager 互操作', () => {
  it('restoreRewind 第③腿：真 fork 净边界起跑（旧史保留 + end-seed + 血缘 origin=fork）', async () => {
    const manager = makeManager();
    const opened = manager.create({ workspaceRoot: ws, title: '源会话' });
    closedTurn(opened.driver.session, '第一轮');
    await persistence.flush();
    closedTurn(opened.driver.session, '第二轮');
    // 拍点：两轮闭合后（boundary = 第二轮 turn/end 的 seq）
    const boundary = opened.driver.session.lastClosedBoundary();
    const manifest = await createCapture(store, { now: () => 1_000, newId: () => 'snap01' })({
      sessionId: opened.sessionId,
      boundarySeq: boundary,
      workspaceRoot: ws,
      trigger: 'mutation',
    });
    // 演化：第三轮闭合（boundary 推进）+ 文件变异
    closedTurn(opened.driver.session, '第三轮');
    writeFileSync(join(ws, 'file.txt'), 'v2', 'utf8');

    // 真管理器直赋 fork 面（零包装——结构兼容的运行时证明）
    const forkFace: RewindForkFace = manager;
    const receipt = await restoreRewind(
      { store, fork: forkFace, session: contextFaceOf(manager), invokingSessionId: opened.sessionId },
      manifest.id,
    );
    expect(receipt.forkedSessionId).toBeDefined();
    expect(receipt.restoredCount).toBe(1);
    expect(readFileSync(join(ws, 'file.txt'), 'utf8')).toBe('v1');

    // 新会话真在册且可 open：种子 = 前缀（boundary 截断）+ end-seed 尾条
    const forked = manager.open(receipt.forkedSessionId!);
    const events = forked.driver.session.events();
    const types = events.map((e) => e.type);
    expect(types[types.length - 1]).toBe('session/end-seed');
    expect(types.filter((t) => t === 'turn/end')).toHaveLength(2); // 第三轮不在种子内（净边界）
    // 源会话零污染：三轮全在
    expect(opened.driver.session.events().filter((e) => e.type === 'turn/end')).toHaveLength(3);
  });

  it('gate 守门与真会话语境互操作：边界推进触发拍、同 run 不重拍', async () => {
    const manager = makeManager();
    const opened = manager.create({ workspaceRoot: ws, title: '守门会话' });
    closedTurn(opened.driver.session, '第一轮');
    await persistence.flush();

    const sessionFace = contextFaceOf(manager);
    const capture = createCapture(store, { now: () => 1_000, newId: () => `snap${String(Date.now()).slice(-4)}` });
    const gate = createCheckpointGate({ capture, session: sessionFace });
    const writeTool = {
      name: 'write_file',
      description: '写',
      parameters: { type: 'object', properties: {} },
      effect: 'write' as const,
      execute: async () => ({ content: [] }),
    };
    const mkInput = (): GateInput => ({
      tool: writeTool,
      args: {},
      toolCallId: 'c1',
      mutated: false,
      sessionId: opened.sessionId,
    });
    const pass = async (v: GateInput) => v;

    // 首变异：拍（boundary = 第一轮末）
    await gate(mkInput(), pass);
    // 同 run 第二变异：不重拍
    await gate(mkInput(), pass);
    const manifestsAfterFirstRun = (await store.listManifests()).filter((m) => m.workspaceRoot === ws);
    expect(manifestsAfterFirstRun).toHaveLength(1);

    // turn 闭合后边界推进——新 run 首变异触发新拍
    closedTurn(opened.driver.session, '第二轮');
    await gate(mkInput(), pass);
    const manifestsAfterSecondRun = (await store.listManifests()).filter((m) => m.workspaceRoot === ws);
    expect(manifestsAfterSecondRun).toHaveLength(2);
    expect(manifestsAfterSecondRun.every((m) => m.sessionId === opened.sessionId)).toBe(true);
  });
});
