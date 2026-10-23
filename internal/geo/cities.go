// Package geo berisi daftar kota operasi kanonik dan validasi wilayah kasar.
package geo

import (
	"math"
	"strings"
)

// City adalah pusat operasi untuk salah satu dari 6 kota seed.
type City struct {
	Name string
	Lat  float64
	Lng  float64
}

// Cities adalah satu-satunya daftar kota operasi yang sah.
var Cities = []City{
	{Name: "Medan", Lat: 3.5952, Lng: 98.6722},
	{Name: "Jakarta", Lat: -6.2088, Lng: 106.8456},
	{Name: "Bandung", Lat: -6.9175, Lng: 107.6191},
	{Name: "Semarang", Lat: -6.9667, Lng: 110.4167},
	{Name: "Surabaya", Lat: -7.2575, Lng: 112.7521},
	{Name: "Makassar", Lat: -5.1477, Lng: 119.4327},
}

// cityRadiusM adalah batas kasar "masih di wilayah kota". Cukup longgar untuk
// area operasi tetapi tetap menolak koordinat dari kota lain.
const cityRadiusM = 60000

// Canonical mengembalikan nama kota kanonik bila input cocok persis
// (setelah trim spasi).
func Canonical(name string) (string, bool) {
	trimmed := strings.TrimSpace(name)
	for _, city := range Cities {
		if city.Name == trimmed {
			return city.Name, true
		}
	}
	return "", false
}

// Center mencari pusat kota kanonik.
func Center(name string) (City, bool) {
	trimmed := strings.TrimSpace(name)
	for _, city := range Cities {
		if city.Name == trimmed {
			return city, true
		}
	}
	return City{}, false
}

// WithinCity memeriksa apakah koordinat berada dalam radius kasar kota.
func WithinCity(name string, lat, lng float64) bool {
	city, ok := Center(name)
	if !ok {
		return false
	}
	return haversineM(city.Lat, city.Lng, lat, lng) <= cityRadiusM
}

func haversineM(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusM = 6371000
	toRad := func(value float64) float64 { return value * math.Pi / 180 }

	dLat := toRad(lat2 - lat1)
	dLng := toRad(lng2 - lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusM * math.Asin(math.Sqrt(a))
}
