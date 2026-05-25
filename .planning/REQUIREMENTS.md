# Requirements: ServerDeck

**Defined:** 2026-05-25
**Core Value:** From any phone browser, see what's running on your server and drop into a shell — no apps, no VPN setup, no switching tools.

## v1 Requirements

### Authentication

- [x] **AUTH-01**: User can log in with username and password via a login form
- [x] **AUTH-02**: User receives a secure httpOnly JWT cookie upon successful login
- [x] **AUTH-03**: Session persists across browser refresh (cookie-based, not localStorage)
- [x] **AUTH-04**: User can log out and the session cookie is invalidated
- [x] **AUTH-05**: Login endpoint is rate-limited to prevent brute-force attacks
- [x] **AUTH-06**: All API routes (REST and WebSocket) reject unauthenticated requests

### Container Dashboard

- [ ] **CONT-01**: User can see a list of all Docker containers (running and stopped)
- [ ] **CONT-02**: Each container shows name, image, status, and uptime
- [ ] **CONT-03**: Container list updates in real time when containers start, stop, or change state
- [ ] **CONT-04**: User can start a stopped container
- [ ] **CONT-05**: User can stop a running container
- [ ] **CONT-06**: User can restart a running container

### Log Streaming

- [ ] **LOGS-01**: User can open a live log view for any container
- [ ] **LOGS-02**: Logs stream in real time via WebSocket
- [ ] **LOGS-03**: Last N lines of existing logs are shown immediately on open (tail)
- [ ] **LOGS-04**: Log stream is cleanly terminated when user closes the log view

### SSH Terminal

- [ ] **SSH-01**: User can open a web-based SSH terminal to the server
- [ ] **SSH-02**: Terminal connects to localhost via SSH using a pre-configured server key
- [ ] **SSH-03**: Terminal input and output are streamed over WebSocket
- [ ] **SSH-04**: Terminal resizes correctly when the browser window or keyboard changes size
- [ ] **SSH-05**: A touch-friendly toolbar provides tappable keys for Ctrl, Tab, Esc, and arrow keys
- [ ] **SSH-06**: SSH session is cleanly terminated when user closes the terminal

### Mobile UX

- [ ] **MOBL-01**: All screens are usable on a 390px-wide phone screen (iPhone 15 baseline)
- [ ] **MOBL-02**: Terminal viewport adjusts correctly when the iOS virtual keyboard appears
- [ ] **MOBL-03**: Touch targets (buttons, list items) meet 44×44px minimum tap target size
- [ ] **MOBL-04**: Autocorrect and autocapitalize are disabled in the terminal input
- [ ] **MOBL-05**: App is installable as a PWA (manifest + service worker stub for offline shell)

## v2 Requirements

### Container Observability

- **STAT-01**: Container CPU and memory usage shown on the dashboard
- **STAT-02**: Container port mappings and environment variables visible in detail view
- **STAT-03**: User can search/filter containers by name or status

### Resilience

- **RESI-01**: Dashboard auto-reconnects WebSocket after network interruption
- **RESI-02**: App shows a clear "disconnected" state and reconnect button when WebSocket drops
- **RESI-03**: Docker daemon restart is detected and event stream is re-established

### Container Exec

- **EXEC-01**: User can exec into a running container (separate from SSH terminal)
- **EXEC-02**: Exec terminal reuses the xterm.js + WebSocket pattern from SSH terminal

### Deployment

- **DEPL-01**: App ships with a `docker-compose.yml` for easy self-hosted setup
- **DEPL-02**: README includes SSH key configuration instructions and first-run setup guide

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-server support | Complexity not needed for personal use; single server is the target for v1 |
| Docker image management (build/pull/push) | Operations dashboard only, not an image registry |
| Docker Compose stack management | Individual container control is sufficient for v1 |
| User management / multiple accounts | Single-user personal tool |
| Push notifications | No app server needed; user checks dashboard on demand |
| 2FA / OAuth | Username + password is sufficient for a personal self-hosted tool |
| Native mobile app | Web app with PWA is sufficient; avoids app store friction |
| Monitoring graphs / metrics history | Real-time status covers the core need; historical metrics are a future concern |

## Traceability

Which phases cover which requirements. Confirmed during roadmap creation (2026-05-25).

| Requirement | Phase | Phase Name | Status |
|-------------|-------|------------|--------|
| AUTH-01 | Phase 1 | Auth Foundation | Pending |
| AUTH-02 | Phase 1 | Auth Foundation | Pending |
| AUTH-03 | Phase 1 | Auth Foundation | Pending |
| AUTH-04 | Phase 1 | Auth Foundation | Pending |
| AUTH-05 | Phase 1 | Auth Foundation | Pending |
| AUTH-06 | Phase 1 | Auth Foundation | Pending |
| CONT-01 | Phase 2 | Container Dashboard | Pending |
| CONT-02 | Phase 2 | Container Dashboard | Pending |
| CONT-03 | Phase 3 | Real-Time Container Status | Pending |
| CONT-04 | Phase 2 | Container Dashboard | Pending |
| CONT-05 | Phase 2 | Container Dashboard | Pending |
| CONT-06 | Phase 2 | Container Dashboard | Pending |
| LOGS-01 | Phase 4 | Log Streaming | Pending |
| LOGS-02 | Phase 4 | Log Streaming | Pending |
| LOGS-03 | Phase 4 | Log Streaming | Pending |
| LOGS-04 | Phase 4 | Log Streaming | Pending |
| SSH-01 | Phase 5 | SSH Terminal | Pending |
| SSH-02 | Phase 5 | SSH Terminal | Pending |
| SSH-03 | Phase 5 | SSH Terminal | Pending |
| SSH-04 | Phase 5 | SSH Terminal | Pending |
| SSH-05 | Phase 5 | SSH Terminal | Pending |
| SSH-06 | Phase 5 | SSH Terminal | Pending |
| MOBL-01 | Phase 6 | Mobile Polish + Hardening | Pending |
| MOBL-02 | Phase 6 | Mobile Polish + Hardening | Pending |
| MOBL-03 | Phase 6 | Mobile Polish + Hardening | Pending |
| MOBL-04 | Phase 6 | Mobile Polish + Hardening | Pending |
| MOBL-05 | Phase 6 | Mobile Polish + Hardening | Pending |

**Coverage:**
- v1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-25*
*Last updated: 2026-05-25 after initial definition*
