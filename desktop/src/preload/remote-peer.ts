import { contextBridge, ipcRenderer } from 'electron'

export interface RemotePeerConfig {
  displaySourceId: string
}

export interface RemoteInputEvent {
  type: 'click' | 'key' | 'type'
  xFrac?: number
  yFrac?: number
  button?: 'left' | 'right'
  key?: string
  text?: string
}

contextBridge.exposeInMainWorld('remotePeer', {
  onStart: (cb: (cfg: RemotePeerConfig) => void) => {
    ipcRenderer.on('focus:remote-peer-start', (_ev, cfg: RemotePeerConfig) => cb(cfg))
  },
  onStop: (cb: () => void) => {
    ipcRenderer.on('focus:remote-peer-stop', cb)
  },
  // Renderer → main: send WebRTC offer SDP (stringified RTCSessionDescription JSON)
  postOffer: (sdp: string) => { ipcRenderer.send('focus:remote-peer-offer', sdp) },
  // Renderer → main: local ICE candidate (stringified RTCIceCandidate JSON)
  postLocalIce: (candidate: string) => { ipcRenderer.send('focus:remote-peer-local-ice', candidate) },
  // Main → renderer: mobile answer SDP
  onAnswer: (cb: (sdp: string) => void) => {
    ipcRenderer.on('focus:remote-peer-answer', (_ev, sdp: string) => cb(sdp))
  },
  // Main → renderer: remote ICE candidate
  onRemoteIce: (cb: (candidate: string) => void) => {
    ipcRenderer.on('focus:remote-peer-remote-ice', (_ev, c: string) => cb(c))
  },
  // Renderer → main: forward input event from data channel
  sendInput: (event: RemoteInputEvent) => { ipcRenderer.send('focus:remote-input', event) },
  // Renderer → main: peer closed (connection ended or timeout)
  closed: () => { ipcRenderer.send('focus:remote-peer-closed') }
})
