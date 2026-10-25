# Guest Sessions and Account Claiming

## Status

Initial implementation is in place. Guest sessions use a 24-hour sliding
inactivity window, a 100 MB maximum upload size, and a 20-track library limit.
Guest recordings remain account-only. See implementation TODOs for remaining
hardening and integration-test work.

## Problem

Track uploads and studio room membership currently require a registered
application user. This blocks visitors who want to try the studio before
creating an account.

Allow visitors to upload tracks and use the studio without signing in, while
keeping their data temporary. If a guest creates an account, preserve that
guest's data as account data instead of letting expiration remove it.

## Goals

- Let an unauthenticated visitor upload and analyze tracks and use the studio.
- Keep guest-owned data only while that guest session remains active.
- Promote guest data to permanent account data when that guest registers.
- Support signing into an existing account and merging guest data into it.
- Keep all ownership decisions server-side; never trust a client-supplied user
  ID.
- Delete expired guest records and S3 objects reliably.
- Keep existing signed-in user behavior and existing S3 object keys working.

## Non-goals

- Persist live room state across backend restarts. Rooms and memberships are
  currently in memory and remain ephemeral.
- Move existing account tracks or recordings to new S3 paths when claiming a
  guest session.
- Make guest data recoverable after its inactivity expiration and cleanup.

## Existing behavior and constraints

- Clerk JWT middleware resolves a Clerk subject to an application user.
- Track and recording records require an application `user_id`.
- Track uploads use `tracks/{userId}/{filename}-{uuid}.{ext}`. Existing S3 keys
  are stored in the database and can remain unchanged after ownership changes.
- Room creation and membership use the application user UUID.
- Permanent users have a Clerk ID; guest users have a nullable Clerk ID and a
  persisted guest-session row.
- Account deletion enumerates track and recording object keys from the
  database, deletes S3 objects, then deletes database records.

## Proposed model

### Guest identity

Represent a guest as an application user with a generated UUID and no Clerk
identity. `GuestSession` stores:

- The unique user ID and hash of the opaque credential.
- `last_active_at` and `expires_at`.
- A cleanup claim and claim timestamp so interrupted cleanup can be retried.

A null Clerk ID distinguishes a guest from a permanent account.

Use the same internal user UUID for track ownership, recording ownership, and
studio membership. The browser must not choose or submit this ID as proof of
identity.

### Guest session credential

Issue a cryptographically random, opaque credential for the guest session.
Persist only a secure hash of the credential with the associated guest user
and expiration. Set the raw credential in a `Secure`, `HttpOnly` cookie with
an appropriate `SameSite` policy and path. Revoke it when the guest is
promoted, merged, or expired.

The credential is a session secret: do not log it, return it in JSON, or store
it in browser local storage. Validate it server-side on every guest request.

For mutating cookie-authenticated requests, enforce an origin/CSRF policy.
Configure credentialed CORS for explicit frontend origins; wildcard origins
must not be used with credentials.

### Authentication resolution

Extend authentication to resolve either:

1. A verified Clerk session to a permanent application user; or
2. A valid guest-session cookie to an unexpired guest application user.

Keep route handlers consuming a server-resolved current user. A valid Clerk
session must not silently fall back to guest access if its application user
cannot be found. Public endpoints remain explicitly public; guest access is
not equivalent to unauthenticated access.

Apply guest identity to track list/upload/update/delete/audio/analyze APIs and
the studio/room APIs needed to start and use a session. Keep recordings
account-only unless guest recording support is explicitly added to scope.

### Guest lifetime

Use a sliding inactivity expiration: each authenticated guest API request
updates `last_active_at` and extends `expires_at`. The default is 24 hours,
configured with `GUEST_SESSION_TTL`. The frontend also refreshes the session
every 10 minutes while a guest page is open, covering studio use where most
activity is sent over a WebSocket.

