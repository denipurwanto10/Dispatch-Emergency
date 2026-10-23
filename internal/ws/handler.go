package ws

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"dispatch/internal/auth"
	"dispatch/internal/model"
)

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan BroadcastEvent
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
	manager    *auth.Manager
}

type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
	userID int64
	role   string
	ctx    context.Context
	cancel context.CancelFunc
}

type BroadcastEvent struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

type SnapshotEvent struct {
	Vehicles    []model.Vehicle    `json:"vehicles"`
	Incidents   []model.Incident   `json:"incidents"`
	Assignments []model.Assignment `json:"assignments"`
}

type VehiclePositionEvent struct {
	VehicleID        int64   `json:"vehicle_id"`
	AssignmentID     int64   `json:"assignment_id"`
	Lat              float64 `json:"lat"`
	Lng              float64 `json:"lng"`
	ProgressPct      float64 `json:"progress_pct"`
	ETARemainingSecs int     `json:"eta_remaining_seconds"`
}

type AssignmentStatusEvent struct {
	Assignment model.Assignment `json:"assignment"`
	Incident   model.Incident   `json:"incident"`
	Vehicle    model.Vehicle    `json:"vehicle"`
}

type IncidentStatusEvent struct {
	Incident model.Incident `json:"incident"`
}

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for development
	},
}

func NewHub(manager *auth.Manager) *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan BroadcastEvent, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		manager:    manager,
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Printf("WebSocket client connected: userID=%d, role=%s (total: %d)", client.userID, client.role, len(h.clients))
		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
			log.Printf("WebSocket client disconnected: userID=%d, role=%s (total: %d)", client.userID, client.role, len(h.clients))
		case event := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- mustMarshal(event):
				default:
					// Client buffer full, disconnect
					delete(h.clients, client)
					close(client.send)
				}
			}
			h.mu.RUnlock()
		}
	}
}

func mustMarshal(v interface{}) []byte {
	data, err := json.Marshal(v)
	if err != nil {
		log.Printf("ws: marshal error: %v", err)
		return []byte("{}")
	}
	return data
}

func (h *Hub) Broadcast(event BroadcastEvent) {
	select {
	case h.broadcast <- event:
	default:
		// Drop if channel full
	}
}

func (h *Hub) ServeWS(c *gin.Context) {
	token := c.Query("token")
	if token == "" {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}

	claims, err := h.manager.Parse(token)
	if err != nil {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("ws: upgrade error: %v", err)
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	client := &Client{
		hub:    h,
		conn:   conn,
		send:   make(chan []byte, 256),
		userID: claims.UserID,
		role:   claims.Role,
		ctx:    ctx,
		cancel: cancel,
	}

	h.register <- client

	go client.writePump()
	go client.readPump()
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
		c.cancel()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("ws: read error: %v", err)
			}
			break
		}
		// Ignore incoming messages from client for now
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				log.Printf("ws: write error: %v", err)
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-c.ctx.Done():
			return
		}
	}
}

// SendSnapshot sends initial snapshot to a newly connected client
func (h *Hub) SendSnapshot(client *Client, vehicles []model.Vehicle, incidents []model.Incident, assignments []model.Assignment) {
	snapshot := SnapshotEvent{
		Vehicles:    vehicles,
		Incidents:   incidents,
		Assignments: assignments,
	}
	event := BroadcastEvent{
		Type: "snapshot",
		Data: snapshot,
	}
	select {
	case client.send <- mustMarshal(event):
	default:
	}
}
