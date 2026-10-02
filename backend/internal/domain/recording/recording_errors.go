package recording

import "errors"

var (
	ErrNotFound        = errors.New("recording not found")
	ErrInvalidUpload   = errors.New("invalid recording upload")
	ErrInvalidTitle    = errors.New("recording title is required and must be at most 200 characters")
	ErrInvalidDuration = errors.New("recording duration must be greater than zero and no more than one hour")
)
