/**
 * write/edit 后诊断 post 注入（03 §10.2——tools_post_execute 行的承载腿）。
 *
 * 编舞：判 tool ∈ {write, edit} 且成功 → 按写路径收集（write = args.path；
 * edit = result.details.operations 按 op 分型——delete 走 didClose，其余走
 * 读盘同步）→ 面注入（service 实现：根外跳过 / 路由 / 已活实例同步等回流
 * / 未活后台预热跳过注入）→ 诊断段追加进 result.content。注入在监听器内
 * **await 收口**（管道水位 = 竞速钟帽内——04 §11 预算），未活实例的后台
 * 预热才是 fire-and-forget（归注入面内部）。
 *
 * **contained 铁律**（03 §10.2 明律）：注入失败 = 吞错 + logger.warn + 不
 * 追加诊断段——绝不改写原结果、绝不置 isError（诊断是增益不是策略）。
 * 本层不碰 next 前置链——纯后置增益段（waterfall 监听者：先 next 透传原
 * 结果，再就地追加）。
 */
import type { PostExecuteInput } from '../contracts/index.js';
import { TOOL_POST_EXECUTE_EVENT } from '../contracts/index.js';

/** 注入面（service 实现——窄面注入本文件零服务依赖） */
export interface LspInjectFace {
  /**
   * 对已写路径注入诊断：读盘全文同步已活实例 → 竞速钟等 publishDiagnostics
   * → 返回追加段清单（超钟路径逐一点名「未及回流」；未活实例后台预热 +
   * 首触一次性「预热中」注记归本面）。
   */
  injectDiagnostics(paths: readonly string[]): Promise<readonly string[]>;
  /** delete 路径的 didClose 唯一触发点（通知已活实例关文档账） */
  closeDocuments(paths: readonly string[]): void;
}

/** 注入器构造依赖 */
export interface LspInjectorDeps {
  readonly face: LspInjectFace;
  readonly warn: (message: string) => void;
}

/**
 * 组 tools_post_execute waterfall 监听器（onWaterfall 挂线）。失败恒
 * contained：吞错 + warn + 原样透传。
 */
export function createDiagnosticsInjector(
  deps: LspInjectorDeps,
): (
  value: PostExecuteInput,
  next: (value: PostExecuteInput) => Promise<PostExecuteInput>,
) => Promise<PostExecuteInput> {
  return async (input, next) => {
    const posted = await next(input); // 先透传——注入纯后置
    try {
      await maybeInject(posted.result, posted, deps);
    } catch (err) {
      // contained 铁律：注入失败不改写原结果、不置 isError——只 warn
      deps.warn(`诊断 post 注入失败（contained 吞错）：${err instanceof Error ? err.message : String(err)}`);
    }
    return posted;
  };
}

/** 注入判定与编舞（await 收口——竞速钟帽内落定，管道返回前诊断段已追加） */
async function maybeInject(
  result: PostExecuteInput['result'],
  input: PostExecuteInput,
  deps: LspInjectorDeps,
): Promise<void> {
  const { tool, args } = input;
  if (result.isError === true) return; // 失败写不注入（成功 = 非 isError）
  const written: string[] = [];
  const deleted: string[] = [];
  if (tool.name === 'write') {
    if (typeof args.path === 'string') written.push(args.path);
  } else if (tool.name === 'edit') {
    // edit 结构化操作账：{operations: [{op: 'add'|'update'|'delete', path}]}
    const details = result.details as { operations?: Array<{ op?: unknown; path?: unknown }> } | undefined;
    if (details !== null && typeof details === 'object' && Array.isArray(details.operations)) {
      for (const op of details.operations) {
        if (typeof op?.path !== 'string') continue;
        if (op.op === 'delete') deleted.push(op.path);
        else written.push(op.path);
      }
    }
  } else {
    return; // 非 {write, edit} 工具——零注入零等待
  }
  if (deleted.length > 0) deps.face.closeDocuments(deleted); // didClose 唯一触发点
  if (written.length === 0) return;
  const segments = await deps.face.injectDiagnostics(written); // 竞速钟帽内（面内执法）
  for (const segment of segments) {
    if (segment !== '') result.content.push({ type: 'text', text: segment });
  }
}

/** 注入器挂线事件名（单源再导出——装配根与测试共用） */
export { TOOL_POST_EXECUTE_EVENT };
