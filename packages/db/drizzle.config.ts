import { defineConfig } from 'drizzle-kit';
import { strictSsl } from './src/ssl';

// Reuse the web app's env file so DATABASE_URL lives in one place.
try {
  process.loadEnvFile('../../apps/web/.env.local');
} catch {
  // fine: DATABASE_URL may come from the shell or CI instead
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: strictSsl(process.env.DATABASE_URL || 'postgresql://set-DATABASE_URL-in-apps-web-.env.local'),
  },
  verbose: true,
  strict: true,
});
