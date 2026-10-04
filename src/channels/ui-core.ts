/**
 * ui 原语分发核（07 §4.3 签名定稿的通道无关编排面——2026-09-06 channels 纵切批）。
 *
 * 职责三块：①降级判定——通道不支持的原语按「notify 化」降级
 * （select→input→notify、confirm→input→notify——插件不感知通道能力差异）；
 * ②阻塞原语编排——入提问队列（与审批 ask 同队列）+ 多后端并发竞速
 * （04 §9 跨入口先答先得，败腿经 signal 撤销）；③widget 会话级单槽
 * （后写胜前写、置 null 清空——07 §4.3 setWidget 多写者语义）。
 *
 * 撤销面（07 §4.3）：外部 signal abort 或队列收口 → 保守值收场
 * （confirm→false / select·input→''）——曾在屏者的撤销说明行归后端
 * signal 消费实现，核只负责 abort 传播与结算。
 *
 * 核级 API 一律显式 sessionId（多会话归属的机器位）；ctx.ui 薄包装绑
 * 「当前会话」归 host 装配批。后端移除（removeBackend）时在飞问询的收口
 * 是后端自身义务（移除前 settle 或经 signal abort）——装配级事件，核不代管。
 */

import type {
  ApprovalAskAnswer,
  ApprovalAskRequest,
  AskKind,
  NotifyLevel,
  UiAskOptions,
  UiBackend,
  UiInputOptions,
  UiSelectChoice,
} from './types.js';
import { AskQueue } from './ask-queue.js';

/** ask 编舞的呈现体：收到内部 signal（败腿/撤销传播位），返回该问询的答案 */
type AskPresenter<T> = (signal: AbortSignal) => Promise<T>;

export class UiCore {
  private readonly backendsGetter: () => readonly UiBackend<never>[];
  private readonly askQueue: AskQueue;
  /** 审批 always 的策略表回写注入（07 §4.3 提问队列条款——装配接线） */
  private readonly onApprovalAlways: ((entry: string) => void) | undefined;
  /** widget 会话级单槽（07 §4.3——per-session 恰一槽，后写胜前写） */
  private readonly widgets = new Map<string, { node: unknown }>();

  constructor(
    backendsGetter: () => readonly UiBackend<never>[],
    askQueue: AskQueue,
    onApprovalAlways?: (entry: string) => void,
  ) {
    this.backendsGetter = backendsGetter;
    this.askQueue = askQueue;
    this.onApprovalAlways = onApprovalAlways;
  }

  private backends(): readonly UiBackend<never>[] {
    return this.backendsGetter();
  }

  /** 能力过滤：声明且实现俱在才 capable（防后端声明能力而缺实现——防御位） */
  private capable<K extends 'confirm' | 'select' | 'input' | 'approval' | 'setStatus' | 'setWidget'>(
    cap: K,
  ): UiBackend<never>[] {
    // 能力键与方法名同名惯例的唯一例外：approval 位的方法面叫 askApproval
    //（与服务面同名——UiBackend 上 confirm/select/input 三件方法名即能力名）
    const method = cap === 'approval' ? 'askApproval' : cap;
    return this.backends().filter(
      (b) => b.capabilities[cap] === true && typeof (b as unknown as Record<string, unknown>)[method] === 'function',
    );
  }

  // ---- 非阻塞三件（纯活体层——07 §4.3 语义纪律：不落日志不入队） ----

  /** 一次性通知：扇出全部后端（level 档识别与 info 归一归后端呈现侧） */
  notify(message: string, opts?: { level?: NotifyLevel }): void {
    for (const b of this.backends()) {
      if (b.capabilities.notify) b.notify(message, opts);
    }
  }

  /** 状态行更新：扇出 capable 后端（last-writer-wins 天然）；零 capable no-op */
  setStatus(sessionId: string, status: string): void {
    for (const b of this.capable('setStatus')) b.setStatus?.(sessionId, status);
  }

