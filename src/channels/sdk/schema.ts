/**
 * SDK 线协议请求面 typebox 深校验（03 §10.6 请求面动词族条「每动词 typebox
 * schema 校验后消费——webui 微路由同纪律」；13a 挂账批 13e 兑现件）。
 *
 * 单源律：六动词 schema 全集即请求面唯一深校验真源——stdio 解码位
 * （./jsonl.ts decodeWireLine 尾段）与 HTTP 体校验位（core:sdk 件经 channels
 * 公开面消费）同源接入，零第二套。结构层（判别字段闭集/必填标量型）仍由
 * jsonl.ts 先行快校——本层补齐逐字段型/选填语义/未知字段拒收。
 *
 * 非抛型结果面：{ok, value} | {ok:false, reason}——错误帧映射归宿主传输层
 * （stdio = SdkDecodeError 包装；HTTP = 400 携结构化错误码），本层零错误词。
 */
import { Type } from 'typebox';
import { Value } from 'typebox/value';

import type { SdkRequest } from './protocol.js';

// 顶部 typebox 注入形态说明：typebox 主包 + value 子路径均入 channels externals
// 白名单（tools/conversation/web/exec/skills 同律——schema 层宿主件直用）。

/** 公共字段词面：未知字段拒收（收窄律执法——请求面六动词载荷即全集） */
const strict = { additionalProperties: false } as const;

/** hello 请求 schema（protocolVersion 必填；sessionId/after/noDelta 选填） */
const HelloSchema = Type.Object(
  {
    verb: Type.Literal('hello'),
    protocolVersion: Type.Integer(),
    sessionId: Type.Optional(Type.String()),
    after: Type.Optional(Type.Integer()),
    noDelta: Type.Optional(Type.Boolean()),
  },
  strict,
);

/** prompt 请求 schema（messageId/content 必填；sessionId 选填——缺席即新建） */
const PromptSchema = Type.Object(
  {
    verb: Type.Literal('prompt'),
    messageId: Type.String(),
    content: Type.String(),
    sessionId: Type.Optional(Type.String()),
  },
  strict,
);

/** interrupt 请求 schema（sessionId 必填） */
const InterruptSchema = Type.Object(
  {
    verb: Type.Literal('interrupt'),
    sessionId: Type.String(),
  },
  strict,
);

/** decide 请求 schema（approvalId/answer 必填；note 选填——answer 四值闭集） */
const DecideSchema = Type.Object(
  {
    verb: Type.Literal('decide'),
    approvalId: Type.String(),
    answer: Type.Union([
      Type.Literal('approve'),
      Type.Literal('reject'),
      Type.Literal('cancel'),
      Type.Literal('always'),
    ]),
    note: Type.Optional(Type.String()),
  },
  strict,
);

/** getEntries 请求 schema（sessionId/since 必填；cursor 选填——分页续读） */
const GetEntriesSchema = Type.Object(
  {
    verb: Type.Literal('getEntries'),
    sessionId: Type.String(),
    since: Type.Integer(),
    cursor: Type.Optional(Type.String()),
  },
  strict,
);

/** sessions 请求 schema（零载荷） */
const SessionsSchema = Type.Object({ verb: Type.Literal('sessions') }, strict);

/** 六动词 schema 分派表（verb 判别字段路由——与 SDK_REQUEST_VERBS 同序） */
const SCHEMAS_BY_VERB: Record<string, ReturnType<typeof Type.Object>> = {
  hello: HelloSchema,
  prompt: PromptSchema,
  interrupt: InterruptSchema,
  decide: DecideSchema,
  getEntries: GetEntriesSchema,
  sessions: SessionsSchema,
};

/**
 * 请求深校验（非抛型）。输入须已过 jsonl.ts 结构层（verb 在闭集内）——本层
 * 补逐字段校验；独立调用时对判别字段缺席/闭集外同样诚实拒收（reason 单句）。
 */
export function validateSdkRequest(value: unknown): { ok: true; value: SdkRequest } | { ok: false; reason: string } {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: '请求须为 JSON 对象' };
  }
  const verb = (value as { verb?: unknown }).verb;
  const schema = typeof verb === 'string' ? SCHEMAS_BY_VERB[verb] : undefined;
  if (schema === undefined) {
    return { ok: false, reason: `请求动词不识别（verb=${String(verb)}——闭集外或缺席）` };
  }
  if (!Value.Check(schema, value)) {
    // 逐字段首错定位（fail-loud 可行动报因——webui 微路由同纪律）
    const errors = [...Value.Errors(schema, value)];
    const first = errors[0];
    const at = first === undefined ? '' : `（${first.instancePath || '(root)'}：${first.message}）`;
    return { ok: false, reason: `${verb} 请求载荷不合 schema${at}` };
  }
  // Value.Check 通过即结构吻合 SdkRequest 判别联合——窄化断言位
  return { ok: true, value: value as unknown as SdkRequest };
}
