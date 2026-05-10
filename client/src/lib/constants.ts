import Constants from 'expo-constants'

export const SERVER_URL: string =
  (Constants.expoConfig?.extra as { serverUrl?: string } | undefined)?.serverUrl ??
  'https://focus-server.vercel.app'
