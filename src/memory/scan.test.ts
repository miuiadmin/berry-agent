/**
 * 写前 secret 扫描测试（06 §8.1——保守常量清单；命中/非命中/诊断不带密钥本体）。
 */
import { describe, expect, it } from 'vitest';
import { scanForSecrets } from './scan.js';

describe('scanForSecrets（保守常量清单命中面）', () => {
  it.each([
    ['openai-style-key', '我把 key 贴这了：sk-abc123def456ghi789jkl mno'],
    ['github-token', 'ghp_0123456789abcdefghijklmnopqrstuvwxyz0123'],
    ['aws-access-key', 'AWS key = AKIAIOSFODNN7EXAMPLE'],
    ['google-api-key', 'AIzaSyA1234567890abcdefghijklmnopqrstuv'],
    ['slack-token', 'xoxb-123456789012-abcdefghijklmn'],
    ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N65Ihog'],
    ['pem-private-key', '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7\n-----END RSA PRIVATE KEY-----'],
  ])('%s 命中', (pattern, text) => {
    const hits = scanForSecrets(text);
    expect(hits.map((h) => h.pattern)).toContain(pattern);
  });

  it('多模式同文命中（逐 pattern 一条——诊断面用）', () => {
    const hits = scanForSecrets('keys: sk-abcdefghij12345678901234 and AKIAIOSFODNN7EXAMPLE');
    expect(hits).toHaveLength(2);
  });

  it('常见长十六进制串零误报（git SHA / 摘要哈希——保守清单的立清单由）', () => {
    const sha = 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3';
    expect(scanForSecrets(`commit ${sha} fixed the bug`)).toEqual([]);
    expect(scanForSecrets(`sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`)).toEqual([]);
  });

  it('普通技术叙述零命中（低误报优先——宁漏勿误：漏网由读出消毒二道闸兜底）', () => {
    expect(scanForSecrets('user prefers pnpm over npm; CI runs nightly; password field validated')).toEqual([]);
    expect(scanForSecrets('export API_KEY=$BERRY_AGENT_TOKEN  # env 引用非密钥本体')).toEqual([]);
    expect(scanForSecrets('https://example.com/path?token=placeholder')).toEqual([]);
  });

  it('短截断形态不命中（最小长度防线——防文档示例串误报）', () => {
    // sk- 后不足 20 位（文档示例占位形）
    expect(scanForSecrets('sk-short-example')).toEqual([]);
    // ghp_ 后不足 30 位
    expect(scanForSecrets('ghp_short')).toEqual([]);
  });

  it('命中结构只携带 pattern 名——疑似密钥本体不入诊断（06 §8.1 字面律的结构锁）', () => {
    const secret = 'sk-abcdefghijklmnopqrst1234';
    const hits = scanForSecrets(`leaked ${secret} here`);
    expect(hits).toHaveLength(1);
    // 序列化面无密钥文本（诊断通道〔log-only〕的物证：结构即无值位）
    expect(JSON.stringify(hits)).not.toContain(secret);
  });
});