Browser tab close is not a reliable signal that a session ended. The product
contract should be inactivity-based rather than promising immediate deletion
on close. When a guest expires, reject its credential immediately, even if
storage cleanup is still pending.

### Upload abuse controls

Guests can create storage and analysis costs without a durable account.
The backend currently enforces a 100 MB request/file size cap and 20 saved
tracks per guest. Supported audio types are validated by the existing upload
service. Distributed request-rate limits, an aggregate byte quota, and an
analysis retry cooldown remain follow-up hardening.

## Lifecycle

### First visit

1. Frontend requests guest-session creation.
2. Backend creates the guest user and session record and sets the opaque
   cookie.
3. Frontend includes credentials on API requests.
4. Backend resolves the cookie and uses the guest's internal user ID for
   ownership checks and uploads.

Creation must be idempotent enough to avoid making multiple guest identities
for concurrent initial requests from one browser.

### Active guest session

- Refresh the inactivity deadline on authenticated guest activity.
- Guest sees and manages only data owned by that guest identity.
- Guest can create and enter the studio without Clerk registration.
- Guest data is not exposed through public track listings or by guessing IDs.

### Register while a guest session is active

When a guest creates a new Clerk account, ask whether to claim the current
guest application user. Claim only after explicit confirmation by attaching
the verified Clerk subject to that row and clearing its expiration. Preserve
the internal user UUID so existing track rows, object keys, and any related
ownership references remain valid. Declining clears the browser's guest cookie;
the unclaimed guest data is then removed by normal expiration cleanup.

Make the claim atomic and idempotent. If the Clerk subject is already attached
to a different application user, do not overwrite it; follow the existing
account merge flow below.

### Sign into an existing account as a guest

Treat this as an explicit merge, distinct from claiming a newly created
account:

1. Verify both the existing Clerk identity and the guest session.
2. In a database transaction, move guest-owned track and supported recording
   rows to the permanent account user ID.
3. Preserve S3 object keys; ownership is determined by database records, not
   by parsing the key.
4. Handle unique conflicts, duplicate metadata, and concurrent claim attempts
   deterministically.
5. Revoke the guest session only after the ownership transfer succeeds.

When the frontend detects a signed-in Clerk user while a guest cookie exists,
it asks whether to merge the guest tracks into that account. The transfer is
transactional, and the guest cookie is revoked only after it succeeds. S3
object keys remain unchanged; database ownership is authoritative. If the
guest declines, the cookie is revoked and the data expires through cleanup.

### Expiration and cleanup

Run a cleanup loop every minute that finds expired guest sessions/users in
batches of 100.
Expiration must invalidate authentication immediately. Cleanup then:

1. Claims expired guest data for deletion using a database row lock and a
   15-minute claim lease so multiple workers do not race and a crashed worker
   can be recovered.
2. Deletes each associated track audio object, analysis result object, and
   any supported recording objects from S3.
3. Deletes track/recording rows and guest session records.
4. Deletes the guest user only after owned data is removed.
5. Retries transient failures and logs actionable context without logging
   credentials or audio contents.

Cleanup must be safe to rerun. A partial S3 failure must not produce a
success-shaped result or permanently strand the guest in an untracked state.
Use a durable retry mechanism or a deletion state that a later run can
resume.

## API and frontend changes

Implemented API surface:

- `POST /guest/session` — create or resume the browser's guest session and set
  its cookie.
- `GET /user/guest-session` — check whether the signed-in browser has an active
  guest session and refresh its inactivity deadline.
- `POST /user/claim-guest` — called only after the user confirms; claims a
  guest for a new app user or merges guest tracks into an existing app user.
- `POST /user/decline-guest` — revoke the guest cookie after the user declines;
  the unclaimed data is removed by normal expiration cleanup.
- `POST /user` — register the permanent app user without implicitly claiming
  guest data.

The API client must send cookies (`withCredentials`) and preserve existing
Clerk bearer-token behavior. The frontend should initialize guest identity
when no Clerk user is signed in, then route track and studio operations through
the same API methods used by signed-in users.

