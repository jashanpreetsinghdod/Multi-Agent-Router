import { describe, expect, it } from 'vitest';
import { validateSafeUrl, isPrivateIp } from '../ssrf.js';
import { executeGetCurrentTime, ToolRegistry } from '../executor.js';
import { BUILTIN_TOOLS } from '../definitions.js';

describe('SSRF Guard', () => {
  it('blocks private IPv4 addresses', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('192.168.1.1')).toBe(true);
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.31.255.255')).toBe(true);
    expect(isPrivateIp('169.254.169.254')).toBe(true);
  });

  it('allows public IPv4 addresses', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('1.1.1.1')).toBe(false);
    expect(isPrivateIp('104.26.10.23')).toBe(false);
  });

  it('blocks dangerous URLs', () => {
    expect(validateSafeUrl('http://localhost:3000/api').safe).toBe(false);
    expect(validateSafeUrl('http://127.0.0.1:8080').safe).toBe(false);
    expect(validateSafeUrl('http://169.254.169.254/latest/meta-data/').safe).toBe(false);
    expect(validateSafeUrl('http://service.internal/secret').safe).toBe(false);
    expect(validateSafeUrl('ftp://example.com/file').safe).toBe(false);
  });

  it('allows valid public URLs', () => {
    expect(validateSafeUrl('https://example.com/path').safe).toBe(true);
    expect(validateSafeUrl('https://en.wikipedia.org/wiki/AI').safe).toBe(true);
  });
});

describe('Tool Execution', () => {
  it('executes get_current_time cleanly', async () => {
    const res = await executeGetCurrentTime({ timezone: 'UTC' });
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content);
    expect(parsed.timezone).toBe('UTC');
    expect(parsed.iso).toBeDefined();
  });

  it('handles invalid timezone gracefully', async () => {
    const res = await executeGetCurrentTime({ timezone: 'Invalid/Nonexistent' });
    expect(res.isError).toBe(true);
    expect(res.content).toContain('Invalid timezone');
  });

  it('registry executes registered tools', async () => {
    const registry = new ToolRegistry();
    expect(registry.has('get_current_time')).toBe(true);
    expect(registry.has('fetch_url')).toBe(true);
    expect(registry.has('web_search')).toBe(true);

    const unknown = await registry.execute('unknown_tool', {});
    expect(unknown.isError).toBe(true);
  });

  it('builtin tools have valid schemas', () => {
    expect(BUILTIN_TOOLS).toHaveLength(3);
    for (const tool of BUILTIN_TOOLS) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