  /** widget 单槽：后写胜前写、置 null 清空；扇出 capable 后端 */
  setWidget(sessionId: string, node: unknown | null): void {
    if (node === null) {
      this.widgets.delete(sessionId);
    } else {
      this.widgets.set(sessionId, { node });
    }
    for (const b of this.capable('setWidget')) b.setWidget?.(sessionId, node);
  }

  /** 当前槽值（repaint 载荷消费——焦点切换重画带上该会话槽） */
  widgetOf(sessionId: string): { node: unknown } | null {
    return this.widgets.get(sessionId) ?? null;
  }

  /** 观众探针：任一后端自报有观众（TUI 恒真 / webui 在线连接数 > 0 / 零后端即假） */
  hasAudience(): boolean {
    return this.backends().some((b) => b.hasAudience());
  }

  // ---- 阻塞三件（入提问队列——与审批 ask 同队列 per-session FIFO） ----

  /** 是/否确认（降级链：confirm 后端 → input 后端〔(y/n) 形〕→ notify 化 + 保守值 false） */
  confirm(sessionId: string, message: string, opts?: UiAskOptions): Promise<boolean> {
    return this.ask(
      sessionId,
      'confirm',
      opts?.signal,
      () => false,
      (signal) => {
        const direct = this.capable('confirm');
        if (direct.length > 0) {
          return Promise.race(direct.map((b) => b.confirm!(message, { signal })));
        }
        const viaInput = this.capable('input');
        if (viaInput.length > 0) {
          // confirm→input 降级（07 §4.3 降级路径同链透传）：(y/n) 形、答 y/yes 为真
          const prompt = `${message} (y/n)`;
          return Promise.race(viaInput.map((b) => b.input!(prompt, { signal }))).then((answer) =>
            /^y(es)?$/i.test(answer.trim()),
          );
        }
        // notify 化到底：呈现问句后保守值收场（无人可答——fail-closed）
        this.notify(message);
        return Promise.resolve(false);
      },
    );
  }

  /** 单选（降级链：select 后端 → input 后端〔编号列表形〕→ notify 化 + 保守值 ''） */
  select(sessionId: string, message: string, choices: readonly UiSelectChoice[], opts?: UiAskOptions): Promise<string> {
    return this.ask(
      sessionId,
      'select',
      opts?.signal,
      () => '',
      (signal) => {
        const direct = this.capable('select');
        if (direct.length > 0) {
          return Promise.race(direct.map((b) => b.select!(message, choices, { signal }))).then((answer) =>
            validateChoice(answer, choices),
          );
        }
        const viaInput = this.capable('input');
        if (viaInput.length > 0) {
          // select→input 降级（Web 通道维持同款——07 §4.3）：编号列表提示、手输 value
          const prompt = `${message}\n${choices.map((c, i) => `${i + 1}. ${c.label} → ${c.value}`).join('\n')}`;
          return Promise.race(viaInput.map((b) => b.input!(prompt, { signal }))).then((answer) =>
            validateChoice(answer, choices),
          );
        }
        this.notify(`${message}\n${choices.map((c) => `- ${c.label} → ${c.value}`).join('\n')}`);
        return Promise.resolve('');
      },
    );
  }

  /** 自由文本输入（降级链：input 后端 → notify 化 + 保守值 ''） */
  input(sessionId: string, message: string, opts?: UiInputOptions): Promise<string> {
    return this.ask(
      sessionId,
      'input',
      opts?.signal,
      () => '',
      (signal) => {
        const viaInput = this.capable('input');
        if (viaInput.length > 0) {
          return Promise.race(viaInput.map((b) => b.input!(message, { placeholder: opts?.placeholder, signal })));
        }
        this.notify(message);
        return Promise.resolve('');
      },
    );
  }

