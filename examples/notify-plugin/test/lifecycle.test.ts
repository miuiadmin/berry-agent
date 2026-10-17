/**
 * notify 件生命周期自持测试（examples/notify-plugin 配套——沿 minimal-code 模板自持形）。
 *
 * 作者引导（完整说明见仓库 docs/plugin-development.md 测试节）：
 * - 本文件是**稳定面**自持形：零宿主 devDep——直测插件入口的导出面形状与
 *   激活/订阅/投递语义，拷走即跑（node 直跑 / vitest / node:test 均可——
 *   顶层断言形，不用 runner 注册 API）；本件 package.json 声明 "type":
 *   "module"（模板件中首个）——node 直跑零重解析告警，装载侧不受影响；
 * - **零真网络**：两后端发送缝（named export `__senders`）恒注入假发送器——
 *   SMTP 真腿（node:tls/node:net 客户端）与 Telegram 真腿（global fetch）在
 *   测试全程零触达；
 * - 伪 ctx 语义与宿主真面同构：secrets.get 缺席抛错（真面 CREDENTIALS_NOT_FOUND
 *   同律）；本件激活路径不走 ctx.effect（订阅回卷由宿主受理内建——见 entry.js 注）。
 *
 * 断言只比形状（函数性/数组性/调用计数/载荷透传），不比文案内容。
 */
import { deepStrictEqual, ok } from 'node:assert';
import activate, { inject, __senders } from '../entry.js';

// —— 锚一：入口导出面形状（default async 函数 + inject 空数组示形 + 发送缝两槽）——
ok(typeof activate === 'function', 'default export 须为函数（async 装载形）');
ok(Array.isArray(inject), 'named export inject 须为数组（硬依赖声明位）');
deepStrictEqual(inject, [], '本件零第三方依赖——保留空数组示形');
ok(__senders !== null && typeof __senders === 'object', 'named export __senders 须为对象（后端发送缝 DI 位）');
deepStrictEqual(
  Object.keys(__senders).sort(),
  ['smtp', 'telegram'],
  '发送缝恰两槽（SMTP/Telegram 双后端——测试经此注入假发送器）',
);
ok(__senders.smtp === undefined && __senders.telegram === undefined, '缺省两槽空 = 真后端直连形（注入是测试替身动作）');

/** 微任务排空（投递链是异步——8 轮足够干涸「handler → deliver → 发送缝」链） */
const drain = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

/**
 * 最小伪 ctx（作者可复制的最小桩）——仅实现本件消费的三面：
 * get('secrets')（自域凭证读，缺席抛错同真面律）/ ui.notify / events.subscribeSessionLifecycle。
 */
function createFakeCtx(secrets) {
  const state = { subscribes: [], notifies: [], unsubscribed: false };
  const ctx = {
    get: (name) => {
      if (name !== 'secrets') throw new Error(`CONTEXT_SERVICE_MISSING（伪面——${name}）`);
      return {
        get: (credentialName) => {
          const value = secrets[credentialName];
          if (value === undefined) {
            // 真面同律：缺席响亮拒（CREDENTIALS_NOT_FOUND）——插件侧兜底降级
            throw new Error(`CREDENTIALS_NOT_FOUND（伪面——${credentialName} 不在本插件域）`);
          }
          return value;
        },
      };
    },
    ui: { notify: (message, opts) => state.notifies.push({ message, opts }) },
    events: {
      subscribeSessionLifecycle: (handler, opts) => {
        state.subscribes.push({ handler, opts });
        return () => {
          state.unsubscribed = true;
        };
      },
    },
  };
  return { ctx, state };
}

const FULL_CONFIG = {
  backend: 'both',
  'smtp-host': 'smtp.example.test',
  'smtp-port': '465',
  'smtp-from': 'agent@example.test',
  'smtp-to': 'owner@example.test',
  'smtp-username': 'agent@example.test',
  'smtp-starttls': false,
  'telegram-chat-id': '424242',
};

