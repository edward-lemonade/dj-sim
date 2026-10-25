package user

import "errors"

var (
	ErrNotFound      = errors.New("user not found")
	ErrAlreadyExists = errors.New("user already exists")
	ErrGuestExpired  = errors.New("guest session expired")
)
