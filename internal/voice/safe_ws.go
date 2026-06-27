package voice

import (
	"sync"

	"github.com/gorilla/websocket"
)

type SafeWS struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func NewSafeWS(conn *websocket.Conn) *SafeWS {
	return &SafeWS{
		conn: conn,
	}
}

func (w *SafeWS) WriteJSON(v any) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	return w.conn.WriteJSON(v)
}

func (w *SafeWS) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	return w.conn.Close()
}
