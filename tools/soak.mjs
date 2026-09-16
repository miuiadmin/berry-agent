#!/usr/bin/env node
/**
 * tools/soak.mjs —— 长跑 soak 统一驱动器（入仓可复跑轨道）。
 *
 * ## 用途
 * 对 berry-agent 宿主做长稳（soak）取证：起真实 daemon（`serve --daemon`）
 * → 逐轮打真实负载（对话 / read 工具 / bash 写动作三混合，按 mode 配比）
 * → 逐轮 RSS 采样（泄漏判据）→ 可选中段 SIGKILL 现场恢复演练 → 汇总表 +
 * 机读 jsonl。四问评估（2026-09-15）结论「长跑韧性有证据无轨道」的本件
 * 收口：原驱动器住 ~/.berry-glm-test/ 试件谱不入仓、新 clone 无法复跑——
 * 本件把轨道搬进仓库，历史取证档见 知识域 `设计文档/00-证据-天级长跑-20260914.md`
 * （160 轮 / 11.95h / kill -9 现场恢复 / RSS 净负增长——形态与判收律的同源）。
 *
 * ## CLI 契约（CI nightly 接线同形——勿改旗标面）
 * ```
 * node tools/soak.mjs [--rounds N] [--mode quick|mixed|long] [--rss-budget-mb N] [--err-lines-cap N] [--kill-exercise] [--unattended] [--drift-cap N] [--help]
 * ```
 * 缺省 `--rounds 3 --mode quick`。mode 配比：
 *  - quick：纯对话 ×2 + read 工具 ×1 轮换（承 12 轮 soak-driver 形），轮间隔 2s——CI 冒烟节律；
 *  - mixed：三混合（i%3===2 → read 工具；i%7===4 且非 read → bash 写动作；余纯对话——
 *    承 soak-day 形），轮间隔 5s；
 *  - long：负载同 mixed + 轮间隔 40s（承 61 分钟 soak-long 形）；天级由 `--rounds N`
 *    拉长（证据档口径：24h ≈ 310 轮）。
 * bash 写动作轮在 daemon 无 UI 形态下走审批降级拒 → 模型收拒收尾——降级链本身入测。
 *
 * ## 模型面（离线自持——零网络零凭证）
 * 每次运行自铸独立临时目录（绝不写真 ~/.berry-agent；BERRY_AGENT_DATA_DIR 自指），
 * 并在目录内生成一个本地 echo provider 插件（Anthropic messages 协议脚本模型，
 * 指向驱动器进程内的 127.0.0.1 echo 服务）经 `plugins install local:` + `mount`
 * 正路装机。宿主全程真实：插件装载 / 会话栈 / durable 台账 / 工具执行 / SSE 解析 /
 * 进程编舞都走产品代码——唯模型应答是本地脚本。soak 考的是宿主韧性不是模型质量。
 *
 * ## 判收口径（四跑教训全继承——见原试件谱注释；批 B 起五判据单源 soak-verdict.mjs）
 *  - 判收词汇：durable 事件 type='turn/end' 且 reason!=='error'（error 轮 2s 假绿洞不得记 ok）；
 *  - 基线计数制：prompt 后 turn/end 计数较基线增长才算收场，取最新一条的 reason
 *    （防 find 首条假收场）；句柄只取自回执（不可凭空构造 sessionId）；
 *  - kill 演习判据：pid+token 双换代 + 断点会话续接收场 + durable entries 只增不减；
 *  - error 行帽（批 B）：daemon.log error 行数 ≤ --err-lines-cap（缺省 0 零容忍——
 *    带病绿收口：错误行增长不再沉默）；
 *  - seq 无洞（批 B）：收场逐会话校验 durable 事件 seq 从 0 起相邻差恰 1——
 *    与 kill-recovery 进程内不变式（恢复前缀无洞 + 续写 seq=N 接续）同源的
 *    驱动器侧投影，count-based 只增不减拦不住的中段丢条由此拦。
 *
 * ## 扩判据（研究档 C4'/C5'——2026-09-16 落码；判据单源同 soak-verdict.mjs）
 *  - 第六判据无人值守（--unattended 启用，三腿）：
 *    ① 跨 tick 会话——echo 插件 apply 期注册 every:1m 巡检行（getJob 查重防
 *       kill 重启 re-apply 撞名），前台轮全静默 5min（recent_user_msg 闸静默窗）
 *       后等自治 fire；判据数 = 非驱动器会话中 turn/end 且 reason≠error 的会话数；
 *    ② 跨压缩窗——echo usage 真实计量（上下文字符/4）+ 460KB 大块填充轮
 *       （判据分母 = fallbackWindowTokens 200k 常量——lastUsageFactOf 不供
 *       contextWindow，缩模型窗改不动分母；user/message 落库截 20.5k 故走
 *       单轮过阈——当前轮足额入请求，单块即过阈 0.5）；专用会话打填充轮至
 *       compaction/start 落账，压缩后同会话续接轮须收场 ok（双达标才计数）；
 *    ③ 跨停靠唤醒——本批未启用：budget 为装配期常量捕获（llm/complete.ts:227），
 *       全局池停靠进程内不可驱动至绿终态，且 wake-refused 三振 console.error
 *       与 error 行帽 0 零容忍冲突——dockResumeOk 恒 null 容忍（判据单源语义）。
 *  - 第七判据延迟漂移（--drift-cap，缺省 3.0；0 = 关闭）：末 1/3 整数轮 dt
 *    中位数 ÷ 首 1/3 中位数 ≤ 帽（driftStatsOf 单源）。kill 演练重启预热轮
 *    （killAt / killAt+1）剔样本；<6 样本恒豁免——quick 三轮天然不执法防
 *    nightly 假红，长跑（--rounds ≥6）退化性慢化由此拦。
 *
 * ## RSS 与预算
 * 逐轮 `ps -o rss=` 采样 daemon 进程；`--rss-budget-mb N` 给帽即断言稳态峰值
 * （重启预热样本另计——kill 重启工作集峰值是已知正常态，非泄漏信号），超帽 exit 1。
 *
 * ## 退出码
 * 0 = 七判据全过（轮次全 ok + 演练启用时 ok + 预算在场时预算内 + error 行 ≤ 帽 +
 * 全会话 seq 无洞 + 无人值守启用时达标 + 延迟漂移在帽）；1 = 任一失败 /
 * 用法错 / 起停失败。判据单源 tools/soak-verdict.mjs。
 *
 * ## 产物
 * stdout 逐轮行 + 末尾汇总表；`<临时目录>/soak-result.jsonl` 机读流（每轮落盘——
 * 中断也有半程账）；daemon.log / sessions.db 在临时数据目录（收场打印路径，留档不清理）。
 *
 * 零 npm 依赖（node 内建 + 全局 fetch）；宿主入口走 `src/host/main.ts` 直跑
 * （NODE_OPTIONS 注入仓内 tsx loader——src 真源无 dist 陈旧陷阱；daemon 脱离
 * spawner 再自举时 loader 经 env 传导仍生效）。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createServer as createTcpProbe } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeVerdict, driftStatsOf, errLineCountOf, seqBreaksOf } from './soak-verdict.mjs';

/* ---------------- 布景常量 ---------------- */

