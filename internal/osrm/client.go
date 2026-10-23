package osrm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const requestTimeout = 5 * time.Second

type Point struct {
	Lat float64
	Lng float64
}

type Table struct {
	Durations [][]*float64
	Distances [][]*float64
}

type Client struct {
	baseURL string
	http    *http.Client
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		http: &http.Client{
			Timeout: requestTimeout,
		},
	}
}

type tableResponse struct {
	Code      string       `json:"code"`
	Message   string       `json:"message"`
	Durations [][]*float64 `json:"durations"`
	Distances [][]*float64 `json:"distances"`
}

// Table memanggil OSRM /table dengan semua kendaraan sebagai sources dan
// insiden sebagai satu-satunya destination. Urutan koordinat OSRM adalah
// longitude,latitude.
func (c *Client) Table(ctx context.Context, vehicles []Point, incident Point) (Table, error) {
	if len(vehicles) == 0 {
		return Table{}, fmt.Errorf("tidak ada kendaraan untuk dihitung")
	}

	coords := make([]string, 0, len(vehicles)+1)
	for _, point := range vehicles {
		coords = append(coords, fmt.Sprintf("%.6f,%.6f", point.Lng, point.Lat))
	}
	coords = append(coords, fmt.Sprintf("%.6f,%.6f", incident.Lng, incident.Lat))

	sourceIndexes := make([]string, 0, len(vehicles))
	for i := range vehicles {
		sourceIndexes = append(sourceIndexes, strconv.Itoa(i))
	}

	query := url.Values{}
	query.Set("sources", strings.Join(sourceIndexes, ";"))
	query.Set("destinations", strconv.Itoa(len(vehicles)))
	query.Set("annotations", "duration,distance")

	endpoint := c.baseURL + "/table/v1/driving/" + strings.Join(coords, ";") + "?" + query.Encode()

	requestCtx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Table{}, fmt.Errorf("buat request OSRM: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "dispatch-demo/1.0")

	resp, err := c.http.Do(req)
	if err != nil {
		return Table{}, fmt.Errorf("panggil OSRM: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return Table{}, fmt.Errorf("baca respons OSRM: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Table{}, fmt.Errorf("OSRM HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload tableResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return Table{}, fmt.Errorf("decode respons OSRM: %w", err)
	}
	if payload.Code != "Ok" {
		message := strings.TrimSpace(payload.Message)
		if message == "" {
			message = "tanpa pesan"
		}
		return Table{}, fmt.Errorf("OSRM code %q: %s", payload.Code, message)
	}

	return Table{
		Durations: payload.Durations,
		Distances: payload.Distances,
	}, nil
}