  /**
   * 审批 ask（07 §4.3 提问队列条款——与阻塞三件同队同收口律）：
   * 多后端竞速真裁决先答先得（跨入口单漏斗——decide durable 单漏斗在
   * ApprovalService 不变）；**unavailable 腿不落定竞速**（第八轮 C1 定谳）：
   * 瞬时 fail-closed 腿（SDK 面该会话零订阅者即创建时立即 'unavailable'）
   * 只投「结构性无人」票——修前 Promise.race 被该腿整场毒化，混合观众形
   * （serve --port / daemon 双挂——真观众在另一腿挂起待答）后答 decide 恒
   * superseded；全腿皆 unavailable 才收口 'unavailable'（fail-closed 不变
   * ——单腿 headless 零观众语义同旧）。收口两语义分立（对齐 04 §9 run 信号
   * 透传 ask 链）——会话关闭 / run 打断 → `'cancel'`（用户主动终止）；降级
   * 到底（全部后端无 approval capability）→ `'unavailable'`（呈现面结构性
   * 无人可答——ApprovalService 侧落 timeout 源；2026-09-13 真模型实测批修，
   * 修前误答 'cancel' 错标用户主动取消）；`always` + 草案 →
   * onApprovalAlways 回写；无草案 always 防御收口视同 approve（零草案
   * 零副作用）。
   */
  askApproval(sessionId: string, request: ApprovalAskRequest, opts?: UiAskOptions): Promise<ApprovalAskAnswer> {
    return this.ask(
      sessionId,
      'approval',
      opts?.signal,
      () => 'cancel',
      (signal) => {
        const direct = this.capable('approval');
        if (direct.length > 0) {
          // 竞速重排（第八轮 C1）：真裁决（approve/reject/always/cancel）先答
          // 先得 + 败腿经内部 signal 撤销（ask 编舞 finish 位统一传播）；
          // 'unavailable' 是腿级「无人可答」证词不是裁决——计票不计胜负，
          // 票满（全腿无人）才 fail-closed。腿抛错仍立即拒出（呈现异常折
          // 保守值 cancel——与旧 race 同语义）
          return new Promise<ApprovalAskAnswer>((resolve, reject) => {
            let noAudienceVotes = 0;
            for (const b of direct) {
              b.askApproval!(sessionId, request, { signal }).then(
                (answer) => {
                  if (answer === 'unavailable') {
                    noAudienceVotes += 1;
                    if (noAudienceVotes === direct.length) resolve('unavailable');
                    return;
                  }
                  resolve(this.settleApprovalAlways(answer, request));
                },
                (cause) => reject(cause),
              );
            }
          });
        }
        // notify 化到底：呈现摘要后自报结构性无人（fail-closed——04 §9 无应答
        // 者语义，ApprovalService 落 unavailable/timeout；与打断路保守值 'cancel'
        // 分立——修前误答 'cancel' 致 decided 错标 cancel/user 双失真）
        this.notify(request.summary);
        return Promise.resolve('unavailable');
      },
    );
  }

  /** always 收口路：带草案回写策略表注入面；无草案防御视同 approve */
  private settleApprovalAlways(answer: ApprovalAskAnswer, request: ApprovalAskRequest): ApprovalAskAnswer {
    if (answer !== 'always') return answer;
    if (request.suggestedEntry === undefined) return 'approve'; // 零草案零副作用（04 §9 ③）
    this.onApprovalAlways?.(request.suggestedEntry);
    return 'always';
  }

  // ---- 收口 ----

  /**
   * 会话收口（通道侧——unregisterSession 联动）：清提问队列（余项保守值）+
   * 清 widget 槽。后端各自的会话呈现清理由其后端自身负责（onEnvelope 流断）。
   */
  closeSession(sessionId: string): void {
    this.askQueue.clearSession(sessionId);
    this.widgets.delete(sessionId);
  }

  /** 提问队列观察面（透传——诊断面/测试消费） */
  pending(sessionId: string): readonly AskKind[] {
    return this.askQueue.pending(sessionId);
  }

  // ---- 编舞内核 ----