After sign-in, ask whether to claim guest data before transferring ownership.
Only an affirmative response claims or merges the guest session; declining
revokes its cookie and leaves the data to expire.

## Configuration

- Set `CORS_ORIGIN` to one or more comma-separated exact frontend origins.
  Wildcard origins are rejected at backend startup because credentialed
  guest-session cookies require explicit CORS origins.
- `GUEST_SESSION_TTL` defaults to `24h`.
- `GUEST_COOKIE_SECURE` must be `true` in production. The checked-in backend
  example sets it to `false` for local HTTP development.
- `GUEST_COOKIE_SAME_SITE` defaults to `Lax`. Use `None` with Secure enabled
  when the deployed frontend and API are cross-site; same-site deployments
  can use `Lax`.
- No Lambda prefix or S3 environment change is required. Keep the track
  prefix at `tracks/`.

## S3 and Lambda

- No S3 environment variable change is needed for the current
  `tracks/{userId}/...` key layout.
- Keep the Lambda S3 notification prefix at `tracks/`; it matches both
  permanent-user and guest-user track keys.
- Analysis results remain under `analysis/{sourceObjectKey}.json`.
- On account claim, the user ID does not change, so no object copy is needed.
- On merge into an existing account, do not rename S3 objects. Continue to
  retrieve and delete them using the database `object_key`.
- Ensure guest cleanup deletes both audio objects and their corresponding
  analysis result objects.

## Security and reliability requirements

- Generate session credentials with a cryptographically secure random source;
  store only a one-way hash.
- Use secure cookie attributes, explicit CORS origins, and a required custom
  request header for guest mutations to force browser preflight.
- Never accept a user ID as an authorization credential.
- Do not fall back from invalid Clerk credentials to guest identity.
- Make registration/claim and merge concurrency-safe and idempotent.
- Make cleanup observable, retryable, and safe to rerun.
- Avoid logging cookies, authorization headers, or uploaded audio data.

## Remaining decisions

- Guest recording support remains out of scope.
- Confirm the 24-hour inactivity period, 100 MB file cap, and 20-track quota.
- Add distributed guest creation/upload/analysis rate limits and an aggregate
  storage quota if needed for production traffic.
- Confirm `CORS_ORIGIN`, cookie Secure, and SameSite settings for deployed
  frontend/API origins.

## Implementation TODOs

- [x] Add nullable Clerk identity and guest lifecycle fields to the user model
      and migration.
- [x] Add hashed guest-session persistence, secure credential generation,
      expiry validation, revocation, and sliding expiration.
- [x] Add guest-session creation/resume endpoint and cookie/CSRF/CORS handling.
- [x] Extend authentication middleware to resolve valid guest cookies without
      weakening Clerk validation.
- [x] Enable guest track and studio APIs while keeping all operations scoped
      to the resolved current user.
- [x] Add guest upload size and track-count limits.
- [ ] Add distributed request-rate limits, aggregate storage quota, and
      analysis retry cooldown.
- [x] Implement atomic claim of a guest user after explicit user confirmation
      when a new Clerk account is registered.
- [x] Implement the merge path after explicit confirmation when the guest
      signs into an already-existing account.
- [x] Prompt on sign-in to claim guest data or decline and let it expire.
- [x] Add durable, retryable cleanup for expired guest sessions, database
      records, audio objects, and analysis objects.
- [x] Update frontend API credential handling, guest initialization,
      registration/sign-in flows, and expiration/error UX.
- [ ] Add database-backed tests for guest auth isolation, expiration, upload ownership,
      account claim, existing-account merge, cleanup retries, and concurrency.
- [ ] Add metrics/logging for guest creation, claims, merges, cleanup backlog,
      and cleanup failures without recording secrets.
- [ ] Confirm the open decisions above and document configured TTL and quotas.
