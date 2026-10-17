/**
 * webhook 验签失败报错文案头名回归锁（第四役 F4——词面勘正）。
 *
 * GitHub 官方 HMAC 验签头名 = **X-Hub-Signature-256**（真源 =
 * mount.ts WEBHOOK_SIGNATURE_HEADER = 'x-hub-signature-256'——常量本身
 * 一直是对的）。修前 webhook.ts:166 报错文案写 X-Signature-256（缺
 * Hub- 段）——运维照文案排查会找错头。产品报错文案（非 AI 生成文本），
 * 断言文案词面不在禁断言范围。
 */
import { describe, expect, it } from 'vitest';

import type { IssueConfig } from './types.js';
import { handleWebhookRequest } from './webhook.js';

/** 测试基线配置（验签失败路径不消费 config——形合即可） */
const CONFIG: IssueConfig = {
  mode: 'draft',
  schedule: 'every:120s',
  repos: ['o/r'],
  perIssueBudgetMessages: 10,
  baseBranch: 'main',
  maxDeliveriesPerDay: 10,
  verifyTimeoutMs: 120_000,
};

describe('验签失败报错文案头名（X-Hub-Signature-256——GitHub 官方词面）', () => {
  it('签名不符报错文案指对头名（含 X-Hub-Signature-256——不教缺 Hub- 段的错名）', async () => {
    // 验签先行：签名不符在载荷解析前抛 ISSUE_WEBHOOK_INVALID（rawBody 形不敏感）
    await expect(
      handleWebhookRequest(
        { secret: 'whsec-test', config: CONFIG, enqueue: async () => ({ status: 'started', key: 'k' }) },
        { event: 'issues', signatureHeader: 'sha256=bad', rawBody: '{}' },
      ),
      // 修前红锚：文案为「X-Signature-256 缺失或错值」——不含 X-Hub-Signature-256
    ).rejects.toMatchObject({
      code: 'ISSUE_WEBHOOK_INVALID',
      message: expect.stringContaining('X-Hub-Signature-256'),
    });
  });
});
