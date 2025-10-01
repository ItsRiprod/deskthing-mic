export type AudioBackendStatus = 'disconnected' | 'connecting' | 'connected' | 'listening' | 'error'

export interface AudioManagerState {
  source: 'websocket' | string
  status: AudioBackendStatus
  error: string
  audioChunks: number
  bytesReceived: number
}

export type StateListener = (s: AudioManagerState) => void

export type PacketHandler = (packet: ArrayBuffer) => void
