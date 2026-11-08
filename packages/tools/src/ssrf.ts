import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
]);

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return false;
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true; // malformed: refuse
  }
  const [a, b] = [parts[0]!, parts[1]!];
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === '::' || lower === '::1') return true;
  // IPv4-mapped / translated forms: check the embedded v4 address.
  const mapped = lower.match(/^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]!);
  if (/^::ffff:/.test(lower)) return true; // hex-form mapped: refuse rather than parse
  const first = parseInt(lower.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (lower.startsWith('64:ff9b:')) return true; // NAT64 can reach v4 internals
  return false;
}

export function validateSafeUrl(urlStr: string): { safe: boolean; reason?: string } {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { safe: false, reason: 'Invalid URL format' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { safe: false, reason: `Unsupported protocol: ${url.protocol}` };
  }
  if (url.username || url.password) {
    return { safe: false, reason: 'Credentials in URLs are not allowed' };
  }

  // WHATWG URL keeps brackets on IPv6 hosts and normalises decimal/hex IPv4.
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (BLOCKED_HOSTS.has(hostname)) {
    return { safe: false, reason: `Blocked host: ${hostname}` };
  }

  if (isIP(hostname) && isPrivateIp(hostname)) {
    return { safe: false, reason: `Private IP access blocked: ${hostname}` };
  }

  if (
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost') ||
    (!hostname.includes('.') && !isIP(hostname))
  ) {
    return { safe: false, reason: `Internal domain blocked: ${hostname}` };
  }

  return { safe: true };
}

export async function assertPublicUrl(urlStr: string): Promise<{ safe: boolean; reason?: string }> {
  const sync = validateSafeUrl(urlStr);
  if (!sync.safe) return sync;

  const hostname = new URL(urlStr).hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname)) return { safe: true };

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0) return { safe: false, reason: `Could not resolve ${hostname}` };
    const bad = addresses.find((a) => isPrivateIp(a.address));
    if (bad) return { safe: false, reason: `${hostname} resolves to a private address` };
    return { safe: true };
  } catch {
    return { safe: false, reason: `Could not resolve ${hostname}` };
  }
}

export async function safeFetch(
  urlStr: string,
  init: RequestInit = {},
  maxRedirects = 5,
): Promise<Response> {
  let current = urlStr;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = await assertPublicUrl(current);
    if (!check.safe) throw new Error(`SSRF Guard blocked request: ${check.reason}`);

    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return res;
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}