// —— 锚二：激活语义（注册动词恰一 + scope 定谳值 + 回卷 disposer）——
{
  const { ctx, state } = createFakeCtx({});
  const cleanup = await activate(ctx, FULL_CONFIG);
  deepStrictEqual(state.subscribes.length, 1, '注册动词恰一次（subscribeSessionLifecycle）');
  deepStrictEqual(
    state.subscribes[0].opts,
    { scope: 'all' },
    '订阅作用域 = all（全会话终态拍——self/tree 档需 sessionId 锚、装载期不可得）',
  );
  ok(typeof cleanup === 'function', 'activate 须返回清理函数（unmount disposer 形）');
  cleanup();
  ok(state.unsubscribed === true, '清理函数即订阅退订（回卷律——宿主侧另有 scope effect 内建兜底，重复退订幂等）');
}

// —— 锚三：run-settled 文案组形（终态在场/缺席两形——缺席不虚构终值）——
{
  const { ctx, state } = createFakeCtx({ 'smtp-password': 'pw-shape', 'telegram-bot-token': 'tok-shape' });
  const smtpSends = [];
  const telegramSends = [];
  __senders.smtp = async (mail, text) => {
    smtpSends.push({ mail, text });
  };
  __senders.telegram = async (token, chatId, text) => {
    telegramSends.push({ token, chatId, text });
  };
  try {
    await activate(ctx, FULL_CONFIG);
    const handler = state.subscribes[0].handler;
    handler({ sessionId: 'sess-alpha', phase: 'run-started' }); // 起拍不推
    handler({ sessionId: 'sess-beta', phase: 'run-settled', status: 'completed' }); // 终态在场形
    handler({ sessionId: 'sess-gamma', phase: 'run-settled' }); // 崩溃路径——终态缺席形
    await drain();
    deepStrictEqual(smtpSends.length, 2, 'SMTP 发送恰两次（起拍零推、终态拍各一）');
    deepStrictEqual(telegramSends.length, 2, 'Telegram 发送恰两次（双后端并发同拍）');
    ok(
      smtpSends[0].text.includes('sess-beta') && smtpSends[1].text.includes('sess-gamma'),
      '文案携带会话 id（载荷透传）',
    );
    ok(smtpSends[0].text.includes('completed'), '终态在场形如实携带终态值（三值之一）');
    ok(!smtpSends[1].text.includes('completed'), '终态缺席形不虚构终值（崩溃路径诚实文案）');
    ok(smtpSends[0].text !== smtpSends[1].text, '在场/缺席两形文案分形（不同形即不同文）');
    // 双后端调用形：SMTP 携完整就绪配置 + 凭证缝密码；Telegram 携 token + config chatId
    deepStrictEqual(smtpSends[0].mail.host, 'smtp.example.test', 'SMTP 调用携 config 主机位');
    deepStrictEqual(smtpSends[0].mail.password, 'pw-shape', 'SMTP 密码经凭证缝取（不入 config）');
    deepStrictEqual(telegramSends[0].token, 'tok-shape', 'token 经凭证缝取（不入 config）');
    deepStrictEqual(telegramSends[0].chatId, '424242', 'chatId 来自 config');
    deepStrictEqual(state.notifies, [], '成功路径零 warn（降级通道静默）');
  } finally {
    __senders.smtp = undefined;
    __senders.telegram = undefined;
  }
}

