import type { RemotePeerConfig, RemoteInputEvent } from '../../preload/remote-peer'

declare global {
  interface Window {
    remotePeer: {
      onStart: (cb: (cfg: RemotePeerConfig) => void) => void
      onStop: (cb: () => void) => void
      postOffer: (sdp: string) => void
      postLocalIce: (candidate: string) => void
      onAnswer: (cb: (sdp: string) => void) => void
      onRemoteIce: (cb: (candidate: string) => void) => void
      sendInput: (event: RemoteInputEvent) => void
      closed: () => void
    }
  }
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  {
    urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443'],
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
]

// 30-minute idle timeout — if no mobile connects, tear down to save resources.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000

let pc: RTCPeerConnection | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null

function clearIdleTimer() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
}

function startIdleTimer() {
  clearIdleTimer()
  idleTimer = setTimeout(() => {
    cleanup()
    window.remotePeer.closed()
  }, IDLE_TIMEOUT_MS)
}

function cleanup() {
  clearIdleTimer()
  pc?.close()
  pc = null
}

window.remotePeer.onStop(cleanup)

window.remotePeer.onStart(async (cfg: RemotePeerConfig) => {
  cleanup()
  startIdleTimer()

  // Get the screen MediaStream using the source ID provided by the main process.
  let stream: MediaStream
  try {
    stream = await (navigator.mediaDevices as MediaDevices & {
      getUserMedia(constraints: {
        video: { mandatory: { chromeMediaSource: string; chromeMediaSourceId: string } }
        audio: boolean
      }): Promise<MediaStream>
    }).getUserMedia({
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: cfg.displaySourceId
        }
      },
      audio: false
    })
  } catch (e) {
    console.error('[remote-peer] getUserMedia failed:', e)
    window.remotePeer.closed()
    return
  }

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

  // Add all video tracks from the screen stream.
  for (const track of stream.getVideoTracks()) {
    pc.addTrack(track, stream)
  }

  // Create the data channel for input events (desktop is offerer so it creates it).
  const channel = pc.createDataChannel('input', { ordered: true })
  channel.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data as string) as RemoteInputEvent
      window.remotePeer.sendInput(event)
    } catch { /* ignore malformed messages */ }
  }

  pc.onconnectionstatechange = () => {
    if (pc?.connectionState === 'connected') {
      clearIdleTimer()
    } else if (
      pc?.connectionState === 'failed' ||
      pc?.connectionState === 'disconnected' ||
      pc?.connectionState === 'closed'
    ) {
      cleanup()
      window.remotePeer.closed()
    }
  }

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      window.remotePeer.postLocalIce(JSON.stringify(candidate.toJSON()))
    }
  }

  // Create offer and hand it to the main process for posting to the server.
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  window.remotePeer.postOffer(JSON.stringify(pc.localDescription))

  // When main delivers the mobile answer, apply it.
  window.remotePeer.onAnswer(async (sdp: string) => {
    if (!pc) return
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(sdp)))
    } catch (e) {
      console.error('[remote-peer] setRemoteDescription failed:', e)
    }
  })

  // When main delivers mobile ICE candidates, add them.
  window.remotePeer.onRemoteIce(async (candidateJson: string) => {
    if (!pc) return
    try {
      await pc.addIceCandidate(new RTCIceCandidate(JSON.parse(candidateJson)))
    } catch { /* ignore stale candidates */ }
  })
})
