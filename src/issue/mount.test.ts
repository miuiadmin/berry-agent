/**
 * issue webhook 挂点测试（批 18a-4'；03 §10.7 ② + 10.6 路由扩展位——
 * 路由扩展机制第二消费方全环）。
 *
 * 全环腿走真 sdk 面真 TCP（127.0.0.1 port 0）——**SdkHttpFaceHandle 直传
 * 挂载窄面即结构兼容互证**（词面独立律的方向性验证：issue 侧零 sdk import
 * 而面级 handle 结构可赋 IssueWebhookMountFace，typecheck 门禁锁形）。
 * 验收门 = webhook 全环验签拒收例（批 18a 验收门表）。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSdkHttpFace, type SdkHttpFaceHandle, type SdkListenInfo } from '../sdk/index.js';
import type { SdkHttpBridge } from '../sdk/index.js';
import { normalizeIssueConfig } from './filter.js';
import {
  mountIssueWebhook,
  type IssueWebhookMount,
  type IssueWebhookMountFace,
  type IssueWebhookRouteDescriptor,
} from './mount.js';
import { ISSUE_WEBHOOK_BODY_LIMIT_BYTES, ISSUE_WEBHOOK_ENDPOINT, type IssueRef } from './types.js';
import { computeSignature, type IssueWebhookDeps } from './webhook.js';

/** 测试密钥（面未开启守卫的对照组） */
const SECRET = 'whsec-test';

/** 桥桩最小同构（webhook 不触核——八面惰性桩，sdk routes.test 同款） */
function makeBridge(): SdkHttpBridge {
  return {
    submitPrompt: () => ({ sessionId: 's' }),
    lookupDedupeKey: () => undefined,
    interruptSession: () => {},
    queryEntries: () => ({ entries: [] }),
    listSessions: () => [],
    highWaterOf: () => undefined,
    sessionStateOf: () => 'missing',
    retryProbeOf: () => null,
  };
}

/** issues 事件载荷（GitHub webhook 消费字段子集） */
function issuesPayload(repo = 'acme/widgets', number = 7): string {
  return JSON.stringify({
    action: 'opened',
    issue: {
      number,
      title: 'Fix flaky test',
      body: '正文文本',
      labels: [],
      assignees: [],
      state: 'open',
      updated_at: '2026-09-08T00:00:00Z',
      html_url: 'https://github.com/example',
    },
    repository: { full_name: repo },
  });
}

