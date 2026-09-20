package middleware

import "testing"

func TestClerkJWKSURL(t *testing.T) {
	url, err := clerkJWKSURL("https://renewing-seal-7962.clerk.accounts.dev")
	if err != nil {
		t.Fatal(err)
	}
	want := "https://renewing-seal-7962.clerk.accounts.dev/.well-known/jwks.json"
	if url != want {
		t.Fatalf("got %q want %q", url, want)
	}

	if _, err := clerkJWKSURL("https://evil.example"); err == nil {
		t.Fatal("expected rejected issuer")
	}
	if _, err := clerkJWKSURL("http://renewing-seal-7962.clerk.accounts.dev"); err == nil {
		t.Fatal("expected rejected http issuer")
	}
}
