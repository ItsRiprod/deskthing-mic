package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/gorilla/websocket"
)

type Command struct {
	Type    string          `json:"type"`
	Request string          `json:"request"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type MicConfig struct {
	SampleRate      int     `json:"sampleRate"`
	Channels        int     `json:"channels"`
	BytesPerSample  int     `json:"bytesPerSample"`
	SecondsPerChunk float64 `json:"secondsPerChunk"`
}

type StatePayload struct {
	State  string    `json:"state"` // "listening", "idle", "error"
	Config MicConfig `json:"config"`
	Error  string    `json:"error,omitempty"`
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func StartWebSocketServer() {
	http.HandleFunc("/", handleWebSocket)
	log.Println("WebSocket server listening on :8890")
	if err := http.ListenAndServe(":8890", nil); err != nil {
		log.Fatal("ListenAndServe error:", err)
	}
}

var (
	audioSession  *AudioSession
	currentConfig MicConfig
	micState      = "idle" // "listening", "idle", "error"
	micError      = ""
	wsConnections = make(map[*websocket.Conn]struct{})
)

func broadcastState() {
	stateMsg := map[string]interface{}{
		"type":    "state",
		"request": "mic",
		"payload": StatePayload{
			State:  micState,
			Config: currentConfig,
			Error:  micError,
		},
	}
	msg, _ := json.Marshal(stateMsg)
	for conn := range wsConnections {
		conn.WriteMessage(websocket.TextMessage, msg)
	}
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}
	wsConnections[conn] = struct{}{}
	defer func() {
		delete(wsConnections, conn)
		conn.Close()
	}()

	// Send initial state to new connection
	stateMsg := map[string]interface{}{
		"type":    "state",
		"request": "mic",
		"payload": StatePayload{
			State:  micState,
			Config: currentConfig,
			Error:  micError,
		},
	}
	msg, _ := json.Marshal(stateMsg)
	conn.WriteMessage(websocket.TextMessage, msg)

	for {
		mt, msg, err := conn.ReadMessage()
		if err != nil {
			log.Println("WebSocket read error:", err)
			micState = "error"
			micError = "WebSocket read error"
			broadcastState()
			break
		}
		if mt == websocket.TextMessage {
			var cmd Command
			if err := json.Unmarshal(msg, &cmd); err != nil {
				log.Println("Invalid command:", err)
				micState = "error"
				micError = "Invalid command"
				broadcastState()
				continue
			}
			switch cmd.Type {
			case "control":
				switch cmd.Request {
				case "mic-listen":
					var cfg MicConfig
					if len(cmd.Payload) > 0 {
						if err := json.Unmarshal(cmd.Payload, &cfg); err != nil {
							micState = "error"
							micError = "Invalid config"
							broadcastState()
							continue
						}
						currentConfig = cfg
					}

					// if the mic is not already listening, start it
					if audioSession == nil {
						audioSession, err = StartAudioStream(AudioConfig(currentConfig), func(chunk []byte) {
							conn.WriteMessage(websocket.BinaryMessage, chunk)
						})
						if err != nil {
							log.Println("Audio start error:", err)
							audioSession = nil
							micState = "error"
							micError = "Audio start error"
						} else {
							micState = "listening"
							micError = ""
						}
						broadcastState()
					} else {
						// already listening
					}
				case "mic-stop":
					if audioSession != nil {
						// kill the audio session
						audioSession.Stop()
						audioSession = nil
						micState = "idle"
						micError = ""
						broadcastState()
					}
				case "mic-config": // sets the current configuration

					// dont update if there is currently a session
					if audioSession != nil {
						continue
					}

					var cfg MicConfig
					if err := json.Unmarshal(cmd.Payload, &cfg); err != nil {
						micState = "error"
						micError = "Invalid config"
						broadcastState()
						continue
					}
					currentConfig = cfg
					broadcastState()
				case "mic-state":
					// Client requests current state
					stateMsg := map[string]interface{}{
						"type":    "state",
						"request": "mic",
						"payload": StatePayload{
							State:  micState,
							Config: currentConfig,
							Error:  micError,
						},
					}
					msg, _ := json.Marshal(stateMsg)
					conn.WriteMessage(websocket.TextMessage, msg)
				}
			case "ping":
				pongMsg := map[string]interface{}{
					"type":    "pong",
					"request": "",
					"payload": nil,
				}
				msg, _ := json.Marshal(pongMsg)
				conn.WriteMessage(websocket.TextMessage, msg)
			}
		}
	}
}
