package osrm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type RouteResponse struct {
	Code      string     `json:"code"`
	Routes    []Route    `json:"routes"`
	Message   string     `json:"message,omitempty"`
	Waypoints []Waypoint `json:"waypoints,omitempty"`
}

type Route struct {
	Distance float64         `json:"distance"`
	Duration float64         `json:"duration"`
	Geometry json.RawMessage `json:"geometry"` // GeoJSON LineString
	Legs     []Leg           `json:"legs"`
}

type Leg struct {
	Distance float64 `json:"distance"`
	Duration float64 `json:"duration"`
	Steps    []Step  `json:"steps"`
	Summary  string  `json:"summary"`
}

type Step struct {
	Distance      float64        `json:"distance"`
	Duration      float64        `json:"duration"`
	Geometry      string         `json:"geometry"`
	Name          string         `json:"name"`
	Mode          string         `json:"mode"`
	Maneuver      *Maneuver      `json:"maneuver,omitempty"`
	Intersections []Intersection `json:"intersections,omitempty"`
}

type Maneuver struct {
	Type          string    `json:"type"`
	Instruction   string    `json:"instruction"`
	BearingAfter  float64   `json:"bearing_after"`
	BearingBefore float64   `json:"bearing_before"`
	Location      []float64 `json:"location"`
}

type Intersection struct {
	Location []float64 `json:"location"`
	Bearings []float64 `json:"bearings"`
	Entry    []bool    `json:"entry"`
	In       int       `json:"in"`
	Out      int       `json:"out"`
}

type Waypoint struct {
	Hint     string    `json:"hint"`
	Location []float64 `json:"location"` // [lng, lat]
	Name     string    `json:"name"`
	Distance float64   `json:"distance"`
}

// RouteClient handles OSRM /route requests
type RouteClient struct {
	baseURL string
	http    *http.Client
}

func NewRouteClient(baseURL string) *RouteClient {
	return &RouteClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		http: &http.Client{
			Timeout: requestTimeout,
		},
	}
}

// Route requests a route from start to end using OSRM /route/v1/driving
// Returns the first route's distance, duration, and GeoJSON geometry.
func (c *RouteClient) Route(ctx context.Context, start, end Point) (RouteResult, error) {
	coords := fmt.Sprintf("%.6f,%.6f;%.6f,%.6f", start.Lng, start.Lat, end.Lng, end.Lat)
	endpoint := c.baseURL + "/route/v1/driving/" + coords + "?overview=full&geometries=geojson&steps=false"

	requestCtx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return RouteResult{}, fmt.Errorf("buat request OSRM route: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "dispatch-demo/1.0")

	resp, err := c.http.Do(req)
	if err != nil {
		return RouteResult{}, fmt.Errorf("panggil OSRM route: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return RouteResult{}, fmt.Errorf("baca respons OSRM route: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return RouteResult{}, fmt.Errorf("OSRM route HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload RouteResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return RouteResult{}, fmt.Errorf("decode respons OSRM route: %w", err)
	}
	if payload.Code != "Ok" {
		message := strings.TrimSpace(payload.Message)
		if message == "" {
			message = "tanpa pesan"
		}
		return RouteResult{}, fmt.Errorf("OSRM route code %q: %s", payload.Code, message)
	}
	if len(payload.Routes) == 0 {
		return RouteResult{}, fmt.Errorf("OSRM route: tidak ada rute yang ditemukan")
	}

	route := payload.Routes[0]
	geometryStr, err := json.Marshal(route.Geometry)
	if err != nil {
		return RouteResult{}, fmt.Errorf("marshal route geometry: %w", err)
	}
	return RouteResult{
		Distance: route.Distance,
		Duration: route.Duration,
		Geometry: string(geometryStr),
	}, nil
}

type RouteResult struct {
	Distance float64 `json:"distance"`
	Duration float64 `json:"duration"`
	Geometry string  `json:"geometry"` // GeoJSON LineString
}
