/**
 * webui/server 传输面集成测试（批 18a-1；批 18a-2' 改形迁移——承载位改
 * 注册 sdk 路由扩展位）。
 *
 * 全环真监听（127.0.0.1 实配 TCP；port 0 由内核指派）——fetch / node:http
 * 真请求；注入面全桩（mock 只停在注入位）。装配形 = **面注册器直注互证**：
 * createSdkHttpFace 起真面 + mountWebui({...deps, register: face.register})
 * ——WebuiRouteDescriptor → SdkRouteDescriptor 方向性结构兼容（03 §10.4
 * 改形注⑤词面独立律）经真请求链双向互证（tests 不计边表账）。
 *
 * 改形断言面收窄注记（面级接管位）：三防线 403/鉴权 401 应答改面级 plain
 * text（原 JSON error 形）——Host/Origin 例只断状态码；in-handler 错误
 * （not_found/closed/too_large/overloaded/no_spa/bad_request）仍 JSON 形
 * 断言不变。锁八面——
 * ①三防线执法序（Host 403 / Origin 403·无 Origin 放行·同源过——面级先行）
 * ②鉴权门（无凭证/错 token 401 / Bearer 过 / auth cookie 桥 Set-Cookie 属性
 * 与 cookie 形复用）
 * ③微路由六撮（探活/会话族含 closed·missing 分账/补全族缺席诚实空；/export
 *   markdown 直出三态——2026-09-17 TUI 余量收官批②；档位面三端点——2026-09-18
 *   webui 档位面受理批：501 判先于会话态 404 / GET 全形状含无锚 null 形 /
 *   fold 坏词面级 500 / PUT 坏词 400 码族词面 / 体帽显式 256KiB 位；DELETE
 *   删除端点三态分档 + 已闭可删 + 501 缺席先于三态——2026-10-07 会话删除编排批；
 *   /attachments 附件读回端点判序四态 + submit images 受理扩形——2026-10-08
 *   剪贴板附件批 03 §10.4 ①④⑥）
 * ④体限幅 413 且应答不早于收完（排空后应答——拿到应答即证无 RST 连坐）
 * ⑤SSE 信封分档（display 活体 / session 终结镜像 / asked 镜像）与按会话
 * 路由（status 定向 / notify 广播）
 * ⑥跨入口审批全环（ask → approvals 清单 → decide applied → 再 decide
 * superseded → 清单出清；abort 撤销清槽；未知 id superseded）
 * ⑦连接帽 503 / 静态面（index/内容型/SPA fallback/穿越拒/未装配 404）
 * ⑧收场丢弃性结算（未决 ask 不 resolve——行回卷语义；监听关停归面）
 * ⑨WEBUI_ENDPOINTS 双表对拍（客户端副本 vs 服务端单源整表恒等——词面单源执法）
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSdkHttpFace, type SdkHttpFaceHandle } from '../sdk/http.js';
import type { SdkHttpBridge } from '../sdk/types.js';
import { BaseError } from '../contracts/index.js';
import type { AgentMessage, UiSessionDeleteResult } from '../contracts/index.js';
import type { SessionEnvelope } from '../channels/index.js';
// 对拍锁消费（挖掘 20 轮件3）：channels 公开面（sdk index `export *` 通）
import { PromptImageSchema } from '../channels/index.js';
import { SubmitImageSchema } from './server.js';
import type {
  WebuiDeps,
  WebuiEnvelope,
  WebuiMountHandle,
  WebuiMountOptions,
  WebuiSessionState,
  WebuiSubmitInput,
} from './index.js';
import { mountWebui } from './server.js';
import { WEBUI_ENDPOINTS as WEBUI_ENDPOINTS_SERVER, type WebuiMessageItem } from './types.js';
import { WEBUI_ENDPOINTS as WEBUI_ENDPOINTS_CLIENT } from './client/protocol.js';

/* ---------------- 注入面桩（装配桥最小同构） ---------------- */

/** 会话族/读面/档位面桩台账 */
interface DepsStub {
  readonly deps: WebuiDeps;
  readonly submitted: WebuiSubmitInput[];
  readonly interrupted: string[];
  readonly created: string[];
  /** 删除受理记账（deleted 态到达的会话 id——busy/missing 不入账） */
  readonly deleted: string[];
  /** 档位面 PUT 受理记账（thinking 侧——回执与坏词形的对拍锚） */
  readonly setLevels: Array<{ readonly sessionId: string; readonly level: string }>;
  /** 档位面 PUT 受理记账（sandbox 侧） */
  readonly setModes: Array<{ readonly sessionId: string; readonly mode: string }>;
  setSession(sessionId: string, state: WebuiSessionState): void;
}

/** 附件读回命中锚（03 §10.4 ④——s-img 桩首枚 image-ref 同 ref：读回桩与投影
 *  桩共用一枚内容地址，端点腿与投影腿各取所需） */
const ATTACHMENT_REF_IN_STORE = 'sha256:' + 'a1'.repeat(32);

