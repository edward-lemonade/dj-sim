package track

import "errors"

var (
	ErrNotFound          = errors.New("track not found")
	ErrInvalidFileType   = errors.New("only audio files are allowed")
	ErrInvalidBeatOffset = errors.New("invalid beat offset")
	ErrTooManyCues       = errors.New("at most 8 cues")
	ErrInvalidCueTime    = errors.New("invalid cue time")
)
