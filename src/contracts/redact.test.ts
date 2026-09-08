/**
 * 出口治理③ 凭据消毒——契约面测试（04 §7 执行段 2026-09-08 落码定形④⑤：
 * 模式集三段幂等性 + 值基腿下限/排序 + 结果出口 walk 结构保形）。
 */
import { describe, it, expect } from 'vitest';
import { redactKnownSecretValues, redactSensitiveText, redactToolResultExit } from './redact.js';
import type { AgentToolResult } from './tools.js';

describe('模式腿：URL userinfo 剥离', () => {
  it('https 冒号对形剥离为注记（scheme 与 host 保留）', () => {
    expect(redactSensitiveText('fetch https://user:pass@example.com/path')).toBe(
      'fetch https://[REDACTED:url-userinfo]@example.com/path',
    );
  });

  it('非 http scheme 同判（postgres/redis——连接串是 exec 工具常见泄漏面）', () => {
    expect(redactSensitiveText('postgres://alice:s3cr3t@db.local:5432/x')).toBe(
      'postgres://[REDACTED:url-userinfo]@db.local:5432/x',
    );
    expect(redactSensitiveText('redis://myuser:hunter2@cache.internal:6379/0')).toBe(
      'redis://[REDACTED:url-userinfo]@cache.internal:6379/0',
    );
  });

  it('裸用户名形（无冒号对）不触发', () => {
    expect(redactSensitiveText('https://example.com/@handle/path')).toBe('https://example.com/@handle/path');
  });
});

describe('模式腿：URL query 敏感参数值剥离', () => {
  it('闭集参数名精确匹配（access_token），非敏感参数（limit）不动', () => {
    expect(redactSensitiveText('GET /v1?access_token=eyJ.abc.def&limit=10')).toBe(
      'GET /v1?access_token=[REDACTED:query-token]&limit=10',
    );
  });

  it('大小写不敏感（API_KEY）+ & 前锚形', () => {
    expect(redactSensitiveText('x=1&API_KEY=abcdef123456')).toBe('x=1&API_KEY=[REDACTED:query-token]');
  });

  it('前缀词不误伤（token_type 非精确段匹配）', () => {
    expect(redactSensitiveText('reply?token_type=bearer&state=xyz')).toBe('reply?token_type=bearer&state=xyz');
  });
});

