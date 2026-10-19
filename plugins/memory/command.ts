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
import { BaseError } from '../../src/contracts/index.js';
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
    // 敏感产物落盘 0600（05 §6.6——2026-10-18 59 轮 L3 批扩列记忆导出件写位）：
    // 导出件是全量记忆明文副本（回执警示句自证——按敏感数据保管），建即仅属主
    // 可读写；「建即」辖建时点，在场旧文件不追溯（58 轮件④ 同律）。
    writeFileSync(target, text, { encoding: 'utf8', mode: 0o600 });
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
    // 行级诊断收集器（命令体局部物——deps 面零改，06 §3 75 轮批注「导入行级
    // 诊断呈现」）：port 层 warn 注入位已铸而此前未接——「第 N 行格式不对」
    // 全吞，用户修导入文件须盲猜。只收词法坏形行级报文（secret 档走 DAO
    // 自有 warn 通道不双报——port.ts 既有语义）。
    const warns: string[] = [];
    const r = runMemoryImport(text, deps.dao, (message) => warns.push(message));
    if (r.inserted + r.skippedExisting + r.rejectedSecret + r.rejectedMalformed === 0) {
      return '导入完成：文件内无数据行（仅 header）。';
    }
    const lines = [
      `导入完成：新插 ${r.inserted} 条 · 已在跳过 ${r.skippedExisting} 条`,
      `　　　　secret 拒写 ${r.rejectedSecret} 条 · 格式不对跳过 ${r.rejectedMalformed} 条`,
    ];
    // 诊断尾段：留样帽 10 + 超量计数保全——总诊断数在首行直给（另 N 行段再
    // 补未列数，双位保全）；无诊断（全好行）零尾段零噪声
    if (warns.length > 0) {
      const DIAGNOSTIC_SAMPLE_CAP = 10;
      lines.push(`行级诊断（共 ${warns.length} 条）：`);
      lines.push(...warns.slice(0, DIAGNOSTIC_SAMPLE_CAP));
      if (warns.length > DIAGNOSTIC_SAMPLE_CAP) {
        lines.push(`……另 ${warns.length - DIAGNOSTIC_SAMPLE_CAP} 行诊断未列`);
      }
    }
    return lines.join('\n');
  } catch (err) {
    if (err instanceof BaseError) return `${err.code}：${err.message}`;
    throw err;
  }
}
