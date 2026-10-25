package config

import (
	"testing"
	"time"
)

func TestFakeRoomServerDelay(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		want    time.Duration
		wantErr bool
	}{
		{name: "disabled", value: "0s", want: 0},
		{name: "enabled", value: "250ms", want: 250 * time.Millisecond},
		{name: "negative", value: "-1ms", wantErr: true},
		{name: "invalid", value: "true", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := (Config{RoomFakeServerDelay: test.value}).FakeRoomServerDelay()
			if (err != nil) != test.wantErr {
				t.Fatalf("FakeRoomServerDelay() error = %v, wantErr %t", err, test.wantErr)
			}
			if err == nil && got != test.want {
				t.Errorf("FakeRoomServerDelay() = %s, want %s", got, test.want)
			}
		})
	}
}
