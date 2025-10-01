package main

import (
    "bytes"
    "encoding/binary"
    "io"
    "log"
    "os/exec"
    "time"
)

type AudioConfig struct {
    SampleRate     int
    Channels       int
    BytesPerSample int
    SecondsPerChunk float64
}

type AudioSession struct {
    cmd      *exec.Cmd
    stdout   io.ReadCloser
    stopChan chan struct{}
}

func StartAudioStream(cfg AudioConfig, sendChunk func([]byte)) (*AudioSession, error) {
    buf := make([]byte, int(float64(cfg.SampleRate)*cfg.SecondsPerChunk)*cfg.BytesPerSample)
    session := &AudioSession{
        stopChan: make(chan struct{}),
    }
    var err error
    session.cmd = exec.Command("arecord",
        "-D", "hw:0,0",
        "-f", "S16_LE",
        "-c", "1",
        "-r", "48000",
        "-t", "raw",
    )
    session.stdout, err = session.cmd.StdoutPipe()
    if err != nil {
        return nil, err
    }
    if err := session.cmd.Start(); err != nil {
        return nil, err
    }
    go func() {
        for {
            select {
            case <-session.stopChan:
                return
            default:
                _, err := io.ReadFull(session.stdout, buf)
                if err != nil {
                    log.Println("arecord read error:", err)
                    return
                }
                wavBuf := wavChunk(buf, cfg.SampleRate, cfg.Channels, cfg.BytesPerSample)
                sendChunk(wavBuf)
                time.Sleep(time.Duration(cfg.SecondsPerChunk * float64(time.Second)))
            }
        }
    }()
    return session, nil
}

func (s *AudioSession) Stop() {
    close(s.stopChan)
    if s.cmd != nil {
        s.cmd.Process.Kill()
    }
}

// wavChunk creates a WAV file in memory for a PCM chunk
func wavChunk(pcm []byte, sampleRate, channels, bytesPerSample int) []byte {
	dataLen := len(pcm)
	blockAlign := channels * bytesPerSample
	byteRate := sampleRate * blockAlign

	buf := &bytes.Buffer{}
	// RIFF header
	buf.WriteString("RIFF")
	binary.Write(buf, binary.LittleEndian, uint32(36+dataLen))
	buf.WriteString("WAVE")
	// fmt chunk
	buf.WriteString("fmt ")
	binary.Write(buf, binary.LittleEndian, uint32(16))               // Subchunk1Size
	binary.Write(buf, binary.LittleEndian, uint16(1))                // AudioFormat PCM
	binary.Write(buf, binary.LittleEndian, uint16(channels))         // NumChannels
	binary.Write(buf, binary.LittleEndian, uint32(sampleRate))       // SampleRate
	binary.Write(buf, binary.LittleEndian, uint32(byteRate))         // ByteRate
	binary.Write(buf, binary.LittleEndian, uint16(blockAlign))       // BlockAlign
	binary.Write(buf, binary.LittleEndian, uint16(bytesPerSample*8)) // BitsPerSample
	// data chunk
	buf.WriteString("data")
	binary.Write(buf, binary.LittleEndian, uint32(dataLen))
	buf.Write(pcm)
	return buf.Bytes()
}
