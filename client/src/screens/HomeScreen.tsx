import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native'
import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Pairing, getPairings, removePairing } from '@/lib/api'
import { getClientId } from '@/lib/storage'
import type { RootStackParamList } from '../App'

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>

function shortId(id: string) {
  return id.slice(0, 8)
}

export default function HomeScreen() {
  const navigation = useNavigation<Nav>()
  const [pairings, setPairings] = useState<Pairing[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const clientId = await getClientId()
    const data = await getPairings(clientId)
    setPairings(data)
    setLoading(false)
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  async function handleRemove(pairing: Pairing) {
    Alert.alert(
      'Remove device',
      `Remove "${pairing.nickname ?? `Desktop-${shortId(pairing.desktopId)}`}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const clientId = await getClientId()
            await removePairing(pairing.id, clientId)
            load()
          }
        }
      ]
    )
  }

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    )
  }

  return (
    <View style={s.container}>
      <FlatList
        data={pairings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={pairings.length === 0 ? s.emptyContainer : undefined}
        ListEmptyComponent={
          <View style={s.center}>
            <Text style={s.emptyTitle}>No paired devices</Text>
            <Text style={s.emptyHint}>Tap + to pair with a Focus Desktop</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.row}>
            <View style={s.info}>
              <Text style={s.name}>
                {item.nickname ?? `Desktop-${shortId(item.desktopId)}`}
              </Text>
              <Text style={s.sub}>
                ID: {shortId(item.desktopId)} · {new Date(item.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <TouchableOpacity style={s.deleteBtn} onPress={() => handleRemove(item)}>
              <Text style={s.deleteIcon}>🗑</Text>
            </TouchableOpacity>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={s.separator} />}
      />

      <TouchableOpacity style={s.fab} onPress={() => navigation.navigate('Scanner')}>
        <Text style={s.fabIcon}>+</Text>
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyContainer: { flex: 1 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#111827', marginBottom: 6 },
  emptyHint: { fontSize: 14, color: '#6b7280' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14
  },
  info: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: '#111827' },
  sub: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  separator: { height: 1, backgroundColor: '#f3f4f6', marginLeft: 20 },
  deleteBtn: { padding: 8 },
  deleteIcon: { fontSize: 18 },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5
  },
  fabIcon: { fontSize: 28, color: '#fff', lineHeight: 32 }
})
