import type { PacketHandler, StateListener, AudioManagerState, MicConfig } from './types'

export class AudioMic {
  private listeners: Set<StateListener> = new Set();
  private packetHandler: PacketHandler | null = null;
  private state: AudioManagerState;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | AudioWorkletNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;

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

      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: this.config.sampleRate,
      });

      const source = this.audioContext.createMediaStreamSource(this.stream);
      const sampleRate = this.config.sampleRate || this.audioContext.sampleRate;
      const secondsPerChunk = this.config.secondsPerChunk || 0.1;
      const bufferSize = Math.pow(2, Math.ceil(Math.log2(sampleRate * secondsPerChunk)));
      const channelCount = this.config.channelCount || 1;
      const bytesPerSample = this.config.bytesPerSample === 2 ? 2 : 4;
      const wavSampleFormat: 'int16' | 'float32' = this.config.bytesPerSample === 2 ? 'int16' : 'float32';

      // Prefer AudioWorklet if available
      if (this.audioContext.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        try {
          const processorCode = `
            class RecorderProcessor extends AudioWorkletProcessor {
              process(inputs) {
                const input = inputs[0];
                if (input && input[0]) {
                  // post Float32Array chunk to main thread
                  const channelData = input[0];
                  // clone buffer so main thread receives its own copy
                  this.port.postMessage(channelData.slice());
                }
                return true;
              }
            }
            registerProcessor('recorder-processor', RecorderProcessor);
          `;

          const blob = new Blob([processorCode], { type: 'application/javascript' });
          const url = URL.createObjectURL(blob);
          await this.audioContext.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);

          // create worklet node
          const awn = new AudioWorkletNode(this.audioContext, 'recorder-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 0,
            channelCount,
          });
          this.processor = awn;
          awn.port.onmessage = (ev: MessageEvent) => {
            const floatBuffer = ev.data as Float32Array;
            this.handleFloat32Chunk(floatBuffer, sampleRate, channelCount, bytesPerSample, wavSampleFormat);
          };

          source.connect(awn);
          // no need to connect awn to destination since it has no outputs
          this.setState({ status: 'listening', error: '' });
          return;
        } catch (workletErr) {
          // fall through to ScriptProcessor fallback
          console.warn('AudioWorklet registration failed, falling back to ScriptProcessorNode:', workletErr);
        }
      }

      // Fallback: ScriptProcessorNode (deprecated but widely supported)
      const spNode = this.audioContext.createScriptProcessor(bufferSize, channelCount, channelCount);
      this.processor = spNode;
      source.connect(spNode);
      // connect to destination only if you want to hear audio; otherwise connect to a dummy gain or don't connect
      try {
        // Some contexts require connecting to destination on certain platforms; keep it but it's harmless
        spNode.connect(this.audioContext.destination);
      } catch {
        // ignore if connection not allowed
      }
      spNode.onaudioprocess = (e: AudioProcessingEvent) => {
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
        this.handleFloat32Chunk(output, sampleRate, channelCount, bytesPerSample, wavSampleFormat);
      };

      this.setState({ status: 'listening', error: '' });
    } catch (err: any) {
      // As a last-resort fallback, try MediaRecorder if low-level access fails
      if (this.stream && typeof MediaRecorder !== 'undefined') {
        try {
          this.mediaRecorder = new MediaRecorder(this.stream);
          this.mediaRecorder.ondataavailable = async (e) => {
            const buf = await e.data.arrayBuffer();
            if (this.packetHandler) this.packetHandler(buf);
            this.setState({
              audioChunks: this.state.audioChunks + 1,
              bytesReceived: this.state.bytesReceived + buf.byteLength,
            });
          };
          this.mediaRecorder.start(1000);
          this.setState({ status: 'listening', error: '' });
          return;
        } catch (mrErr) {
          // fall through to error handling
          console.warn('MediaRecorder fallback failed:', mrErr);
        }
      }

      this.setState({ status: 'error', error: err instanceof Error ? err.message : `Mic open failed! ${String(err)}` });
      console.error('Error opening mic:', err);
    }
  }

  private handleFloat32Chunk(
    floatBuffer: Float32Array,
    sampleRate: number,
    channelCount: number,
    bytesPerSample: number,
    sampleFormat: 'int16' | 'float32'
  ) {
    // Convert to desired PCM format
    let pcm: ArrayBuffer;
    if (bytesPerSample === 2) {
      const int16 = new Int16Array(floatBuffer.length);
      for (let i = 0; i < floatBuffer.length; i++) {
        int16[i] = Math.max(-32768, Math.min(32767, Math.floor(floatBuffer[i] * 32767)));
      }
      pcm = int16.buffer;
    } else {
      // ensure we copy the buffer so it's safe
      pcm = new Float32Array(floatBuffer).buffer;
    }

    const wavBuffer = this.makeWavChunk(
      pcm,
      sampleRate,
      channelCount,
      bytesPerSample,
      sampleFormat
    );

    if (this.packetHandler) {
      this.packetHandler(wavBuffer);
    }

    this.setState({
      audioChunks: this.state.audioChunks + 1,
      bytesReceived: this.state.bytesReceived + wavBuffer.byteLength,
    });
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
      try {
        // AudioWorkletNode or ScriptProcessorNode
        (this.processor as any).disconnect();
      } catch { }
      this.processor = null;
    }
    if (this.mediaRecorder) {
      try {
        if (this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
      } catch { }
      this.mediaRecorder = null;
    }
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch { }
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
