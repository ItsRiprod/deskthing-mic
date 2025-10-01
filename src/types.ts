
export type AudioBackendType = 'websocket' | 'mic' | 'unset';
export type AudioBackendStatus = 'disconnected' | 'connecting' | 'connected' | 'listening' | 'error';

export interface MicConfig {
  deviceId?: string;
  sampleRate?: number;
  channelCount?: number;
  bytesPerSample?: number;
  secondsPerChunk?: number;
  // Add more config as needed
}

export interface MicState {
  status: AudioBackendStatus;
  error: string;
  config: MicConfig;
  audioChunks: number;
  bytesReceived: number;
}


export interface AudioManagerState {
  backend: AudioBackendType;
  status: AudioBackendStatus;
  error: string;
  audioChunks: number;
  bytesReceived: number;
  micConfig?: MicConfig;
}

export type StateListener = (s: AudioManagerState) => void;
export type PacketHandler = (packet: ArrayBuffer) => void;
