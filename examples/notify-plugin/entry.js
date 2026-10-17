/**
 * notify 范式件入口——run 收口单向推送（SMTP / Telegram 双后端）。
 *
 * 无人值守「跑完主动找人」的第一块自证：订阅 session/lifecycle 活体事件，
 * run 收口（run-settled）时把终态推到人面通道——run 起拍不打扰、只报收口。
 *
 * 试跑（零装机——装载计划纯内存注入 `_quick_test` 行，退出即消失；试件形
 * 动作即授予：node: 内建生效集 = 清单声明全集，零开门即可装载）：
 *
 *     berry --plugin-file ./examples/notify-plugin
 *
 * 装机（正式安装进数据目录——enabled.yaml + 装机账本两源落盘）：
 *
 *     berry plugins install local:$(pwd)/examples/notify-plugin
 *
 * 契约要点（完整能力面见仓库 docs/plugin-development.md）：
 * - 入口 = default export 的 async 函数（(ctx, config) 双参——config 是宿主
 *   合成后的配置实参）；返回清理函数即 unmount disposer；
 * - 硬依赖声明在 named export `inject`（零第三方依赖——空数组示形）；
 * - 订阅动词 ctx.events.subscribeSessionLifecycle(handler, { scope })：scope
 *   取 'all'（全会话终态拍）。self/tree 档虽零开门但必须携带 sessionId 锚
 *   （装载期无会话锚可用，结构性不适配）；all 档走高危面 sessions.observe-cross
 *   开门 + 受理审计——开门义务见件内 README「开门义务清单」；
 * - 订阅回卷：宿主受理即挂 scope effect（LIFO unload 自动撤订——契约内建，
 *   重复退订幂等）；本件仍返回同一 disposer 作 unmount 清理（双保险同幂等）；
 * - 凭证两枚经 ctx.get('secrets') 自域读（plugin:<本件 id> 域）：
 *   smtp-password / telegram-bot-token——值不入 config 不入日志；
 * - import 门禁：node:tls / node:net 不在放行档纯计算闭集（src/host/builtins.ts
 *   PURE_COMPUTATION_BUILTINS 八名），须清单 grants.nodeBuiltins 逐名声明 +
 *   用户 opens 开门（grants.node-builtins 第七枚）——本件因此是 R3 机制的
 *   首个真实消费者（狗粮定位详见件内 README）；global fetch 非门禁射程。
 */

import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

/** 硬依赖声明（本件零第三方依赖——保留空数组示形） */
export const inject = [];

/** 凭证名（自域 plugin:<本件 id> 下的两枚——人面录入路径见件内 README） */
const SMTP_PASSWORD_SECRET = 'smtp-password';
const TELEGRAM_TOKEN_SECRET = 'telegram-bot-token';

/** 邮件主题（值位文案——品牌词只允许出现在值位/文案位） */
const MAIL_SUBJECT = 'berry-agent run 收口通知';

/** EHLO 自报域（SMTP 客户端身份位——占位形即可，不影响投递） */
const EHLO_NAME = 'berry-agent-notify.local';

/** SMTP 单连接整体超时（毫秒）——无人值守场景不给悬挂连接留面 */
const SMTP_TIMEOUT_MS = 15_000;

/**
 * 后端发送缝（DI——测试/替身注入位，绝不真发网络）。
 * 槽形：smtp = (mail, text) => Promise<void>；telegram = (token, chatId, text) => Promise<void>。
 * 缺省两槽 undefined = 走本件真实现（smtp = 零依赖最小客户端；telegram = global fetch）。
 */
export const __senders = { smtp: undefined, telegram: undefined };