describe('模式腿：敏感键名赋值值脱敏', () => {
  it('env dump 形（GITHUB_TOKEN 命中、COUNT 不动）', () => {
    expect(redactSensitiveText('export GITHUB_TOKEN=ghp_abcdef1234 COUNT=42')).toBe(
      'export GITHUB_TOKEN=[REDACTED:secret] COUNT=42',
    );
  });

  it('JSON 引号形保引号（消毒产物仍是合法 JSON 引号串）', () => {
    const out = redactSensitiveText('{"api_key": "sk-1234567890abcdef", "region": "us-east-1"}');
    expect(out).toBe('{"api_key": "[REDACTED:secret]", "region": "us-east-1"}');
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('复合键分段判（aws_secret_access_key 末段 key 命中）', () => {
    expect(redactSensitiveText('aws_secret_access_key = wJalrXUtnFEMI')).toBe(
      'aws_secret_access_key = [REDACTED:secret]',
    );
  });

  it('末段判控制误伤面（token_type/token_url 公开字段不触发）', () => {
    expect(redactSensitiveText('token_type: bearer')).toBe('token_type: bearer');
    expect(redactSensitiveText('"token_url": "https://oauth.example.com/token"')).toBe(
      '"token_url": "https://oauth.example.com/token"',
    );
  });

  it('Authorization 头整行特例（值含空格——Bearer 形整行收口）', () => {
    expect(redactSensitiveText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.sig')).toBe(
      'Authorization: [REDACTED:credential]',
    );
    expect(redactSensitiveText('proxy-authorization: Basic dXNlcjpwYXNz')).toBe(
      'proxy-authorization: [REDACTED:credential]',
    );
  });

  it('散文误伤阈：裸值 <4 不触发（"the token: is" 不动）', () => {
    expect(redactSensitiveText('the token: is here')).toBe('the token: is here');
    expect(redactSensitiveText('the token: abcd')).toBe('the token: [REDACTED:secret]');
  });

  it('非敏感名不吞段：前缀对值区并段的敏感对递归再扫（错误消息常见形）', () => {
    expect(redactSensitiveText('工具 boom 执行异常：Error: 命令失败：GITHUB_TOKEN=ghp_abcdef123456 未授权')).toContain(
      'GITHUB_TOKEN=[REDACTED:secret]',
    );
    expect(redactSensitiveText('Error: 命令失败：GITHUB_TOKEN=ghp_abcdef123456 未授权')).not.toContain(
      'ghp_abcdef123456',
    );
  });
});

describe('模式腿：幂等性（注记形不再触发）', () => {
  const samples = [
    'https://user:pass@example.com/path?token=abc&x=1',
    'Authorization: Bearer xyz',
    'GITHUB_TOKEN=ghp_abc COUNT=1',
    '{"client_secret": "cs-9999"}',
    'redis://u:p@h:1/0',
  ];
  for (const [index, text] of samples.entries()) {
    it(`样本 ${index + 1}：消毒产物再消毒不变`, () => {
      const once = redactSensitiveText(text);
      expect(once).not.toBe(text);
      expect(redactSensitiveText(once)).toBe(once);
    });
  }
});

describe('值基腿：已知秘密活值整段置换', () => {
  it('活值出现即整段置换为 credential 注记', () => {
    expect(redactKnownSecretValues('错误：连接 sk-abcdef123456 失败', ['sk-abcdef123456'])).toBe(
      '错误：连接 [REDACTED:credential] 失败',
    );
  });

  it('长度 <8 不参与（短值误伤普通文本的灾难面控制）', () => {
    expect(redactKnownSecretValues('abc def ghi', ['abc', 'def'])).toBe('abc def ghi');
  });

  it('长值先换（前缀包含关系下短值先换会破坏长值锚）', () => {
    // 'long-secret-value' 包含前缀 'long-sec'——长值先换后短值锚已消失
    expect(redactKnownSecretValues('x long-secret-value y', ['long-sec', 'long-secret-value'])).toBe(
      'x [REDACTED:credential] y',
    );
  });

  it('值含正则元字符安全（split/join 字面替换）', () => {
    expect(redactKnownSecretValues('a.b*c+d(e) 出现', ['a.b*c+d(e)'])).toBe('[REDACTED:credential] 出现');
  });

  it('重复出现全置换 + 空值表直通 + 缺席值不动', () => {
    expect(redactKnownSecretValues('vvvvvvvvvv vvvvvvvvvv', ['vvvvvvvvvv'])).toBe(
      '[REDACTED:credential] [REDACTED:credential]',
    );
    expect(redactKnownSecretValues('anything', [])).toBe('anything');
    expect(redactKnownSecretValues('k k k', ['kkkkkkkkkkkk'])).toBe('k k k');
  });
});

describe('结果出口 walk：redactToolResultExit', () => {
  it('content 文本块消毒；图片块原样保留（自有界）', () => {
    const result: AgentToolResult = {
      content: [
        { type: 'text', text: 'GITHUB_TOKEN=ghp_abcdef1234' },
        { type: 'image', data: 'aGk=', mimeType: 'image/png' },
      ],
    };
    redactToolResultExit(result, []);
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'GITHUB_TOKEN=[REDACTED:secret]' });
    expect(result.content[1]).toMatchObject({ type: 'image', data: 'aGk=' });
  });

  it('details 字符串叶消毒（嵌套对象/数组深走），数与布尔不动', () => {
    const result: AgentToolResult = {
      content: [],
      details: {
        env: ['GITHUB_TOKEN=ghp_abcdef1234', 'PATH=/usr/bin'],
        nested: { apiKey: 'sk-wxyz9876543210' },
        count: 7,
        flag: true,
      },
    };
    redactToolResultExit(result, []);
    expect(result.details).toMatchObject({
      env: ['GITHUB_TOKEN=[REDACTED:secret]', 'PATH=/usr/bin'],
      nested: { apiKey: '[REDACTED:secret]' },
      count: 7,
      flag: true,
    });
  });

  it('值基腿在 walk 内合流（details 裸值活值置换）', () => {
    const result: AgentToolResult = {
      content: [{ type: 'text', text: 'log: sk-live-abcdef12 end' }],
      details: { url: 'resp mentions sk-live-abcdef12 twice' },
    };
    redactToolResultExit(result, ['sk-live-abcdef12']);
    expect(result.content[0]).toMatchObject({ text: 'log: [REDACTED:credential] end' });
    expect((result.details as { url: string }).url).toBe('resp mentions [REDACTED:credential] twice');
  });

  it('环防御：details 循环引用不炸不递归失控', () => {
    const inner: Record<string, unknown> = { s: 'password=abcdefgh' };
    const cyclic: Record<string, unknown> = { inner, self: null };
    cyclic.self = cyclic;
    const result: AgentToolResult = { content: [], details: cyclic };
    expect(() => redactToolResultExit(result, [])).not.toThrow();
    expect(inner.s).toBe('password=[REDACTED:secret]');
  });

  it('details 缺席/原始值形态零改动直通', () => {
    const a: AgentToolResult = { content: [{ type: 'text', text: 'plain' }] };
    redactToolResultExit(a, []);
    expect(a.content[0]).toMatchObject({ text: 'plain' });
    const b: AgentToolResult = { content: [], details: '裸字符串明细' };
    redactToolResultExit(b, []);
    expect(b.details).toBe('裸字符串明细');
  });
});
