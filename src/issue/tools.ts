/**
 * issue 工具面（03 §10.7——件注册的只读工具）。
 *
 * 单工具 `issue_get`：取本 issue 正文 + 评论清单（升序）。绑定面设计——
 * repo/number 由件侧闭包注入（模型不可指定他仓他号：外部输入最小暴露面），
 * 参数面零自由度（无参数——headless 会话生来只服务这一个 issue）。
 *
 * 上下文帽：正文 + 评论合计 ISSUE_CONTEXT_CAP_BYTES（64KiB）——外部不可信
 * 文本进模型上下文的总闸（出口治理④字段瘦身同律）；超帽截断尾部并注记
 * （截断标记让模型自知信息不全，不静默丢）。
 */
import { Type } from 'typebox';
import type { ToolDefinition } from '../contracts/index.js';
import type { GithubBackend } from './github.js';
import { ISSUE_CONTEXT_CAP_BYTES } from './types.js';

/** 工具依赖（service 组装注入——backend 经窄面） */
export interface IssueToolsDeps {
  readonly backend: GithubBackend;
  /** 目标 issue（闭包绑定——模型面零参数） */
  readonly repo: string;
  readonly number: number;
}

/** 组 issue_get 工具（单件数组——effect read 恒免审批） */
export function createIssueTools(deps: IssueToolsDeps): ToolDefinition[] {
  return [
    {
      name: 'issue_get',
      effect: 'read',
      description:
        '取当前 issue 的正文与全部评论（时间升序）。无参数——本会话已绑定该 issue。输出超 64KiB 时尾部截断并注记。',
      parameters: Type.Object({}),
      execute: async () => {
        const [issues, comments] = await Promise.all([
          deps.backend.listIssues({ repo: deps.repo }),
          deps.backend.listComments({ repo: deps.repo, number: deps.number }),
        ]);
        const mine = issues.find((i) => i.number === deps.number);
        if (mine === undefined) {
          return {
            content: [
              { type: 'text' as const, text: `issue ${deps.repo}#${deps.number} 不在源返回集内（可能已关闭或删除）` },
            ],
            isError: true,
          };
        }
        // 正文段（不可信外部文本——原样引用不转义解释，帽前标注来源）
        const sections: string[] = [
          `# ${mine.title}（${mine.repo}#${mine.number}）`,
          `状态：${mine.state}｜标签：${mine.labels.join(', ') || '（无）'}｜指派：${mine.assignees.join(', ') || '（无）'}`,
          `链接：${mine.htmlUrl}`,
          '',
          mine.body || '（正文为空）',
        ];
        if (comments.length > 0) {
          sections.push('', '## 评论');
          for (const c of comments) {
            sections.push(`— ${c.author}（${c.createdAt}）：`, c.body || '（空）');
          }
        }
        let text = sections.join('\n');
        // 总闸帽：超限截断尾部 + 截断注记（模型自知信息不全）
        const bytes = Buffer.byteLength(text, 'utf8');
        if (bytes > ISSUE_CONTEXT_CAP_BYTES) {
          // 逐段回退到帽内（段级截断——不产生半个多字节字符）
          const kept: string[] = [];
          let used = 0;
          for (const section of sections) {
            const b = Buffer.byteLength(section, 'utf8') + 1;
            if (used + b > ISSUE_CONTEXT_CAP_BYTES - 200) break; // 尾注记余量
            kept.push(section);
            used += b;
          }
          text = `${kept.join('\n')}\n\n…（内容超 ${ISSUE_CONTEXT_CAP_BYTES} 字节帽已截断——评论可能不全）`;
        }
        return { content: [{ type: 'text' as const, text }], details: { comments: comments.length } };
      },
    },
  ];
}
