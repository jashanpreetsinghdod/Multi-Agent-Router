import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const SESSION_COOKIE = 'omni_sid';
const SESSION_RE = /^[a-f0-9]{64}$/;

export function sessionIdFrom(req: NextRequest): string | undefined {
  const value = req.cookies.get(SESSION_COOKIE)?.value;
  return value && SESSION_RE.test(value) ? value : undefined;
}

export function noSession(): NextResponse {
  return NextResponse.json({ error: 'No session. Reload the page.' }, { status: 401 });
}