function makeDeps(opts?: {
  readonly withoutTodo?: boolean;
  readonly withoutCompletion?: boolean;
  readonly withoutExport?: boolean;
  /** jsonl 键单独缺席（exportMarkdown 照注——键缺席 = jsonl 请求 501 诚实缺席形） */
  readonly withoutExportJsonl?: boolean;
  /** 档位面整面缺席（三端点 501 诚实缺席形） */
  readonly withoutTiers?: boolean;
  /** 删除键缺席（DELETE 端点 501 诚实缺席形——WebuiSessionsFace.deleteSession 可选键） */
  readonly withoutDelete?: boolean;
  /** 附件读回键缺席（GET /api/attachments/:ref 端点 501 诚实缺席形——03 §10.4 ④） */
  readonly withoutAttachment?: boolean;
  /** fold 坏词形（tiersOf 抛 BaseError——面级 500 路；冷读 CR-TIER-2 边缘三形之三） */
  readonly foldBadWord?: boolean;
  /** submit 幂等冲突形（桥 submitPrompt 抛 SDK_MESSAGE_CONFLICT——409 结构码路） */
  readonly conflictSubmit?: boolean;
  /** submit 竞窗收口形（挖掘 20 轮：桥前置复检抛 SESSION_NOT_FOUND——先决门
   * 判 open 后受理前会话被删的 TOCTOU 窗，HTTP 面应折 404 not_found 与先决
   * 门同档——修前无 catch 走面级 500） */
  readonly raceGoneSubmit?: boolean;
  /** submit 受理拒形（桥 submitPrompt 抛 status 400 异常——AttachmentIntakeRejectionError
   *  鸭子形最小同构：件侧窄 catch 折 400 bad_request 的对拍锚，03 §10.4 ②） */
  readonly intakeReject?: string;
  /** 信封腿取值 seam 注入（卡② 腿②——缺席 = 降级形：message_end 帧不挂 seq） */
  readonly tailSeqOf?: (sessionId: string) => number | undefined;
}): DepsStub {
  const states = new Map<string, WebuiSessionState>([
    ['s-1', 'open'],
    ['s-closed', 'closed'],
    // busy 拒删档专用：在飞 run 形（桩面以 id 定档——删除回执 busy 分账锚）
    ['s-busy', 'open'],
    // 档位面专用：thinking 无锚形会话（fold 与 boot 均缺席 → GET tiers 应答
    // thinkingLevel: null——冷读 CR-TIER-2 边缘三形之二）
    ['s-noanchor', 'open'],
    // 携图会话（投影 images 位测试锚——messages 桩 s-img 行的在场态）
    ['s-img', 'open'],
  ]);
  // 桩投影（卡② 腿①——读面应答逐条带 seq：fetchMessages 返回形翻 WebuiMessageItem，
  // 桩数据同步贴 seq 锚位——内容面对注入位 opaque，seq 逐条在场即锁）
  const messages = new Map<string, WebuiMessageItem[]>([
    ['s-1', [{ role: 'user', content: '问', timestamp: 1_690_000_000_000, seq: 0 }]],
    ['s-closed', [{ role: 'user', content: '旧账', timestamp: 1_680_000_000_000, seq: 2 }]],
    // 携图会话（剪贴板附件批 03 §10.4 ⑥ 投影 images 位测试锚）：user content
    // 块数组含 image-ref 引用块两枚（受理位铸形——引用形非内联 base64），
    // GET messages 应答须映射 images 位 {ref, mimeType}[]；assistant 行零图
    // 作对照（投影 images 位只辖 user 消息）
    [
      's-img',
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: '看这两张图' },
            { type: 'image-ref', ref: 'sha256:' + 'a1'.repeat(32), mimeType: 'image/png', bytes: 8 },
            { type: 'image-ref', ref: 'sha256:' + 'b2'.repeat(32), mimeType: 'image/webp', bytes: 6 },
          ],
          timestamp: 1_690_000_000_100,
          seq: 3,
        },
        { role: 'assistant', content: [{ type: 'text', text: '收到' }], timestamp: 1_690_000_000_200, seq: 4 },
      ],
    ],
  ]);
  // /export markdown 直出桩（renderSessionMarkdown 产出形的最小同构——内容
  // 面为注入面 opaque，拼装单源对拍归 host 桥测试件）
  const markdowns = new Map<string, string>([
    ['s-1', '# 会话导出 `s-1`\n\n- 导出时间：2026-09-17T00:00:00.000Z\n- 事件数：1\n'],
    ['s-closed', '# 会话导出 `s-closed`\n\n- 导出时间：2026-09-17T00:00:00.000Z\n- 事件数：1\n'],
  ]);
  // /export jsonl 直出桩（对偶面第三载体批——renderSessionJsonl 产出形最小
  // 同构：首行 _meta 裸对象 + 事件信封行；内容面为注入面 opaque）
  const jsonls = new Map<string, string>([
    ['s-1', `${JSON.stringify({ format: 'berry-agent/session', version: 1, exportedAt: 0 })}\n`],
    ['s-closed', `${JSON.stringify({ format: 'berry-agent/session', version: 1, exportedAt: 0 })}\n`],
  ]);
  const submitted: WebuiSubmitInput[] = [];
  const interrupted: string[] = [];
  const created: string[] = [];
  const deleted: string[] = [];
  const setLevels: Array<{ readonly sessionId: string; readonly level: string }> = [];
  const setModes: Array<{ readonly sessionId: string; readonly mode: string }> = [];
  let seq = 0;
  // 档位面桩（host 装配桥真身最小同构——2026-09-18 webui 档位面受理批）：
  // 词表 = 七档/三档词汇（词法面与 conversation/safety 单源同形）；detail 行
  // 文案透传（内容面为注入面 opaque，host 侧文案表对拍归 host 桥测试件——
  // danger 行锚钉死措辞以证透传保真）；坏词抛 BaseError 码族（conversation
  // append 面词法校验 fail-loud 同构——码面即 HTTP 应答 error 词对拍锚）
  const tierLevels: readonly string[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  const tierModes: readonly string[] = ['read-only', 'workspace-write', 'danger'];
  const tiers = {
    tiersOf: (id: string) => {
      // fold 坏词形：上抛不静默吞（服务端不 catch——面级 500 路）
      if (opts?.foldBadWord === true) {
        throw new BaseError(
          'SANDBOX_MODE_INVALID',
          'sandbox/mode 事件模式非法："danger-full"（三种取值：read-only / workspace-write / danger）',
        );
      }
      return {
        // s-noanchor = 无锚形会话（thinkingLevel: null——行集照常全量）
        thinkingLevel: id === 's-noanchor' ? null : 'medium',
        sandboxMode: 'workspace-write',
        thinkingLevels: tierLevels.map((level) => ({ level, detail: `thinking 档 ${level}` })),
        sandboxModes: tierModes.map((mode) => ({
          mode,
          // danger 行文案 = 07 §4.1 钉死措辞（透传保真锚——SPA 零硬编码）
          detail: mode === 'danger' ? '无沙箱——任何命令直跑宿主' : `sandbox 档 ${mode}`,
        })),
      };
    },
    setThinkingLevel: (id: string, level: string) => {
      if (!tierLevels.includes(level)) {
        throw new BaseError(
          'THINKING_LEVEL_INVALID',
          `思考级别无效：${JSON.stringify(level)}（可选值：off / minimal / low / medium / high / xhigh / max）`,
        );
      }
      setLevels.push({ sessionId: id, level });
      return `思考级别：${level}（下一轮对话起生效；该级别是否生效随模型能力）`;
    },
    setSandboxMode: (id: string, mode: string) => {
      if (!tierModes.includes(mode)) {
        throw new BaseError(
          'SANDBOX_MODE_INVALID',
          `沙箱模式无效：${JSON.stringify(mode)}（可选值：read-only / workspace-write / danger）`,
        );
      }
      setModes.push({ sessionId: id, mode });
      return `沙箱模式：${mode}（即刻生效于后续工具调用）`;
    },
  };
  const deps: WebuiDeps = {
    sessions: {
      createSession: () => {
        const id = `s-new-${++seq}`;
        created.push(id);
        states.set(id, 'open');
        return id;
      },
      listSessions: () => [{ id: 's-1', title: null, lastActivityAt: 1_690_000_000_001 }],
      countSessions: () => 1,
      sessionStateOf: (id) => states.get(id) ?? 'missing',
      submitPrompt: (input) => {
        // 幂等冲突形：同 messageId 异内容时桥 fail-loud 抛（admit 判据族与
        // SDK 线同源——0dcf5c9 接线）；HTTP 面应折 409 结构码而非面级 500
        if (opts?.conflictSubmit === true) {
          throw new BaseError('SDK_MESSAGE_CONFLICT', `messageId=${input.messageId} 同键异内容（幂等 admit 冲突档）`);
        }
        // 竞窗收口形（挖掘 20 轮）：真身 = 桥 submitPrompt 入口 isOpen 复检
        // fail-loud（setThinkingLevel 姊妹守卫同码同文）——桩最小同构
        if (opts?.raceGoneSubmit === true) {
          throw new BaseError('SESSION_NOT_FOUND', `会话已结束（${input.sessionId}）——请刷新页面或重新打开会话`);
        }
        // 受理拒形（03 §10.4 ②）：host 受理链拒 = 携 status 400 的普通 Error
        //（AttachmentIntakeRejectionError 鸭子形最小同构——件侧不可 import host
        // 模块，窄 catch 按 status 位折 400；文案五族中文白话住码面单源）
        if (opts?.intakeReject !== undefined) {
          throw Object.assign(new Error(opts.intakeReject), { status: 400 });
        }
        submitted.push(input);
        return { sessionId: input.sessionId };
      },
      interruptSession: (id) => {
        interrupted.push(id);
      },
      // 删除键（2026-10-07 会话删除编排批——可选键注入形同 tiers 件；缺席 =
      // DELETE 端点 501）。三态桩：s-busy 拒删档 / 缺席 missing 档 / 其余
      // 受理即删（含已闭——存储编排面射界，与 sessionStateOf 分账分立）
      ...(opts?.withoutDelete === true
        ? {}
        : {
            deleteSession: async (id: string): Promise<UiSessionDeleteResult> => {
              if (id === 's-busy') return { status: 'busy' };
              if ((states.get(id) ?? 'missing') === 'missing') return { status: 'missing' };
              deleted.push(id);
              states.delete(id); // 物理删后即缺席（后续存在性分账 missing）
              return { status: 'deleted' };
            },
          }),
    },
    read: {
      // 桩同构（第八轮深扫 laneF 件F1）：真身链 host 桥 fetchMessages =
      // stack.projectionOf → 缺席会话 loadSession 抛 PERSIST_DATA_CORRUPT
      //（persist/persistence.ts 同码）——桩对 missing 同构上抛（修前桩静默返
      // [] 测不出真链：存在性错走面级 500 而非 404 分账）
      fetchMessages: async (id) => {
        if ((states.get(id) ?? 'missing') === 'missing') {
          throw new BaseError('PERSIST_DATA_CORRUPT', `会话 ${id} 不存在（读未保存 id 或已删除——调用序检视）`);
        }
        return messages.get(id) ?? [];
      },
      ...(opts?.withoutTodo === true ? {} : { todoOf: () => [{ status: 'in-progress', content: '跑测' }] }),
      // 导出两键（03 §10.4 对偶面第三载体批——exportMarkdown/exportJsonl 分立
      // 可选键；withoutExport = seam 缺席两键皆不注、withoutExportJsonl = 仅
      // jsonl 键缺席——键缺席 = jsonl 请求 501 诚实缺席）
      ...(opts?.withoutExport === true
        ? {}
        : {
            exportMarkdown: (id: string) => markdowns.get(id),
            ...(opts?.withoutExportJsonl === true ? {} : { exportJsonl: (id: string) => jsonls.get(id) }),
          }),
      // 附件读回键（03 §10.4 ④——GET /api/attachments/:ref 的注入面；缺席 =
      // withoutAttachment 时键不注 → 501 诚实缺席形）。桩最小同构真身
      // host 桥读回：命中返 {bytes, mimeType}（bytes 为 Uint8Array——真身
      // persist attachment-store.read 的 Buffer 即其子型），不在场返 null。
      ...(opts?.withoutAttachment === true
        ? {}
        : {
            readAttachment: (ref: string) => {
              // 命中锚：PNG 魔数头（\x89PNG\r\n\x1a\n）+ 尾块——Content-Type
              // 由读回记录的 mimeType 单源派生，件侧不查扩展名
              if (ref === ATTACHMENT_REF_IN_STORE) {
                return {
                  bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]),
                  mimeType: 'image/png',
                };
              }
              return null;
            },
          }),
    },
    ...(opts?.withoutCompletion === true ? {} : { completion: { workspaceFiles: (q) => [`a/${q}.ts`] } }),
    // 档位面注入（缺席 = 三端点 501 诚实缺席——exportMarkdown 缺席同精神）
    ...(opts?.withoutTiers === true ? {} : { tiers }),
    // 信封腿取值 seam 注入（卡② 腿②——缺席 = 键不注入：降级形用例默认面）
    ...(opts?.tailSeqOf !== undefined ? { tailSeqOf: opts.tailSeqOf } : {}),
  };
  return {
    deps,
    submitted,
    interrupted,
    created,
    deleted,
    setLevels,
    setModes,
    setSession: (id, state) => {
      if (state === 'missing') states.delete(id);
      else states.set(id, state);
    },
  };
}

/** sdk 面桥桩最小同构（webui 全族走扩展路由不触核——八面惰性桩） */
function makeBridge(): SdkHttpBridge {
  return {
    submitPrompt: () => ({ sessionId: 's' }),
    lookupDedupeKey: () => undefined,
    interruptSession: () => {},
    queryEntries: () => ({ entries: [] }),
    listSessions: () => [],
    countSessions: () => 0,
    highWaterOf: () => undefined,
    sessionStateOf: () => 'missing',
    retryProbeOf: () => null,
  };
}

/* ---------------- SSE 读取腿（后台泵 + 顺序 next；ping 注释行天然跳过） ---------------- */

interface SseReader {
  next(): Promise<WebuiEnvelope | undefined>;
  abort(): void;
}

