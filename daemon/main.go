package main

import "log"

func main() {
	log.Println("Starting DeskThing audio daemon...")
	StartWebSocketServer()
}
