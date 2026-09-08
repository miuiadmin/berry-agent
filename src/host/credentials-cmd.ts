/**
 * host/credentials-cmd — `credentials` 子命令族 CLI 入口（03 §10.9 人面命令
 * CLI 半边；c-5 落码批）。
 *
 * 零装配直开库（sessions 读腿同形）：不开运行时、不占单活跃机标记、不装载
 * 插件——短命凭证管理动词不是第二宿主实例。开库走 Persistence 直开 + 宿主
 * 迁移链尾单源（HOST_MIGRATION_TAIL——链必须与运行时全同，短链开真库会被
 * 同库拒降级运行）。动词语义/值域执法/结算文本单源在 credentials/commands
 * （TUI /credentials 同源——双面一底座）。
 *
 * 退出码：0 成功（含空清单——诚实空非失败）/ 1 执行失败（名缺席、namespace
 * 坏形——结算文本已含原因，不另打行）。用法错归解析层（exit 2）。
 *
 * 审计注记：CLI 短命进程不接 credentials/changed seam（audit_events 载体
 * 挂账 U3-2；宿主运行时形态的发射位在 assembly deps）。
 */
import { stdout as processStdout, stderr as processStderr } from 'node:process';

import { Persistence } from '../persist/index.js';
import { runCredentialsCommand } from '../credentials/index.js';
import type { CredentialsSub } from '../credentials/index.js';

import { HOST_MIGRATION_TAIL } from './runtime.js';

/** 入口选项（main 分派接线 + 测试注入面） */
export interface CredentialsEntryOptions {
  /** 数据目录（缺省 resolveDataDir()——secret.key 归属地） */
  readonly dataDir?: string;
  /** 库文件路径（缺省 resolveDatabasePath() 三级梯子——与一切入口同源；
   * 注意 dataDir 不重定位库文件〔路径梯子律 05 §6.6〕；测试隔离注入位） */
  readonly dbPath?: string;
  /** 输出面（缺省 process.stdout——测试注入） */
  readonly writeOut?: (text: string) => void;
  /** 错误面（缺省 process.stderr——测试注入） */
  readonly writeErr?: (text: string) => void;
}

/** credentials 子命令族主入口。返回进程退出码（0/1；用法错归解析层退 2） */
export async function runCredentialsEntry(sub: CredentialsSub, options: CredentialsEntryOptions): Promise<number> {
  const out = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const err = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  // 开库（迁移链尾单源；warn 走错误面——毒丸/撕裂尾告警直达人面）
  const persistence = Persistence.open({
    ...(options.dbPath !== undefined ? { dbPath: options.dbPath } : {}),
    ...(options.dataDir !== undefined ? { dataDir: options.dataDir } : {}),
    migrations: HOST_MIGRATION_TAIL,
    warn: (message) => err(`warn：${message}`),
  });
  try {
    // persist Store 结构可赋 CredentialsCommandStore 四法投影（词面独立律
    // compat 面——commands.test.ts 对拍互证；直传真身零适配层）
    const result = runCredentialsCommand(sub, { store: persistence.store });
    out(result.text);
    return result.ok ? 0 : 1;
  } finally {
    await persistence.close();
  }
}
