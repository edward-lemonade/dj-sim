package handler

import (
	"encoding/json"
	"testing"
)

func TestAnalysisWebhookPayloadSourceObjectKey(t *testing.T) {
	tests := []struct {
		name string
		json string
		want string
	}{
		{
			name: "lambda s3 key",
			json: `{"s3_key":"tracks/song.mp3"}`,
			want: "tracks/song.mp3",
		},
		{
			name: "object key",
			json: `{"object_key":"tracks/song.mp3"}`,
			want: "tracks/song.mp3",
		},
		{
			name: "object key takes precedence",
			json: `{"object_key":"tracks/canonical.mp3","s3_key":"tracks/legacy.mp3"}`,
			want: "tracks/canonical.mp3",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var payload analysisWebhookPayload
			if err := json.Unmarshal([]byte(tt.json), &payload); err != nil {
				t.Fatalf("unmarshal payload: %v", err)
			}
			if got := payload.sourceObjectKey(); got != tt.want {
				t.Fatalf("sourceObjectKey() = %q, want %q", got, tt.want)
			}
		})
	}
}