/** config 归一形（坏形容错——畸形值降级，不崩装载） */
function readSettings(config) {
  const record = config !== null && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const str = (key) => (typeof record[key] === 'string' ? record[key].trim() : '');
  // backend 坏值回落 both（真实装载形下 select 校验已先行拒；此处兜直接激活形）
  const backend = str('backend');
  const port = str('smtp-port') === '' ? '465' : str('smtp-port');
  return {
    backend: backend === 'smtp' || backend === 'telegram' ? backend : 'both',
    smtp: {
      host: str('smtp-host'),
      port: /^\d{1,5}$/.test(port) ? Number(port) : Number.NaN,
      from: str('smtp-from'),
      to: str('smtp-to'),
      username: str('smtp-username'),
      starttls: record['smtp-starttls'] === true,
    },
    telegram: { chatId: str('telegram-chat-id') },
  };
}

/** SMTP 就绪检查——缺席键清单（空数组 = 就绪；坏端口计入缺席） */
function missingSmtpKeys(smtp) {
  const missing = [];
  if (smtp.host === '') missing.push('smtp-host');
  if (!Number.isInteger(smtp.port) || smtp.port < 1 || smtp.port > 65535) missing.push('smtp-port');
  if (smtp.from === '') missing.push('smtp-from');
  if (smtp.to === '') missing.push('smtp-to');
  return missing;
}

