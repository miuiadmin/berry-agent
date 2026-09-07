/**
 * LSP 四工具（03 §10.2——静态注册面：diagnostics / symbols / definitions /
 * references）。
 *
 * 结构性差异（与 MCP 件对照）：工具面**静态四件、无发现步**——注册不依赖
 * 服务器在线（实例惰性首用才 spawn）。扩展名路由选服务器，无路由 isError
 * 诚实回执；一切失败折 isError 结果（数据面不改抛出面）。
 */
import { Type } from 'typebox';
import type { AgentToolResult, ToolDefinition } from '../contracts/index.js';

/** 四工具执行面（service 实现——窄面注入本文件零服务依赖） */
export interface LspToolFace {
  /** 拉 URI 诊断（全文同步后等回流） */
  diagnostics(path: string): Promise<AgentToolResult>;
  /** 文档符号表 */
  symbols(path: string): Promise<AgentToolResult>;
  /** 定义跳转（0-based line/character） */
  definitions(path: string, line: number, character: number): Promise<AgentToolResult>;
  /** 引用查找（0-based line/character） */
  references(path: string, line: number, character: number): Promise<AgentToolResult>;
}

/** 造四件静态工具（execute 落 face；效果面全 read——查询族零写效应） */
export function buildLspToolDefs(face: LspToolFace): ToolDefinition[] {
  const diagnostics: ToolDefinition = {
    name: 'diagnostics',
    effect: 'read',
    description:
      '查询文件的语言服务诊断（LSP——lint/类型错等）。按文件扩展名路由到已配置的语言服务器（惰性启动，首次调用可能较慢）。返回 error/warning 分级清单；诊断超时诚实降级说明。',
    parameters: Type.Object({
      path: Type.String({ description: '目标文件路径（相对路径锚工作区根）' }),
    }),
    execute: async (args) => face.diagnostics(args.path as string),
  };
  const symbols: ToolDefinition = {
    name: 'symbols',
    effect: 'read',
    description:
      '列出文件的文档符号（LSP documentSymbol——函数/类/变量等结构清单，带位置）。按扩展名路由语言服务器（惰性启动）。',
    parameters: Type.Object({
      path: Type.String({ description: '目标文件路径（相对路径锚工作区根）' }),
    }),
    execute: async (args) => face.symbols(args.path as string),
  };
  const definitions: ToolDefinition = {
    name: 'definitions',
    effect: 'read',
    description: '查符号定义位置（LSP definition）。入参行/列 0-based。按扩展名路由语言服务器（惰性启动）。',
    parameters: Type.Object({
      path: Type.String({ description: '目标文件路径（相对路径锚工作区根）' }),
      line: Type.Integer({ description: '行号（0-based）' }),
      character: Type.Integer({ description: '列号（0-based）' }),
    }),
    execute: async (args) => face.definitions(args.path as string, args.line as number, args.character as number),
  };
  const references: ToolDefinition = {
    name: 'references',
    effect: 'read',
    description:
      '查符号全部引用位置（LSP references，含声明）。入参行/列 0-based。按扩展名路由语言服务器（惰性启动）。',
    parameters: Type.Object({
      path: Type.String({ description: '目标文件路径（相对路径锚工作区根）' }),
      line: Type.Integer({ description: '行号（0-based）' }),
      character: Type.Integer({ description: '列号（0-based）' }),
    }),
    execute: async (args) => face.references(args.path as string, args.line as number, args.character as number),
  };
  return [diagnostics, symbols, definitions, references];
}
