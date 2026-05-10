export const SERVER_URL =
  (typeof process !== 'undefined' && process.env['FOCUS_SERVER_URL']) ||
  'https://focus-server-three.vercel.app'