/** 仓库根（tools/ 上一级——驱动器与 cwd 解耦） */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** 宿主入口（src 真源直跑——不走 dist） */
const HOST_MAIN = join(REPO_ROOT, 'src/host/main.ts');
/** tsx loader（daemon child 再自举时经 NODE_OPTIONS 生效的钩子入口） */
const TSX_LOADER = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
/** soak 专用模型标识（echo provider 注册名/模型名——BERRY_AGENT_MODEL 强制指此） */
const SOAK_MODEL_SPEC = 'soak-echo/soak-echo';
/** echo 插件 id（package.json name 与 berryAgent.id 同值——mount 动词用） */
const PLUGIN_ID = 'soak-echo-provider';
/** 会话边界：每 12 轮换新会话（上下文累积 12 轮——承原驱动器节律） */
const SESSION_ROLLOVER = 12;
/** daemon 起活等待窗（秒）——冷启动可 >90s（原驱动器 240s 窗同值） */
const DAEMON_READY_WINDOW_SEC = 240;
/** 无人值守腿②填充块字符数（用户消息与 echo 回执各一块，两处同源）。体积
 *  由压缩判据真分母推导：判据分母 = compaction fallbackWindowTokens 200k 装配
 *  常量（栈面 lastUsageFactOf 不供 contextWindow——缩模型窗声明改不动分母），
 *  阈值 0.5 → 需末条 assistant usage.input ≥ 100k token ≈ 请求上下文 400k
 *  字符。user/message 落库截 20.5k/条（历史累积路径被压死——每轮净增仅
 * ~5k token），故走单轮过阈：当前轮消息足额到达模型（内存活体投影，实测
 *  460k chars 原样入请求），单块 460k chars → usage.input ≈ 115k token ≥
 *  100k 稳过阈（裕度 15%）。 */
const FILLER_BLOCK_CHARS = 460_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- CLI 解析 ---------------- */

const USAGE = `用法：node tools/soak.mjs [--rounds N] [--mode quick|mixed|long] [--rss-budget-mb N] [--err-lines-cap N] [--kill-exercise] [--unattended] [--drift-cap N] [--help]

  --rounds N          轮数（缺省 3；正整数）
  --mode M            负载配比与轮间隔（缺省 quick）
                        quick  纯对话×2 + read 工具×1 轮换，间隔 2s（CI 冒烟）
                        mixed  三混合（对话/read/bash 写），间隔 5s
                        long   三混合 + 间隔 40s（小时级节律；天级由 --rounds 拉长）
  --rss-budget-mb N   RSS 预算帽（MB；稳态峰值超帽 exit 1）
  --err-lines-cap N   daemon.log error 行帽（缺省 0 零容忍——已知噪声源可放宽）
  --kill-exercise     中段 SIGKILL daemon + 现场恢复检查（双换代/续接/只增不减）
  --unattended        无人值守三腿（研究档 C4'）：① 跨 tick 会话（echo 插件注册
                        every:1m 巡检行，前台轮后静默 5min 等自治 fire——recent_user_msg
                        闸静默窗）② 跨压缩窗（专用会话打 460KB 填充轮至 compaction 触发
                        ——判据分母 = fallbackWindowTokens 200k 常量、单轮过阈，
                        压缩后续接轮须 ok）③ 跨停靠唤醒（本批未启用——budget 装配期常量形进程内不可驱动至绿终态，
                        dockResumeOk 恒 null 容忍）
  --drift-cap N       延迟漂移帽（缺省 3.0；末 1/3 逐轮 dt 中位数 ÷ 首 1/3 中位数
                        超帽 exit 1。传 0 = 关闭。样本 <6 轮恒豁免——quick 三轮
                        天然不执法，防 nightly 假红）
  --help              本帮助

退出码：0 = 七判据全绿（轮次/演练/预算/error 行帽/seq 无洞/无人值守/延迟漂移）；1 = 任一失败。`;

function parseArgs(argv) {
  const out = {
    rounds: 3,
    mode: 'quick',
    rssBudgetMb: null,
    errLinesCap: 0,
    killExercise: false,
    unattended: false,
    driftCap: 3.0,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`旗标 ${a} 缺值`);
      return argv[++i];
    };
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--rounds') {
      const v = Number(next());
      if (!Number.isInteger(v) || v < 1) throw new Error('--rounds 须为正整数');
      out.rounds = v;
    } else if (a === '--mode') {
      const v = next();
      if (!['quick', 'mixed', 'long'].includes(v)) throw new Error(`--mode 取值非法：${v}（quick|mixed|long）`);
      out.mode = v;
    } else if (a === '--rss-budget-mb') {
      const v = Number(next());
      if (!Number.isFinite(v) || v <= 0) throw new Error('--rss-budget-mb 须为正数');
      out.rssBudgetMb = v;
    } else if (a === '--err-lines-cap') {
      const v = Number(next());
      if (!Number.isInteger(v) || v < 0) throw new Error('--err-lines-cap 须为非负整数');
      out.errLinesCap = v;
    } else if (a === '--kill-exercise') out.killExercise = true;
    else if (a === '--unattended') out.unattended = true;
    else if (a === '--drift-cap') {
      const v = Number(next());
      if (!Number.isFinite(v) || v < 0) throw new Error('--drift-cap 须为非负数（0 = 关闭漂移判据）');
      out.driftCap = v > 0 ? v : null; // 0 = 显式关闭（driftCap null 恒绿——判据单源语义）
    } else throw new Error(`未知旗标：${a}`);
  }
  return out;
}

/* ---------------- 子进程环境（sanitize + 自指） ---------------- */

/**
 * 宿主子进程 env：剔掉会把写面/编舞面指到调用者世界的旋钮（库重定向、显式
 * token、daemon child 标记、cron 车道标记、测试探针），再强制自指三项
 * （数据目录 / 模型 / NODE_OPTIONS tsx loader）。绝不继承调用者的 ~/.berry-agent。
 */
function childEnv(dataDir) {
  const exclude = new Set([
    'BERRY_AGENT_DB_PATH', // 库文件重定向——soak 库必须落在临时目录
    'BERRY_AGENT_SDK_TOKEN', // 显式 token 形态——走 daemon 自动 token
    'BERRY_AGENT_SERVE_DAEMON_CHILD', // daemon child 标记——防 spawn 递归误判
    'BERRY_AGENT_SDK_PORT', // SDK 端口 env 载体——旗标单源
    'BERRY_AGENT_INJECT_PROBE', // 测试探针
    'BERRY_AGENT_CRON', // cron 车道标记——防 exec 判据门误归因
    'BERRY_AGENT_TASK',
  ]);
  const env = { ...process.env };
  for (const key of exclude) delete env[key];
  env.BERRY_AGENT_DATA_DIR = dataDir;
  env.BERRY_AGENT_MODEL = SOAK_MODEL_SPEC; // 调用者若设真模型标识也不透传——临时目录内无其 provider
  env.NODE_OPTIONS = ['--import ' + pathToFileURL(TSX_LOADER).href, process.env.NODE_OPTIONS].filter(Boolean).join(' ');
  return env;
}

