package user

import "testing"

func TestNewGuestCredentialCreatesUnpredictableTokenAndHash(t *testing.T) {
	first, firstHash, err := NewGuestCredential()
	if err != nil {
		t.Fatalf("NewGuestCredential() error = %v", err)
	}
	second, secondHash, err := NewGuestCredential()
	if err != nil {
		t.Fatalf("NewGuestCredential() second error = %v", err)
	}
	if first == second {
		t.Fatal("NewGuestCredential() returned the same credential twice")
	}
	if firstHash == first || firstHash != HashGuestCredential(first) {
		t.Fatal("guest credential hash is not a stable one-way representation")
	}
	if firstHash == secondHash {
		t.Fatal("different credentials produced the same hash")
	}
}
