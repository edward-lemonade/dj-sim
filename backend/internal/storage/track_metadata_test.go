package storage

import "testing"

func TestInferTrackMetadata(t *testing.T) {
	cases := []struct {
		name   string
		input  string
		artist string
		title  string
	}{
		{name: "standard artist and title", input: "Nora Lane - Midnight Echo.mp3", artist: "Nora Lane", title: "Midnight Echo"},
		{name: "fallback without separator", input: "midnight_echo.wav", artist: "Unknown Artist", title: "Midnight Echo"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			meta := InferTrackMetadata(tc.input)
			if meta.Title != tc.title {
				t.Fatalf("title mismatch: got %q want %q", meta.Title, tc.title)
			}
			if meta.Artist != tc.artist {
				t.Fatalf("artist mismatch: got %q want %q", meta.Artist, tc.artist)
			}
		})
	}
}