/** 跑宿主 CLI（src 入口直跑）；失败时打印输出并返回 null 供调用方 fail-loud */
function hostRun(dataDir, args, timeoutMs) {
  const r = spawnSync(process.execPath, [HOST_MAIN, ...args], {
    env: childEnv(dataDir),
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  if (r.status !== 0) {
    console.log(`[soak] 宿主命令失败：berry ${args.join(' ')}（exit=${r.status}）`);
    if (r.stdout) console.log(r.stdout.slice(-2000));
    if (r.stderr) console.log(r.stderr.slice(-2000));
    return null;
  }
  return r;
}

/* ---------------- echo 模型服务（Anthropic messages 协议脚本应答） ---------------- */

/**
 * 本地 echo 模型服务：脚本判答不联网。判答序看请求 messages 末条：
 *  - 末条是 tool_result（工具轮回执）→ 纯文本收场（回执摘录入答——真两段工具流）；
 *  - 末条用户文本含「请调用 read 工具」→ 回 read 工具调用（路径取自提示文）；
 *  - 末条用户文本含「请调用 bash 工具」→ 回 bash 工具调用（命令取自提示文）；
 *  - 其余 → 纯文本应答（轮号照抄）。
 * SSE 帧序严格对 pi-ai anthropic-messages 解析器：message_start →
 * content_block_start/delta/stop → message_delta(stop_reason) → message_stop。
 */
function startEchoServer() {
  let callCount = 0;
  const server = createHttpServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method !== 'POST' || !String(req.url).endsWith('/messages')) {
        res.writeHead(404).end();
        return;
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400).end();
        return;
      }
      callCount++;
      // 请求侧取证（腿②诊断期）：每请求 messages 逐条角色/长度/前缀落 /tmp——
      // 判腿不匹配时直接看 last 消息真身（vitest 吞 console 同律，走文件）
      if (process.env.SOAK_ECHO_DEBUG) {
        const lines = (body.messages ?? []).map(
          (m) => `${m.role}:${JSON.stringify(m.content ?? '').length}:${JSON.stringify(m.content ?? '').slice(0, 60)}`,
        );
        appendFileSync(
          '/tmp/soak-echo-req.log',
          `call#${callCount} sys=${JSON.stringify(body.system ?? '').length}\n${lines.join('\n')}\n`,
        );
      }
      const blocks = scriptResponse(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // SSE 单帧（event 名 = 事件 type——解析器按 type 分派）
      const sse = (obj) => res.write(`event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`);
      // 真实计量（研究档 C4' 腿②）：input = 全上下文消息字符 / 4（anthropic
      // input 语义 = 整个请求上下文——逐轮累积增长，喂 compaction 阈值判据的
      // 「真 token 主判」路）；output = 应答块字符 / 4。原 16*(n+1) 恒小假值
      // 使阈值路永不可触发。
      const ctxChars = (body.messages ?? []).reduce(
        (sum, m) => sum + JSON.stringify(m?.content ?? '').length + JSON.stringify(m?.role ?? '').length,
        0,
      );
      const outChars = blocks.reduce((sum, b) => sum + (b.text?.length ?? JSON.stringify(b.input ?? '').length), 0);
      const usage = {
        input_tokens: Math.max(1, Math.ceil(ctxChars / 4)),
        output_tokens: Math.max(1, Math.ceil(outChars / 4)),
      };
      sse({ type: 'message_start', message: { id: `msg_soak_${callCount}`, model: 'soak-echo', usage } });
      blocks.forEach((block, index) => {
        if (block.kind === 'text') {
          sse({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
          sse({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } });
        } else {
          sse({
            type: 'content_block_start',
            index,
            content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
          });
          // 参数整体一段 JSON 增量发出——解析器 parseStreamingJson 收全量
          sse({
            type: 'content_block_delta',
            index,
            delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
          });
        }
        sse({ type: 'content_block_stop', index });
      });
      sse({
        type: 'message_delta',
        delta: { stop_reason: blocks.some((b) => b.kind === 'tool') ? 'tool_use' : 'end_turn' },
        usage,
      });
      sse({ type: 'message_stop' });
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, close: () => server.close() });
    });
  });
}

/** 用户文本提取（content 兼容 string / 块数组两形） */
const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((b) => b && b.type === 'text')
          .map((b) => b.text ?? '')
          .join(' ')
      : '';

