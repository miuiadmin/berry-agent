/**
 * /memory-export · /memory-import 命令处理器（批 18c-8——06 §3/§7：用户
 * 命令面非模型工具面——操作者运维动词〔备份/迁移〕，模型可发起的全量明文
 * 记忆落盘 = 可诱导批量外泄路径，故不入工具面）。
 *
 * 形态律同 /goal /rewind /tick（命令件先例）：argv → 人读文本；服务面守卫错
 * （BaseError）折文本不抛——命令面是用户面不是异常面。TUI 命令注册归批 12
 * host 装配批（corePlugins 注册表现空）。
 *
 * 可写根判定：导出落盘路径越界拒 MEMORY_EXPORT_ROOT_DENIED（装配闭包注入
 * 可写根列表 + handler 内显式 isWithinRoots 判定——06 §3：守门管道对插件内
 * 文件写不可见、memory 件无 safety 拓扑边）；**导入读面无根判定**（读取任意
 * 路径是用户显式动词，写入面才受可写根约束——同 skills loadFace 读面先例）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { BaseError } from '../contracts/index.js';
import { buildMemoryExport, isWithinRoots, runMemoryImport, type MemoryPortDaoFace } from './port.js';

export const MEMORY_EXPORT_USAGE =
  '用法：/memory-export <path> [owner] —— 记忆导出为 JSONL 明文文件（owner 省略 = 全 owner；路径须在可写根内）';

export const MEMORY_IMPORT_USAGE =
  '用法：/memory-import <path> —— 从 JSONL 文件恢复式导入（按 id 幂等：已有条目跳过、零合并零覆写）';

/** /memory-export 装配依赖（writableRoots/ownerRoots 归 host 装配闭包注入） */
export interface MemoryExportCommandDeps {
  readonly dao: MemoryPortDaoFace;
  /** 可写根列表（导出落盘路径判定——越界 MEMORY_EXPORT_ROOT_DENIED） */
  readonly writableRoots: () => readonly string[];
  /** owner 键 → 原始根路径对照（header ownerRoots——project 键跨机承接链必需） */
  readonly ownerRoots: () => Record<string, string>;
  /** Unix 毫秒时钟（header exportedAt） */
  readonly now: () => number;
}

/** /memory-import 装配依赖（导入读面无根判定——只携 DAO 窄面） */
export interface MemoryImportCommandDeps {
  readonly dao: MemoryPortDaoFace;
}

/** /memory-export 处理器（argv = [path, owner?] → 人读文本；守卫错折文本） */
export async function runMemoryExportCommand(argv: readonly string[], deps: MemoryExportCommandDeps): Promise<string> {
  const [target, owner] = argv;
  try {
    if (!target) return `缺路径。\n${MEMORY_EXPORT_USAGE}`;
    // 落盘路径判定（越界拒——isWithinRoots 同律复用引证〔skills 先例函数体拷贝 + 注记互证〕）
    if (!isWithinRoots(target, deps.writableRoots())) {
      throw new BaseError('MEMORY_EXPORT_ROOT_DENIED', `导出落盘路径不在可写根内：${target}`);
    }
    const text = buildMemoryExport(deps.dao, {
      ownerKey: owner,
      ownerRoots: deps.ownerRoots(),
      now: deps.now(),
    });
    writeFileSync(target, text, 'utf8');
    const count = text.trimEnd().split('\n').length - 1; // 首行 header 外即数据行数
    const scope = owner === undefined ? '全部 owner' : `owner ${owner}`;
    return [
      `已导出 ${count} 条记忆（${scope}）→ ${target}`,
      '警示：导出文件含全部记忆明文——按敏感数据保管、勿提交进仓库。',
    ].join('\n');
  } catch (err) {
    // 守卫错折文本（命令面是用户面——BaseError 码与人读原因直呈）
    if (err instanceof BaseError) return `${err.code}：${err.message}`;
    throw err;
  }
}

/** /memory-import 处理器（argv = [path] → 人读文本；header 坏形整文件拒折文本） */
export async function runMemoryImportCommand(argv: readonly string[], deps: MemoryImportCommandDeps): Promise<string> {
  const [target] = argv;
  try {
    if (!target) return `缺路径。\n${MEMORY_IMPORT_USAGE}`;
    const text = readFileSync(target, 'utf8');
    const r = runMemoryImport(text, deps.dao);
    if (r.inserted + r.skippedExisting + r.rejectedSecret + r.rejectedMalformed === 0) {
      return '导入完成：文件内无数据行（仅 header）。';
    }
    return [
      `导入完成：新插 ${r.inserted} 条 · 已在跳过 ${r.skippedExisting} 条`,
      `　　　　secret 拒写 ${r.rejectedSecret} 条 · 坏形跳过 ${r.rejectedMalformed} 条（恢复式幂等——零合并零覆写）`,
    ].join('\n');
  } catch (err) {
    if (err instanceof BaseError) return `${err.code}：${err.message}`;
    throw err;
  }
}
