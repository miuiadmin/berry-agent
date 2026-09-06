/**
 * SDK 通道后端（UiBackend 第三实装——批 13b-3；03 §10.6 审批外推第三腿的
 * 通道侧消费位）。
 *
 * 架构位：把 {@link SdkWireCore}（单连接状态机）包成通道核可注册的
 * UiBackend——活体信封直推核的直播腿、审批 ask 走独立帧族外推（不占 seq
 * 不进 durable），decide 请求应答经幂等账回注 Promise（跨入口竞速先答先得
 * 的 SDK 腿——败者 decide 归 superseded）。
 *
 * 能力面：唯 approval 一位（线协议无 notify/confirm/select/input/setStatus/
 * setWidget 帧词汇——status 心跳已携带，widget 是 TUI/webui 呈现概念）。
 *
 * fail-closed（03 §10.6 第三腿）：ask 到来时该会话无订阅者即立即 resolve
 * `'cancel'`（headless 无人值守不豁免——与通道核「notify 化到底 cancel」
 * 同语义，本后端自身执法避免核级竞速挂死）。重连补推：hello 落订阅即该会话
 * 未决 ask 全量重推（调用方重启凭 hello 重收 ask 面，幂等账护住已决者）。
 *
 * 传输归宿主 serve（13c stdio）/core:sdk 件（13e HTTP+SSE）——装配桥喂
 * deps（除 decideApproval/onSubscribed 两面由本件自持），dispose 归连接
 * 生命周期收口。
 */
import type { ApprovalAskAnswer } from '../../contracts/index.js';
import type { SessionEnvelope, UiBackend } from '../types.js';
import type { SdkAskFrame } from './protocol.js';
import { SdkWireCore, type SdkWireDeps, type SdkWireOptions } from './wire-core.js';

/** 未决 ask 账项（幂等 decide 判据 + 重连重推载体） */
interface PendingAsk {
  /** 完整 ask 帧（重推 = 原帧再写——载荷零重组） */
  readonly frame: SdkAskFrame;
  /** 已决标记（先答先得后迟到 decide/abort 皆 no-op） */
  settled: boolean;
  readonly resolve: (answer: ApprovalAskAnswer) => void;
}

/** createSdkBackend 产物（后端 + 线核 + 收口三位——装配面 13c/13e 消费） */
export interface SdkBackendHandle {
  /** 通道核注册面（UiBackend 契约件） */
  readonly backend: UiBackend<never>;
  /** 线协议核（宿主行解码 → handleRequest / 定时 heartbeatTick+drain） */
  readonly core: SdkWireCore;
  /** 连接收口：在飞 ask 全部 cancel 保守收场 + core.close()（后续全静默） */
  dispose(): void;
}

/**
 * 造 SDK 通道后端（每连接一枚——core 即该连接的单连接状态机）。
 *
 * @param deps 装配桥注入面（decideApproval/onSubscribed 两面由本件自持——
 *   幂等账与重推编舞是后端语义不是桥语义）
 * @param options 线核构造选项（时钟/节拍/背压参——透传）
 */
export function createSdkBackend(
  deps: Omit<SdkWireDeps, 'decideApproval' | 'onSubscribed'>,
  options?: SdkWireOptions,
): SdkBackendHandle {
  /** 未决 ask 账（approvalId → 账项——decide 幂等判据 + 重推面） */
  const pending = new Map<string, PendingAsk>();
  /** 后端内 ask 计数（调用方未指派 approvalId 时生成 `sdk-N`——连接内唯一） */
  let askSeq = 0;

  const core = new SdkWireCore(
    {
      ...deps,
      // decide 应答：未决账项在册且未决 → 落定回执 applied；unknown/已决 →
      // superseded（跨入口竞速败者——03 §10.6 第三腿幂等语义）
      decideApproval: (approvalId, answer) => {
        const entry = pending.get(approvalId);
        if (entry === undefined || entry.settled) return 'superseded';
        entry.settled = true;
        pending.delete(approvalId);
        entry.resolve(answer);
        return 'applied';
      },
      // 订阅受理钩：该会话未决 ask 全量重推（重连后凭 hello 重收 ask 面；
      // 已决者早已出账——重推面天然只含未决）
      onSubscribed: (sessionId) => {
        for (const entry of pending.values()) {
          if (entry.frame.sessionId === sessionId) core.pushFrame(entry.frame, sessionId);
        }
      },
    },
    options,
  );

  const backend: UiBackend<never> = {
    id: 'sdk',
    // 唯 approval 一位（文件头能力面注）——其余 false 使核降级判定不路由本后端
    capabilities: {
      notify: false,
      confirm: false,
      select: false,
      input: false,
      approval: true,
      setStatus: false,
      setWidget: false,
    },
    // 观众探针：活跃订阅数（零订阅 = 无人接帧 = 无观众）
    hasAudience: () => core.subscriptionCount > 0,
    // 能力位 false——核不扇出本后端（方法在场纯为接口完备）
    notify: () => {},
    // 活体信封直推直播腿（focused 无 SDK 语义——订阅即全量，无聚焦降档）
    onEnvelope: (env: SessionEnvelope) => core.pushEvent(env.sessionId, env.event),
    askApproval: (sessionId, request, opts) =>
      new Promise<ApprovalAskAnswer>((resolve) => {
        // fail-closed：该会话无订阅者即无人可答——立即 cancel（帧不出站）
        if (!core.isSubscribed(sessionId)) {
          resolve('cancel');
          return;
        }
        const approvalId = request.approvalId ?? `sdk-${++askSeq}`;
        const frame: SdkAskFrame = {
          kind: 'ask',
          sessionId,
          approvalId,
          summary: request.summary,
          ...(request.reason !== undefined ? { reason: request.reason } : {}),
          ...(request.toolName !== undefined ? { toolName: request.toolName } : {}),
          ...(request.suggestedEntry !== undefined ? { suggestedEntry: request.suggestedEntry } : {}),
        };
        const entry: PendingAsk = { frame, settled: false, resolve };
        pending.set(approvalId, entry);
        core.pushFrame(frame, sessionId);
        // 败腿撤销（UiCore 竞速先答后 abort 传播位）：保守值 cancel + 出账
        //（迟到 decide 归 superseded）；已决后迟到 abort 是无害 no-op
        opts?.signal?.addEventListener(
          'abort',
          () => {
            if (entry.settled) return;
            entry.settled = true;
            pending.delete(approvalId);
            resolve('cancel');
          },
          { once: true },
        );
      }),
  };

  return {
    backend,
    core,
    dispose: () => {
      // 连接收口：在飞 ask 保守收场（持有 Promise 的上层按 cancel 语义续走）
      for (const entry of pending.values()) {
        if (entry.settled) continue;
        entry.settled = true;
        entry.resolve('cancel');
      }
      pending.clear();
      core.close();
    },
  };
}