/** 脚本判答：请求体 → 应答块（text 块或 tool 块） */
function scriptResponse(body) {
  const last = (body.messages ?? [])[body.messages.length - 1] ?? {};
  // 二段腿：末条带 tool_result 块 = 工具已执行（或降级拒）——纯文本收场
  if (Array.isArray(last.content) && last.content.some((b) => b && b.type === 'tool_result')) {
    const receipt = last.content
      .filter((b) => b && b.type === 'tool_result')
      .map((b) => textOf(b.content))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return [{ kind: 'text', text: `工具回执已收：${receipt.slice(0, 80) || '(空)'}——soak 轮收场。` }];
  }
  // marker 判文取「最后一条真用户消息」：宿主每 prompt 后追加 <environment>
  // 披露注入条（213 chars 环境面）为请求末条——读 last 会吞掉全部 marker 匹配
  // （read/bash/填充三腿全退通用应答，2026-09-16 诊断实证）。倒扫跳过注入条。
  let userText = '';
  for (let i = (body.messages ?? []).length - 1; i >= 0; i--) {
    const m = body.messages[i];
    if (!m || m.role !== 'user') continue;
    const t = textOf(m.content);
    if (t.startsWith('<environment>')) continue; // 环境披露注入条——非用户输入
    userText = t;
    break;
  }
  // read 工具腿：路径取自提示文（本驱动器生成的提示文锚「读取文件 <绝对路径>」）
  if (/请调用 read 工具/.test(userText)) {
    const m = userText.match(/读取文件\s+(\/[^\s，。,"']+)/);
    return [
      {
        kind: 'tool',
        id: `toolu_soak_${Date.now().toString(36)}`,
        name: 'read',
        input: { path: m?.[1] ?? '/etc/hostname' },
      },
    ];
  }
  // bash 写动作腿：命令取自提示文（锚「执行 <命令> 把轮号」）
  if (/请调用 bash 工具/.test(userText)) {
    const m = userText.match(/执行\s+(.+?)\s+把轮号/);
    return [
      {
        kind: 'tool',
        id: `toolu_soak_${Date.now().toString(36)}`,
        name: 'bash',
        input: { command: m?.[1] ?? 'echo soak' },
      },
    ];
  }
  // 无人值守填充轮腿（研究档 C4' 腿②）：大块文本回填（FILLER_BLOCK_CHARS
  // 恒量块——专用会话逐轮累积，两轮即过判据阈 0.5；块体积推导见常量注）
  if (/无人值守填充轮/.test(userText)) {
    return [{ kind: 'text', text: `无人值守填充轮回执 ${'填'.repeat(FILLER_BLOCK_CHARS)}` }];
  }
  // 纯对话腿：轮号照抄（无轮号 = 演练续接腿等——通用应答）
  const round = userText.match(/第\s*(\d+)\s*轮/);
  return [{ kind: 'text', text: round ? `第 ${round[1]} 轮就绪（soak echo）。` : 'soak echo 收场。' }];
}

/* ---------------- echo provider 插件物化 + 装机 ---------------- */

/** 在临时目录写插件包（镜像 glm 试件形——虚拟键 berry-agent/llm 取工厂面）。
 *  unattended 形差异（研究档 C4'）：注册 every:1m tick 巡检行（daemon 起钟后
 *  自治 fire——腿① 的自治负载源）。模型窗恒 400k：压缩判据分母 = compaction
 *  fallbackWindowTokens 200k 装配常量（lastUsageFactOf 不供 contextWindow——
 *  缩窗声明改不动分母，压缩触发由填充块体积驱动见 FILLER_BLOCK_CHARS 注），
 *  而窗声明会进 complete 溢出检测（isContextOverflow——input ≥ 窗且正常停即
 *  判溢出）：填充腿请求 token 峰值 ~115k（460k chars 单块），窗 400k 恒在其上防误判。 */
function materializeEchoPlugin(pluginDir, echoBaseUrl, unattended) {
  writeFileSync(
    join(pluginDir, 'package.json'),
    JSON.stringify(
      {
        name: PLUGIN_ID,
        version: '1.0.0',
        type: 'module',
        main: 'index.mjs',
        keywords: ['berry-agent-plugin'],
        berryAgent: { id: PLUGIN_ID, entry: 'index.mjs' },
      },
      null,
      2,
    ) + '\n',
  );
  // 插件源码（驱动器按 echo 服务实际端口注入 baseUrl；嵌入式哑 key——echo 不校验）
  writeFileSync(
    join(pluginDir, 'index.mjs'),
    `/**
 * soak echo provider 插件（tools/soak.mjs 运行期生成——不入仓库）。
 * 用宿主同版本工厂面造 Anthropic messages 协议 provider，指回驱动器进程内的
 * 127.0.0.1 echo 服务（脚本模型——零网络零凭证）。
 */
import { createProvider, anthropicMessagesApi } from 'berry-agent/llm';

const echoModel = {
  id: 'soak-echo',
  name: 'soak echo model',
  api: 'anthropic-messages',
  provider: 'soak-echo',
  baseUrl: '${echoBaseUrl}',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 400000,
  maxTokens: 4096,
};

const provider = createProvider({
  id: 'soak-echo',
  name: 'soak echo (local)',
  baseUrl: '${echoBaseUrl}',
  auth: {
    apiKey: {
      name: 'soak echo key',
      resolve: async () => ({ auth: { apiKey: 'soak-echo-local' }, source: 'embedded soak key' }),
    },
  },
  models: [echoModel],
  api: anthropicMessagesApi(),
});

export default async (ctx) => {
  ctx.effect(() => ctx.llm.registerProvider(provider));
${
  unattended
    ? `
  // 无人值守 tick 腿（--unattended 物化时注入）：注册每分钟巡检行——daemon
  // 起钟后到点经 DiscoveryGates 自治 fire（用户行 = 新建会话 headless run）。
  // getJob 查重防 kill 演练重启后 re-apply 撞名（SCHEDULER_NAME_EXISTS 亮拒）。
  ctx.effect(() => {
    const sched = ctx.tryGet('scheduler');
    if (!sched) {
      console.warn('soak 插件：scheduler 面缺席——tick 巡检行未注册');
      return;
    }
    if (!sched.service.getJob('soak-unattended-tick')) {
      sched.service.addJob({
        name: 'soak-unattended-tick',
        prompt: '无人值守 tick 巡检：请只回复一句话——tick 巡检完成。',
        schedule: 'every:1m',
        enabled: true,
      });
    }
  });
`
    : ''
}
};
`,
  );
}

/* ---------------- daemon 编舞（起 / 等就绪 / 停） ---------------- */

/** 占位端口探测（bind 0 → 取号 → 即关——daemon 绑定前的小竞窗可接受） */
function probeFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createTcpProbe();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * 起 daemon：幂等先停旧代 → serve --daemon（spawner 确认起活即退）→ 轮询等
 * pid+token（token 行 = daemon.log stderr 披露位；pid 真源 = serve/daemon.pid，
 * 内容 JSON 形）。expectFresh 双换代律：重启后 pid 与 token 须双变——防「新
 * pid + 旧 token 尾行」提前 break 拿陈旧 token 后续 401（六跑教训）。
 */
async function startDaemon(ctx, { expectFresh = false, oldPid = 0, oldToken = '' } = {}) {
  hostRun(ctx.dataDir, ['serve', 'stop'], 15000); // 未运行幂等退 0——失败照走
  const up = hostRun(ctx.dataDir, ['serve', '--daemon', '--sdk-port', String(ctx.sdkPort)], 90000);
  if (up === null) return { pid: 0, token: '' };
  const logPath = join(ctx.dataDir, 'serve', 'daemon.log');
  let pid = 0;
  let token = '';
  for (let i = 0; i < DAEMON_READY_WINDOW_SEC; i++) {
    await sleep(1000);
    try {
      const log = readFileSync(logPath, 'utf8');
      const m = [...log.matchAll(/Bearer ([a-f0-9]+)/g)].pop();
      const pidText = readFileSync(join(ctx.dataDir, 'serve', 'daemon.pid'), 'utf8').trim();
      // pid 文件 JSON 形（{"pid":N}）兜裸数字形
      const pidNum = pidText.startsWith('{') ? Number(JSON.parse(pidText).pid) : Number(pidText);
      if (m && Number.isFinite(pidNum) && pidNum > 0) {
        if (expectFresh && (pidNum === oldPid || m[1] === oldToken)) continue; // 换代未完成——继续等
        pid = pidNum;
        token = m[1];
        break;
      }
    } catch {
      /* log/pid 未建或半写——继续等 */
    }
  }
  return { pid, token };
}

/** daemon.log 尾行（起活失败时 fail-loud 诊断） */
function daemonLogTail(ctx, lines = 10) {
  try {
    return readFileSync(join(ctx.dataDir, 'serve', 'daemon.log'), 'utf8')
      .split('\n')
      .slice(-lines)
      .join('\n');
  } catch {
    return '(daemon.log 缺席)';
  }
}

/* ---------------- SDK 线协议（prompt / entries 轮询） ---------------- */

const isEnd = (e) => e.type === 'turn/end' || e.event?.type === 'turn/end';
const reasonOf = (e) => e.data?.reason ?? e.event?.data?.reason ?? '?';

/**
 * 拉全会话 durable 条目（since -1 + 分页跟尽——协议.ts「跟尽义务在调用方」：
 * nextCursor 在场即携 cursor 续读；单页即止 = 截断不报错系调用方违约）。
 * since 取 -1 非 0：读面窗口是 (since, 高水位] **左开**（serve-entry queryEntries
 * `e.seq > since`——重放游标语义），传 0 会漏首条 seq=0 使收场校验误报截头。
 * 批 B 起收场 seq 无洞校验依赖全量——缺省帽 1000 断尾会让校验只见首段。
 */
async function entriesOf(ctx, sessionId) {
  const out = [];
  let cursor;
  for (let page = 0; page < 50; page++) {
    // 页数硬帽 50（= 5 万条——防御服务端异常死循环；正常态远达不到）
    const body = { sessionId, since: -1 };
    if (cursor !== undefined) body.cursor = cursor;
    const en = await ctx.post('/v1/entries', body);
    out.push(...(en.entries ?? en.result?.entries ?? []));
    cursor = en.nextCursor ?? en.result?.nextCursor;
    if (cursor === undefined || cursor === null) break;
  }
  return out;
}

/**
 * 等一轮收场：轮询至 turn/end 计数较基线增长（帽 capSec）。基线计数制
 * （prompt 后计数增长才算收场 + 取最新 turn/end 的 reason）——防 find 首条
 * 假收场与 error 轮 2s 假绿两洞。baseIn 供演练段传 prompt 前基线。
 */
async function awaitTurnEnd(ctx, sessionId, capSec, baseIn = null) {
  const base = baseIn ?? (await entriesOf(ctx, sessionId)).filter(isEnd).length;
  for (let w = 0; w < Math.ceil(capSec / 2); w++) {
    await sleep(2000);
    const entries = await entriesOf(ctx, sessionId);
    const ends = entries.filter(isEnd);
    if (ends.length > base) {
      return { done: ends[ends.length - 1], count: entries.length }; // 最新一条 = 本轮收场
    }
  }
  return { done: null, count: -1 };
}

/** daemon 进程 RSS 采样（KiB；进程不在/采样失败 = -1——fail 面交给轮结论） */
function rssOf(pid) {
  const out = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
  const txt = (out.stdout ?? '').trim();
  return txt === '' || out.status !== 0 ? -1 : Number(txt);
}

/* ---------------- 负载形态（按 mode 配比） ---------------- */

/** 轮负载三形：plain（纯对话）/ read-tool / bash-write */
function roundKind(i, mode) {
  if (i % 3 === 2) return 'read-tool';
  if (mode !== 'quick' && i % 7 === 4) return 'bash-write'; // quick 无写轮（12 轮 soak-driver 形）
  return 'plain';
}

/** 造轮提示文（read 轮先落标记文件——绝对路径不依赖工作区锚） */
function mkContent(i, kind, ctx) {
  if (kind === 'read-tool') {
    const marker = `soak-r${i}-${Date.now().toString(36)}`;
    const file = join(ctx.markerDir, `${marker}.txt`);
    writeFileSync(file, `第 ${i} 轮 soak 标记：${marker}\n`, 'utf8');
    return `请调用 read 工具读取文件 ${file}，然后用一句话告诉我文件里的标记名。`;
  }
  if (kind === 'bash-write') {
    return `请调用 bash 工具执行 echo soak-r${i} > ${join(ctx.tempRoot, `soak-echo-${i}.txt`)} 把轮号写入临时文件，然后告诉我写入结果。`;
  }
  return `这是第 ${i} 轮 soak 长跑。请只回复一句话：第 ${i} 轮就绪（带轮号）。`;
}

/* ---------------- 主流程 ---------------- */

async function main(opts) {
  /* —— 布景：临时根 + echo 服务 + 插件物化 + 装机 —— */
  const tempRoot = mkdtempSync(join(tmpdir(), 'berry-soak-'));
  const dataDir = join(tempRoot, 'data');
  const pluginDir = join(tempRoot, 'echo-plugin');
  const markerDir = join(tempRoot, 'markers');
  const resultFile = join(tempRoot, 'soak-result.jsonl');
  mkdirSync(markerDir, { recursive: true });

  const echo = await startEchoServer();
  const echoBaseUrl = `http://127.0.0.1:${echo.port}`;
  console.log(`[soak] 临时根 ${tempRoot}（echo 模型 ${echoBaseUrl}）`);
  mkdirSync(pluginDir, { recursive: true });
  materializeEchoPlugin(pluginDir, echoBaseUrl, opts.unattended);
  mkdirSync(join(dataDir, 'serve'), { recursive: true });

  const ctx = {
    tempRoot,
    dataDir,
    markerDir,
    resultFile,
    sdkPort: await probeFreePort(),
    pid: 0,
    token: '',
    post: null, // 下方随 token 铸
  };
  ctx.post = (path, body) =>
    fetch(`http://127.0.0.1:${ctx.sdkPort}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'x-sdk-protocol': '1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  // GET 面（/v1/sessions 零载荷动词——无人值守腿①轮询会话清单用）
  ctx.get = (path) =>
    fetch(`http://127.0.0.1:${ctx.sdkPort}${path}`, {
      headers: { Authorization: `Bearer ${ctx.token}`, 'x-sdk-protocol': '1' },
    }).then((r) => r.json());

  let exitCode = 0;
  try {
    // 装机正路：local: 直引 + mount（写动词下次启动装载生效——daemon 尚未起，天然合序）
    if (hostRun(dataDir, ['plugins', 'install', `local:${pluginDir}`], 60000) === null) return 1;
    if (hostRun(dataDir, ['plugins', 'mount', PLUGIN_ID], 30000) === null) return 1;
    console.log(`[soak] echo 插件已装机+挂载（${PLUGIN_ID}）`);

    /* —— 起 daemon —— */
    console.log(
      `[soak] 起 daemon（mode=${opts.mode} rounds=${opts.rounds}${opts.killExercise ? ' +kill 演练' : ''}）…`,
    );
    let gen = await startDaemon(ctx);
    if (!gen.token) {
      console.log('FAIL-token——daemon.log 尾 10 行：');
      console.log(daemonLogTail(ctx));
      return 1;
    }
    ctx.pid = gen.pid;
    ctx.token = gen.token;
    console.log(`[soak] daemon pid=${ctx.pid} token=${ctx.token.slice(0, 8)}… sdk-port=${ctx.sdkPort}`);

    /* —— 轮负载主循环 —— */
    const intervalMs = opts.mode === 'quick' ? 2000 : opts.mode === 'mixed' ? 5000 : 40000;
    const killAt = Math.ceil(opts.rounds / 2); // 演练锚轮（半程）
    const started = Date.now();
    const results = [];
    const sessionIds = [];
    let sessionId = ''; // 会话句柄懒建：块首轮缺席 = 服务端新建，回执带回后钉住续接
    let okCount = 0;

    for (let i = 1; i <= opts.rounds; i++) {
      const t0 = Date.now();
      const kind = roundKind(i, opts.mode);
      // prompt（句柄只取自回执——不可凭空构造在场会话名）
      let pr;
      try {
        const payload = sessionId
          ? { sessionId, messageId: `soak-r${i}-${t0}`, content: mkContent(i, kind, ctx) }
          : { messageId: `soak-r${i}-${t0}`, content: mkContent(i, kind, ctx) };
        pr = await ctx.post('/v1/prompt', payload);
      } catch (e) {
        results.push({ round: i, kind, ok: false, why: `prompt 网络异常：${e.message}`, t: Date.now() });
        console.log(`[r${i}] FAIL-net ${e.message}`);
        continue;
      }
      const gotSession = pr.sessionId ?? pr.result?.sessionId;
      if (pr.error || !gotSession) {
        results.push({
          round: i,
          kind,
          ok: false,
          why: `prompt 拒：${JSON.stringify(pr).slice(0, 200)}`,
          t: Date.now(),
        });
        console.log(`[r${i}] FAIL-prompt ${JSON.stringify(pr).slice(0, 120)}`);
        continue;
      }
      if (!sessionId) {
        sessionId = gotSession; // 块首轮——钉住服务端新建的句柄
        sessionIds.push(gotSession);
      }
      const curSession = sessionId; // 演练段用本轮实际会话——边界翻转后变量可能已空，钉住
      const cap = kind === 'bash-write' ? 150 : 90;
      const { done, count } = await awaitTurnEnd(ctx, curSession, cap);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      const rss = rssOf(ctx.pid);
      if (done) {
        const reason = reasonOf(done);
        const ok = reason !== 'error'; // error 轮 2s 假绿洞——不得记 ok
        if (ok) okCount++;
        results.push({ round: i, kind, ok, reason, dt: Number(dt), rss, entries: count, t: Date.now() });
        console.log(`[r${i}] ${ok ? 'ok' : 'FAIL-error'} ${kind} ${dt}s reason=${reason} rss=${rss} entries=${count}`);
      } else {
        results.push({ round: i, kind, ok: false, why: `turn/end ${cap}s 未达`, rss, t: Date.now() });
        console.log(`[r${i}] FAIL-timeout ${kind} ${dt}s rss=${rss}`);
      }
      writeFileSync(resultFile, results.map((r) => JSON.stringify(r)).join('\n') + '\n');
      // 会话边界翻转（每 12 轮——上下文累积节律）
      if (i % SESSION_ROLLOVER === 0) {
        console.log(
          `[m${i}] 里程碑 ${i}/${opts.rounds} ok=${okCount} rss=${rssOf(ctx.pid)} 会话数=${sessionIds.length}`,
        );
        sessionId = '';
      }
      if (i !== opts.rounds) await sleep(intervalMs); // 轮间隔（末轮不睡）

      /* —— kill 演练：SIGKILL → 重启（双换代）→ 断点续接 → 只增不减对平 —— */
      if (opts.killExercise && i === killAt) {
        console.log(`[drill] 第 ${i} 轮完成——进入 kill -9 现场恢复演练`);
        const beforeEntries = await entriesOf(ctx, curSession);
        const beforeSeq = beforeEntries.length;
        const resumeBase = beforeEntries.filter(isEnd).length;
        try {
          process.kill(ctx.pid, 'SIGKILL');
        } catch (e) {
          console.log(`[drill] kill 异常：${e.message}`);
        }
        console.log(`[drill] kill -9 已发（pid=${ctx.pid}）——3s 后重启`);
        await sleep(3000);
        const oldPid = ctx.pid;
        const oldToken = ctx.token;
        gen = await startDaemon(ctx, { expectFresh: true, oldPid, oldToken });
        if (!gen.token) {
          console.log('[drill] FAIL-restart——daemon.log 尾 10 行：');
          console.log(daemonLogTail(ctx));
          results.push({ round: 'drill-restart', ok: false, t: Date.now() });
          writeFileSync(resultFile, results.map((r) => JSON.stringify(r)).join('\n') + '\n');
          return 1; // daemon 起不来——后续轮无意义，直接收场
        }
        ctx.pid = gen.pid;
        ctx.token = gen.token;
        const warmupRss = rssOf(ctx.pid); // 重启预热样本——预算另计（已知正常态）
        console.log(`[drill] 重启完成 pid=${oldPid}→${ctx.pid} 双换代确认（预热 rss=${warmupRss}）`);
        // 断点会话续接：daemon 重启投影重放后同会话可续
        const rt0 = Date.now();
        const resume = await ctx.post('/v1/prompt', {
          sessionId: curSession,
          messageId: `soak-resume-${rt0}`,
          content: '续接验证：请只回复四个字——续接完成。',
        });
        if (resume.error) console.log(`[drill] 续接 prompt 异形：${JSON.stringify(resume).slice(0, 160)}`);
        const { done: rDone, count: rCount } = await awaitTurnEnd(ctx, curSession, 120, resumeBase);
        if (rDone) {
          const reason = reasonOf(rDone);
          const growOk = rCount >= beforeSeq; // durable 台账只增不减
          console.log(
            `[drill] 续接轮 reason=${reason} entries=${beforeSeq}→${rCount}（${growOk ? '只增不减 ✓' : '回退 FAIL'}）`,
          );
          results.push({
            round: 'drill-resume',
            ok: reason !== 'error' && growOk,
            reason,
            rss: warmupRss,
            t: Date.now(),
          });
        } else {
          console.log('[drill] FAIL-resume-timeout——续接轮 120s 未收场');
          results.push({ round: 'drill-resume', ok: false, why: 'timeout', rss: warmupRss, t: Date.now() });
        }
        writeFileSync(resultFile, results.map((r) => JSON.stringify(r)).join('\n') + '\n');
      }
    }

    /* —— 无人值守腿②（研究档 C4'）：跨压缩窗——专用会话打填充轮至 compaction
       触发（200KB 恒量块 × 真实计量——两轮过阈 0.5，分母推导见
       FILLER_BLOCK_CHARS 注），压缩后续接轮须收场 ok。compactions 判据数 =
       「达标压缩窗」：事件 ≥1 且续接轮 ok 才计数——续接失败即 0（红），
       fail-loud 归因行由判据单源打印。腿位在 kill 演练后（daemon 双换代
       存活性已验，本腿考自治压缩面）。—— */
    let unattendedCompactions = null;
    let unattendedTickSessions = null;
    if (opts.unattended) {
      console.log('[unattended] 腿②跨压缩窗：专用会话打填充轮（460KB/轮块，单轮过阈——判据分母 200k token）…');
      let fillerSession = '';
      let compactionStarts = 0;
      for (let fr = 1; fr <= 6 && compactionStarts === 0; fr++) {
        // 填充轮：提示文带「无人值守填充轮」marker（echo 大块回填腿锚）
        const payload = fillerSession
          ? {
              sessionId: fillerSession,
              messageId: `soak-fill-${fr}-${Date.now()}`,
              content: `无人值守填充轮 ${fr}：${'载'.repeat(FILLER_BLOCK_CHARS)}`,
            }
          : {
              messageId: `soak-fill-${fr}-${Date.now()}`,
              content: `无人值守填充轮 ${fr}：${'载'.repeat(FILLER_BLOCK_CHARS)}`,
            };
        const pr = await ctx.post('/v1/prompt', payload);
        const gotSession = pr.sessionId ?? pr.result?.sessionId;
        if (pr.error || !gotSession) {
          console.log(`[unattended] 填充轮 ${fr} prompt 拒：${JSON.stringify(pr).slice(0, 160)}`);
          break;
        }
        if (!fillerSession) {
          fillerSession = gotSession;
          sessionIds.push(gotSession); // 入 seq 校验域（surfaceOp append 形不改 seq 连续性）
        }
        const { done } = await awaitTurnEnd(ctx, fillerSession, 120);
        if (!done) {
          console.log(`[unattended] 填充轮 ${fr} 120s 未收场`);
          break;
        }
        // 压缩事件计数（durable 落账词 compaction/start——run settle 后异步触发，
        // 轮收场 ≠ 压缩已落账，逐轮重扫全量 entries）
        const entries = await entriesOf(ctx, fillerSession);
        compactionStarts = entries.filter((e) => (e.type ?? e.event?.type) === 'compaction/start').length;
        console.log(`[unattended] 填充轮 ${fr} 收场 reason=${reasonOf(done)}——compaction/start × ${compactionStarts}`);
      }
      let continuationOk = false;
      if (compactionStarts > 0 && fillerSession) {
        // 压缩后续接轮：同会话继续提交一轮普通对话——压缩遮蔽后栈可续跑
        const cr = await ctx.post('/v1/prompt', {
          sessionId: fillerSession,
          messageId: `soak-fill-cont-${Date.now()}`,
          content: '压缩后续接验证：请只回复一句话——压缩后续接完成。',
        });
        const { done: cDone } = await awaitTurnEnd(ctx, fillerSession, 120);
        continuationOk = !cr.error && !!cDone && reasonOf(cDone) !== 'error';
        console.log(`[unattended] 压缩后续接轮 ${continuationOk ? 'ok' : 'FAIL'}（events ≥1：${compactionStarts}）`);
      }
      unattendedCompactions = continuationOk ? compactionStarts : 0;
      results.push({
        round: 'unattended-compaction',
        ok: unattendedCompactions >= 1,
        compactions: unattendedCompactions,
        t: Date.now(),
      });
      writeFileSync(resultFile, results.map((r) => JSON.stringify(r)).join('\n') + '\n');

      /* —— 无人值守腿①：跨 tick 会话——前台与填充轮全静默后等 every:1m 巡检行
         自治 fire（DiscoveryGates：recent_user_msg 静默窗 5min + cooldown 60s——
         巡检行由 echo 插件 apply 期注册，kill 重启 re-apply 查重免撞名）。判据
         数 = 非驱动器会话中「turn/end 且 reason≠error」的会话数（有头无尾的卡
         死 fire 不计数）。等待窗 540s = 5min 静默 + tick 粒度 + 引擎轮询余量。 —— */
      console.log('[unattended] 腿①跨 tick：静默等自治 fire（5min 静默窗 + 1min tick 粒度）…');
      const knownIds = new Set(sessionIds);
      const tickSessionIds = [];
      const quietDeadline = Date.now() + 540_000;
      while (Date.now() < quietDeadline && tickSessionIds.length === 0) {
        await sleep(10_000);
        let list;
        try {
          list = await ctx.get('/v1/sessions');
        } catch {
          continue; // 瞬态网络抖动——下轮重试
        }
        const foreign = (list.sessions ?? []).filter((s) => !knownIds.has(s.id));
        for (const s of foreign) {
          if (tickSessionIds.includes(s.id)) continue;
          try {
            const entries = await entriesOf(ctx, s.id);
            if (entries.some((e) => isEnd(e) && reasonOf(e) !== 'error')) tickSessionIds.push(s.id);
          } catch {
            /* 会话条目瞬态不可读——下轮重扫 */
          }
        }
      }
      unattendedTickSessions = tickSessionIds.length;
      console.log(
        `[unattended] tick 自治会话 ${unattendedTickSessions} 个${tickSessionIds.length > 0 ? `（首会话 ${tickSessionIds[0].slice(0, 8)}…）` : '（等待窗内未 fire——腿①红）'}`,
      );
      results.push({
        round: 'unattended-tick',
        ok: unattendedTickSessions >= 1,
        tickSessions: unattendedTickSessions,
        t: Date.now(),
      });
      writeFileSync(resultFile, results.map((r) => JSON.stringify(r)).join('\n') + '\n');
      // 腿③跨停靠唤醒：本批未启用（budget 装配期常量形进程内不可驱动至绿终态
      // ——llm/complete.ts:227 常量捕获；wake-refused 三振 console.error 与
      // error 行帽 0 零容忍冲突）——dockResumeOk 恒 null 容忍（判据单源语义）
    }

    /* —— 汇总 + 预算断言 + 退出码 —— */
    const drillRows = results.filter((r) => typeof r.round === 'string' && r.round.startsWith('drill-'));
    const drillOk = drillRows.length > 0 ? drillRows.every((r) => r.ok) : null; // null = 未启用
    const steady = results
      .filter((r) => Number.isInteger(r.round))
      .map((r) => r.rss)
      .filter((v) => v > 0);
    const warmup = results
      .filter((r) => r.round === 'drill-resume')
      .map((r) => r.rss)
      .filter((v) => v > 0);
    const rssFirst = steady[0] ?? 0;
    const rssLast = steady[steady.length - 1] ?? 0;
    const rssPeak = Math.max(...steady, ...warmup, 0);
    const rssPeakSteady = Math.max(...steady, 0);
    let errLines = 0;
    try {
      errLines = errLineCountOf(readFileSync(join(dataDir, 'serve', 'daemon.log'), 'utf8'));
    } catch {
      /* 无档——0 */
    }
    // 逐会话 durable 事件序无洞校验（收场终态；daemon 已死则 entriesOf 抛错走
    // 意外异常路径退 1——fail-loud，此时红因早已在轮结论里）
    const seqBreaksBySession = {};
    for (const sid of sessionIds) {
      const entries = await entriesOf(ctx, sid);
      seqBreaksBySession[sid] = seqBreaksOf(entries);
    }
    const totalSec = ((Date.now() - started) / 1000).toFixed(1);
    const capKb = opts.rssBudgetMb !== null ? opts.rssBudgetMb * 1024 : null;
    const budgetWithin = capKb !== null ? rssPeakSteady <= capKb : null;
    // 延迟漂移统计（研究档 C5'）：整数轮 dt 序列（演练重启预热轮剔样本——
    // killAt 轮收场后即演练、killAt+1 轮在冷缓存重启后跑，两端 dt 都非稳态形）
    const driftSampleRounds = new Set();
    if (opts.killExercise) {
      driftSampleRounds.add(killAt);
      driftSampleRounds.add(killAt + 1);
    }
    const driftDts = results
      .filter(
        (r) => Number.isInteger(r.round) && !driftSampleRounds.has(r.round) && typeof r.dt === 'number' && r.dt > 0,
      )
      .map((r) => r.dt);
    const driftStats = driftStatsOf(driftDts); // <6 样本 → null（样本窗豁免）
    const driftRatio = driftStats?.ratio ?? null;
    const driftFirstMedianSec = driftStats?.firstMedianSec ?? null;
    const driftLastMedianSec = driftStats?.lastMedianSec ?? null;
    // 无人值守第六判据入参（--unattended 才设期望；dockResumeOk 恒 null = 腿③未启用容忍）
    const unattended = opts.unattended
      ? {
          tickSessions: unattendedTickSessions ?? 0,
          tickSessionsMin: 1,
          compactions: unattendedCompactions ?? 0,
          compactionsMin: 1,
          dockResumeOk: null,
        }
      : null;
    const verdict = computeVerdict({
      okCount,
      rounds: opts.rounds,
      drillOk,
      budgetWithin,
      errLines,
      errLinesCap: opts.errLinesCap,
      seqBreaksBySession,
      unattended,
      driftRatio,
      driftCap: opts.driftCap,
      driftFirstMedianSec,
      driftLastMedianSec,
    });

    const summary = {
      rounds: opts.rounds,
      mode: opts.mode,
      ok: okCount,
      fail: opts.rounds - okCount,
      totalSec: Number(totalSec),
      sessions: sessionIds.length,
      rssFirstKb: rssFirst,
      rssLastKb: rssLast,
      rssPeakKb: rssPeak,
      rssPeakSteadyKb: rssPeakSteady,
      rssBudgetMb: opts.rssBudgetMb,
      budgetWithin,
      killExercise: opts.killExercise,
      drillOk,
      errLinesCap: opts.errLinesCap,
      daemonLogErrorLines: errLines,
      seqBreaksBySession,
      unattended: opts.unattended
        ? {
            enabled: true,
            tickSessions: unattendedTickSessions ?? 0,
            tickSessionsMin: 1,
            compactions: unattendedCompactions ?? 0,
            compactionsMin: 1,
            dockResumeOk: null, // 腿③未启用（budget 装配期常量形不可驱动——见 soak.mjs 头注）
          }
        : null,
      driftRatio,
      driftCap: opts.driftCap,
      driftFirstMedianSec,
      driftLastMedianSec,
      verdictFails: verdict.fails,
      dataDir,
      resultFile,
    };
    writeFileSync(resultFile, [...results.map((r) => JSON.stringify(r)), JSON.stringify(summary)].join('\n') + '\n');

    // 汇总表（stdout 人读面）
    console.log('[soak] 汇总表：');
    console.log(`  轮次       ${okCount}/${opts.rounds} ok（fail=${opts.rounds - okCount}）`);
    console.log(`  时长       ${totalSec}s（${sessionIds.length} 会话）`);
    console.log(
      `  RSS 首末   ${rssFirst} → ${rssLast} KB（Δ ${rssLast - rssFirst >= 0 ? '+' : ''}${rssLast - rssFirst} KB）`,
    );
    console.log(`  RSS 峰值   ${rssPeak} KB（稳态峰值 ${rssPeakSteady} KB——重启预热另计）`);
    console.log(
      `  预算       ${capKb === null ? '未设（--rss-budget-mb 可设帽）' : `${opts.rssBudgetMb}MB 帽——${budgetWithin ? '内 ✓' : `超帽（稳态峰值 ${rssPeakSteady}KB > ${capKb}KB）`}`}`,
    );
    console.log(`  kill 演练  ${drillOk === null ? '未启用（--kill-exercise）' : drillOk ? 'PASS' : 'FAIL'}`);
    const errOk = errLines <= opts.errLinesCap;
    console.log(`  error 行   ${errLines}（帽 ${opts.errLinesCap}）${errOk ? ' ✓' : ' ✗ 超帽'}`);
    const seqBad = Object.values(seqBreaksBySession).filter((b) => b.length > 0);
    console.log(
      `  seq 校验   ${sessionIds.length} 会话${seqBad.length === 0 ? '全无洞 ✓' : `断洞 ✗（${seqBad.length} 会话）`}`,
    );
    if (opts.unattended) {
      const tickOk = (unattendedTickSessions ?? 0) >= 1;
      const compOk = (unattendedCompactions ?? 0) >= 1;
      console.log(`  tick 会话  ${unattendedTickSessions ?? 0}（最低 1）${tickOk ? ' ✓' : ' ✗ 自治 fire 未达标'}`);
      console.log(`  压缩窗    ${unattendedCompactions ?? 0}（最低 1——事件+续接双达标才计）${compOk ? ' ✓' : ' ✗'}`);
      console.log('  停靠唤醒  未启用（腿③ budget 常量形不可驱动——dockResumeOk null 容忍）');
    }
    const driftText =
      driftStats === null
        ? `样本 ${driftDts.length} 轮不足 6——样本窗豁免`
        : `${driftRatio.toFixed(2)}x（首段中位 ${driftFirstMedianSec}s / 末段中位 ${driftLastMedianSec}s）`;
    // 汇总行绿红（与判据单源同语义：未设帽/样本窗不足恒绿；执法 = ratio ≤ 帽）
    const driftOk = typeof opts.driftCap !== 'number' || driftRatio === null || driftRatio <= opts.driftCap;
    console.log(
      `  延迟漂移  ${driftText}${typeof opts.driftCap === 'number' ? `（帽 ${opts.driftCap}x）` : '（未设帽）'}${driftOk ? ' ✓' : ' ✗ 超帽'}`,
    );
    console.log(`  产物       ${resultFile}（daemon.log 在 ${join(dataDir, 'serve')}）`);

    exitCode = verdict.green ? 0 : 1;
    if (!verdict.green) for (const f of verdict.fails) console.log(`  判据 FAIL  ${f}`);
    console.log(exitCode === 0 ? 'SOAK-ALL-GREEN' : 'SOAK-HAS-FAIL');
    return exitCode;
  } finally {
    // 干净收场：停 daemon（幂等）+ 关 echo 服务（临时目录留档不清理）
    try {
      hostRun(dataDir, ['serve', 'stop'], 15000);
      console.log('[soak] daemon 已停——干净收场');
    } catch {
      /* 幂等 */
    }
    echo.close();
  }
}

/* ---------------- 入口 ---------------- */

const argv = process.argv.slice(2);
let opts;
try {
  opts = parseArgs(argv);
} catch (e) {
  console.error(`参数错：${e.message}\n\n${USAGE}`);
  process.exit(1);
}
if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}
// 前置自检：tsx loader 与宿主入口在场（node_modules 未装时 fail-loud 指路）
try {
  readFileSync(TSX_LOADER);
  readFileSync(HOST_MAIN);
} catch {
  console.error(`前置缺席：${TSX_LOADER} 或 ${HOST_MAIN} 不可读——先在仓库根 npm install（devDependencies 含 tsx）`);
  process.exit(1);
}
try {
  process.exit(await main(opts));
} catch (e) {
  // 主流程意外异常（布景失败/未预期路径）——fail-loud 退 1
  console.error(`[soak] 意外异常：${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
}