/** 错误文案（err.message 只取一层——凭证/令牌永不入报文） */
function errorText(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * run-settled 文案组形——终态三值在场/缺席两形如实组（缺席字段不虚构：
 * 崩溃路径宿主只报收口不虚构终值，本文案同律）。
 */
function composeSettledText(event) {
  const stamp = new Date().toISOString();
  if (event.status === undefined) {
    return `会话 ${event.sessionId} 的 run 已收口，但终态缺席（崩溃路径——宿主只报收口不虚构终值）。时点 ${stamp}`;
  }
  return `会话 ${event.sessionId} 的 run 已收口：终态 ${event.status}。时点 ${stamp}`;
}

/* ---------------- SMTP 真腿：零依赖最小客户端（node:tls / node:net） ---------------- */

/** DATA 段载荷组装：头块 + 正文行尾归一 + 点填充（RFC 5321——行首「.」加倍防提前终结） */
function smtpWirePayload(mail, bodyText) {
  const headers = [
    `From: ${mail.from}`,
    `To: ${mail.to}`,
    `Subject: ${MAIL_SUBJECT}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
  ].join('\r\n');
  const normalized = headers + '\r\n' + bodyText.replace(/\r?\n/g, '\r\n');
  return normalized
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

/**
 * 零依赖最小 SMTP 客户端（~百行级——每步中文注解）。
 *
 * 两档传输形（按 config smtp-starttls 定档）：
 * - false（缺省）= 隐式 TLS 直连：node:tls.connect 起手即握手（465 常形）；
 * - true = STARTTLS 形：node:net.connect 明文连入 → EHLO → STARTTLS 升级握手
 *   （node:tls.connect({ socket }) 现场升级、证书校验缺省开）→ TLS 后再 EHLO。
 *
 * 会话五段式：问候(220) → EHLO(250) → [STARTTLS(220) + EHLO(250)] →
 * [AUTH PLAIN(235)] → MAIL FROM/RCPT TO(250) → DATA(354) → 终点号(250) → QUIT(221)。
 * 应答读形：完整应答 = 若干「<码>-」续行 + 一行「<码><空格>」终行。
 *
 * @param {{ host: string, port: number, from: string, to: string, username?: string,
 *           password?: string, starttls: boolean }} mail 已就绪的 SMTP 配置
 * @param {string} bodyText 推送正文
 */
async function sendMailViaSmtp(mail, bodyText) {
  let active =
    mail.starttls === true
      ? netConnect({ host: mail.host, port: mail.port }) // STARTTLS 档：先明文、升级在前
      : tlsConnect({ host: mail.host, port: mail.port, servername: mail.host }); // 隐式 TLS 档

  // —— 行帧腿：data 块切行、跨块拼应答、完整应答入队/唤醒等者 ——
  let buffer = '';
  let current = null; // 拼至半途的应答行集（终行「<码><空格>」到齐即完整）
  const completed = []; // 已完整无人领取的应答（问候语先至形）
  const waiters = []; // readReply 挂起的等者（FIFO——指令序严格串行）
  let ended = null; // 流终错误（迟到读立即拒）

  const failAll = (err) => {
    if (ended === null) ended = err;
    while (waiters.length > 0) waiters.shift().reject(err);
  };
  const absorbLine = (line) => {
    if (current === null) {
      if (!/^\d{3}[- ]/.test(line)) return; // 应答帧外杂行（理论不至）——丢弃
      current = [line];
    } else {
      current.push(line);
    }
    if (/^\d{3} /.test(line)) {
      const reply = { code: Number(line.slice(0, 3)), text: current.join('\n') };
      current = null;
      const waiter = waiters.shift();
      if (waiter !== undefined) waiter.resolve(reply);
      else completed.push(reply);
    }
  };
  const attach = (sock) => {
    sock.setEncoding('utf8');
    sock.setTimeout(SMTP_TIMEOUT_MS); // 空闲超时——无人值守不给悬挂连接留面
    sock.on('data', (chunk) => {
      buffer += chunk;
      let idx = buffer.indexOf('\n');
      while (idx !== -1) {
        absorbLine(buffer.slice(0, idx).replace(/\r$/, ''));
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf('\n');
      }
    });
    sock.on('timeout', () => {
      failAll(new Error('SMTP 连接超时'));
      sock.destroy();
    });
    sock.on('error', (err) => failAll(new Error(`SMTP 连接错误：${errorText(err)}`)));
    sock.on('close', () => failAll(new Error('SMTP 连接已关闭（应答未齐）')));
  };
  const readReply = () =>
    new Promise((resolve, reject) => {
      const queued = completed.shift();
      if (queued !== undefined) {
        resolve(queued);
        return;
      }
      if (ended !== null) {
        reject(ended);
        return;
      }
      waiters.push({ resolve, reject });
    });
  const send = (line) => {
    active.write(`${line}\r\n`);
    return readReply();
  };
  const expectCode = (reply, code, stage) => {
    if (reply.code !== code) throw new Error(`SMTP ${stage} 应答码 ${reply.code}（期望 ${code}）：${reply.text}`);
  };

  attach(active);
  try {
    expectCode(await readReply(), 220, '问候');
    expectCode(await send(`EHLO ${EHLO_NAME}`), 250, 'EHLO');
    if (mail.starttls === true) {
      expectCode(await send('STARTTLS'), 220, 'STARTTLS');
      const plain = active;
      plain.removeAllListeners('data'); // 让位 TLS 层独占读——残留监听与握手抢流会撕裂会话
      active = tlsConnect({ socket: plain, servername: mail.host }); // 现场握手升级（证书校验缺省开）
      attach(active);
      expectCode(await send(`EHLO ${EHLO_NAME}`), 250, 'EHLO（TLS 后）');
    }
    if (typeof mail.username === 'string' && mail.username !== '') {
      // AUTH PLAIN：一行 base64(\0用户名\0密码)——凭证只进本指令，不入日志不入报文
      const authPlain = Buffer.from(`\0${mail.username}\0${mail.password ?? ''}`, 'utf8').toString('base64');
      expectCode(await send(`AUTH PLAIN ${authPlain}`), 235, 'AUTH PLAIN');
    }
    expectCode(await send(`MAIL FROM:<${mail.from}>`), 250, 'MAIL FROM');
    expectCode(await send(`RCPT TO:<${mail.to}>`), 250, 'RCPT TO');
    expectCode(await send('DATA'), 354, 'DATA');
    active.write(`${smtpWirePayload(mail, bodyText)}\r\n.\r\n`);
    expectCode(await readReply(), 250, 'DATA 终');
    active.write('QUIT\r\n');
    expectCode(await readReply(), 221, 'QUIT');
  } finally {
    active.destroy(); // 成败两路都收连接（QUIT 后的 close 对已空的等者是 no-op）
  }
}

/* ---------------- Telegram 真腿：global fetch（非门禁射程——globals 面不定级） ---------------- */

/** Telegram Bot API sendMessage——token 只进 URL 构造位，失败报文不带 token */
async function sendTelegramMessage(token, chatId, text) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    // 网络层失败——报文重铸为不含 URL/token 的形（cause 里可能带 URL，弃置不外传）
    throw new Error(`Telegram 网络请求失败：${errorText(err)}`);
  }
  if (!response.ok) {
    throw new Error(`Telegram Bot API 非 2xx 应答：${response.status}`);
  }
}

/* ---------------- 投递编排（降级不抛——fire-and-forget 同 core:mcp 惯用形） ---------------- */

/** SMTP 投递：凭证条件现读（username 在场才取——匿名档不读不发 AUTH）→ 发送缝解析 → 失败 warn 不抛（本轮跳过） */
async function deliverSmtp(ctx, smtp, text) {
  try {
    // 匿名投递形：username 缺席 = 零凭证可用（secrets.get 缺席抛 CREDENTIALS_NOT_FOUND
    // ——匿名档结构性不读即不触发；README/package.json 承诺面的兑现位）
    const password = smtp.username === '' ? undefined : ctx.get('secrets').get(SMTP_PASSWORD_SECRET);
    const send = __senders.smtp ?? sendMailViaSmtp; // 发送缝：注入优先、缺省真腿
    await send({ ...smtp, password }, text);
  } catch (err) {
    ctx.ui.notify(`run 收口通知 SMTP 推送失败（本轮跳过）：${errorText(err)}`, { level: 'warn' });
  }
}

/** Telegram 投递：token 现读 → 发送缝解析 → 失败 warn 不抛（本轮跳过） */
async function deliverTelegram(ctx, telegram, text) {
  try {
    const token = ctx.get('secrets').get(TELEGRAM_TOKEN_SECRET); // token 不入 config 不入日志
    const send = __senders.telegram ?? sendTelegramMessage;
    await send(token, telegram.chatId, text);
  } catch (err) {
    ctx.ui.notify(`run 收口通知 Telegram 推送失败（本轮跳过）：${errorText(err)}`, { level: 'warn' });
  }
}

/** 插件本体：装载即执行（apply）——订阅面在此打开 */
export default async (ctx, config) => {
  const settings = readSettings(config);
  const useSmtp = settings.backend === 'both' || settings.backend === 'smtp';
  const useTelegram = settings.backend === 'both' || settings.backend === 'telegram';

  // 缺后端配置 = 该后端降级跳过 + warn（不崩装载——另一后端不受牵连）
  let smtpReady = false;
  if (useSmtp) {
    const missing = missingSmtpKeys(settings.smtp);
    if (missing.length === 0) {
      smtpReady = true;
    } else {
      ctx.ui.notify(`notify 件 SMTP 后端缺配置（${missing.join('、')}）——该后端跳过、推送降级`, { level: 'warn' });
    }
  }
  let telegramReady = false;
  if (useTelegram) {
    if (settings.telegram.chatId !== '') {
      telegramReady = true;
    } else {
      ctx.ui.notify('notify 件 Telegram 后端缺配置（telegram-chat-id）——该后端跳过、推送降级', { level: 'warn' });
    }
  }

  // 订阅 scope 定谳：'all'——全会话终态拍（self/tree 档需 sessionId 锚、装载期不可得；
  // all 档开门义务 sessions.observe-cross 见件内 README）。受理即挂宿主 scope effect
  // （LIFO unload 自动撤订）——本件再返同一 disposer 作 unmount 清理（重复退订幂等）。
  return ctx.events.subscribeSessionLifecycle(
    (event) => {
      if (event.phase !== 'run-settled') return; // 起拍不推——只报收口
      const text = composeSettledText(event);
      // fire-and-forget：各后端自兜底（deliverX 内部全捕获——失败 warn 不抛不阻主线）
      if (smtpReady) void deliverSmtp(ctx, settings.smtp, text);
      if (telegramReady) void deliverTelegram(ctx, settings.telegram, text);
    },
    { scope: 'all' },
  );
};
