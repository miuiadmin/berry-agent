/**
 * telegram-channel 范式件入口——Telegram 双向渠道（IM 域第一条真实外延）。
 *
 * 无人值守「**在 IM 里发起、在 IM 里收口**」：TG 消息 /start 起无头会话并
 * 绑定 chat ↔ 会话，run 终态推回本 chat；期间 run 卡审批时推送摘要，人回
 * 短指令「批准」/「拒绝」收口。恰四指令（v1 射程——全对话转投等于把 TG
 * 变第二 TUI，拍板档 N3 维持界外）。
 *
 * 试跑（零装机——装载计划纯内存注入 `_quick_test` 行，退出即消失；试件形
 * 动作即授予：node: 内建生效集 = 清单声明全集，零开门即可装载）：
 *
 *     berry --plugin-file ./examples/telegram-channel
 *
 * 装机（正式安装进数据目录——enabled.yaml + 装机账本两源落盘）：
 *
 *     berry plugins install local:$(pwd)/examples/telegram-channel
 *
 * 契约要点（完整能力面见仓库 docs/plugin-development.md）：
 * - 入口 = default export 的 async 函数（(ctx, config) 双参——config 是宿主
 *   合成后的配置实参）；返回清理函数即 unmount disposer；
 * - 硬依赖声明在 named export `inject`（零第三方依赖——空数组示形）；
 * - 双门 + 受门内建：ctx.triggers.register（门 triggers.start-run）交接起会
 *   starter，**先注册**——门检失败掷在一切注册之前，apply 中途失败零 UiBackend
 *   残留；ctx.channels.registerUiBackend（门 channels.ui-backend）注册 TG 后端
 *   （成功路 disposer 两撤序 LIFO 同步）。node:https 受 grants.node-builtins 门（清单声明 ∩ 行 opens 开门
 *   两方交集）——收发两腿（getUpdates 长轮询 + sendMessage）全部走
 *   node:https 手写最小客户端，本件因此是该门的诚实消费者（非「globals 面
 *   不定级即绕行」形——对照 notify 件 Telegram 腿走 global fetch 的旧案）；
 * - **终态观测走 UiBackend.onEnvelope 信封回调面**（设计原案「fire 回执后
 *   动态 subscribeSessionLifecycle scope 'self'」撞装载窗关闭律——apply 收口
 *   即关窗，后置订阅结构性 PLUGIN_WINDOW_CLOSED；信封回调面零 ctx 动词零
 *   额外门，通道核把一切会话的 agent_end 终态扇给在册后端，本件按绑定 Map
 *   窄滤——语义与「订阅读尾答」等价：终态推回绑定 chat 后释放动态绑定）；
 * - 凭证 telegram-bot-token 经 ctx.get('secrets') 自域现读（plugin:<本件 id>
 *   域；轮换友好——每轮 poll / 每次投递前现读）；token 只进 URL 构造位，
 *   一切失败报文重铸不带 token 不带 URL；
 * - 绑定态纯内存（D2 裁决）：config 静态 bindings 数组 boot 载入 + 运行期
 *   /start 动态绑定——重启即失（README 诚实注记，TG 侧提示重新 /start），
 *   本件零文件写入（无 grants.writableRoots 诉求）；
 * - 长轮询循环只在凭证在场时起（缺席 warn 降级零起——零 token 装载安全形；
 *   同态 askApproval 即决 'unavailable'、hasAudience 返 false——收发链整体
 *   退位为证词票，挂着不答即毒化宿主多后端竞速）；错误退避重试有帽；
 *   disposer 停循环 + 销毁在飞请求（req.destroy）；
 * - 发送缝 `__tg`（named export）是唯一测试替身位——poll / send 两槽注入
 *   期间真腿零触达（零真网络）。
 */

import { request as httpsRequest } from 'node:https';

/** 硬依赖声明（本件零第三方依赖——保留空数组示形） */
export const inject = [];

/**
 * 收发缝（DI——测试/替身注入位，绝不真发网络）。
 * 槽形：poll = (token, offset, timeoutMs) => Promise<{ updates, nextOffset }>；
 *       send = (token, chatId, text) => Promise<void>。
 * 缺省两槽 undefined = 走本件真实现（node:https 手写最小客户端——受门内建）。
 */
