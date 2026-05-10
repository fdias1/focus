import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useEffect } from 'react'
import { StatusBar } from 'expo-status-bar'
import HomeScreen from './screens/HomeScreen'
import ScannerScreen from './screens/ScannerScreen'
import { getClientId } from './lib/storage'
import { registerClient, updatePushToken } from './lib/api'
import { registerForPushNotifications } from './lib/notifications'

export type RootStackParamList = {
  Home: undefined
  Scanner: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()

export default function App() {
  useEffect(() => {
    async function init() {
      const clientId = await getClientId()
      // Register client (idempotent) and refresh push token on every launch.
      await registerClient(clientId)
      const pushToken = await registerForPushNotifications()
      if (pushToken) await updatePushToken(clientId, pushToken)
    }
    init()
  }, [])

  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <Stack.Navigator>
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: 'Focus Client', headerLargeTitle: true }}
        />
        <Stack.Screen
          name="Scanner"
          component={ScannerScreen}
          options={{ title: 'Scan QR Code', presentation: 'modal' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
