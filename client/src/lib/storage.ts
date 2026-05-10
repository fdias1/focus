import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'

const CLIENT_ID_KEY = 'focus_client_id'

/**
 * Returns the persistent client UUID, generating one on first call.
 */
export async function getClientId(): Promise<string> {
  const stored = await AsyncStorage.getItem(CLIENT_ID_KEY)
  if (stored) return stored
  const id = Crypto.randomUUID()
  await AsyncStorage.setItem(CLIENT_ID_KEY, id)
  return id
}
