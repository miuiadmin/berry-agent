/**
 * contracts/types 类型面源声明锁（治理声明面批）。
 *
 * 锁位背景：类型联合在运行时零痕迹（无运行时词表可对拍），联合成员集的
 * 唯一可红锁位 = 声明源文本扫描（产品固定声明面——断言不受「禁断言 AI 生成
 * 文本」约束；正则锚声明句非行号锚——并行在飞不漂移）。
 *
 * JobKind 闭集成员锁：幽灵词清洗后防回潮——exec 子进程治理实际不走 Job 表
 * 登记（六役勘正笔），'process' 一度入联合零登记源，任何运行时行为均无法
 * 撞它；此锁让幽灵词再次混入联合时测试当场红（声明面回归锁）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 被锁源文（同目录相对 URL 取件——cwd 无关） */
const source = readFileSync(new URL('./types.ts', import.meta.url), 'utf8');

describe('JobKind 闭集成员（源声明锁）', () => {
  it('恰三员 subagent/issue/trigger——幽灵词（如 exec 子进程的 process 形）回潮即红', () => {
    // 正则锚声明句（export type JobKind = … ;）——多行/行内两形均收
    const decl = source.match(/export type JobKind =([^;]+);/);
    expect(decl).not.toBeNull();
    // 逐员剥引号去空白后精确对拍闭集（排序比消除成员序差异）
    const members = decl![1]!.split('|').map((word) => word.trim().replace(/^['"]|['"]$/g, ''));
    expect([...members].sort()).toEqual(['issue', 'subagent', 'trigger']);
  });
});
