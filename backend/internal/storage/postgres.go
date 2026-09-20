package storage

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/track"
	"github.com/edward-lemonade/dj-sim-backend/internal/domain/user"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func Connect(databaseURL string) (*gorm.DB, error) {
	gdb, err := gorm.Open(postgres.Open(databaseURL), &gorm.Config{
		TranslateError: true,
	})
	if err != nil {
		return nil, fmt.Errorf("connect postgres: %w", err)
	}
	if err := gdb.AutoMigrate(&user.User{}, &track.Track{}); err != nil {
		return nil, fmt.Errorf("migrate schema: %w", err)
	}
	return gdb, nil
}

type TrackMetadata struct {
	Title  string
	Artist string
	Cover  string
}

func InferTrackMetadata(fileName string) TrackMetadata {
	name := strings.TrimSuffix(filepath.Base(fileName), filepath.Ext(fileName))
	name = strings.ReplaceAll(name, "_", " ")
	name = strings.ReplaceAll(name, "-", " - ")

	meta := TrackMetadata{
		Title:  strings.TrimSpace(name),
		Artist: "Unknown Artist",
		Cover:  "",
	}

	if idx := strings.Index(meta.Title, " - "); idx > -1 {
		meta.Artist = strings.TrimSpace(meta.Title[:idx])
		meta.Title = strings.TrimSpace(meta.Title[idx+3:])
	}

	meta.Title = titleCase(meta.Title)
	if meta.Artist != "Unknown Artist" {
		meta.Artist = titleCase(meta.Artist)
	}
	if meta.Title == "" {
		meta.Title = "Untitled Track"
	}

	return meta
}

func titleCase(s string) string {
	parts := strings.Fields(s)
	for i, part := range parts {
		if part == "" {
			continue
		}
		if len(part) == 1 {
			parts[i] = strings.ToUpper(part)
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + strings.ToLower(part[1:])
	}
	return strings.Join(parts, " ")
}