  /**
   * ask 统一编排：入队 → 队首呈现（多后端竞速先答先得）→ 落定出队。
   * 入口先收副屏（07 §4.1 件 8 条款：注意力优先级 ask > 回看——ask 到来时
   * 在场副屏先收起再入提问队列；能力缺席〔无副屏后端〕零义务跳过）。
   * 三条收口路（全部 once）：首答（含降级解析值）/ 呈现异常（保守值——
   * fail-closed）/ 外部 signal abort 或队列取消（保守值）。入参 signal 已
   * 中止 = 零呈现早退（保守值直收不入队——见 ask 体内注）；排队期（未晋升
   * 队首）的外部 abort = cancel 语义——只结算自身保守值，不误弹 ACTIVE 件、
   * 不晋升后继（settled 以 started 位门控——残位零呈现让位见 start 钩子）。
   */
  private ask<T>(
    sessionId: string,
    kind: AskKind,
    externalSignal: AbortSignal | undefined,
    conservative: () => T,
    present: AskPresenter<T>,
  ): Promise<T> {
    // ask 强制收起（件 8 条款——批 10f-4）：扇出可选钩，先于入队
    for (const b of this.backends()) b.collapseAltScreen?.();
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });

    // 入参 signal 已中止先检（abort 事件只发一次，只挂监听则死路——
    // safety/approval.ts bridgeApprovalSignal 同律）。早退**不入队**：入队即
    // 占队首而 settled 已被早收场消费（无对应件可出队）——后继问死排 + 后端
    // 僵尸浮层。十六役补扫 N1：run 打断竞窗内 bridgeApprovalSignal 同步
    // relay 使本件收到已中止 signal，修前只挂监听即死挂——run 到不了
    // finally，settleApprovals 的 signal 链先收假定被打破
    if (externalSignal?.aborted) {
      resolve(conservative());
      return promise;
    }

    let done = false;
    // 本件是否已晋升队首（start 钩子已进）：finish 只允许已晋升件调 settled
    // 出队。排队中（未 start）被外部 abort 收场的件若走 settled，弹出的会是
    // 在飞的另一件——ACTIVE 被错误出队成账外孤儿（promise 仍悬、面板在屏，
    // 此后 clearSession 不再能取消它）；且队列会把本件自己晋升、以 finish 里
    // 已 abort 的 controller.signal 调 present——后端只挂 abort 监听即僵尸
    // 浮层（十六役 N1 同族：入参 signal 已中止早检只护 externalSignal，
    // 内部 controller.signal 无此护栏）。
    let started = false;
    // 内部 signal：败腿撤销 + 队列收口的统一传播位（后端只认这一个信号源——
    // 外部 signal 经本核折入 finish，不直传后端）
    const controller = new AbortController();

    const finish = (value: T): void => {
      if (done) return;
      done = true;
      controller.abort(); // 败腿撤销传播（已落定后端再收 abort 是无害 no-op）
      resolve(value);
      // 未 start（仍在排队）的收场只结算自身：不误弹 ACTIVE、不晋升后继
      //（cancel 语义）。AskQueue 无单件出队面——本件在队内的残位由 start
      // 钩子的 done 早检在晋升时刻零呈现让位（见下）。
      if (started) this.askQueue.settled(sessionId);
    };

    const externalAbort = () => finish(conservative());
    externalSignal?.addEventListener('abort', externalAbort, { once: true });

    this.askQueue.enqueue(sessionId, kind, {
      start: () => {
        started = true; // 晋升即置位——finish 的 settled 门
        if (done) {
          // 排队期已被外部 abort 收场的迟到晋升：controller.signal 已中止，
          // present 即僵尸浮层——不出呈现，直接按落定出队让真正的后继顶上
          this.askQueue.settled(sessionId);
          return;
        }
        present(controller.signal).then(finish, () => finish(conservative()));
      },
      cancel: () => finish(conservative()),
    });

    return promise;
  }
}

/** select 降级答案校验：手输不在 value 集即保守值 ''（fail-closed——不猜最近匹配） */
function validateChoice(answer: string, choices: readonly UiSelectChoice[]): string {
  const trimmed = answer.trim();
  return choices.some((c) => c.value === trimmed) ? trimmed : '';
}
