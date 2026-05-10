// Override at build time via FOCUS_SERVER_URL environment variable.
// Update this to your Vercel deployment URL before building for production.
export const SERVER_URL =
  (typeof process !== 'undefined' && process.env['FOCUS_SERVER_URL']) ||
  'https://focus-server.vercel.app'
