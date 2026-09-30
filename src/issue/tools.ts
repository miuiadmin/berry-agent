/**
 * issue 工具面（03 §10.7——件注册的只读工具族）。
 *
 * 两件：
 * - `issue_get`：取本 issue 正文 + 评论清单（升序）。绑定面设计——
 *   repo/number 由件侧闭包注入（模型不可指定他仓他号：外部输入最小暴露面），
 *   参数面零自由度（无参数——headless 会话生来只服务这一个 issue）；
 * - `issue_escalate`（⑪ 裁决 4——结构化上报四字段登记面）：模型主动上报
 *   待裁决问题的唯一通道。**effect read 免审批**（登记面纯内存无外部写
 *   ——headless 无应答者下 write/exec 档工具触发审批对即恒废件）；工具
 *   执行 = 只登记不发评论（载荷经回调登记进编排层闭包表，run 收口时随
 *   回执转人审——零新增中途外部写面，评论投递维持编排层收口单链）。
 *
 * 上下文帽：正文 + 评论合计 ISSUE_CONTEXT_CAP_BYTES（64KiB）——外部不可信
 * 文本进模型上下文的总闸（出口治理④字段瘦身同律）；超帽截断尾部并注记
 * （截断标记让模型自知信息不全，不静默丢）。
 *
 * 反查/评论翻页（单页帽 100）：绑定 issue 在 open 长尾（open 数超 100 的仓）
 * 时单页 newest-100 反查会假报「已关闭或删除」——反查满页续翻（帽 5 页防
 * 深翻，达帽话术诚实区分射程）；评论超 100 条单页会静默丢最新段——升序跟
 * 尽翻页（帽 10 页 = 1000 条，达帽附溢出注记不静默丢）。
 */
import { Type } from 'typebox';
import type { ToolDefinition } from '../contracts/index.js';
import type { GithubBackend } from './github.js';
import type { IssueCommentRef, IssueEscalation, IssueRef } from './types.js';
import { ISSUE_CONTEXT_CAP_BYTES } from './types.js';

/** 单页帽（与后端 per_page=100 同值——满页判定 = 可能还有更深页） */
const LIST_PAGE_SIZE = 100;
/** issue 反查翻页帽（5 页——防深翻；达帽即诚实缺席注记不硬翻） */
const ISSUE_LOOKUP_PAGE_CAP = 5;
/** 评论跟尽翻页帽（10 页 = 1000 条——达帽附溢出注记不静默丢） */
const COMMENTS_PAGE_CAP = 10;

/** 工具依赖（service 组装注入——backend 经窄面；onEscalate = 编排层登记回调〔⑪ 裁决 4〕） */
export interface IssueToolsDeps {
  readonly backend: GithubBackend;
  /** 目标 issue（闭包绑定——模型面零参数） */
  readonly repo: string;
  readonly number: number;
  /** escalation 登记回调（登记进 runOne 闭包表——工具工厂与编舞同域，跨停靠存活随 Job 蒸发） */
  readonly onEscalate: (escalation: IssueEscalation) => void;
}