// —— 锚四：发送缝失败降级形 + 缺后端配置降级形 + 凭证缺席降级形（零真网络——两槽恒注入）——
{
  // ① 发送失败 → 逐后端 warn 降级（不抛、不阻另一后端）
  const failed = createFakeCtx({ 'smtp-password': 'pw-shape', 'telegram-bot-token': 'tok-shape' });
  __senders.smtp = async () => {
    throw new Error('SMTP 线路故障（假发送器注入）');
  };
  __senders.telegram = async () => {
    throw new Error('Telegram 线路故障（假发送器注入）');
  };
  try {
    await activate(failed.ctx, FULL_CONFIG);
    failed.state.subscribes[0].handler({ sessionId: 'sess-delta', phase: 'run-settled', status: 'failed' });
    await drain();
    const warnCount = failed.state.notifies.filter((n) => n.opts !== undefined && n.opts.level === 'warn').length;
    ok(warnCount >= 2, '两后端失败各落一条 warn（fire-and-forget 降级不抛）');
  } finally {
    __senders.smtp = undefined;
    __senders.telegram = undefined;
  }

  // ② 缺后端配置 → 激活期 warn + 该后端零调用（另一后端不受牵连）
  const partial = createFakeCtx({ 'telegram-bot-token': 'tok-shape' });
  const smtpCalls = [];
  const telegramCalls = [];
  __senders.smtp = async () => {
    smtpCalls.push(1);
  };
  __senders.telegram = async () => {
    telegramCalls.push(1);
  };
  try {
    await activate(partial.ctx, { backend: 'both', 'telegram-chat-id': '424242' }); // SMTP 配置三键全缺
    const warnAtBoot = partial.state.notifies.filter((n) => n.opts !== undefined && n.opts.level === 'warn').length;
    ok(warnAtBoot >= 1, '缺后端配置在激活期即 warn（该后端跳过、不崩装载）');
    partial.state.subscribes[0].handler({ sessionId: 'sess-epsilon', phase: 'run-settled', status: 'aborted' });
    await drain();
    deepStrictEqual(smtpCalls.length, 0, 'SMTP 后端零调用（缺配置降级）');
    deepStrictEqual(telegramCalls.length, 1, 'Telegram 后端照常投递（另一后端不受牵连）');
  } finally {
    __senders.smtp = undefined;
    __senders.telegram = undefined;
  }

  // ③ 凭证缺席 → 逐次发送 warn 跳过（secrets.get 抛错被兜、不定崩）
  const secretless = createFakeCtx({}); // 凭证盒空——两枚全缺席
  const calls = [];
  __senders.smtp = async () => {
    calls.push('smtp');
  };
  __senders.telegram = async () => {
    calls.push('telegram');
  };
  try {
    await activate(secretless.ctx, FULL_CONFIG);
    secretless.state.subscribes[0].handler({ sessionId: 'sess-zeta', phase: 'run-settled', status: 'completed' });
    await drain();
    deepStrictEqual(calls, [], '凭证缺席两后端零触达发送缝（现读抛错被兜）');
    const warns = secretless.state.notifies.filter((n) => n.opts !== undefined && n.opts.level === 'warn').length;
    ok(warns >= 2, '凭证缺席逐后端 warn（人面可诊——指路 credentials 录入）');
  } finally {
    __senders.smtp = undefined;
    __senders.telegram = undefined;
  }
}

// —— 锚五：SMTP 匿名投递形（username 缺席 + 凭证盒空 → 发送缝可达、password
// undefined、零 warn——README/package.json 承诺面的结构性锁；复闸 NEW-1）——
{
  const { ctx, state } = createFakeCtx({}); // 凭证盒空——匿名形不读凭证
  const smtpSends = [];
  __senders.smtp = async (mail) => {
    smtpSends.push(mail);
  };
  try {
    // username 缺席 = 匿名档（不发 AUTH）；backend 单 smtp 隔离 Telegram 侧
    const anonymous = { ...FULL_CONFIG, 'smtp-username': '' };
    await activate(ctx, { ...anonymous, backend: 'smtp' });
    state.subscribes[0].handler({ sessionId: 'sess-eta', phase: 'run-settled', status: 'completed' });
    await drain();
    deepStrictEqual(smtpSends.length, 1, '匿名形 SMTP 发送缝可达（不读凭证即不触发缺席抛）');
    deepStrictEqual(smtpSends[0].password, undefined, '匿名形 password 传 undefined（AUTH 腿不发）');
    deepStrictEqual(
      state.notifies.filter((n) => n.opts !== undefined && n.opts.level === 'warn'),
      [],
      '匿名形零 warn（凭证缺席降级形不误伤匿名正道形）',
    );
  } finally {
    __senders.smtp = undefined;
  }
}

console.log('notify 件 lifecycle 自持测试样张：全部形状锚通过');
