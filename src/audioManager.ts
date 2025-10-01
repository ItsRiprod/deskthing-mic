
import { AudioWebSocket } from './audioWebSocket';
import { AudioMic } from './audioMic';
import type { PacketHandler, StateListener, AudioManagerState, MicConfig } from './types';

type Backend = AudioWebSocket | AudioMic;

class AudioManager {
  private backend: Backend | null = null;
  private backendType: 'websocket' | 'mic' | 'unset' = 'unset';
  private wsUrl = 'ws://localhost:8890';
  private ready: Promise<'websocket' | 'mic' | 'unset'>;
  private config: MicConfig = {};

  private stateListeners: Set<StateListener> = new Set();
  private packetHandlers: Set<PacketHandler> = new Set();

  constructor() {
    this.ready = this.initBackend();
  }

  private async initBackend(): Promise<'websocket' | 'mic' | 'unset'> {
    if (this.backend) {
      this.backend.cleanup()
      this.backend = null
      console.debug("Cleaned up existing backend");
    };
    
    const ws = new AudioWebSocket(this.wsUrl);
    if (await ws.testAvailability()) {
      this.backend = ws;
      this.backendType = 'websocket';
      console.debug("Initialized WebSocket backend");
      await this.setupListeners();
      this.backend.initialize();
      return 'websocket';
    } else {
      const mic = new AudioMic(this.config);
      if (!(mic.testAvailability())) {
        console.error("No audio backend available");
        this.backendType = 'unset';
        return 'unset'
      }
      this.backend = mic;
      this.backendType = 'mic';
      console.debug("Initialized Mic listeners");
      await this.setupListeners();
      console.debug("Initialized Mic backend");
      this.backend.initialize();
      return 'mic';
    }
  }

  private async setupListeners() {
    if (!this.backend) return;
    this.backend.subscribe(state => this.notifyStateListeners(state));
    this.backend.setPacketHandler(packet => this.notifyPacketHandlers(packet));
  }

  private async notifyStateListeners(state: AudioManagerState) {
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }

  private async notifyPacketHandlers(packet: ArrayBuffer) {
    for (const handler of this.packetHandlers) {
      handler(packet);
    }
  }


  async retryBackend() {
    this.ready = this.initBackend();
    await this.ready;
  }

  async configureMic(config: MicConfig) {
    await this.ready;
    this.config = { ...this.config, ...config };
    if (this.backend) {
      this.backend.configureMic(this.config);
    }
  }

  async openMic() {
    await this.ready;
    if (this.backend) {
      await this.backend.openMic(this.config);
    }
  }

  async closeMic() {
    await this.ready;
    if (this.backend) {
      this.backend.closeMic();
    }
  }

  async getMicState(): Promise<AudioManagerState> {
    await this.ready;
    return this.backend ? this.backend.getState() : { backend: 'mic', status: 'disconnected', error: '', audioChunks: 0, bytesReceived: 0 };
  }

  async onAudioPacket(handler: PacketHandler): Promise<() => void> {
    await this.ready;
    this.packetHandlers.add(handler);
    return () => {
      this.packetHandlers.delete(handler);
    };
  }

  async onMicStateChange(listener: StateListener): Promise<() => void> {
    await this.ready;
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }
}

export const audioManager = new AudioManager();
