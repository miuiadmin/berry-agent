/**
 * /rewind 命令处理器（05 §5.3 批 15d——两段事务的用户呈现面）。
 *
 * 形态律与 /goal、/tick 同族：argv → 人读文本；服务面守卫错（BaseError：
 * NOT_FOUND / STORE_CORRUPT / RESTORE_FAILED）折文本不抛（命令面是用户面
 * 不是异常面）。动词三形：
 *   /rewind list            按当前会话工作区锚列点（id/时刻/触发形/规模）
 *   /rewind preview <id>    段一 preview——恢复 N/删除 M/不动 U 零改动对账
 *   /rewind restore <id>    段二 restore——保底拍+文件恢复+fork 三步序
 *
 * 归属守卫（preview/restore 前置）：回退点锚须与发起会话工作区一致——
 * 跨工作区误贴 id 响亮拒（restore 的文件恢复与域外删除均按回退点工作区
 * 执行，误贴会把破坏性操作打错靶而回执「已回退」）。
 *
 * TUI 命令注册已落（批 19c-4 ctx.channels.registerCommand）；adopt 切前台
 * 编舞 v1 未落——restore 回执的 forkedSessionId 先经输出面呈报，焦点切换随
 * TUI adopt 命令立题〔2026-09-11 勘正：原注指向已飞的批 12，失锚〕。
 */
import { BaseError } from '../contracts/index.js';
import { previewRewind, restoreRewind, type RewindRestoreDeps } from './restore.js';
import type { CheckpointStore } from './store.js';
import type { SessionContextFace } from './types.js';

/** TUI 子动词册（R6 批 10j——补全源名集单源；与 runRewindCommand switch 同步） */
export const REWIND_SUBVERBS = ['list', 'preview', 'restore', 'help'] as const;

export const REWIND_USAGE = [
  '用法：/rewind list —— 列当前工作区的回退点',
  '　　　/rewind preview <id> —— 预演（恢复 N/删除 M/不动 U，零改动）',
  '　　　/rewind restore <id> —— 回退（保底快照 → 文件恢复 → fork 新会话）',
].join('\n');

/** 命令装配依赖 */
export interface RewindCommandDeps extends RewindRestoreDeps {
  store: CheckpointStore;
  session: SessionContextFace;
  /** 发起会话（list 按其工作区锚过滤——restore 保底快照归属同源） */
  sessionId: string;
}

/** manifest 行渲染（list 用——id 截 8 位短形 + 触发形中文 + 规模） */
function manifestLine(id: string, capturedAt: number, trigger: string, files: number, boundarySeq: number): string {
  const when = new Date(capturedAt).toISOString().replace('T', ' ').slice(0, 19);
  const kind = trigger === 'mutation' ? '变异前拍' : '回退保底拍';
  return `- ${id.slice(0, 8)}… ${when}〔${kind}〕${files} 文件 · 回退点 seq=${boundarySeq}`;
}

/**
 * restore/preview 前置守卫：回退点归属工作区与发起会话锚一致（跨工作区
 * 误贴 id 的 fail-loud 拒）。restore 三步序全按 manifest.workspaceRoot 执行
 * ——含「walk 域内 manifest 外文件删除」破坏腿，跨区误贴会把破坏性操作
 * 打错靶而回执「已回退」。返回 undefined = 通过；返回文本 = 拒绝回执
 * （人读面直接折文本——命令面是用户面不是异常面，不新增错误码）。
 */
async function guardRewindOwnership(deps: RewindCommandDeps, id: string): Promise<string | undefined> {
  const manifest = await deps.store.loadManifest(id); // NOT_FOUND / STORE_CORRUPT 直通（上层折文本）
  const current = deps.session.contextOf(deps.sessionId)?.workspaceRoot ?? '';
  if (manifest.workspaceRoot !== current) {
    return [
      `回退点 ${manifest.id.slice(0, 8)}… 不属于当前会话工作区——拒绝跨工作区回退（防误靶：restore 的文件恢复与域外删除均按回退点工作区执行）。`,
      `回退点锚：${manifest.workspaceRoot}；当前会话锚：${current === '' ? '（无锚）' : current}`,
      '如确要回退，请到该工作区的会话发起 /rewind。',
    ].join('\n');
  }
  return undefined;
}

/** /rewind 处理器（argv → 人读文本；守卫错折文本） */
export async function runRewindCommand(argv: readonly string[], deps: RewindCommandDeps): Promise<string> {
  const [verb, ...rest] = argv;
  try {
    switch (verb) {
      case 'list': {
        const ctx = deps.session.contextOf(deps.sessionId);
        if (ctx === undefined || ctx.workspaceRoot === '') {
          return '当前会话无工作区锚——无从列点（快照特性按工作区适用）。';
        }
        const rows = (await deps.store.listManifests()).filter((m) => m.workspaceRoot === ctx.workspaceRoot);
        if (rows.length === 0) return '本工作区暂无回退点（首个变异前拍在工作区内的写工具执行时落）。';
        const lines = rows.map((m) => manifestLine(m.id, m.capturedAt, m.trigger, m.files.length, m.boundarySeq));
        return `本工作区共 ${rows.length} 个回退点（新在前）：\n${lines.join('\n')}`;
      }
      case 'preview': {
        const id = rest[0];
        if (!id) return `缺回退点 id。\n${REWIND_USAGE}`;
        // 归属守卫先行（只读面同判——预演也不越区对账；manifest 复读幂等无害）
        const denied = await guardRewindOwnership(deps, id);
        if (denied !== undefined) return denied;
        const result = await previewRewind(deps.store, id);
        return [
          `回退点 ${result.manifest.id.slice(0, 8)}…（${new Date(result.manifest.capturedAt).toISOString().replace('T', ' ').slice(0, 19)} 拍摄，${result.manifest.files.length} 文件，回退点 seq=${result.manifest.boundarySeq}）`,
          `预演对账（零改动）：恢复 ${result.restoreCount} · 删除 ${result.deleteCount} · 不动 ${result.untouchedCount}`,
          `确认执行：/rewind restore ${result.manifest.id}`,
        ].join('\n');
      }
      case 'restore': {
        const id = rest[0];
        if (!id) return `缺回退点 id。\n${REWIND_USAGE}`;
        // 归属守卫先行（破坏性操作打错靶的唯一前置防线——见 guardRewindOwnership）
        const denied = await guardRewindOwnership(deps, id);
        if (denied !== undefined) return denied;
        const receipt = await restoreRewind(deps, id);
        const forkLine =
          receipt.forkedSessionId !== undefined
            ? `已 fork 新会话 ${receipt.forkedSessionId}（旧史保留，自回退点净边界起跑）。`
            : `fork 未成：${receipt.vetoReason}（文件已恢复——痕迹链完整，可重试或手动接续）`;
        return [
          `已回退至 ${receipt.id.slice(0, 8)}…：恢复 ${receipt.restoredCount} · 删除 ${receipt.deletedCount} · 不动 ${receipt.untouchedCount}`,
          `保底快照 ${receipt.preRewindId.slice(0, 8)}…（本次回退自身可回退）。`,
          forkLine,
        ].join('\n');
      }
      case undefined:
      case 'help':
        return REWIND_USAGE;
      default:
        return `未知动词「${verb}」。\n${REWIND_USAGE}`;
    }
  } catch (err) {
    // 守卫错折文本（命令面是用户面——BaseError 码与人读原因直呈）
    if (err instanceof BaseError) return `${err.code}：${err.message}`;
    throw err;
  }
}
