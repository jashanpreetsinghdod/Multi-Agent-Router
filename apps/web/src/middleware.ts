import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'omni_sid';
const SESSION_RE = /^[a-f0-9]{64}$/;

export function middleware(req: NextRequest) {
  const existing = req.cookies.get(SESSION_COOKIE)?.value;
  if (existing && SESSION_RE.test(existing)) return NextResponse.next();

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const sid = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  // Make the new id visible to the route handler on this same request.
  req.cookies.set(SESSION_COOKIE, sid);
  const headers = new Headers(req.headers);
  headers.set('cookie', req.cookies.toString());

  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export const config = {
  // /v1/* authenticates with a bearer router key instead of the cookie.
  matcher: ['/((?!_next/|favicon.ico|v1/).*)'],
};
