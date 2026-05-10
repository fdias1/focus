import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
})

/**
 * Requests notification permissions and returns the Expo push token,
 * or null if permissions were denied or we're on a simulator.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('focus', {
      name: 'Focus Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default'
    })
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }

  if (finalStatus !== 'granted') return null

  try {
    const token = await Notifications.getExpoPushTokenAsync()
    return token.data
  } catch {
    return null
  }
}
