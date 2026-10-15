/**
 * shell 直达执行件（挖掘 47 轮件 B——`!` 前缀命令直达用户 shell，07 §4.1
 * shell 直达条款的执行面）。
 *
 * 职责边界：判态与路由归 TUI backend（`!` 起头提交走 runDirectShell seam），
 * 执行与回执归本件（spawn/notify 全注入——host 装配位闭包接线）。命令绕过
 * 模型与沙箱直达用户 shell——用户显式前缀即意图，审批门不越 doors 裁决权
 * （03 §4.6 对端注记：门册闭集不增条——'!' 直达是键面路由非 capability 面）。
 *
 * 编舞（回执文案三段式合规 07 §4.4 律二）：
 * - 起跑回声：notify info「shell 直达：$ 〈命令〉」——长命令无反馈窗的诚实呈报；
 * - in-flight 单飞锁：执行中二发 warn 拒（完成即解锁——finally 位，失败亦解锁）；
 * - 成功回执：info「$ 〈命令〉 完成」+ stdout 尾段（非空才附）；
 * - 失败回执：error「$ 〈命令〉 失败：〈诊断〉」——诊断源 = stderr 尾段非空 ?
 *   stderr 尾段 : err.message 兜底（超时腿 SIGTERM 击杀后 stderr 恒空串——
 *   仅取 stderr 会呈空诊断；err.message「Command failed …/killed」形保可读，
 *   plugin-install :605 stderr 属性取形同源）；
 * - 输出尾段帽：超帽截头留尾 + 「…（已截断，共 N 字符）」计数前注——回执是
 *   瞬时行非全文输出面，尾部通常即错误现场。
 */
import type { SpawnRunner } from './plugin-install.js';

/** 执行超时帽（ms——规范定值 120s；spawn timeoutMs 通道透传） */
export const DIRECT_SHELL_TIMEOUT_MS = 120_000;

/** 回执输出尾段帽（字符——超帽截头留尾） */
export const DIRECT_SHELL_TAIL_CAP = 800;

/** 机制件注入面（spawn/notify/cwd 全注入——测试零真子进程零真网络） */
export interface DirectShellDeps {
  /** 子进程执行面（createDefaultSpawnRunner 注入） */
  readonly spawn: SpawnRunner;
  /** 工作目录现读器（聚焦会话工作区锚——每笔现读非闭包冻结） */
  readonly cwd: () => string;
  /** 通知面（backend.notify 注入——回声/回执/单飞拒全经此） */
  readonly notify: (text: string, opts?: { level?: 'info' | 'warn' | 'error' | 'success' }) => void;
  /** shell 路径（缺省 = process.env.SHELL 非空值 ?? '/bin/sh'） */
  readonly shellPath?: string;
  /** 超时帽 ms（缺省 DIRECT_SHELL_TIMEOUT_MS） */
  readonly timeoutMs?: number;
  /** 输出尾段帽字符（缺省 DIRECT_SHELL_TAIL_CAP） */
  readonly outputTailCap?: number;
}

/**
 * 输出尾段截断（纯函数——超帽截头留尾 + 计数前注；帽内原样零前注）。
 * 「截头留尾」= 保住错误现场（诊断信息通常在输出尾部）。
 */
export function tailOf(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return `…（已截断，共 ${text.length} 字符）\n${text.slice(-cap)}`;
}

/**
 * 组装 shell 直达执行器（返回命令消费闭包——backend seam 直挂）。
 * shellPath 缺省链闭包期一次解析（SHELL 环境键非空值 ?? '/bin/sh'——
 * 空串视同未设）。
 */
export function runDirectShellCommand(deps: DirectShellDeps): (command: string) => void {
  const shellPath = deps.shellPath ?? (process.env.SHELL && process.env.SHELL !== '' ? process.env.SHELL : '/bin/sh');
  const timeoutMs = deps.timeoutMs ?? DIRECT_SHELL_TIMEOUT_MS;
  const tailCap = deps.outputTailCap ?? DIRECT_SHELL_TAIL_CAP;
  let inFlight = false; // 单飞锁（host 侧一执行器一锁——装配每会话各持）
  return (command) => {
    if (inFlight) {
      deps.notify('shell 直达：上一条仍在执行（完成后再发）', { level: 'warn' });
      return;
    }
    inFlight = true;
    // 起跑回声：立即落（spawn 异步窗内用户需要已受理的可见反馈）
    deps.notify(`shell 直达：$ ${command}`, { level: 'info' });
    deps.spawn
      .run(shellPath, ['-c', command], { cwd: deps.cwd(), timeoutMs })
      .then(({ stdout }) => {
        // 成功回执：命令行 + 完成 + stdout 尾段（空输出零附——静默成功形「命令 完成」单行）
        const tail = tailOf(stdout, tailCap);
        deps.notify(tail !== '' ? `$ ${command} 完成\n${tail}` : `$ ${command} 完成`, { level: 'info' });
      })
      .catch((err: unknown) => {
        // stderr 属性取形（execFile promisify reject 真身形——plugin-install :605 同源）
        const stderr = err instanceof Error ? ((err as Error & { stderr?: string }).stderr ?? '') : '';
        const stderrTail = tailOf(stderr, tailCap);
        const diag = stderrTail !== '' ? stderrTail : err instanceof Error ? err.message : String(err);
        deps.notify(`$ ${command} 失败：${diag}`, { level: 'error' });
      })
      .finally(() => {
        inFlight = false; // 完成即解锁（成败同律）
      });
  };
}