/** 组 issue 工具族（issue_get + issue_escalate——两件 effect read 恒免审批） */
export function createIssueTools(deps: IssueToolsDeps): ToolDefinition[] {
  /**
   * 反查绑定 issue：单页起查，未命中且满页（= 可能还有更旧 open issue）续翻
   * 至列尽（短页）或帽（5 页）。已知窄化边界：后端 listIssues 会滤掉 PR 混
   * 列（100 原始行滤后 < 100 时提前判列尽）——残界极窄（须首页恰混 PR 且
   * 目标在更深处），达帽话术的射程注记兜底诚实性。
   */
  const findBoundIssue = async (): Promise<{ issue: IssueRef | undefined; hitCap: boolean }> => {
    for (let page = 1; page <= ISSUE_LOOKUP_PAGE_CAP; page++) {
      const issues = await deps.backend.listIssues({ repo: deps.repo, page });
      const mine = issues.find((i) => i.number === deps.number);
      if (mine !== undefined) return { issue: mine, hitCap: false };
      if (issues.length < LIST_PAGE_SIZE) return { issue: undefined, hitCap: false }; // 短页 = 列尽
    }
    return { issue: undefined, hitCap: true }; // 恒满页达帽——缺席话术区分射程
  };

  /** 评论跟尽：升序翻页至列尽（短页）或帽（10 页）——达帽溢出注记不静默丢 */
  const collectComments = async (): Promise<{ list: IssueCommentRef[]; overflow: boolean }> => {
    const list: IssueCommentRef[] = [];
    for (let page = 1; page <= COMMENTS_PAGE_CAP; page++) {
      const batch = await deps.backend.listComments({ repo: deps.repo, number: deps.number, page });
      list.push(...batch);
      if (batch.length < LIST_PAGE_SIZE) return { list, overflow: false };
    }
    return { list, overflow: true }; // 恒满页达帽——最新段未收录（升序取旧段）
  };

  return [
    {
      name: 'issue_get',
      effect: 'read',
      description:
        '取当前 issue 的正文与全部评论（时间升序）。无参数——本会话已绑定该 issue。输出超 64KiB 时尾部截断并注记。',
      parameters: Type.Object({}),
      execute: async () => {
        // 反查腿（可多页）与评论腿（可多页）并行——两腿互不阻塞
        const [found, comments] = await Promise.all([findBoundIssue(), collectComments()]);
        const mine = found.issue;
        if (mine === undefined) {
          return {
            content: [
              {
                type: 'text' as const,
                // 达帽形区分射程（「不在最新 500 条内」）——恒满页时「列尽」
                // 话术是假列尽（更深页存在只是不翻了），诚实注记翻页帽
                text: found.hitCap
                  ? `issue ${deps.repo}#${deps.number} 不在最新 ${ISSUE_LOOKUP_PAGE_CAP * 100} 条 open issue 内（可能已关闭或删除——或超出翻页上限，更深须人工直查）`
                  : `issue ${deps.repo}#${deps.number} 不在源返回集内（可能已关闭或删除）`,
              },
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
        if (comments.list.length > 0) {
          sections.push('', '## 评论');
          for (const c of comments.list) {
            sections.push(`— ${c.author}（${c.createdAt}）：`, c.body || '（空）');
          }
          if (comments.overflow) {
            // 溢出注记（升序取旧段——最新段未收录）：模型自知信息不全
            sections.push(
              '',
              `…（评论超 ${COMMENTS_PAGE_CAP * 100} 条上限——以上为最早的 ${comments.list.length} 条，更新段未收录）`,
            );
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
          text = `${kept.join('\n')}\n\n…（内容超 ${ISSUE_CONTEXT_CAP_BYTES} 字节上限已截断——评论可能不全）`;
        }
        return { content: [{ type: 'text' as const, text }], details: { comments: comments.list.length } };
      },
    },
    {
      name: 'issue_escalate',
      effect: 'read',
      description:
        '向人上报需裁决的问题或决策请求（登记面——run 收口时随回执转人审，不中途发评论）。question 必填；可选附 options 候选清单 / recommendation 建议案 / continueWithDefault 建议的默认继续案（仅呈报，不会自动执行）。',
      parameters: Type.Object({
        question: Type.String({ description: '要人裁决的问题' }),
        options: Type.Optional(Type.Array(Type.String(), { description: '候选案清单（可选）' })),
        recommendation: Type.Optional(Type.String({ description: '建议案（可选）' })),
        continueWithDefault: Type.Optional(Type.String({ description: '建议的默认继续案（可选——v1 仅呈报不执行）' })),
      }),
      execute: async (args) => {
        // 只登记不发评论（收口单链——评论投递是编排层收口动作 postReceipt 不破）。
        // 参数面已过管道 schema 前置校验（question 必填串）——此处窄化组装载荷
        deps.onEscalate({
          question: typeof args.question === 'string' ? args.question : String(args.question),
          ...(Array.isArray(args.options) ? { options: args.options.map((o) => String(o)) } : {}),
          ...(typeof args.recommendation === 'string' ? { recommendation: args.recommendation } : {}),
          ...(typeof args.continueWithDefault === 'string' ? { continueWithDefault: args.continueWithDefault } : {}),
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: '已记录上报——run 收口时随回执转人审。可继续任务其余部分；若无法继续，直接收尾并在总结中说明等待裁决的事项。',
            },
          ],
        };
      },
    },
  ];
}
