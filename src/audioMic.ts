import type { PacketHandler, StateListener, AudioManagerState, MicConfig } from './types'

export class AudioMic {
  private listeners: Set<StateListener> = new Set();
  private packetHandler: PacketHandler | null = null;
  private state: AudioManagerState;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private config: MicConfig = {};

  constructor(config: MicConfig = {}) {
    this.config = config;
    this.state = {
      backend: 'mic',
      status: 'disconnected',
      error: '',
      audioChunks: 0,
      bytesReceived: 0,
      micConfig: this.config,
    };
  }

  getState() {
    return { ...this.state };
  }

  subscribe(fn: StateListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  testAvailability(): boolean {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  initialize() {
    // No-op for mic, but kept for interface consistency
    this.setState({ status: 'connected', error: '' });
  }

  private setState(partial: Partial<AudioManagerState>) {
    this.state = { ...this.state, ...partial };
    for (const l of this.listeners) l(this.getState());
  }

  setPacketHandler(handler: PacketHandler) {
    this.packetHandler = handler;
  }

  configureMic(config: MicConfig) {
    this.config = { ...this.config, ...config };
    this.setState({ micConfig: this.config });
  }

  async openMic() {
    try {
      this.setState({ status: 'connecting', error: '' });
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.config.deviceId ? { exact: this.config.deviceId } : undefined,
          sampleRate: this.config.sampleRate,
          channelCount: this.config.channelCount,
        },
      });
      this.audioContext = new AudioContext({
        sampleRate: this.config.sampleRate,
      });
      const source = this.audioContext.createMediaStreamSource(this.stream);
      // Calculate buffer size and chunking
      const sampleRate = this.config.sampleRate || this.audioContext.sampleRate;
      const secondsPerChunk = this.config.secondsPerChunk || 0.1;
      const bufferSize = Math.pow(2, Math.ceil(Math.log2(sampleRate * secondsPerChunk)));
      const channelCount = this.config.channelCount || 1;
      this.processor = this.audioContext.createScriptProcessor(bufferSize, channelCount, channelCount);
      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
      this.processor.onaudioprocess = (e) => {
        // Interleave channels if needed
        let output: Float32Array;
        if (channelCount === 1) {
          output = new Float32Array(e.inputBuffer.getChannelData(0));
        } else {
          const length = e.inputBuffer.length;
          output = new Float32Array(length * channelCount);
          for (let c = 0; c < channelCount; c++) {
            const channel = e.inputBuffer.getChannelData(c);
            for (let i = 0; i < length; i++) {
              output[i * channelCount + c] = channel[i];
            }
          }
        }
        // Convert to bytesPerSample if needed (default: Float32, else Int16)
        let pcm: ArrayBuffer;
        let bytesPerSample = this.config.bytesPerSample === 2 ? 2 : 4;
        let wavSampleFormat: "int16" | "float32" = this.config.bytesPerSample === 2 ? 'int16' : 'float32';
        if (bytesPerSample === 2) {
          // Convert Float32 [-1,1] to Int16
          const int16 = new Int16Array(output.length);
          for (let i = 0; i < output.length; i++) {
            int16[i] = Math.max(-32768, Math.min(32767, Math.floor(output[i] * 32767)));
          }
          pcm = int16.buffer;
        } else {
          // Float32 PCM
          pcm = output.slice().buffer;
        }

        // WAV header
        const wavBuffer = this.makeWavChunk(
          pcm,
          sampleRate,
          channelCount,
          bytesPerSample,
          wavSampleFormat
        );
        if (this.packetHandler) {
          this.packetHandler(wavBuffer);
        }
        // Helper to create a WAV chunk (header + PCM data)

        this.setState({
          audioChunks: this.state.audioChunks + 1,
          bytesReceived: this.state.bytesReceived + wavBuffer.byteLength,
        });
      };
      this.setState({ status: 'listening', error: '' });
    } catch (err: any) {
      this.setState({ status: 'error', error: err instanceof Error ? err.message : `Mic open failed! ${String(err)}` });
      console.error('Error opening mic:', err);
    }
  }

  private makeWavChunk(
    pcm: ArrayBuffer,
    sampleRate: number,
    channels: number,
    bytesPerSample: number,
    sampleFormat: 'int16' | 'float32'
  ): ArrayBuffer {
    const pcmLength = pcm.byteLength;
    const headerSize = 44;
    const totalSize = headerSize + pcmLength;
    const view = new DataView(new ArrayBuffer(totalSize));
    // RIFF identifier 'RIFF'
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcmLength, true); // file length - 8
    this.writeString(view, 8, 'WAVE');
    // fmt chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, sampleFormat === 'int16' ? 1 : 3, true); // AudioFormat: 1=PCM, 3=IEEE float
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * bytesPerSample, true); // ByteRate
    view.setUint16(32, channels * bytesPerSample, true); // BlockAlign
    view.setUint16(34, bytesPerSample * 8, true); // BitsPerSample
    // data chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, pcmLength, true);
    // PCM data
    new Uint8Array(view.buffer, 44).set(new Uint8Array(pcm));
    return view.buffer;
  }

  private writeString(view: DataView, offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  closeMic() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.setState({ status: 'connected' });
  }

  cleanup() {
    this.closeMic();
    this.listeners.clear();
    this.packetHandler = null;
  }
}