async function openSse(port: number, sessionId: string, token: string): Promise<SseReader> {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/events`, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const pending: WebuiEnvelope[] = [];
  const waiters: Array<(frame: WebuiEnvelope | undefined) => void> = [];
  let buffer = '';
  let done = false;
  (async (): Promise<void> => {
    try {
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const idx = buffer.indexOf('\n\n');
          if (idx === -1) break;
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
          if (dataLine === undefined) continue; // ping 注释行
          pending.push(JSON.parse(dataLine.slice(6)) as WebuiEnvelope);
          const waiter = waiters.shift();
          if (waiter !== undefined) waiter(pending.pop());
        }
      }
    } catch {
      // abort 收线——泵终止
    }
    done = true;
    for (const waiter of waiters.splice(0)) waiter(undefined);
  })();
  const next = (): Promise<WebuiEnvelope | undefined> =>
    new Promise((resolve) => {
      const frame = pending.shift();
      if (frame !== undefined || done) {
        resolve(frame);
        return;
      }
      waiters.push(resolve);
      setTimeout(() => {
        const at = waiters.indexOf(resolve);
        if (at !== -1) {
          waiters.splice(at, 1);
          resolve(undefined);
        }
      }, 2_000);
    });
  return { next, abort: () => controller.abort() };
}

/** 静默断言腿（「不该来的帧」——足额等 reader 自带 2s 静默窗：竞态短窗的
 * 残留 waiter 会偷走后续帧，静默断言必须等窗自尽） */
async function expectSilence(reader: SseReader): Promise<void> {
  expect(await reader.next()).toBeUndefined();
}

/** node:http 裸请求（Host/Origin/cookie 防线测试位——fetch 禁改受限头） */
function rawRequest(
  port: number,
  path: string,
  headers: Record<string, string>,
  method = 'GET',
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

describe('webui/server 传输面（微路由 + SSE + 跨入口审批）', () => {
  let face: SdkHttpFaceHandle | undefined;
  let webui: WebuiMountHandle | undefined;
  let stub: DepsStub;
  let port: number;
  let token: string;
  let dir: string | undefined;

  /** 单装配（面注册器直注——结构兼容互证位） */
  const rig = async (
    deps: WebuiDeps,
    mount?: WebuiMountOptions,
  ): Promise<{ face: SdkHttpFaceHandle; webui: WebuiMountHandle; port: number; token: string }> => {
    const f = createSdkHttpFace({ config: { tcp: { host: '127.0.0.1', port: 0 } }, bridge: makeBridge() });
    // face.register（SdkRouteRegistrar）直注 WebuiMountDeps.register——
    // 方向性结构兼容（WebuiRouteDescriptor 可赋值 SdkRouteDescriptor）
    const w = mountWebui({ ...deps, register: f.register }, mount);
    const info = await f.start();
    return { face: f, webui: w, port: info.tcp[0]!.port, token: f.token };
  };

  const boot = async (opts?: {
    readonly extraDeps?: Pick<WebuiDeps, 'staticDir'>;
    readonly mount?: WebuiMountOptions;
    readonly stubOpts?: Parameters<typeof makeDeps>[0];
  }): Promise<void> => {
    // 重启面（静态面在场例）：先收口旧面——监听不泄漏
    if (face !== undefined) {
      webui?.detach();
      await face.stop();
    }
    stub = makeDeps(opts?.stubOpts);
    const r = await rig({ ...stub.deps, ...opts?.extraDeps }, opts?.mount);
    face = r.face;
    webui = r.webui;
    port = r.port;
    token = r.token;
  };

  beforeEach(async () => {
    await boot();
  });

  afterEach(async () => {
    webui?.detach();
    await face?.stop();
    face = undefined;
    webui = undefined;
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  /** 公共头（Bearer 鉴权形） */
  const authHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    ...extra,
  });

  /** 能力位解包腿（capabilities 自报真后直用——消费面与核同律；focused 位
   * webui 实装忽略、测试恒传 false 走核标准形） */
  const pushEnvelope = (env: SessionEnvelope): void => webui!.backend.onEnvelope!(env, false);

  const get = async (
    path: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; json: unknown }> => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: authHeaders(headers) });
    const text = await res.text();
    return { status: res.status, json: text === '' ? null : (JSON.parse(text) as unknown) };
  };

  const post = async (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; json: unknown }> => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: authHeaders(headers),
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text === '' ? null : (JSON.parse(text) as unknown) };
  };

  /** PUT 腿（档位面两切档端点专用——体校验/回执对拍与 get/post 同形） */
  const put = async (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; json: unknown }> => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'PUT',
      headers: authHeaders(headers),
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text === '' ? null : (JSON.parse(text) as unknown) };
  };

  /** DELETE 腿（会话删除端点专用——零请求体；2026-10-07 会话删除编排批） */
  const del = async (
    path: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; json: unknown }> => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'DELETE',
      headers: authHeaders(headers),
    });
    const text = await res.text();
    return { status: res.status, json: text === '' ? null : (JSON.parse(text) as unknown) };
  };

  /* ---- ① 三防线（面级先行——403 应答为面级 plain text，断状态码） ---- */

  it('探活开面：GET /api/health 无鉴权 200 只回 ok', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('Host 防线：非回环 Host 403（DNS rebinding 面——面级 plain text 应答）', async () => {
    const r = await rawRequest(port, '/api/health', { host: 'evil.example.com' });
    expect(r.status).toBe(403);
  });

  it('Origin 硬防线：异源 403 / 无 Origin 放行 / 同源过', async () => {
    expect(
      (await rawRequest(port, '/api/health', { host: '127.0.0.1', origin: 'http://evil.example.com' })).status,
    ).toBe(403);
    expect((await rawRequest(port, '/api/health', { host: '127.0.0.1' })).status).toBe(200);
    expect(
      (await rawRequest(port, '/api/health', { host: '127.0.0.1', origin: `http://127.0.0.1:${port}` })).status,
    ).toBe(200);
  });

  /* ---- ② 鉴权门与 cookie 桥 ---- */

  it('鉴权门：/api/* 无凭证 401 / 错 token 401 / Bearer 实效过', async () => {
    const none = await fetch(`http://127.0.0.1:${port}/api/sessions`);
    expect(none.status).toBe(401);
    const wrong = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      headers: { authorization: 'Bearer deadbeef' },
    });
    expect(wrong.status).toBe(401);
    expect((await get('/api/sessions')).status).toBe(200);
  });

  it('auth cookie 桥：对 token → 204 + Set-Cookie 三属性；cookie 形复用过鉴权', async () => {
    const wrong = await fetch(`http://127.0.0.1:${port}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'nope' }),
    });
    expect(wrong.status).toBe(401);
    const res = await fetch(`http://127.0.0.1:${port}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(204);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('webui_token=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    // cookie 形复用（EventSource 无头位——桥的存在性证明）
    const viaCookie = await rawRequest(port, '/api/sessions', {
      host: '127.0.0.1',
      cookie: `webui_token=${token}`,
    });
    expect(viaCookie.status).toBe(200);
  });

  it('体校验：auth 体缺 token 400（typebox 收窄律——未知字段拒收）', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tok: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  /* ---- ③ 微路由会话族 ---- */

  it('sessions：GET 清单 / POST 开新（受理入桩记账）', async () => {
    const list = await get('/api/sessions');
    expect(list.status).toBe(200);
    // B2 截断披露：total 字段 = 全量总数（清单默认 100 窗，消费者可机读感知）
    expect(list.json).toEqual({
      sessions: [{ id: 's-1', title: null, lastActivityAt: 1_690_000_000_001 }],
      total: 1,
    });
    const created = await post('/api/sessions', {});
    expect(created.status).toBe(200);
    expect((created.json as { sessionId: string }).sessionId).toBe('s-new-1');
    expect(stub.created).toEqual(['s-new-1']);
  });

  it('messages：投影拉取；closed 会话兜底可拉（只读不受闭态拦）', async () => {
    const open = await get('/api/sessions/s-1/messages');
    expect(open.status).toBe(200);
    expect((open.json as { messages: AgentMessage[] }).messages).toHaveLength(1);
    const closed = await get('/api/sessions/s-closed/messages');
    expect(closed.status).toBe(200);
    expect((closed.json as { messages: AgentMessage[] }).messages[0]).toMatchObject({ role: 'user' });
  });

  it('投影 images 位映射：user 块数组的 image-ref 逐枚映 {ref, mimeType} 保序；assistant/纯文本行零 images 键（03 §10.4 ⑥）', async () => {
    // 修前红：WebuiMessageItem 无 images 位——携图 user 行的应答里图位缺场
    //（SPA 无从画图）；投影保持引用形（ref 内容地址），内联 base64 不回传
    const res = await get('/api/sessions/s-img/messages');
    expect(res.status).toBe(200);
    const items = (res.json as { messages: WebuiMessageItem[] }).messages;
    expect(items).toHaveLength(2);
    // user 行：content 块数组原样在场 + images 位两枚保序映射（text 块不入图位）
    expect(items[0]).toMatchObject({ role: 'user', seq: 3 });
    expect(items[0]!.images).toEqual([
      { ref: 'sha256:' + 'a1'.repeat(32), mimeType: 'image/png' },
      { ref: 'sha256:' + 'b2'.repeat(32), mimeType: 'image/webp' },
    ]);
    // assistant 对照行：零图 → images 键不注（缺省位缺省形，非 null 占位）
    expect(items[1]).toMatchObject({ role: 'assistant', seq: 4 });
    expect(items[1]!.images).toBeUndefined();
    // 纯文本对照：s-1 既有行零漂移（无 images 键）
    const plain = await get('/api/sessions/s-1/messages');
    const plainItems = (plain.json as { messages: WebuiMessageItem[] }).messages;
    expect(plainItems[0]!.images).toBeUndefined();
  });

  it('messages 会话态分账：missing 404 not_found（events 位镜像——修前红：同构桩上抛走面级 500）', async () => {
    // 第八轮深扫 laneF 件F1：修前 handler 无存在性检查，真链 fetchMessages →
    // loadSession 对缺席会话抛 PERSIST_DATA_CORRUPT → 面级 catch 500（存在性
    // 错误误报为内部错误）；修后与 events 位同词分账 404 not_found（03 §10.4
    // 定形注⑥「GET messages 先例同词」的本位兑现——closed 仍放行只读腿）
    const res = await fetch(`http://127.0.0.1:${port}/api/sessions/who-knows/messages`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404); // 修前红：500（存在性错未分账先入投影拉取）
    expect(await res.json()).toMatchObject({ error: 'not_found', message: '会话不存在' });
  });

  it('todo：数据源在场回条目；缺席诚实回 null', async () => {
    const withFace = await get('/api/sessions/s-1/todo');
    expect(withFace.status).toBe(200);
    expect((withFace.json as { items: unknown[] }).items).toEqual([{ status: 'in-progress', content: '跑测' }]);
    // 缺席面：重建一无 todoOf 的装配
    const bare = await rig(makeDeps({ withoutTodo: true }).deps);
    try {
      const res = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/s-1/todo`, {
        headers: { authorization: `Bearer ${bare.token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ items: null });
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
  });

  it('todo 会话态分账：missing 404 not_found（messages 位同词对齐——修前红：200 {items:null}）', async () => {
    // 第九轮深扫 laneE1 件2：messages 端点 404 分账（第八轮笔7 件F1）后
    // API 面唯一遗留不一致端点——修前对 missing 会话回 200 {items:null}，
    // 缺席会话被虚报为「无数据源」档（03 §10.4 定形注⑥存在性分账射界）
    const res = await fetch(`http://127.0.0.1:${port}/api/sessions/who-knows/todo`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404); // 修前红：200
    expect(await res.json()).toMatchObject({ error: 'not_found', message: '会话不存在' });
  });

  it('export：markdown 直出三态——open 200（Content-Type 精确值）/ missing 404 not_found / closed 近史兜底 200', async () => {
    // open 会话：markdown 正文直出（不落盘——web 面消费语义 = 浏览器/curl 直接取文）
    const open = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/export`, { headers: authHeaders() });
    expect(open.status).toBe(200);
    expect(open.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await open.text()).toBe('# 会话导出 `s-1`\n\n- 导出时间：2026-09-17T00:00:00.000Z\n- 事件数：1\n');
    // 缺席 404（error 词 not_found 同族；message 与 /api 兜底的「未知 API 路由」分立——锚真身非兜底）
    const missing = await fetch(`http://127.0.0.1:${port}/api/sessions/nope/export`, { headers: authHeaders() });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: 'not_found', message: '会话不存在' });
    // 已闭会话 = 近史投影兜底照常返体（读面语义同 GET messages——只读腿不受闭态拦，host 桥真身内兜底）
    const closed = await fetch(`http://127.0.0.1:${port}/api/sessions/s-closed/export`, { headers: authHeaders() });
    expect(closed.status).toBe(200);
    expect(closed.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await closed.text()).toBe('# 会话导出 `s-closed`\n\n- 导出时间：2026-09-17T00:00:00.000Z\n- 事件数：1\n');
  });

  it('export jsonl 查询参形：?format=jsonl 200 ndjson 直出 / 显式 markdown 零漂移 / 值域外 400 / 键缺席 501 / 缺席会话 404', async () => {
    // 修前红（对偶面第三载体批）：现端点无视查询参恒 markdown——
    // ?format=jsonl 拿到 text/markdown + markdown 桩体，ndjson 断言红
    const jsonl = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/export?format=jsonl`, {
      headers: authHeaders(),
    });
    expect(jsonl.status).toBe(200);
    expect(jsonl.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
    expect(await jsonl.text()).toBe(
      `${JSON.stringify({ format: 'berry-agent/session', version: 1, exportedAt: 0 })}\n`,
    );
    // 显式 markdown = 既有体零漂移（零参与既有调用面同体）
    const md = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/export?format=markdown`, {
      headers: authHeaders(),
    });
    expect(md.status).toBe(200);
    expect(md.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await md.text()).toBe('# 会话导出 `s-1`\n\n- 导出时间：2026-09-17T00:00:00.000Z\n- 事件数：1\n');
    // 值域外 → 400 bad_request（词法错先于状态错——03 §10.4 判序钉死）
    const bad = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/export?format=yaml`, {
      headers: authHeaders(),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      error: 'bad_request',
      message: '不支持的导出格式（format 须是 markdown 或 jsonl）',
    });
    // jsonl 形会话缺席 → 404 not_found（markdown 位同词）
    const missing = await fetch(`http://127.0.0.1:${port}/api/sessions/nope/export?format=jsonl`, {
      headers: authHeaders(),
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: 'not_found', message: '会话不存在' });
    // 已闭会话 = 事件流直出照常返体（读面语义同 markdown 位——只读腿不受闭态拦）
    const closed = await fetch(`http://127.0.0.1:${port}/api/sessions/s-closed/export?format=jsonl`, {
      headers: authHeaders(),
    });
    expect(closed.status).toBe(200);
    expect(closed.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
  });

  it('export jsonl 键缺席：只注 exportMarkdown 时 ?format=jsonl 501 诚实缺席（分立可选键）', async () => {
    // 测试装配分支腿：withoutExportJsonl 只摘 jsonl 键——markdown 请求照常
    // 200（与 withoutExport 的 seam 两键皆缺席形分立）
    const bare = await rig(makeDeps({ withoutExportJsonl: true }).deps);
    try {
      const jsonl = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/s-1/export?format=jsonl`, {
        headers: { authorization: `Bearer ${bare.token}` },
      });
      expect(jsonl.status).toBe(501);
      expect(await jsonl.json()).toMatchObject({
        error: 'not_implemented',
        message: '会话导出未启用（当前运行形态不含此功能）',
      });
      const md = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/s-1/export?format=markdown`, {
        headers: { authorization: `Bearer ${bare.token}` },
      });
      expect(md.status).toBe(200);
      expect(md.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
  });

  it('export 鉴权缺拒：无凭证 401（鉴权随全 API 面——cookie 桥/Bearer 双受理族）', async () => {
    const anon = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/export`);
    expect(anon.status).toBe(401);
  });

  it('export 注入窄面缺席：501 诚实缺席（WebuiCompletionFace? 缺席诚实空同精神）', async () => {
    const bare = await rig(makeDeps({ withoutExport: true }).deps);
    try {
      const res = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/s-1/export`, {
        headers: { authorization: `Bearer ${bare.token}` },
      });
      expect(res.status).toBe(501);
      expect(await res.json()).toMatchObject({ error: 'not_implemented' });
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
  });

  /* ---- ③ 附件读回端点 GET /api/attachments/:ref（2026-10-08 剪贴板附件批 03 §10.4 ④） ---- */

  it('attachments 判序四态：坏形 ref 400 → 注入键缺席 501 → 不在场 404 → 命中 200 字节回放（词法错先于状态错）', async () => {
    // ① 坏形 ref 400（词法层先执法——非 sha256:64hex 形即拒，不触读回面）
    const badRef = await get('/api/attachments/' + encodeURIComponent('not-a-ref'));
    expect(badRef.status).toBe(400); // 修前红：/api/* 兜底 404
    expect(badRef.json).toMatchObject({ error: 'bad_request' });
    // ② 注入键缺席 501（readAttachment 键不注——诚实缺席先于文件不在场）
    const bare = await rig(makeDeps({ withoutAttachment: true }).deps);
    try {
      const res = await fetch(`http://127.0.0.1:${bare.port}/api/attachments/${ATTACHMENT_REF_IN_STORE}`, {
        headers: { authorization: `Bearer ${bare.token}` },
      });
      expect(res.status).toBe(501); // 修前红：404（兜底吞掉缺席分档）
      expect(await res.json()).toMatchObject({ error: 'not_implemented' });
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
    // ③ 合形但不在场 404（读回返 null 档）
    const absent = await get('/api/attachments/sha256:' + 'ff'.repeat(32));
    expect(absent.status).toBe(404);
    expect(absent.json).toMatchObject({ error: 'not_found' });
    // ④ 命中 200：字节原样回放 + Content-Type 由读回记录 mimeType 单源派生
    const hit = await fetch(`http://127.0.0.1:${port}/api/attachments/${ATTACHMENT_REF_IN_STORE}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(hit.status).toBe(200);
    expect(hit.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await hit.arrayBuffer())).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]),
    );
  });

  it('attachments 鉴权缺拒：无凭证 401（鉴权随全 API 面——token-or-cookie 与 export 同族）', async () => {
    const anon = await fetch(`http://127.0.0.1:${port}/api/attachments/${ATTACHMENT_REF_IN_STORE}`);
    expect(anon.status).toBe(401);
  });

  /* ---- ③ 会话族 DELETE 删除端点（2026-10-07 会话删除编排批 webui 第三载体） ---- */

  it('DELETE 会话删除：三态分档（deleted 200 / busy 409 / missing 404）+ 已闭可删（存储编排面射界）', async () => {
    // deleted → 200 应答体 {status:'deleted'} + 受理入桩记账
    const ok = await del('/api/sessions/s-1');
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ status: 'deleted' });
    expect(stub.deleted).toEqual(['s-1']);
    // busy → 409 error 词 busy（message 人读因——TUI 确认视图状态行主体同句，
    // 载体专属键面尾巴不随 webui；submit 窄 catch SDK_MESSAGE_CONFLICT→409
    // 同面一致）
    const busy = await del('/api/sessions/s-busy');
    expect(busy.status).toBe(409);
    expect(busy.json).toMatchObject({ error: 'busy', message: '会话正在运行——等待完成或先打断后再删' });
    // missing → 404 not_found（GET messages 先例同词）
    const missing = await del('/api/sessions/who-knows');
    expect(missing.status).toBe(404);
    expect(missing.json).toMatchObject({ error: 'not_found', message: '会话不存在' });
    // 已闭会话可删（closed 非 404 档——删除面是存储编排面，与 tiers「已闭
    // 一律 404」的活体交互面射界分立；端点无 sessionStateOf 前置拦）
    const closed = await del('/api/sessions/s-closed');
    expect(closed.status).toBe(200);
    expect(closed.json).toEqual({ status: 'deleted' });
    expect(stub.deleted).toEqual(['s-1', 's-closed']);
  });

  it('DELETE 鉴权缺拒：无凭证 401（鉴权随全 API 面——token-or-cookie）', async () => {
    const anon = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1`, { method: 'DELETE' });
    expect(anon.status).toBe(401);
  });

  it('DELETE 注入窄面缺席：501 诚实缺席且判先于三态分账（GET /export 先例同序——冷读 CR-TIER-2）', async () => {
    const bare = await rig(makeDeps({ withoutDelete: true }).deps);
    try {
      // missing 会话仍 501（面缺席优先于编排回执分账——若序倒置则 404 即红）
      const res = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/who-knows`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${bare.token}` },
      });
      expect(res.status).toBe(501);
      expect(await res.json()).toMatchObject({ error: 'not_implemented' });
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
  });

  /* ---- ③ 档位面三端点（2026-09-18 webui 档位面受理批——GET tiers + 两 PUT） ---- */

  it('档位面鉴权缺拒：三端点无凭证 401（鉴权随全 API 面——token-or-cookie）', async () => {
    const tiers = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/tiers`);
    expect(tiers.status).toBe(401);
    const thinking = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/thinking-level`, { method: 'PUT' });
    expect(thinking.status).toBe(401);
    const sandbox = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/sandbox-mode`, { method: 'PUT' });
    expect(sandbox.status).toBe(401);
  });

  it('tiers：GET 200 全形状（四键齐 + 行集 detail 透传 + danger 钉死措辞）', async () => {
    const r = await get('/api/sessions/s-1/tiers');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      thinkingLevel: 'medium',
      sandboxMode: 'workspace-write',
      thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((level) => ({
        level,
        detail: `thinking 档 ${level}`,
      })),
      sandboxModes: [
        { mode: 'read-only', detail: 'sandbox 档 read-only' },
        { mode: 'workspace-write', detail: 'sandbox 档 workspace-write' },
        // danger 行 = 07 §4.1 钉死措辞透传（SPA 零硬编码的行文案单源证明）
        { mode: 'danger', detail: '无沙箱——任何命令直跑宿主' },
      ],
    });
  });

  it('tiers 无锚形：thinkingLevel = null（fold 与 boot 均缺席——行集照常全量、sandboxMode 恒有锚）', async () => {
    const r = await get('/api/sessions/s-noanchor/tiers');
    expect(r.status).toBe(200);
    const body = r.json as {
      thinkingLevel: string | null;
      sandboxMode: string;
      thinkingLevels: unknown[];
      sandboxModes: unknown[];
    };
    expect(body.thinkingLevel).toBeNull();
    expect(body.sandboxMode).toBe('workspace-write');
    expect(body.thinkingLevels).toHaveLength(7);
    expect(body.sandboxModes).toHaveLength(3);
  });

  it('tiers 会话态分账：missing 404 not_found / closed 404 closed（读写不分——档位面是会话活体交互面）', async () => {
    const missing = await get('/api/sessions/who-knows/tiers');
    expect(missing.status).toBe(404);
    expect(missing.json).toMatchObject({ error: 'not_found' });
    // 已闭一律 404 closed：messages//export 的已闭放行系正文读面语义，tiers 非正文读面
    const closed = await get('/api/sessions/s-closed/tiers');
    expect(closed.status).toBe(404);
    expect(closed.json).toMatchObject({ error: 'closed' });
  });

  it('档位面注入窄面缺席：三端点 501 诚实缺席且 501 判先于会话态 404（GET /export 先例同序——冷读 CR-TIER-2）', async () => {
    const bare = await rig(makeDeps({ withoutTiers: true }).deps);
    try {
      // GET：missing 会话仍 501（面缺席优先于会话存在性分账——若序倒置则 404 即红）
      const g = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/who-knows/tiers`, {
        headers: { authorization: `Bearer ${bare.token}` },
      });
      expect(g.status).toBe(501);
      expect(await g.json()).toMatchObject({ error: 'not_implemented' });
      // 两 PUT 同序（501 先于会话态与体校验）
      const p1 = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/who-knows/thinking-level`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bare.token}` },
        body: JSON.stringify({ level: 'high' }),
      });
      expect(p1.status).toBe(501);
      expect(await p1.json()).toMatchObject({ error: 'not_implemented' });
      const p2 = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/who-knows/sandbox-mode`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bare.token}` },
        body: JSON.stringify({ mode: 'read-only' }),
      });
      expect(p2.status).toBe(501);
      expect(await p2.json()).toMatchObject({ error: 'not_implemented' });
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
  });

  it('tiers fold 坏词：面级 500 不静默吞（冷读 CR-TIER-2 钉死——TUI 开屏 notify 降级形分立如实）', async () => {
    const broken = await rig(makeDeps({ foldBadWord: true }).deps);
    try {
      // 面抛上抛 → sdk 面监听器 catch → 500（面级 plain text 应答——断状态码即可）
      const res = await fetch(`http://127.0.0.1:${broken.port}/api/sessions/s-1/tiers`, {
        headers: { authorization: `Bearer ${broken.token}` },
      });
      expect(res.status).toBe(500);
    } finally {
      broken.webui.detach();
      await broken.face.stop();
    }
  });

  it('thinking-level：PUT 200 {receipt} 透传 + 受理记账；坏词 400 码族词面（THINKING_LEVEL_INVALID 不吞码）', async () => {
    const ok = await put('/api/sessions/s-1/thinking-level', { level: 'high' });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ receipt: '思考级别：high（下一轮对话起生效；该级别是否生效随模型能力）' });
    expect(stub.setLevels).toEqual([{ sessionId: 's-1', level: 'high' }]);
    // 坏词 fail-loud：400 + error 词 = 码族词面呈现（message 人读因透传）
    const bad = await put('/api/sessions/s-1/thinking-level', { level: 'ultra' });
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ error: 'THINKING_LEVEL_INVALID' });
    expect((bad.json as { message: string }).message).toContain('ultra');
    // 坏词不入账（词法校验在 append 前——受理记账长度不变）
    expect(stub.setLevels).toHaveLength(1);
  });

  it('sandbox-mode：PUT 200 {receipt} 透传 + 受理记账；坏词 400 SANDBOX_MODE_INVALID', async () => {
    const ok = await put('/api/sessions/s-1/sandbox-mode', { mode: 'read-only' });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ receipt: '沙箱模式：read-only（即刻生效于后续工具调用）' });
    expect(stub.setModes).toEqual([{ sessionId: 's-1', mode: 'read-only' }]);
    const bad = await put('/api/sessions/s-1/sandbox-mode', { mode: 'yolo' });
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ error: 'SANDBOX_MODE_INVALID' });
    expect(stub.setModes).toHaveLength(1);
  });

  it('档位面 PUT 体校验：键缺失 / 未知字段 / 键错位 / 坏 JSON → 400（typebox 收窄律）', async () => {
    expect((await put('/api/sessions/s-1/thinking-level', { value: 'high' })).status).toBe(400);
    expect((await put('/api/sessions/s-1/thinking-level', { level: 'high', extra: 1 })).status).toBe(400);
    // sandbox-mode 携 thinking 键 = 键错位（mode 键缺失）
    expect((await put('/api/sessions/s-1/sandbox-mode', { level: 'read-only' })).status).toBe(400);
    const bad = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/thinking-level`, {
      method: 'PUT',
      headers: authHeaders(),
      body: 'not-json',
    });
    expect(bad.status).toBe(400);
    // 坏体不入账（校验先于执行体调用）
    expect(stub.setLevels).toHaveLength(0);
    expect(stub.setModes).toHaveLength(0);
  });

  it('档位面 PUT 会话态分账：missing 404 not_found / closed 404 closed（对照 submit 词面）', async () => {
    const missing = await put('/api/sessions/who-knows/thinking-level', { level: 'high' });
    expect(missing.status).toBe(404);
    expect(missing.json).toMatchObject({ error: 'not_found' });
    const closed = await put('/api/sessions/s-closed/sandbox-mode', { mode: 'read-only' });
    expect(closed.status).toBe(404);
    expect(closed.json).toMatchObject({ error: 'closed' });
    // 两态均不入账
    expect(stub.setLevels).toHaveLength(0);
    expect(stub.setModes).toHaveLength(0);
  });

  it('档位面 PUT 体帽：描述符显式设值（sdk 面 10MiB 缺省不渗透——冷读 F2）超帽 413', async () => {
    // 件级帽注到 32B 的 rig：PUT 路由描述符显式携 bodyLimitBytes 才吃到件级帽；
    // 若描述符缺席该键则面级 10MiB 缺省渗透、本例不 413 即红——F2 防渗透牙
    const bare = await rig(stub.deps, { bodyLimitBytes: 32 });
    try {
      const res = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/s-1/thinking-level`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bare.token}`,
        },
        body: JSON.stringify({ level: 'x'.repeat(200) }),
      });
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: 'too_large' });
      const res2 = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/s-1/sandbox-mode`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bare.token}`,
        },
        body: JSON.stringify({ mode: 'y'.repeat(200) }),
      });
      expect(res2.status).toBe(413);
      expect(await res2.json()).toMatchObject({ error: 'too_large' });
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
  });

  it('submit：受理 200 + messageId 缺席 undefined 透传 / 显式透传（8572ccd 拍板——件侧不补生成）', async () => {
    const noId = await post('/api/sessions/s-1/submit', { text: '问' });
    expect(noId.status).toBe(200);
    expect(noId.json).toEqual({ sessionId: 's-1' });
    const withId = await post('/api/sessions/s-1/submit', { text: '再问', messageId: 'm-spa-1' });
    expect(withId.status).toBe(200);
    // 随真态翻档（原断言生成键 'webui-1'）：缺席形 = undefined 透传（无幂等
    // 不落账，桥侧容忍形 18a3cf8 前置判据收口）
    expect(stub.submitted).toEqual([
      { sessionId: 's-1', content: '问', messageId: undefined },
      { sessionId: 's-1', content: '再问', messageId: 'm-spa-1' },
    ]);
  });

  it('submit 体校验：缺 text / 未知字段 → 400', async () => {
    expect((await post('/api/sessions/s-1/submit', { content: 'x' })).status).toBe(400);
    expect((await post('/api/sessions/s-1/submit', { text: 'x', extra: 1 })).status).toBe(400);
    // 坏 JSON 同档
    const bad = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/submit`, {
      method: 'POST',
      headers: authHeaders(),
      body: 'not-json',
    });
    expect(bad.status).toBe(400);
  });

  it('submit 幂等冲突：桥抛 SDK_MESSAGE_CONFLICT → 409 结构码不吞码（tiers PUT catch 同形）', async () => {
    // SPA 重试携同 messageId 异内容时桥 admit fail-loud 抛（0dcf5c9 判据族
    // 与 SDK 线同源）——HTTP 面须折 409 + error=码族词（sdk/http.ts 码表
    // SDK_MESSAGE_CONFLICT→409 已有），修前无 catch 走面级 500 吞码
    const rigged = await rig(makeDeps({ conflictSubmit: true }).deps);
    try {
      const res = await fetch(`http://127.0.0.1:${rigged.port}/api/sessions/s-1/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${rigged.token}` },
        body: JSON.stringify({ text: '问', messageId: 'm-spa-1' }),
      });
      expect(res.status).toBe(409); // 修前红：500
      expect(await res.json()).toMatchObject({ error: 'SDK_MESSAGE_CONFLICT' }); // 修前红：面级 500 无结构码
    } finally {
      rigged.webui.detach();
      await rigged.face.stop();
    }
  });

  it('submit 竞窗收口：桥抛 SESSION_NOT_FOUND → 404 not_found（先决门同档；修前红：500）', async () => {
    // 挖掘 20 轮：先决门（sessionStateOf）判 open 与桥受理之间有删除竞窗
    // （DELETE 并发先落）——桥入口 isOpen 复检 fail-loud 抛 SESSION_NOT_FOUND
    // （setThinkingLevel 姊妹守卫同码族），HTTP 面窄 catch 折 404 not_found
    // 与先决门 missing 档同档；修前无此 catch 走面级 500 吞码
    const rigged = await rig(makeDeps({ raceGoneSubmit: true }).deps);
    try {
      const res = await fetch(`http://127.0.0.1:${rigged.port}/api/sessions/s-1/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${rigged.token}` },
        body: JSON.stringify({ text: '竞窗提交', messageId: 'm-race-1' }),
      });
      expect(res.status).toBe(404); // 修前红：500
      expect(await res.json()).toMatchObject({ error: 'not_found' }); // 修前红：面级 500 无结构码
    } finally {
      rigged.webui.detach();
      await rigged.face.stop();
    }
  });

  it('携图成员形对拍锁（挖掘 20 轮件3）：SubmitImageSchema ≡ channels PromptImageSchema——单侧增删字段/松 strict 即红', () => {
    // 剪贴板附件批宣称「形漂移由两线 schema 对拍锁」修前无锁——单侧漂移
    // （增删字段/松 strict/改 required）静默达线：webui 受理与 SDK 受理对同
    // 一粘贴载荷判分叉。对拍三面：properties 键集、required 集、strict
    // （additionalProperties——两侧同律收窄）。修前红形：两面私有未导出
    //（import 面缺口——对拍断言无处执法）
    const left = SubmitImageSchema as unknown as {
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
    const right = PromptImageSchema as unknown as {
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
    expect(Object.keys(left.properties).sort()).toEqual(Object.keys(right.properties).sort());
    expect([...(left.required ?? [])].sort()).toEqual([...(right.required ?? [])].sort());
    expect(left.additionalProperties).toBe(right.additionalProperties); // strict 同律
  });

  it('submit 携图：images 原形透传入桥（受理执法在 host——件侧零实现只透传，03 §10.4 ①）', async () => {
    // 修前红：SubmitSchema strict 收窄律拒未知字段 images → 400（本例红在
    // 400 ≠ 202 + 桩记账空）
    const images = [
      { data: 'aGVsbG8=', mimeType: 'image/png' },
      { data: 'eW91', mimeType: 'image/webp' },
    ];
    const r = await post('/api/sessions/s-1/submit', { text: '看图', images, messageId: 'm-img-1' });
    expect(r.status).toBe(200);
    expect(stub.submitted).toEqual([{ sessionId: 's-1', content: '看图', messageId: 'm-img-1', images }]);
  });

  it('submit images 坏形拒收：非数组/成员缺 data/成员未知字段 → 400 bad_request（形闸先于受理）', async () => {
    // strict 维持：images 选填扩形不开「未知字段」口子——成员载荷恰两字段
    const notArray = await post('/api/sessions/s-1/submit', { text: 'x', images: 'aGVsbG8=' });
    expect(notArray.status).toBe(400);
    expect(notArray.json).toMatchObject({ error: 'bad_request' });
    const missingData = await post('/api/sessions/s-1/submit', {
      text: 'x',
      images: [{ mimeType: 'image/png' }],
    });
    expect(missingData.status).toBe(400);
    const extraField = await post('/api/sessions/s-1/submit', {
      text: 'x',
      images: [{ data: 'aGVsbG8=', mimeType: 'image/png', bytes: 5 }],
    });
    expect(extraField.status).toBe(400);
    expect(stub.submitted).toEqual([]); // 三坏形均不触桥（形闸先于受理）
  });

  it('submit 受理拒折 400：host 受理链拒（携 status 400 异常）→ 400 bad_request 文案透传（03 §10.4 ②）', async () => {
    // 受理链（能力门→数量帽→base64→字节帽→魔数→MIME→像素帽）拒时桥抛
    // AttachmentIntakeRejectionError（status 400）——件侧窄 catch 折 400 +
    // 五族中文文案原样到达（文案单源住 host，件侧不复制不断言具体词）
    const rigged = await rig(makeDeps({ intakeReject: '单张图片不能超过 5MB' }).deps);
    try {
      const res = await fetch(`http://127.0.0.1:${rigged.port}/api/sessions/s-1/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${rigged.token}` },
        body: JSON.stringify({ text: '看图', images: [{ data: 'eW91', mimeType: 'image/png' }], messageId: 'm-big' }),
      });
      expect(res.status).toBe(400); // 修前红：500（无窄 catch 走面级兜底）
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe('bad_request');
      expect(body.message).toBe('单张图片不能超过 5MB');
    } finally {
      rigged.webui.detach();
      await rigged.face.stop();
    }
  });

  it('submit 体帽 32MiB 定值：挂载小帽不外泄到 submit 端点（per-route 显式帽——amplification 形不真发大包）', async () => {
    // 03 §10.4 ①：submit 体帽显式 32MiB（4 件 × 5MiB × base64 4/3 膨胀 +
    // 文本余量）——挂载缺省帽 2048B 档下 4KiB 载荷仍 202 即证端点级帽
    // 覆写生效（若沿用面级帽则 413 本例红）
    const bare = await rig(stub.deps, { bodyLimitBytes: 2048 });
    try {
      const res = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/s-1/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bare.token}` },
        body: JSON.stringify({ text: 'x'.repeat(4096), messageId: 'm-fat' }),
      });
      expect(res.status).toBe(200); // 修前红：413（面级帽 2048B 拦截）
      // 对照：/api/auth 仍按面级帽执法（小帽不因 submit 扩形全局放宽）
      const auth = await fetch(`http://127.0.0.1:${bare.port}/api/auth`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'x'.repeat(4096),
      });
      expect(auth.status).toBe(413);
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
  });

  it('interrupt：204 + 受理记账', async () => {
    const r = await post('/api/sessions/s-1/interrupt', {});
    expect(r.status).toBe(204);
    expect(r.json).toBeNull();
    expect(stub.interrupted).toEqual(['s-1']);
  });

  it('会话存在性分账：missing submit/events 404 not_found；closed submit 404 closed', async () => {
    const missingSubmit = await post('/api/sessions/nope/submit', { text: 'x' });
    expect(missingSubmit.status).toBe(404);
    expect(missingSubmit.json).toMatchObject({ error: 'not_found' });
    const missingEvents = await get('/api/sessions/nope/events');
    expect(missingEvents.status).toBe(404);
    const closedSubmit = await post('/api/sessions/s-closed/submit', { text: 'x' });
    expect(closedSubmit.status).toBe(404);
    expect(closedSubmit.json).toMatchObject({ error: 'closed' });
  });

  it('补全族：在场回注入面条目；缺席诚实空', async () => {
    const files = await get('/api/workspace/files?q=src');
    expect(files.status).toBe(200);
    expect(files.json).toEqual({ items: ['a/src.ts'] });
    // 面在场而 symbols 键缺席（恰 = host 桥生产形——completion 只含
    // workspaceFiles）：symbols 路由键级缺省位回诚实空（与整面缺席分立锁）
    const symbols = await get('/api/workspace/symbols?q=x');
    expect(symbols.status).toBe(200);
    expect(symbols.json).toEqual({ items: [] });
    // q 缺参形：handler queryOf(req).get('q') ?? '' 缺省位——q='' 走桩的空查询腿
    const noQuery = await get('/api/workspace/files');
    expect(noQuery.status).toBe(200);
    expect(noQuery.json).toEqual({ items: ['a/.ts'] });
    const bare = await rig(makeDeps({ withoutCompletion: true }).deps);
    try {
      const res = await fetch(`http://127.0.0.1:${bare.port}/api/workspace/symbols?q=x`, {
        headers: { authorization: `Bearer ${bare.token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ items: [] });
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
  });

  it('/api 兜底：未知 API 路径过鉴权门后 404 JSON（防 SPA fallback 吞程序面错路）', async () => {
    const unknown = await get('/api/who-knows');
    expect(unknown.status).toBe(404);
    expect(unknown.json).toMatchObject({ error: 'not_found' });
    // 鉴权先行语义维持：无凭证 401（先过门再 404）
    const anon = await fetch(`http://127.0.0.1:${port}/api/who-knows`);
    expect(anon.status).toBe(401);
  });

  /* ---- ④ 体限幅 ---- */

  it('POST 体超帽 413 且应答不早于收完（拿到应答即证排空后回——无 RST 连坐）', async () => {
    // 载体注记（剪贴板附件批 03 §10.4 ①）：submit 端点体帽升位定值 32MiB
    //（携图受理预算）后，本例改走 /api/auth 载体——挂载缺省帽 32B 档的
    // 面级漏斗腿对拍不变（submit 专属帽腿另立 amplification 例锁）
    const bare = await rig(stub.deps, { bodyLimitBytes: 32 });
    try {
      const res = await fetch(`http://127.0.0.1:${bare.port}/api/auth`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ token: 'x'.repeat(200) }),
      });
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: 'too_large' });
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
  });

  /* ---- ⑤ SSE 信封分档与路由 ---- */

  it('SSE 分档：update 走 display 族 / 终结型走 session 族（帧序保持）', async () => {
    const reader = await openSse(port, 's-1', token);
    try {
      pushEnvelope({ sessionId: 's-1', event: { type: 'message_start', role: 'assistant' } });
      pushEnvelope({
        sessionId: 's-1',
        event: { type: 'message_update', role: 'assistant', partial: { role: 'user', content: '部分', timestamp: 1 } },
      });
      pushEnvelope({
        sessionId: 's-1',
        event: {
          type: 'message_end',
          message: { role: 'user', content: '完', timestamp: 2 },
        },
      });
      const f1 = await reader.next();
      expect(f1).toMatchObject({ kind: 'display', sessionId: 's-1' });
      expect((f1 as { payload: { type: string } }).payload.type).toBe('message_start');
      const f2 = await reader.next();
      expect(f2?.kind).toBe('display');
      const f3 = await reader.next();
      expect(f3).toMatchObject({ kind: 'session', sessionId: 's-1' });
      expect((f3 as { payload: { type: string } }).payload.type).toBe('message_end');
      await expectSilence(reader);
    } finally {
      reader.abort();
    }
  });

  it('SSE 终结帧载荷镜像：tool_execution_end 携 result 整体（isError 位随行——SPA 失败分档供数半边）', async () => {
    // 分档判据定形注②的载荷半边：session 族帧 payload = AgentEvent 逐字镜像
    // （服务端无第二构造位），工具结果（含 isError）随帧整体到达——SPA 终态
    // 行失败分档（frames 终结行判 result.isError）的供数链在此锁死
    const reader = await openSse(port, 's-1', token);
    try {
      pushEnvelope({
        sessionId: 's-1',
        event: { type: 'tool_execution_end', toolCallId: 't-1', result: { content: [], isError: true } },
      });
      const frame = await reader.next();
      expect(frame).toEqual({
        kind: 'session',
        sessionId: 's-1',
        payload: { type: 'tool_execution_end', toolCallId: 't-1', result: { content: [], isError: true } },
      });
      await expectSilence(reader);
    } finally {
      reader.abort();
    }
  });

  it('信封腿（卡② 腿②）：message_end 帧外挂 seq 值等透传；tool_execution_end 帧不扩', async () => {
    // 03 §10.4 卡② 定谳版「信封载荷腿」：seq 挂 session 族信封帧外层（帧
    // 外挂位——payload 逐字镜像不动）；对账消费位唯 message_end，其余
    // session 族帧不扩。注入 fake 取值 seam（值面 opaque——透传保真即锁）。
    // 修前红：帧无 seq 字段——toMatchObject 字段在场即红。
    await boot({ stubOpts: { tailSeqOf: (id) => (id === 's-1' ? 7 : undefined) } });
    const reader = await openSse(port, 's-1', token);
    try {
      pushEnvelope({
        sessionId: 's-1',
        event: { type: 'message_end', message: { role: 'user', content: '完', timestamp: 2 } },
      });
      const frame = await reader.next();
      // 帧对象：外层 seq 在场且值等（取值 seam 透传）
      expect(frame).toMatchObject({ kind: 'session', sessionId: 's-1', seq: 7 });
      expect((frame as { payload: { type: string } }).payload.type).toBe('message_end');
      // 序列化保真：JSON 线面在场（SSE data 行携 "seq"——客户端线面消费锚）
      expect(JSON.stringify(frame)).toContain('"seq":7');
      // 其余 session 族帧不扩：tool_execution_end 帧无 seq 键（toEqual 整形锁）
      pushEnvelope({
        sessionId: 's-1',
        event: { type: 'tool_execution_end', toolCallId: 't-seq', result: { content: [], isError: false } },
      });
      const toolFrame = await reader.next();
      expect(toolFrame).toEqual({
        kind: 'session',
        sessionId: 's-1',
        payload: { type: 'tool_execution_end', toolCallId: 't-seq', result: { content: [], isError: false } },
      });
      await expectSilence(reader);
    } finally {
      reader.abort();
    }
  });

  it('信封腿降级形：tailSeqOf 缺席时 message_end 帧无 seq 键（旧装配兼容——客户端逐行回退路供数）', async () => {
    // 默认桩键级缺席（API-only/旧装配形）：帧不挂 seq——降级判据归客户端
    // 逐行（seq 缺席即走 (role,text) 多重集回退路），服务端不造 undefined 键
    const reader = await openSse(port, 's-1', token);
    try {
      pushEnvelope({
        sessionId: 's-1',
        event: { type: 'message_end', message: { role: 'user', content: '完', timestamp: 2 } },
      });
      const frame = await reader.next();
      expect(frame).toEqual({
        kind: 'session',
        sessionId: 's-1',
        payload: { type: 'message_end', message: { role: 'user', content: '完', timestamp: 2 } },
      }); // toEqual 整形锁：多出 seq 键即红（降级形不破）
      expect('seq' in frame!).toBe(false); // 上行 toEqual 已锁非 undefined——断言收窄
      await expectSilence(reader);
    } finally {
      reader.abort();
    }
  });

  it('断线重连一致性（D2①）：close 销账 hasAudience 翻 false → 断线窗事件零滞留 → 新流只收后续帧（live-only）', async () => {
    const r1 = await openSse(port, 's-1', token);
    // 在场观众登记（订阅即入册）
    expect(webui!.backend.hasAudience()).toBe(true);
    // 终结帧先达（session 镜像族——重连前事件锚）
    pushEnvelope({
      sessionId: 's-1',
      event: { type: 'message_end', message: { role: 'user', content: '一', timestamp: 2 } },
    });
    const f1 = await r1.next();
    expect(f1?.kind).toBe('session');
    // 断线：读者侧 abort → res close → 件侧销账（轮询至 hasAudience 翻 false——
    // 件侧销账位挂 res close，撤销即永不销账：hasAudience 恒 true 即缺陷）
    r1.abort();
    const t0 = Date.now();
    while (webui!.backend.hasAudience()) {
      if (Date.now() - t0 > 2_000) throw new Error('close 销账超时：hasAudience 恒 true（流账未摘）');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // 断线窗：事件照推不炸（无观众 = 按会话索引空集短路——零滞留零异常）
    pushEnvelope({ sessionId: 's-1', event: { type: 'message_start', role: 'assistant' } });
    // 重连：新流 live-only——断线前与断线窗的帧都不得补推（足额 2s 静默窗断言）
    const r2 = await openSse(port, 's-1', token);
    try {
      await expectSilence(r2);
      // 新流照常接收后续帧（重连不哑流）
      pushEnvelope({
        sessionId: 's-1',
        event: { type: 'message_end', message: { role: 'user', content: '二', timestamp: 3 } },
      });
      const f2 = await r2.next();
      expect(f2?.kind).toBe('session');
      expect((f2 as { payload: { type: string } }).payload.type).toBe('message_end');
    } finally {
      r2.abort();
    }
  });

  it('SSE 受理尾 status 快照（订阅建流即对齐——03 §10.6 ② 2026-10-04 注 webui 腿）：断连窗丢 agent_end 的重连观众收当前 status 信封恰一帧', async () => {
    // 第八轮深扫 laneF 件F2：run 在飞断连 → agent_end 落在断线窗（无观众零
    // 滞留既有律）→ 重连观众无终态帧可收 → run 账恒挂（打断键伪使能）——
    // 修形 = 流受理尾补发一帧当前 status 信封（缓存源 = setStatus emit 时
    // 随写；词汇零新增——session-scoped status 帧原帧复播）。修前红：零帧。
    const r1 = await openSse(port, 's-1', token);
    // run 在飞：setStatus 落一帧（受理尾快照的缓存源——emit 时随写）
    webui!.backend.setStatus!('s-1', '⚙ bash 慢命令 …');
    expect(await r1.next()).toEqual({ kind: 'status', sessionId: 's-1', payload: { status: '⚙ bash 慢命令 …' } });
    // 断连：agent_end 随即落入断线窗（无观众零滞留——重连观众无终态帧可收）
    r1.abort();
    const t0 = Date.now();
    while (webui!.backend.hasAudience()) {
      if (Date.now() - t0 > 2_000) throw new Error('close 销账超时：hasAudience 恒 true（流账未摘）');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    pushEnvelope({ sessionId: 's-1', event: { type: 'agent_end', status: 'completed' } });
    // 重连：受理尾补发恰一帧当前 status 快照（修前红：2s 静默窗 undefined 零帧）
    const r2 = await openSse(port, 's-1', token);
    try {
      const snapshot = await r2.next();
      expect(snapshot).toEqual({ kind: 'status', sessionId: 's-1', payload: { status: '⚙ bash 慢命令 …' } });
      // 恰一帧：不重放不循环（display/session 族断线帧仍零补推——live-only 不破）
      await expectSilence(r2);
    } finally {
      r2.abort();
    }
  });

  it('status 快照终态形与静默分账：run 已收口（末次 setStatus 终态词）重连收终态形；closed 空流恒静默不破', async () => {
    // 机制位锁（卡③勘正注）：末次 setStatus 即缓存帧原帧复播——终态词直达
    // 重连观众（打断键使能面的服务端权威供数）。本例直驱 setStatus 只锁
    // 机制位：现产线无 run 终态 setStatus 生产者（全库生产者仅切档回执 +
    // 插件 ctx.ui 透传位），「run 已收口末次帧恰为终态词」的产线形两案
    // 呈拍中（第九轮卡③）。closed 会话流恒静默既有律不破——不得向空流
    // 形造帧
    const r1 = await openSse(port, 's-1', token);
    webui!.backend.setStatus!('s-1', '⏹ 已中止');
    expect(await r1.next()).toEqual({ kind: 'status', sessionId: 's-1', payload: { status: '⏹ 已中止' } });
    r1.abort();
    // closed 会话：迟到 status 走写位生命周期门（第九轮件1——非 open 删旧
    // 不写新零扇出；修前「无观众窗只进缓存账」形已不可达）
    webui!.backend.setStatus!('s-closed', '✗ 失败 · 模型渠道未配置');
    const r2 = await openSse(port, 's-1', token);
    const rClosed = await openSse(port, 's-closed', token);
    try {
      expect(await r2.next()).toEqual({ kind: 'status', sessionId: 's-1', payload: { status: '⏹ 已中止' } });
      await expectSilence(r2);
      await expectSilence(rClosed); // closed 空流恒静默——快照不得破既有律
    } finally {
      r2.abort();
      rClosed.abort();
    }
  });

  it('status 缓存生命周期 = 会话生命周期：会话闭后迟到 setStatus 零扇出 + 快照不供数（修前红：帧直达 closed 空流）', async () => {
    // 第九轮深扫 laneE1 件1：lastStatusFrame 只写不删（含已闭/缺席会话的
    // 植入条目）无界增长；且修前 setStatus 对 closed 会话照常 live 扇出——
    // 「closed 空流恒静默」只在受理尾快照面成立（cd4cca0），live 推送面破
    // 律。修形 = 写位生命周期门（非 open 删旧不写新零扇出）+ 读位销账 +
    // 收场 clear + 写入顺带清谱。纯内存增长面（条目计数）无行为断言位——
    // 本例锁可观测半边（live 扇出与快照供数），清谱射程归 notes 诚实说明
    const closedReader = await openSse(port, 's-closed', token);
    try {
      // 迟到 status（会话已闭）：live 扇出不得破空流静默律——修前红：帧到达
      webui!.backend.setStatus!('s-closed', '迟到回执');
      await expectSilence(closedReader);
      // 对照弧：open 会话落缓存 → 会话转闭 → 受理尾快照不供数（既有律回归位）
      webui!.backend.setStatus!('s-1', '跑测中');
      stub.setSession('s-1', 'closed');
      const afterClose = await openSse(port, 's-1', token);
      try {
        await expectSilence(afterClose);
      } finally {
        afterClose.abort();
      }
    } finally {
      closedReader.abort();
    }
  });

  it('status 定向：只达订阅会话的流；notify 广播：全流皆达', async () => {
    const r1 = await openSse(port, 's-1', token);
    const r2 = await openSse(port, 's-closed', token);
    try {
      webui!.backend.setStatus!('s-1', '跑测中');
      const f1 = await r1.next();
      expect(f1).toEqual({ kind: 'status', sessionId: 's-1', payload: { status: '跑测中' } });
      await expectSilence(r2);
      webui!.backend.notify('你好', { level: 'info' });
      expect(await r1.next()).toMatchObject({ kind: 'notify' });
      expect(await r2.next()).toMatchObject({ kind: 'notify', payload: { message: '你好', level: 'info' } });
    } finally {
      r1.abort();
      r2.abort();
    }
  });

  it('未订阅会话零扇出（pushToSession 空索引短路——无观众不炸）', async () => {
    webui!.backend.setStatus!('s-1', '无人看');
    pushEnvelope({
      sessionId: 's-1',
      event: { type: 'message_start', role: 'assistant' },
    });
    webui!.backend.notify('无人听');
    expect(webui!.backend.hasAudience()).toBe(false);
  });

  /* ---- ⑥ 跨入口审批全环 ---- */

  it('审批全环：ask 镜像 → 清单 → decide applied → ask 落值 → 再 decide superseded → 清单出清', async () => {
    const reader = await openSse(port, 's-1', token);
    try {
      const asked = webui!.backend.askApproval!('s-1', { summary: '装插件 X', reason: '外部源' });
      // asked 镜像走 session 族（零新词汇——payload 复用 durable approval/asked 形）
      const mirror = await reader.next();
      expect(mirror?.kind).toBe('session');
      expect(mirror).toMatchObject({
        sessionId: 's-1',
        payload: { type: 'approval/asked', summary: '装插件 X', reason: '外部源' },
      });
      const approvalId = (mirror as { payload: { approvalId: string } }).payload.approvalId;
      expect(approvalId).toMatch(/^webui-\d+$/);
      // 清单投影
      const list = await get('/api/approvals');
      expect(list.json).toMatchObject({
        approvals: [{ approvalId, sessionId: 's-1', summary: '装插件 X', reason: '外部源' }],
      });
      // sessionId 过滤
      const filtered = await get('/api/approvals?sessionId=s-other');
      expect((filtered.json as { approvals: unknown[] }).approvals).toEqual([]);
      // decide：先到 applied
      const first = await post(`/api/approvals/${approvalId}/decide`, { answer: 'approve', note: '可以' });
      expect(first.status).toBe(200);
      expect(first.json).toEqual({ outcome: 'applied' });
      await expect(asked).resolves.toBe('approve');
      // 后到 superseded（幂等回执——先答先得）
      const second = await post(`/api/approvals/${approvalId}/decide`, { answer: 'reject' });
      expect(second.json).toEqual({ outcome: 'superseded' });
      // 清单出清
      const cleared = await get('/api/approvals');
      expect((cleared.json as { approvals: unknown[] }).approvals).toEqual([]);
    } finally {
      reader.abort();
    }
  });

  it('审批撤销：signal abort → ask 落 cancel + 清单出清；已决后迟到 abort 是 no-op', async () => {
    const reader = await openSse(port, 's-1', token);
    try {
      const controller = new AbortController();
      const asked = webui!.backend.askApproval!('s-1', { summary: '装 Y' }, { signal: controller.signal });
      const mirror = (await reader.next()) as { payload: { approvalId: string } };
      expect(mirror.payload.approvalId).toMatch(/^webui-\d+$/);
      controller.abort();
      await expect(asked).resolves.toBe('cancel');
      const afterAbort = await get('/api/approvals');
      expect((afterAbort.json as { approvals: unknown[] }).approvals).toEqual([]);
      // 已决后迟到 abort：ask 已落值不再改判
      const asked2 = webui!.backend.askApproval!('s-1', { summary: '装 Z' });
      const mirror2 = (await reader.next()) as { payload: { approvalId: string } };
      await post(`/api/approvals/${mirror2.payload.approvalId}/decide`, { answer: 'reject' });
      await expect(asked2).resolves.toBe('reject');
      expect(asked2).resolves.not.toBe('cancel');
    } finally {
      reader.abort();
    }
  });

  it('decide 未知 approvalId → superseded（幂等回执不造值）', async () => {
    const r = await post('/api/approvals/ghost/decide', { answer: 'approve' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ outcome: 'superseded' });
  });

  it('decide 体校验：answer 闭集外 → 400', async () => {
    expect((await post('/api/approvals/ghost/decide', { answer: 'maybe' })).status).toBe(400);
  });

  /* ---- ⑦ 连接帽与静态面 ---- */

  it('SSE 连接帽：超帽新连接 503 overloaded', async () => {
    const bare = await rig(stub.deps, { maxConnections: 1 });
    try {
      const r1 = await openSse(bare.port, 's-1', bare.token);
      const res = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/s-1/events`, {
        headers: { authorization: `Bearer ${bare.token}` },
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: 'overloaded' });
      r1.abort();
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
  });

  it('静态面缺席（API-only 形）：GET / 404 no_spa', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'no_spa' });
  });

  it('静态面在场：index/内容型/SPA fallback/穿越拒', async () => {
    dir = await mkdtemp(join(tmpdir(), 'webui-spa-'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>测</title>', 'utf8');
    await writeFile(join(dir, 'app.js'), 'console.log(1)', 'utf8');
    await boot({ extraDeps: { staticDir: dir } });
    const index = await fetch(`http://127.0.0.1:${port}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    const js = await fetch(`http://127.0.0.1:${port}/app.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('text/javascript');
    // SPA fallback：未知深路径回 index.html（前端路由接管）
    const deep = await fetch(`http://127.0.0.1:${port}/some/deep/route`);
    expect(deep.status).toBe(200);
    expect(deep.headers.get('content-type')).toContain('text/html');
    // 路径穿越：编码形出根即拒（403 forbidden）
    const escape = await rawRequest(port, '/..%2F..%2Fetc%2Fpasswd', { host: '127.0.0.1' });
    expect(escape.status).toBe(403);
    // 畸形百分号序列（decodeURIComponent 抛 URIError）：与未知路径同语义——
    // SPA fallback 回 index.html（非 500 internal 错误分档失真；未认证客户端可任意触发位）
    const malformed = await rawRequest(port, '/_%E0%A4', { host: '127.0.0.1' });
    expect(malformed.status).toBe(200);
    expect(malformed.headers['content-type']).toContain('text/html');
    expect(malformed.body).toContain('<!doctype html>');
  });

  /* ---- ⑧ 收场丢弃性结算 ---- */

  it('收场：未决 ask 不 resolve（行回卷丢弃性）+ 监听归零（面收口）', async () => {
    const asked = webui!.backend.askApproval!('s-1', { summary: '悬而未决' });
    const reader = await openSse(port, 's-1', token);
    webui!.detach();
    await face!.stop();
    face = undefined; // afterEach 不再二次 stop（幂等亦无害，示洁）
    const settled = await Promise.race([
      asked.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 150)),
    ]);
    expect(settled).toBe(false); // 丢弃性结算——清槽不造值
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow();
    reader.abort();
  });
});

/* ---------------- ⑨ 双表对拍锁（词面单源执法——tests 不计边表账） ---------------- */

describe('WEBUI_ENDPOINTS 双表对拍（客户端副本 vs 服务端单源）', () => {
  it('整表恒等：键集 + 逐键值（18 路径 19 端点口径——服务端改词面则客户端静默 404 的漂移面本例即红）', () => {
    // client/protocol.ts 头注承诺「与服务端 WEBUI_ENDPOINTS 同形同词面」——
    // 承诺升为可执行锁；toStrictEqual 整表锁含键集/逐键值/键序三面，
    // 任一侧改词面（含增删键）四门禁即红
    expect(WEBUI_ENDPOINTS_CLIENT).toStrictEqual(WEBUI_ENDPOINTS_SERVER);
  });
});
