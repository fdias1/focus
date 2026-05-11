import type { NextConfig } from 'next'
import pkg from './package.json'

// Surface the deployed version on the homepage so we can sanity-check a
// Vercel redeploy at a glance. SHA comes from Vercel's build env; in local
// dev it falls back to "dev".
const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'dev'

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_GIT_SHA: sha
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' }
        ]
      }
    ]
  }
}

export default nextConfig
