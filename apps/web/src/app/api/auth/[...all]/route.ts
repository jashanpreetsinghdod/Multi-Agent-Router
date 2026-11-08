import { toNextJsHandler } from 'better-auth/next-js';
import { NextResponse, type NextRequest } from 'next/server';
import { getAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const disabled = () => NextResponse.json({ error: 'Sign-in is not configured on this server.' }, { status: 404 });

export async function GET(req: NextRequest) {
  const auth = getAuth();
  return auth ? toNextJsHandler(auth).GET(req) : disabled();
}

export async function POST(req: NextRequest) {
  const auth = getAuth();
  return auth ? toNextJsHandler(auth).POST(req) : disabled();
}