/** 裸请求（Host/Origin 防线位——fetch 禁改两头；POST 形可写体） */
function rawRequest(
  options: { port: number; host?: string },
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ ...options, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe('issue webhook 挂点（18a-4）', () => {
  /* ---------------- 契约面（假挂载窄面——描述符形零网络） ---------------- */

  it('契约面：单 POST 端点、auth self、loopbackOnly 不设、缺省体帽；路径/帽可覆写；dispose 摘除', () => {
    const registered: IssueWebhookRouteDescriptor[] = [];
    const detached: number[] = [];
    const fakeFace: IssueWebhookMountFace = {
      register: (descriptor) => {
        registered.push(descriptor);
        return () => detached.push(registered.indexOf(descriptor));
      },
    };
    const normalized = normalizeIssueConfig({ repos: ['acme/widgets'] });
    if (!normalized.ok) throw new Error(normalized.message);

    const mount = mountIssueWebhook(
      { secret: SECRET, config: normalized.config, enqueue: () => ({ status: 'started', key: 'k' }) },
      fakeFace,
    );
    expect(registered).toHaveLength(1);
    // 描述符形：POST 单方法 + self 档 + loopbackOnly 不设（入站投递面挂非回环）
    expect(registered[0]!.method).toBe('POST');
    expect(registered[0]!.path).toBe(ISSUE_WEBHOOK_ENDPOINT);
    expect(registered[0]!.auth).toBe('self');
    expect(registered[0]!.loopbackOnly).toBeUndefined();
    expect(registered[0]!.bodyLimitBytes).toBe(ISSUE_WEBHOOK_BODY_LIMIT_BYTES);

    // 覆写位
    mount.dispose();
    const mount2 = mountIssueWebhook(
      { secret: SECRET, config: normalized.config, enqueue: () => ({ status: 'started', key: 'k' }) },
      fakeFace,
      { path: '/webhooks/custom', bodyLimitBytes: 1024 },
    );
    expect(registered[1]!.path).toBe('/webhooks/custom');
    expect(registered[1]!.bodyLimitBytes).toBe(1024);
    mount2.dispose();
    mount.dispose(); // 幂等
    expect(detached).toHaveLength(2);
  });

  it('空 secret = 面未开启守卫（空密钥 HMAC 可伪造——禁值守卫先于读体）', async () => {
    const normalized = normalizeIssueConfig({ repos: ['acme/widgets'] });
    if (!normalized.ok) throw new Error(normalized.message);
    const registered: IssueWebhookRouteDescriptor[] = [];
    const fakeFace: IssueWebhookMountFace = {
      register: (descriptor) => {
        registered.push(descriptor);
        return () => {};
      },
    };
    mountIssueWebhook(
      { secret: '', config: normalized.config, enqueue: () => ({ status: 'started', key: 'k' }) },
      fakeFace,
    );

    // handler 直调（零网络）——res 桩记账
    const writes: Array<{ status: number; body: string }> = [];
    const res = {
      writeHead: (status: number) => writes.push({ status, body: '' }),
      end: (payload?: string) => {
        writes[writes.length - 1]!.body = String(payload);
      },
    } as never;
    await registered[0]!.handler({ headers: {} } as never, res, {
      readBody: () => Promise.resolve({ ok: true, body: issuesPayload() }),
    });
    expect(writes[0]!.status).toBe(400);
    expect(writes[0]!.body).toContain('ISSUE_WEBHOOK_INVALID');
    expect(writes[0]!.body).toContain('面未开启');
  });

  /* ---------------- 全环（真 sdk 面真 TCP——结构兼容互证 + 验收门） ---------------- */

  describe('全环真面', () => {
    let face: SdkHttpFaceHandle;
    let info: SdkListenInfo;
    let dir: string;
    let mount: IssueWebhookMount;
    let enqueued: IssueRef[];

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'issue-mount-'));
      enqueued = [];
      const normalized = normalizeIssueConfig({ repos: ['acme/widgets'] });
      if (!normalized.ok) throw new Error(normalized.message);
      const deps: IssueWebhookDeps = {
        secret: SECRET,
        config: normalized.config,
        enqueue: (issue) => {
          enqueued.push(issue);
          return { status: 'started', key: `${issue.repo}#${issue.number}` };
        },
      };
      face = createSdkHttpFace({
        config: { tcp: { host: '127.0.0.1', port: 0 } }, // sock 缺席——TCP 单监听
        bridge: makeBridge(),
        warn: () => {},
      });
      // 结构兼容互证：面级 handle 直传挂载窄面（typecheck 锁形——SdkHttpFaceHandle 可赋 IssueWebhookMountFace）
      const asMountFace: IssueWebhookMountFace = face;
      mount = mountIssueWebhook(deps, asMountFace);
      info = await face.start();
    });

    afterEach(async () => {
      mount.dispose();
      await face.stop();
      await rm(dir, { recursive: true, force: true });
    });

    const port = (): number => info.tcp[0]!.port;

    it('验收门：全环验签拒收——坏签 400 携码，零入队（self 档免 token 头可达）', async () => {
      const payload = issuesPayload();
      const res = await rawRequest(
        { port: port(), host: '127.0.0.1' },
        'POST',
        ISSUE_WEBHOOK_ENDPOINT,
        {
          host: '127.0.0.1',
          'x-github-event': 'issues',
          'x-hub-signature-256': 'sha256=' + '0'.repeat(64), // 坏签（非本密钥 HMAC）
          'content-length': String(Buffer.byteLength(payload)),
        },
        payload,
      );
      // 'self' 档：请求未携任何 Authorization 头仍达 handler——验签件侧执法拒收
      expect(res.status).toBe(400);
      expect(res.body).toContain('ISSUE_WEBHOOK_INVALID');
      expect(enqueued).toHaveLength(0);
    });

    it('验签过 + 域内：200 receipt enqueued 携键，enqueue 收到归一 IssueRef', async () => {
      const payload = issuesPayload('acme/widgets', 7);
      const res = await rawRequest(
        { port: port(), host: '127.0.0.1' },
        'POST',
        ISSUE_WEBHOOK_ENDPOINT,
        {
          host: '127.0.0.1',
          'x-github-event': 'issues',
          'x-hub-signature-256': computeSignature(SECRET, payload),
          'content-length': String(Buffer.byteLength(payload)),
        },
        payload,
      );
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ receipt: 'enqueued', key: 'acme/widgets#7' });
      expect(enqueued).toHaveLength(1);
      expect(enqueued[0]!.repo).toBe('acme/widgets');
      expect(enqueued[0]!.number).toBe(7);
    });

    it('域外仓：200 out-of-scope（他仓事件是正常流非错误）', async () => {
      const payload = issuesPayload('other/org', 9);
      const res = await rawRequest(
        { port: port(), host: '127.0.0.1' },
        'POST',
        ISSUE_WEBHOOK_ENDPOINT,
        {
          host: '127.0.0.1',
          'x-github-event': 'issues',
          'x-hub-signature-256': computeSignature(SECRET, payload),
          'content-length': String(Buffer.byteLength(payload)),
        },
        payload,
      );
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ receipt: 'out-of-scope' });
      expect(enqueued).toHaveLength(0);
    });

    it('体过帽：413（面级排空纪律——per-route 帽 256KiB）', async () => {
      const big = issuesPayload() + 'x'.repeat(ISSUE_WEBHOOK_BODY_LIMIT_BYTES);
      const res = await rawRequest(
        { port: port(), host: '127.0.0.1' },
        'POST',
        ISSUE_WEBHOOK_ENDPOINT,
        {
          host: '127.0.0.1',
          'x-github-event': 'issues',
          'x-hub-signature-256': computeSignature(SECRET, big),
          'content-length': String(Buffer.byteLength(big)),
        },
        big,
      );
      expect(res.status).toBe(413);
    });

    it('dispose 后端点摘除：404 同未注册', async () => {
      mount.dispose();
      const payload = issuesPayload();
      const res = await rawRequest(
        { port: port(), host: '127.0.0.1' },
        'POST',
        ISSUE_WEBHOOK_ENDPOINT,
        {
          host: '127.0.0.1',
          'x-github-event': 'issues',
          'x-hub-signature-256': computeSignature(SECRET, payload),
          'content-length': String(Buffer.byteLength(payload)),
        },
        payload,
      );
      expect(res.status).toBe(404);
    });
  });
});

describe('配置归一 maxDeliveriesPerDay（04 §13——mandate maxPerDay 原料）', () => {
  it('缺省 10；好值透传', () => {
    expect(normalizeIssueConfig({ repos: ['o/r'] })).toMatchObject({
      ok: true,
      config: { maxDeliveriesPerDay: 10 },
    });
    expect(normalizeIssueConfig({ repos: ['o/r'], maxDeliveriesPerDay: 500 })).toMatchObject({
      ok: true,
      config: { maxDeliveriesPerDay: 500 },
    });
  });

  it('空帽即坏形（0/负数/小数/越上界均拒——彻底关停走 HALT 或撤 consent）', () => {
    for (const bad of [0, -3, 2.5, 100_001, '10']) {
      const r = normalizeIssueConfig({ repos: ['o/r'], maxDeliveriesPerDay: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain('HALT');
    }
  });
});
