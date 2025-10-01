import type { PacketHandler, AudioManagerState, StateListener } from './types'

class AudioManager {
  public available = false
  private ws: WebSocket | null = null
  private reconnectTimeout: number | null = null
  private url = 'ws://localhost:8890'
  private reconnectDelay = 3000
  private listening = false
  private packetHandler: PacketHandler | null = null

  // internal state that external code (like a VoiceAgent store) can read
  private state: AudioManagerState = {
    source: 'websocket',
    status: 'disconnected',
    error: '',
    audioChunks: 0,
    bytesReceived: 0,
  }

  private listeners: Set<StateListener> = new Set()

  getState(): AudioManagerState {
    return { ...this.state }
  }

  subscribe(fn: StateListener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private setState(partial: Partial<AudioManagerState>) {
    this.state = { ...this.state, ...partial }
    for (const l of this.listeners) l(this.getState())
  }

  setPacketHandler(handler: PacketHandler) {
    this.packetHandler = handler
  }

  testAvailability(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(this.url)
        ws.onopen = () => {
          ws.close()
          this.available = true
          resolve(true)
          console.log('[audioManager] Audio backend is available')
        }
        ws.onerror = () => {
          this.available = false
          resolve(false)
        }
      } catch {
        this.available = false
        resolve(false)
      }
    })
  }

  connect() {
    if (this.state.source !== 'websocket') return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('[audioManager] WebSocket is already connected or connecting')
      return
    }
    this.setState({ status: 'connecting' })
    try {
      this.ws = new WebSocket(this.url)
      this.ws.binaryType = 'arraybuffer'
      this.ws.onopen = () => {
        this.setState({ status: 'connected', error: '' })
        console.log('[audioManager] Successfully connected to audio backend')
      }
      this.ws.onclose = () => {
        this.setState({ status: 'disconnected' })
        this.ws = null
        console.log('[audioManager] WebSocket closed unexpectedly')
        this.scheduleReconnect()
      }
      this.ws.onerror = (error) => {
        this.setState({ error: 'WebSocket error' })
        console.log('[audioManager] WebSocket error:', error)
        this.ws = null
        this.scheduleReconnect()
      }
      this.ws.onmessage = (event) => {
        if (this.state.source !== 'websocket') return
        if (event.data instanceof ArrayBuffer) {
          if (this.packetHandler) this.packetHandler(event.data)
          // update counters
          this.setState({
            audioChunks: this.state.audioChunks + 1,
            bytesReceived: this.state.bytesReceived + event.data.byteLength,
          })
        }
      }
    } catch (err) {
      this.setState({ error: 'WebSocket connection failed', status: 'error' })
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) return
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null
      if (this.ws) {
        this.disconnect()
      }
      console.log('[audioManager] Attempting to reconnect to audio backend...')
      this.connect()
    }, this.reconnectDelay)
  }

  async startListening() {
    if (this.state.source !== 'websocket') return
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[audioManager] Initiating listening mode')
      this.ws.send('listen')
      this.listening = true
      this.setState({ status: 'listening', audioChunks: 0, bytesReceived: 0 })
    } else {
      console.error('[audioManager] WebSocket is not connected, cannot stop listening. Websocket state is ', this.ws ? this.ws.readyState : 'Does Not Exist')
    }

    await this.pingServer()
  }

  async pingServer(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[audioManager] Cannot ping, WebSocket not open')
      return
    }

    return new Promise((resolve) => {
      let pongReceived = false

      // capture local ws reference so narrowing holds inside callbacks
      const ws = this.ws!

      const handleMessage = (event: MessageEvent) => {
        // if ANY message is received, consider it a pong
        pongReceived = true
        console.log('Received pong from server, connection is healthy')
        ws.removeEventListener('message', handleMessage as EventListener)
        resolve()
      }

      // ws is non-null here due to the earlier guard
      ws.addEventListener('message', handleMessage as EventListener)
      ws.send('ping')

      setTimeout(() => {
        if (!pongReceived) {
          console.warn('[audioManager] No pong received, reconnecting...')
          ws.removeEventListener('message', handleMessage as EventListener)
          this.disconnect()
          this.connect()
          resolve()
        }
      }, 2000) // two seconds to respond
    })
  }

  stopListening() {
    if (this.state.source !== 'websocket') return

    if (!this.listening) {
      console.error('[audioManager] Not currently listening!')
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[audioManager] Stopping listening')
      this.ws.send('stop')
      this.listening = false
      this.setState({ status: 'connected' })
    } else {
      this.setState({ status: 'disconnected' })
      console.error('[audioManager] WebSocket is not connected, cannot stop listening')
    }
  }

  disconnect() {
    console.log('[audioManager] Disconnecting Audio Backend')
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    this.setState({ status: 'disconnected' })
    this.reset()
  }

  // allow consumers to change the source (eg 'websocket' or others)
  setSource(source: string) {
    this.setState({ source })
  }

  // reset internal counters and errors
  reset() {
    this.setState({ error: '', audioChunks: 0, bytesReceived: 0 })
  }
}

export const audioManager = new AudioManager()