export const __tg = { poll: undefined, send: undefined };

/** 本件 id（触发器名域前缀须与此同——防跨插件冒名的域律） */
const PLUGIN_ID = 'berry-agent-example-telegram-channel';

/** 凭证名（自域 plugin:<本件 id> 下——人面录入路径见件内 README） */
const TOKEN_SECRET = 'telegram-bot-token';

/** 触发器名（域名两段式——域前缀 == 本插件 id 恰等律） */
const TRIGGER_NAME = `${PLUGIN_ID}/tg-message`;

/** Telegram Bot API 端点（token 只拼进此 base 之后的路径位） */
const TG_API_BASE = 'https://api.telegram.org';

/** 长轮询档（getUpdates 的 timeout 参——秒位；TG 上限约 50s，25s 留换页余量） */
const LONG_POLL_TIMEOUT_MS = 25_000;

/** 长轮询请求整体帽 = timeout + 宽限（悬挂连接不留面） */
const LONG_POLL_GRACE_MS = 10_000;

/** 发送腿整体帽（毫秒） */
const SEND_TIMEOUT_MS = 15_000;

/** 轮询失败退避初值（毫秒） */
const BACKOFF_INITIAL_MS = 1_000;

/** 退避帽（毫秒——长时间断网不定崩宿主也不刷屏） */
const BACKOFF_CAP_MS = 60_000;

/** 错误文案（err.message 只取一层——凭证/令牌/URL 永不入报文） */
function errorText(err) {
  return err instanceof Error ? err.message : String(err);
}

/** 毫秒睡（退避用——醒后由循环条件再判停机旗） */
const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * config 归形（坏值降级不崩装载）——只消费一个键：
 * bindings：[{ chat, session }] 静态绑定数组（chat/会话 id 均非空字符串才收）。
 * 注：v1 configSchema 字型是扁平闭集（text/secret/select/boolean），表达不了
 * 对象数组——本键不进 configSchema、由本函数行级宽校验（README 注记）。
 */
function readSettings(config) {
  const record = config !== null && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const raw = record.bindings;
  const bindings = [];
  let skipped = 0;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const chat = item !== null && typeof item === 'object' && typeof item.chat === 'string' ? item.chat.trim() : '';
      const session =
        item !== null && typeof item === 'object' && typeof item.session === 'string' ? item.session.trim() : '';
      if (chat !== '' && session !== '') bindings.push({ chat, session });
      else skipped += 1; // 坏值条目跳过计数（激活期 warn——降级不崩装载）
    }
  } else if (raw !== undefined) {
    skipped = 1; // bindings 非数组形——整体弃用（记一条降级）
  }
  return { bindings, skipped };
}

/* ---------------- node:https 最小客户端（受门内建——收发两腿共用） ---------------- */

/**
 * 单次 POST + JSON 应答（Promise 形）。
 * token 已在 url 路径位（api.telegram.org/bot<token>/<method>——唯一出现位）；
 * 一切失败报文重铸不含 url 不含 token。timeoutMs 到点 destroy 连接（悬挂
 * 不留面）；req 登记进 inflight 集——disposer 统一 destroy（在飞中止）。
 */
function httpsPostJson(url, payload, timeoutMs, inflight) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    let settled = false; // 单口收口旗（timeout/error/end 竞态只结一次）
    const req = httpsRequest(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          const status = res.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null; // 非 JSON 体——走非 ok 报错腿
          }
          const desc =
            parsed !== null && typeof parsed === 'object' && typeof parsed.description === 'string'
              ? parsed.description
              : '';
          if (status < 200 || status >= 300) {
            reject(new Error(`Telegram Bot API 非 2xx 应答：${status}${desc === '' ? '' : `（${desc}）`}`));
            return;
          }
          if (parsed === null || typeof parsed !== 'object' || parsed.ok !== true) {
            reject(new Error(`Telegram Bot API 应答非 ok：${desc === '' ? '（无描述）' : desc}`));
            return;
          }
          resolve(parsed);
        });
      },
    );
    inflight.add(req);
    req.on('close', () => inflight.delete(req)); // 成败两路都出集（幂等）
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(new Error(`Telegram 网络请求失败：${errorText(err)}`));
    });
    req.setTimeout(timeoutMs, () => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(new Error(`Telegram 请求超时（${timeoutMs}ms）`));
    });
    req.end(body);
  });
}

