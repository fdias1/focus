import { CameraView, useCameraPermissions } from 'expo-camera'
import { useState } from 'react'
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
  Platform
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { confirmPairing } from '@/lib/api'
import { getClientId } from '@/lib/storage'
import { registerForPushNotifications } from '@/lib/notifications'

interface QRPayload {
  v: number
  token: string
  server: string
}

export default function ScannerScreen() {
  const navigation = useNavigation()
  const [permission, requestPermission] = useCameraPermissions()
  const [scanned, setScanned] = useState(false)
  const [nickname, setNickname] = useState('')
  const [pendingPayload, setPendingPayload] = useState<QRPayload | null>(null)
  const [pairing, setPairing] = useState(false)

  async function handleBarcode({ data }: { data: string }) {
    if (scanned) return
    setScanned(true)
    try {
      const payload: QRPayload = JSON.parse(data)
      if (payload.v !== 1 || !payload.token) throw new Error('invalid')
      setPendingPayload(payload)
    } catch {
      Alert.alert('Invalid QR', 'This QR code is not from Focus Desktop.', [
        { text: 'Try again', onPress: () => setScanned(false) }
      ])
    }
  }

  async function handleConfirm() {
    if (!pendingPayload) return
    setPairing(true)
    const clientId = await getClientId()
    const pushToken = await registerForPushNotifications()
    const result = await confirmPairing(pendingPayload.token, clientId, pushToken, nickname)
    setPairing(false)

    if (!result) {
      Alert.alert('Pairing failed', 'The token may have expired. Try again from Focus Desktop.', [
        { text: 'OK', onPress: () => { setScanned(false); setPendingPayload(null) } }
      ])
      return
    }

    Alert.alert('Paired!', 'This desktop will now send notifications to your phone.', [
      { text: 'Done', onPress: () => navigation.goBack() }
    ])
  }

  if (!permission) return <View style={s.container} />

  if (!permission.granted) {
    return (
      <View style={s.center}>
        <Text style={s.hint}>Camera access is required to scan the QR code.</Text>
        <TouchableOpacity style={s.btn} onPress={requestPermission}>
          <Text style={s.btnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // Confirmation sheet shown after a valid QR is scanned
  if (pendingPayload) {
    return (
      <KeyboardAvoidingView
        style={s.center}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>Pair with desktop</Text>
          <Text style={s.sheetSub}>Token: {pendingPayload.token}</Text>
          <TextInput
            style={s.input}
            placeholder="Nickname (optional)"
            placeholderTextColor="#9ca3af"
            value={nickname}
            onChangeText={setNickname}
            maxLength={64}
          />
          <TouchableOpacity
            style={[s.btn, pairing && s.btnDisabled]}
            onPress={handleConfirm}
            disabled={pairing}
          >
            <Text style={s.btnText}>{pairing ? 'Pairing…' : 'Confirm'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.cancelBtn}
            onPress={() => { setScanned(false); setPendingPayload(null) }}
          >
            <Text style={s.cancelText}>Scan again</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    )
  }

  return (
    <View style={s.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleBarcode}
      />
      <View style={s.overlay}>
        <View style={s.viewfinder} />
        <Text style={s.overlayHint}>Point at the QR code in Focus Desktop</Text>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24 },
  hint: { fontSize: 15, color: '#374151', textAlign: 'center', marginBottom: 20 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center'
  },
  viewfinder: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: '#3b82f6',
    borderRadius: 12,
    backgroundColor: 'transparent'
  },
  overlayHint: {
    marginTop: 24,
    color: '#fff',
    fontSize: 14,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4
  },
  sheet: { width: '100%', gap: 12 },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: '#111827', textAlign: 'center' },
  sheetSub: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#111827'
  },
  btn: {
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center'
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelBtn: { alignItems: 'center', padding: 10 },
  cancelText: { color: '#6b7280', fontSize: 14 }
})
