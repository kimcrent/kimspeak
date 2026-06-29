package voice

import (
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const signalWriteWait = 10 * time.Second

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

	if err := w.conn.SetWriteDeadline(time.Now().Add(signalWriteWait)); err != nil {
		return err
	}

	return w.conn.WriteJSON(v)
}

func (w *SafeWS) WriteControl(messageType int, data []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	return w.conn.WriteControl(messageType, data, time.Now().Add(signalWriteWait))
}

func (w *SafeWS) Close() error {
	_ = w.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
	)

	return w.conn.Close()
}
