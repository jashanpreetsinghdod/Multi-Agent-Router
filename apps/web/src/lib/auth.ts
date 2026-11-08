import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { getPool } from './store/postgres';

export interface AuthConfigStatus {
  enabled: boolean;
  missing: string[];
}

export function authConfigStatus(): AuthConfigStatus {
  const required = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
  const missing = required.filter((k) => !process.env[k]);
  return { enabled: missing.length === 0, missing };
}

const ts = { createdAt: 'created_at', updatedAt: 'updated_at' };

function createAuth() {
  const baseURL = process.env.BETTER_AUTH_URL!;
  return betterAuth({
    baseURL,
    secret: process.env.BETTER_AUTH_SECRET!,
    trustedOrigins: [baseURL],
    database: getPool(),
    user: {
      modelName: 'users',
      fields: { emailVerified: 'email_verified', ...ts },
    },
    session: {
      modelName: 'sessions',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        ...ts,
      },
      // Signed cookie cache: most requests skip the session lookup in Postgres.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    account: {
      modelName: 'accounts',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        ...ts,
      },
      encryptOAuthTokens: true,
    },
    verification: {
      modelName: 'verification',
      fields: { expiresAt: 'expires_at', ...ts },
    },
    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: baseURL.startsWith('https://'),
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const g = globalThis as unknown as { __omniAuth?: Auth };

/** Better Auth instance, or null when sign-in is not configured. */
export function getAuth(): Auth | null {
  if (!authConfigStatus().enabled) return null;
  return (g.__omniAuth ??= createAuth());
}

export async function signedInUser(headers: Headers) {
  const auth = getAuth();
  if (!auth) return null;
  const session = await auth.api.getSession({ headers });
  return session?.user ?? null;
}
