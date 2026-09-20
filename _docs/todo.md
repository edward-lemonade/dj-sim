# Backend buildout

- [x] Sketch scope: Postgres + project CRUD + Clerk-synced users
- [x] Config, GORM + AutoMigrate (users, projects)
- [x] User store + HTTP handlers (`GET /user/me`, `POST /user`)
- [x] Project CRUD handlers
- [x] Auth (Clerk JWT) + CORS + wire `cmd/server`
- [x] Frontend API routes for remaining project CRUD
- [x] Compile check
- [x] Split routes into `internal/router`
- [x] Add service layer; keep store as DB access only
- [x] Client: fetchOrCreateAppUser on login, cache via React Query

Renamed ./backend/internal/store -> ./backend/internal/repository

Renamed ./backend/internal/db/db.go -> ./backend/internal/db/gorm.go
Renamed ./backend/internal/db -> ./backend/internal/storage

We use db as a place for all of our storage clients. In the future, this may mean S3, or local file storage.