/** poll 真腿：getUpdates 长轮询——游标只进（update_id + 1），坏形条目不推进游标 */
async function telegramGetUpdates(token, offset, timeoutMs, inflight) {
  const parsed = await httpsPostJson(
    `${TG_API_BASE}/bot${token}/getUpdates`,
    { offset, timeout: Math.floor(timeoutMs / 1000) },
    timeoutMs + LONG_POLL_GRACE_MS,
    inflight,
  );
  const result = parsed.result;
  const updates = Array.isArray(result) ? result : [];
  let nextOffset = offset;
  for (const update of updates) {
    const id =
      update !== null && typeof update === 'object' && typeof update.update_id === 'number' ? update.update_id : -1;
    if (id >= 0 && id + 1 > nextOffset) nextOffset = id + 1;
  }
  return { updates, nextOffset };
}

/** send 真腿：sendMessage（应答体只看 ok 位——零回显需求） */
async function telegramSendMessage(token, chatId, text, inflight) {
  await httpsPostJson(`${TG_API_BASE}/bot${token}/sendMessage`, { chat_id: chatId, text }, SEND_TIMEOUT_MS, inflight);
}

/* ---------------- 插件本体 ---------------- */

/**
 * 装载即执行（apply）——注册面（后端 + 触发器）在此打开，收发循环凭证在场才起。
 * @returns {() => void} unmount disposer（停循环 + 毁在飞 + 收口挂起审批 + 撤两注册）
 */
