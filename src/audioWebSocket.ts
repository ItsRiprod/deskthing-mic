import type { PacketHandler, StateListener, AudioManagerState, MicConfig } from './types'

export class AudioWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private listeners: Set<StateListener> = new Set();
  private packetHandler: PacketHandler | null = null;
  private state: AudioManagerState;
  private reconnectTimeout: number | null = null;
  private reconnectDelay = 3000;

  constructor(url: string) {
    this.url = url;
    this.state = {
      backend: 'websocket',
      status: 'disconnected',
      error: '',
      audioChunks: 0,
      bytesReceived: 0,
    };
  }

  getState() {
    return { ...this.state };
  }

  subscribe(fn: StateListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(partial: Partial<AudioManagerState>) {
    this.state = { ...this.state, ...partial };
    for (const l of this.listeners) l(this.getState());
  }

  setPacketHandler(handler: PacketHandler) {
    this.packetHandler = handler;
  }

  async testAvailability(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(this.url);
        ws.onopen = () => {
          ws.close();
          resolve(true);
        };
        ws.onerror = () => {
          resolve(false);
        };
      } catch {
        resolve(false);
      }
    });
  }

  
  initialize() {
    this.connect();
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setState({ status: 'connecting' });
    try {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => {
        this.setState({ status: 'connected', error: '' });
      };
      this.ws.onclose = () => {
        this.setState({ status: 'disconnected' });
        this.ws = null;
        this.scheduleReconnect();
      };
      this.ws.onerror = () => {
        this.setState({ error: 'WebSocket error' });
        this.ws = null;
        this.scheduleReconnect();
      };
      this.ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Binary audio chunk
          if (this.packetHandler) this.packetHandler(event.data);
          this.setState({
            audioChunks: this.state.audioChunks + 1,
            bytesReceived: this.state.bytesReceived + event.data.byteLength,
          });
        } else if (typeof event.data === 'string') {
          // Text message: likely state update or pong
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'state' && msg.request === 'mic' && msg.payload) {
              // Update state from backend
              const payload = msg.payload;
              this.setState({
                status: payload.State || this.state.status,
                error: payload.Error || '',
                micConfig: payload.Config ? {
                  sampleRate: payload.Config.SampleRate,
                  channelCount: payload.Config.Channels,
                  bytesPerSample: payload.Config.BytesPerSample,
                  secondsPerChunk: payload.Config.SecondsPerChunk,
                } : this.state.micConfig,
              });
            }
            // Optionally handle pong or other message types here
          } catch (e) {
            // Ignore invalid JSON
          }
        }
      };
    } catch (err) {
      this.setState({ error: 'WebSocket connection failed', status: 'error' });
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) return;
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.ws) this.disconnect();
      this.connect();
    }, this.reconnectDelay);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.setState({ status: 'disconnected' });
  }

  configureMic(config: MicConfig) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'control',
        request: 'mic-config',
        payload: {
          sampleRate: config.sampleRate,
          channels: config.channelCount,
          bytesPerSample: config.bytesPerSample,
          secondsPerChunk: config.secondsPerChunk,
        },
      };
      this.ws.send(JSON.stringify(msg));
    }
  }

  openMic(config?: MicConfig) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'control',
        request: 'mic-listen',
        payload: config
          ? {
              sampleRate: config.sampleRate,
              channels: config.channelCount,
              bytesPerSample: config.bytesPerSample,
              secondsPerChunk: config.secondsPerChunk,
            }
          : undefined,
      };
      this.ws.send(JSON.stringify(msg));
      this.setState({ status: 'listening', audioChunks: 0, bytesReceived: 0 });
    }
  }

  closeMic() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'control',
        request: 'mic-stop',
      };
      this.ws.send(JSON.stringify(msg));
      this.setState({ status: 'connected' });
    }
  }

  
  cleanup() {
    this.closeMic();
    this.disconnect()
    this.listeners.clear();
    this.packetHandler = null;
  }
}
