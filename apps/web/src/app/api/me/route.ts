import { NextResponse, type NextRequest } from 'next/server';
import { authConfigStatus, signedInUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await signedInUser(req.headers);
  return NextResponse.json({
    user: user ? { name: user.name, email: user.email, image: user.image ?? null } : null,
    loginAvailable: authConfigStatus().enabled,
  });
}
