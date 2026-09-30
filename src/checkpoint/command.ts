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
 * 已落（2026-09-30 批3——deps.adoptSession 注入：registerSession+focus，
 * resolve 后才 return 回执 = notify 排 focus 落画后）。
 */
import { BaseError } from '../contracts/index.js';
import { previewRewind, restoreRewind, type RewindRestoreDeps } from './restore.js';
import type { CheckpointStore } from './store.js';
import type { SessionContextFace } from './types.js';

/** TUI 子动词册（R6 批 10j——补全源名集单源；与 runRewindCommand switch 同步） */
export const REWIND_SUBVERBS = ['list', 'preview', 'restore', 'help'] as const;

export const REWIND_USAGE = [
  '用法：/rewind —— 打开选择页挑回退点（无参形；选择页不可用时显示本用法）',
  '　　　/rewind list —— 列当前工作区的回退点',
  '　　　/rewind preview <id> —— 预览（恢复 N/删除 M/不动 U，不改动文件）',
  '　　　/rewind restore <id> —— 回退（回退前快照 → 文件恢复 → 新建分支会话）',
].join('\n');

/** 命令装配依赖 */
export interface RewindCommandDeps extends RewindRestoreDeps {
  store: CheckpointStore;
  session: SessionContextFace;
  /** 发起会话（list 按其工作区锚过滤——restore 保底快照归属同源） */
  sessionId: string;
  /**
   * 焦点会话在飞判据（2026-09-30 会话管理命令批批3——05 §5.3 翻案笔③
   * busy 守卫：restore 三步序非事务原子，在飞 run 继续写文件会覆盖恢复
   * 产物或被 walk 删腿误删在途产物）。缺席 = 无守卫放行（纯诊断形/测试
   * 替身兼容——旧调用方零破坏）。
   */
  readonly focusRunning?: () => boolean;
  /**
   * fork 成功后的切前台回调（批3——05 §5.3 翻案笔① adopt 编舞：宿主侧
   * registerSession + focus 权威路，notify 回执排在 focus 落画后由调用序
   * 天然保证——本函数 resolve 后调用方才呈报回执）。缺席 = 纯回执不切焦
   * （serve/诊断形——forkedSessionId 仍进回执文本）。
   */
  readonly adoptSession?: (sessionId: string) => Promise<void>;
}

/**
 * manifest 行渲染（list 用——id 截 8 位短形 + 触发形中文 + 规模）。
 * 批3（2026-09-30 会话管理命令批）导出升单源：/rewind 副屏选择器条目行
 * 同源复用本函数（插件域组装成品行——面板/后端零 checkpoint 依赖零重拼）。
 */
export function manifestLine(
  id: string,
  capturedAt: number,
  trigger: string,
  files: number,
  boundarySeq: number,
): string {
  const when = new Date(capturedAt).toISOString().replace('T', ' ').slice(0, 19);
  const kind = trigger === 'mutation' ? '修改前快照' : '回退前快照';
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
      `回退点 ${manifest.id.slice(0, 8)}… 不属于当前会话工作区——已拒绝跨工作区回退（恢复与删除都在回退点所在的工作区执行，防止改错地方）。`,
      `回退点工作区：${manifest.workspaceRoot}；当前会话工作区：${current === '' ? '（无）' : current}`,
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
          return '当前会话未绑定工作区——无法列出回退点（回退点按工作区记录）。';
        }
        const rows = (await deps.store.listManifests()).filter((m) => m.workspaceRoot === ctx.workspaceRoot);
        if (rows.length === 0) return '本工作区暂无回退点——berry 修改此工作区文件时会自动创建。';
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
          `回退点 ${result.manifest.id.slice(0, 8)}…（${new Date(result.manifest.capturedAt).toISOString().replace('T', ' ').slice(0, 19)} 创建，${result.manifest.files.length} 文件，回退点 seq=${result.manifest.boundarySeq}）`,
          `预览结果（不改动文件）：恢复 ${result.restoreCount} · 删除 ${result.deleteCount} · 不动 ${result.untouchedCount}`,
          `确认执行：/rewind restore ${result.manifest.id}`,
        ].join('\n');
      }
      case 'restore': {
        const id = rest[0];
        if (!id) return `缺回退点 id。\n${REWIND_USAGE}`;
        // 归属守卫先行（破坏性操作打错靶的唯一前置防线——见 guardRewindOwnership）
        const denied = await guardRewindOwnership(deps, id);
        if (denied !== undefined) return denied;
        // busy 守卫（批3——05 §5.3 翻案笔③：焦点会话在飞拒——三步序非事务
        // 原子，在飞 run 继续写文件会覆盖恢复产物或被 walk 删腿误删在途
        // 产物；缺席位 = 无守卫放行〔诊断形兼容〕）
        if (deps.focusRunning?.() === true) {
          return '当前会话正在运行——先按 Ctrl+C 停止再回退（运行中继续写文件会破坏要恢复的内容）。';
        }
        const receipt = await restoreRewind(deps, id);
        // adopt 切前台（批3——05 §5.3 翻案笔①：fork 成功即 registerSession+
        // focus；resolve 后才 return 回执 = notify 排 focus 落画后的调用序
        // 保证；缺席 = 纯回执不切焦）。切焦失败不回滚已成的 restore（文件已
        // 恢复 + fork 已建——破坏性步骤居前不可逆），折降级行进回执保 fork
        // id 与手动续接路（/resume <id>）——回执通道是用户面不是异常面
        let adoptFailed: string | undefined;
        if (receipt.forkedSessionId !== undefined && deps.adoptSession !== undefined) {
          try {
            await deps.adoptSession(receipt.forkedSessionId);
          } catch (err) {
            adoptFailed = String(err);
          }
        }
        const forkLine =
          receipt.forkedSessionId !== undefined
            ? `已新建分支会话 ${receipt.forkedSessionId}（原会话保留不动，从回退点重新开始）。`
            : `新建分支会话失败：${receipt.vetoReason}（文件已恢复——可重试或手动接续）`;
        const lines = [
          `已回退至 ${receipt.id.slice(0, 8)}…：恢复 ${receipt.restoredCount} · 删除 ${receipt.deletedCount} · 不动 ${receipt.untouchedCount}`,
          `回退前快照 ${receipt.preRewindId.slice(0, 8)}…（本次回退自身可回退）。`,
          forkLine,
        ];
        if (adoptFailed !== undefined && receipt.forkedSessionId !== undefined) {
          lines.push(
            `切换到新会话失败：${adoptFailed}（文件已恢复，分支会话 ${receipt.forkedSessionId} 已建——可用 /resume ${receipt.forkedSessionId} 手动续接）。`,
          );
        }
        return lines.join('\n');
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
