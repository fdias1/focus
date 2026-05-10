import type { Config } from 'drizzle-kit'

// drizzle-kit doesn't auto-read .env.local (that's a Next.js feature).
// Node.js 20.12+ has process.loadEnvFile built-in — no extra deps needed.
try {
  process.loadEnvFile('.env.local')
} catch {
  // file doesn't exist or Node < 20.12 — fall through to existing env vars
}

export default {
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!
  }
} satisfies Config
