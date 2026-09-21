package handler

import "testing"

func TestParseWaveformOverview(t *testing.T) {
	t.Run("empty", func(t *testing.T) {
		if parseWaveformOverview("") != nil {
			t.Fatal("expected nil")
		}
	})

	t.Run("invalid json", func(t *testing.T) {
		if parseWaveformOverview("{") != nil {
			t.Fatal("expected nil")
		}
	})

	t.Run("valid", func(t *testing.T) {
		got := parseWaveformOverview(`{"lows":[0.1],"mids":[0.2],"highs":[0.3],"durationSeconds":12.5}`)
		if got == nil {
			t.Fatal("expected overview")
		}
		if len(got.Lows) != 1 || got.Lows[0] != 0.1 || got.DurationSeconds != 12.5 {
			t.Fatalf("unexpected overview: %+v", got)
		}
	})
}