export default async (ctx, config) => {
  const settings = readSettings(config);

  /* ---- 绑定态（纯内存——重启即失，D2 裁决；零文件写入） ---- */
  /** chatId -> sessionId（TG chat id 归一存字符串） */
  const chatToSession = new Map();
  /** sessionId -> chatId（反向索引——askApproval/onEnvelope 按会话找 chat） */
  const sessionToChat = new Map();
  /** sessionId -> 'static' | 'dynamic'（终态推回后只释放动态绑定——静态绑定是 config 声明的常驻意图） */
  const bindingOrigin = new Map();
  const bind = (chatId, sessionId, origin) => {
    // 双向换绑两清：chat 换绑新会话 / 会话换绑新 chat，旧侧都不悬空
    const oldSession = chatToSession.get(chatId);
    if (oldSession !== undefined && oldSession !== sessionId) sessionToChat.delete(oldSession);
    const oldChat = sessionToChat.get(sessionId);
    if (oldChat !== undefined && oldChat !== chatId) chatToSession.delete(oldChat);
    chatToSession.set(chatId, sessionId);
    sessionToChat.set(sessionId, chatId);
    bindingOrigin.set(sessionId, origin);
  };
  // config 静态绑定 seed（boot 载入——重启后仍由 config 重建）
  for (const item of settings.bindings) bind(item.chat, item.session, 'static');
  if (settings.skipped > 0) {
    ctx.ui.notify(`telegram-channel 件 config.bindings 有 ${settings.skipped} 处坏值已跳过（降级不崩装载）`, {
      level: 'warn',
    });
  }

  /* ---- 停机旗 + 在飞请求登记（disposer 消费面） ---- */
  const stop = { aborted: false };
  const inflight = new Set();

  /* ---- 凭证现读（轮换友好——每轮 poll / 每次投递前现读；缺席抛错被各消费腿兜） ---- */
  const readToken = () => ctx.get('secrets').get(TOKEN_SECRET);

  /* ---- 收发缝解析（DI——注入优先、缺省真腿；真腿闭包携 inflight 供停机销毁） ---- */
  const pollSeam = __tg.poll ?? ((token, offset, timeoutMs) => telegramGetUpdates(token, offset, timeoutMs, inflight));
  const sendSeam = __tg.send ?? ((token, chatId, text) => telegramSendMessage(token, chatId, text, inflight));

  /* ---- 投递两形 ---- */
  /** 诊断形：失败 ctx.ui.notify warn（人面可诊——本轮跳过不重试不抛出） */
  const deliver = async (chatId, text) => {
    try {
      await sendSeam(readToken(), chatId, text);
    } catch (err) {
      ctx.ui.notify(`telegram-channel 推送失败（chat ${chatId}，本轮跳过）：${errorText(err)}`, { level: 'warn' });
    }
  };
  /**
   * 静默形：宿主 notify 扇出腿专用——失败必须吞。自环防护：本腿若失败再走
   * ctx.ui.notify warn，warn 又扇出回本后端 notify → 再投递再失败 → 无界回环；
   * 静默吞是结构止环位（尽力通知语义——失败即丢）。
   */
  const deliverSilent = async (chatId, text) => {
    try {
      await sendSeam(readToken(), chatId, text);
    } catch {
      /* 静默（自环防护——见上注） */
    }
  };

  /* ---- 审批挂起（per-chat 单飞：新审批让位——旧者以 'unavailable' 收口） ---- */
  /** chatId -> { sessionId, resolve(answer) }（resolve 自带出册守卫） */
  const pendingByChat = new Map();

  /** 审批摘要组形（notify 文案律：在场用之、缺席组形不虚构——summary 契约恒在场，此处留防御形） */
  const composeApprovalText = (sessionId, request) => {
    const summary = typeof request?.summary === 'string' ? request.summary.trim() : '';
    const reason = typeof request?.reason === 'string' ? request.reason.trim() : '';
    const toolName = typeof request?.toolName === 'string' ? request.toolName.trim() : '';
    const lines = [];
    if (summary !== '') lines.push(summary);
    else if (reason !== '') lines.push(reason);
    else if (toolName !== '') lines.push(`工具 ${toolName} 请求审批`);
    else lines.push('收到一条审批请求（无摘要）');
    if (toolName !== '' && summary !== '') lines.push(`工具：${toolName}`);
    lines.push(`会话 ${sessionId}——回复「批准」或「拒绝」`);
    return lines.join('\n');
  };

  /* ---- 运行能力探测（装载时点一次——零 token 即收发循环不起，askApproval/
   * hasAudience 同态短路；中途录入新 token 须 /reload 重算〔README 降级语义〕） ---- */
  let tokenAvailable = true;
  try {
    readToken();
  } catch {
    tokenAvailable = false;
  }
  if (!tokenAvailable) {
    ctx.ui.notify(
      `telegram-channel 件缺凭证 ${TOKEN_SECRET}（录入：berry credentials add ${TOKEN_SECRET} '<token>' --namespace plugin:${PLUGIN_ID}）——收发循环未起（降级不崩装载）`,
      { level: 'warn' },
    );
  }

  /* ---- UiBackend 本体（id 'telegram'——插件域可注册名；宿主保留域只有 'tui'） ---- */
  const backend = {
    id: 'telegram',
    capabilities: {
      notify: true,
      confirm: false,
      select: false,
      input: false,
      approval: true, // 短指令审批（N3 拍板档）
      setStatus: false,
      setWidget: false,
    },
    /**
     * 观众探针：运行能力在场且有绑定 chat 才有观众（零 token 或零绑定 =
     * 无人可答——零 token 态本后端整体退位，宿主级观众聚合不复计本腿）。
     */
    hasAudience() {
      return tokenAvailable && chatToSession.size > 0;
    },
    /**
     * 宿主 notify 扇出直推（与 askApproval 同发送缝）：推给一切已绑定 chat
     * （v1 全档直推不筛 level——README 边界注记）；零绑定零推。失败走静默形
     * （自环防护见 deliverSilent 注）。
     */
    notify(message) {
      for (const chatId of chatToSession.keys()) void deliverSilent(chatId, message);
    },
    /**
     * 审批往返：绑定 chat 收摘要 → 短指令收口。
     * - 零 token（收发循环未起）→ 即决 'unavailable'（证词票——多后端竞速
     *   下无人会再来答本题，挂着即毒化竞速：唯一 capable 腿时宿主整体
     *   fail-closed 语义靠本短路兑现，永挂不退位是修前洞）；
     * - 无绑定（本后端对该会话无人可答）→ 'unavailable'（同证词票——
     *   非裁决票，全后端皆无人时宿主才整体降级 unavailable）；
     * - per-chat 单飞让位：新审批到达即旧者 'unavailable' 收口（旧摘要已被顶
     *   替，诚实证词非裁决）；
     * - opts.signal abort → 'cancel'（宿主侧静默丢弃迟到腿——无害；入口即
     *   已 abort 的形直收口零监听——迟到臂同律）。
     */
    askApproval(sessionId, request, opts) {
      if (!tokenAvailable) return Promise.resolve('unavailable');
      const chatId = sessionToChat.get(sessionId);
      if (chatId === undefined) return Promise.resolve('unavailable');
      const text = composeApprovalText(sessionId, request);
      const promise = new Promise((resolve) => {
        const entry = {
          sessionId,
          resolve: (answer) => {
            // 出册守卫：让位后的旧 entry 不误删新者（resolve 本身幂等）
            if (pendingByChat.get(chatId) === entry) pendingByChat.delete(chatId);
            resolve(answer);
          },
        };
        const old = pendingByChat.get(chatId);
        if (old !== undefined) old.resolve('unavailable'); // 让位律
        pendingByChat.set(chatId, entry);
        if (opts?.signal?.aborted) {
          entry.resolve('cancel'); // 入口即已 abort——零监听直收口（addEventListener 对已 abort 信号不回调）
        } else {
          opts?.signal?.addEventListener('abort', () => entry.resolve('cancel'), { once: true });
        }
      });
      void deliver(chatId, text); // 摘要推送（失败 warn——诊断形）
      return promise;
    },
    /**
     * 活体信封呈现（通道核把一切会话的一切事件扇给在册后端——本件窄滤）：
     * 只消费 agent_end（run 终态）且只推绑定会话。推完即释放**动态**绑定
     * （「终态推回后撤订」的兑现位——静态绑定是 config 常驻意图不释放）。
     */
    onEnvelope(env) {
      if (env === null || typeof env !== 'object') return;
      const event = env.event;
      if (event === null || typeof event !== 'object' || event.type !== 'agent_end') return;
      const chatId = sessionToChat.get(env.sessionId);
      if (chatId === undefined) return; // 非本后端绑定会话——扇出面广，窄滤
      const status = typeof event.status === 'string' ? event.status : undefined;
      const stamp = new Date().toISOString();
      const text =
        status !== undefined
          ? `会话 ${env.sessionId} 的 run 已收口：终态 ${status}。时点 ${stamp}`
          : `会话 ${env.sessionId} 的 run 已收口，但终态缺席（崩溃路径——如实报不虚构终值）。时点 ${stamp}`;
      if (bindingOrigin.get(env.sessionId) === 'dynamic') {
        chatToSession.delete(chatId);
        sessionToChat.delete(env.sessionId);
        bindingOrigin.delete(env.sessionId);
      }
      void deliver(chatId, text);
    },
  };
  /* ---- 触发器注册（先注册——门检失败掷在一切注册之前，apply 中途失败零
   * UiBackend 残留；注册成功即 fire 交接 starter——起会闭包唯一持有位） ---- */
  let starter = null;
  const disposeTrigger = ctx.triggers.register({
    name: TRIGGER_NAME,
    description: 'Telegram /start 入向触发——TG 消息起无头会话并绑定 chat（终态/审批推回；IM 域第一条触发链）',
    fire: (injected) => {
      starter = injected;
    },
  });
  const disposeBackend = ctx.channels.registerUiBackend(backend);

  /* ---- 指令面（恰四指令——v1 射程，其余消息忽略） ---- */
  const handleCommand = (chatId, text) => {
    // /start 前缀收严：命令词边界 = 空白 / 可选 @地址段 / 串尾——群形
    // '/start@mybot 提示' 剥地址段取提示（@mybot 不混入 prompt）；
    // '/startxyz' 不认领（命令词粘连形非本指令）。
    const startMatch = /^\/start(?:@\S+)?(?:\s|$)/.exec(text);
    if (startMatch !== null) {
      const prompt = text.slice(startMatch[0].length).trim();
      if (prompt === '') {
        void deliver(chatId, '用法：/start <提示>——起无头会话并绑定本 chat（终态与审批将推回这里）');
        return;
      }
      if (typeof starter !== 'function') {
        void deliver(chatId, '触发器 starter 未就绪（装载序异常）——请重载插件');
        return;
      }
      const receipt = starter({ prompt }); // starter 永不 throw（既有律）——拒/失败返 undefined
      if (receipt === null || typeof receipt !== 'object' || typeof receipt.sessionId !== 'string') {
        void deliver(chatId, '起会未受理（拒或失败——宿主 warn 面可诊）');
        return;
      }
      bind(chatId, receipt.sessionId, 'dynamic');
      void deliver(
        chatId,
        `已起会话 ${receipt.sessionId} 并绑定本 chat——run 终态将推回这里；期间如需审批会收到摘要，回复「批准」或「拒绝」`,
      );
      return;
    }
    if (text === '/status') {
      const sessionId = chatToSession.get(chatId);
      const pending = pendingByChat.get(chatId);
      const lines = [];
      lines.push(sessionId === undefined ? '当前未绑定会话（/start <提示> 起会即绑）' : `当前绑定会话：${sessionId}`);
      lines.push(
        pending === undefined
          ? '本 chat 无挂起审批'
          : `本 chat 有挂起审批（会话 ${pending.sessionId}）——回复「批准」或「拒绝」`,
      );
      void deliver(chatId, lines.join('\n'));
      return;
    }
    if (text === '批准' || text === '拒绝') {
      const pending = pendingByChat.get(chatId);
      if (pending === undefined) {
        void deliver(chatId, '本 chat 当前无挂起审批（/status 可查绑定态）');
        return;
      }
      const sessionId = pending.sessionId;
      pending.resolve(text === '批准' ? 'approve' : 'reject');
      void deliver(chatId, `已${text}（会话 ${sessionId} 的挂起审批）`);
      return;
    }
    // 其余消息忽略（恰四指令边界——README 注记；不做对话转投）
  };

  /** update 分帧：只认 message.text 形（channel_post/edited 等形 v1 忽略），坏形零抛 */
  const handleUpdate = (update) => {
    const message =
      update !== null && typeof update === 'object' && update.message !== null && typeof update.message === 'object'
        ? update.message
        : null;
    if (message === null) return;
    if (typeof message.text !== 'string') return; // 贴纸/图片等非文本消息忽略
    if (message.chat === null || typeof message.chat !== 'object' || message.chat.id === undefined) return;
    const chatId = String(message.chat.id); // TG 数值 id 归一字符串（与 config 静态键同域）
    handleCommand(chatId, message.text.trim());
  };

  /* ---- 长轮询循环（运行能力在场才起——探测已前置；token 中途录入须 /reload） ---- */
  const runLoop = async () => {
    let offset = 0; // getUpdates 游标（内存态——重启从 0 重放 TG 留存的未确认更新）
    let backoff = BACKOFF_INITIAL_MS;
    while (!stop.aborted) {
      try {
        const token = readToken(); // 每轮现读（轮换友好——中途录入新 token 即生效）
        const { updates, nextOffset } = await pollSeam(token, offset, LONG_POLL_TIMEOUT_MS);
        if (stop.aborted) break; // 停机竞态：应答到达时已停——弃本批
        offset = nextOffset;
        backoff = BACKOFF_INITIAL_MS; // 成功即复位退避
        for (const update of updates) handleUpdate(update);
      } catch (err) {
        if (stop.aborted) break; // 停机销毁的在飞请求在此收声（非故障）
        ctx.ui.notify(`telegram-channel 收发循环异常（退避 ${backoff}ms 重试）：${errorText(err)}`, { level: 'warn' });
        await sleep(backoff);
        backoff = Math.min(backoff * 2, BACKOFF_CAP_MS); // 指数退避有帽
      }
    }
  };
  if (tokenAvailable) void runLoop();

  /* ---- unmount disposer：停循环 → 毁在飞 → 收口挂起 → 撤两注册（LIFO——
   * 后注册者先撤） ---- */
  return () => {
    stop.aborted = true;
    for (const req of inflight) req.destroy(); // 在飞长轮询/发送即断（error 腿被停机旗收声）
    inflight.clear();
    // 挂起审批收口：本后端卸载即无人可答——'unavailable'（证词非裁决票）
    for (const entry of [...pendingByChat.values()]) entry.resolve('unavailable');
    pendingByChat.clear();
    disposeBackend();
    disposeTrigger();
  };
};
