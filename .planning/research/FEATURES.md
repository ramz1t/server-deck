# Feature Landscape — ServerDeck

**Domain:** Mobile-friendly personal server dashboard (Docker monitoring + SSH terminal)
**Researched:** 2025-05-25
**Reference apps:** Portainer, Dockge, Lazydocker, Yacht, Homarr, Cockpit, ttyd

---

## Table Stakes

Features users expect. Missing = app is useless or indistinguishable from just using the CLI.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Username + password login | App is internet-exposed; must be gated | Low | Single credential pair; bcrypt hash stored in config file |
| Session persistence across refresh | Without this, every page load forces re-login — unusable on mobile | Low | JWT or signed session cookie with configurable TTL |
| Container list with live status | Core reason the app exists — know what's running | Low–Med | Poll Docker API every 2–3s or use Docker event stream; show running/stopped/exited with color coding |
| Start / Stop / Restart container | The most common operations; all reference apps support these | Low | Simple Docker API calls; requires confirmation for stop/restart |
| Live container log streaming | Second most common operation; all reference apps support this | Med | WebSocket stream from Docker logs API; auto-scroll with ability to pause |
| Web-based SSH terminal | Stated core value — "drop into a shell from your phone" | Med–High | xterm.js + WebSocket + ssh2 (Node) to localhost; PTY allocation required |
| Mobile-friendly layout | Without this, the app fails its stated purpose | Med | Responsive Tailwind layout; bottom nav bar; large tap targets (≥44px) |
| Logout | Security requirement; sessions must be terminable | Low | Clear token/cookie; invalidate server-side session |

---

## Differentiators

Features that make ServerDeck stand out for a personal mobile use case. Not universally expected, but high value relative to complexity.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Terminal virtual keyboard toolbar | iOS/Android physical keyboard is absent; Ctrl, Tab, Esc, arrow keys are inaccessible on phone keyboards. **This is the #1 mobile terminal usability gap** in all reference apps | Med | Fixed toolbar above xterm.js with Ctrl, Alt, Tab, Esc, arrow key buttons. Sends raw escape sequences via `terminal.onData` |
| Container exec shell | Drop into a container shell (not just server SSH) — useful for debugging running services | Med | Same xterm.js component, different backend: `docker exec -it <id> /bin/sh` via dockerode |
| At-a-glance status summary | Dashboard view showing total running/stopped counts + aggregate CPU/memory — "is everything OK?" at a glance | Low–Med | Could be a header banner on the container list page; no separate screen needed |
| Container resource stats (CPU/mem) | Know if something is hammering the server; all serious tools (Portainer, Cockpit, Lazydocker) show this | Med | Docker stats API stream; per-container % CPU and MB used |
| Log search / filter | Long logs are unreadable without search; becomes critical for debugging | Med | Client-side filter against buffered lines; highlight matches |
| Container detail view | Environment variables (read-only), ports, image name, created time | Low | Read from `docker inspect`; no editing required |
| Auto-reconnect on disconnect | WebSocket drops on mobile when screen locks or network changes; silent reconnect is essential for mobile UX | Med | Exponential backoff reconnect for both log streams and terminal sessions |
| HTTPS enforcement reminder/docs | App is internet-exposed; running over plain HTTP is a real risk users may overlook | Low | Deployment docs only; not a code feature, but critical for the personal-tool use case |
| PWA manifest + add-to-home-screen | Makes the app feel native on iOS/Android; avoids browser chrome cluttering the terminal | Low | `manifest.json` + service worker stub; no offline support needed |
| Keyboard shortcut: Ctrl+C in log view | Power users expect this to stop log tailing | Low | Map keyboard event in log view component |

---

## Anti-Features

Features to deliberately NOT build. Each one has a reason grounded in the single-user personal tool context.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Multi-user / RBAC | This is a personal tool. Role management is Portainer's entire business. Zero users will need it | Single hardcoded credential in config; document how to change it |
| Docker image management (build/pull/push) | Project.md explicitly out-of-scope. Low demand for phone-based image builds. Adds significant surface area | Link to Portainer or Dockge for image ops |
| Docker Compose stack management | Dockge and Portainer already do this well. Compose YAML editing on mobile is painful | Out of scope v1; consider read-only stack view later |
| Container creation / deployment UI | Portainer/Yacht's template system. Complex form on mobile. Not the value prop of this tool | Use CLI or other tools to create containers |
| Volume / network management | Low-frequency, high-complexity operation. Nobody does this from their phone | Document CLI commands |
| Multi-server support | Project.md explicitly out-of-scope. Adds connection management, credential storage complexity | Single-server focus; revisit only if validated need emerges |
| Plugin / extension system | Portainer's extension system adds architecture overhead. Personal tools need simplicity | Ship everything needed in core; no plugin API |
| Notification / alerting system | Requires persistent background workers, push notification infrastructure. Scope creep | Integrate with external tools (Uptime Kuma, Healthchecks.io) for alerts |
| Two-factor authentication (2FA) | Complexity-to-value ratio is poor for a single-user personal tool — the user knows who they are | Strong password + HTTPS is sufficient; document IP allowlisting as an alternative layer |
| Dark/light theme toggle | Nice polish but zero impact on core value; adds CSS complexity | Ship one theme (dark — better for terminal, better at night) |
| Activity audit log | Portainer's enterprise feature. No compliance requirement for personal tools | Not needed |

---

## Mobile-Specific UX Considerations

These are not separate features but constraints that affect how table-stakes features must be implemented.

### Terminal (xterm.js on mobile)

**Problem:** xterm.js has limited first-class mobile support. iOS Safari in particular:
- Does not reliably focus a hidden `<input>` to show the keyboard
- Resizes the viewport when the keyboard appears, shrinking the terminal
- Has no native way to send Ctrl, Esc, Tab from the software keyboard

**Required mitigations:**
1. **Virtual keyboard toolbar** — fixed bar above the terminal with tappable Ctrl, Alt, Tab, Esc, ↑↓←→ buttons. Each sends the correct escape sequence via `terminal.onData()`. This is the single most important mobile-terminal improvement.
2. **Viewport + keyboard handling** — use `visualViewport` API to detect keyboard height on iOS; adjust terminal height dynamically rather than relying on `100vh`
3. **Font size adjustment** — allow pinch-to-resize font (or ±buttons) since phone screens are small and default 14px may be unreadable at arm's length
4. **Prevent terminal zoom** — `touch-action: none` + `user-scalable=no` meta on terminal container so iOS doesn't zoom on double-tap

### Container / Log List

- **Pull-to-refresh** not needed — auto-polling handles it; but a visible "last updated" timestamp helps
- **Swipe actions** on container rows (swipe left = stop, swipe right = logs) — reduces taps but adds complexity; defer to v2
- **Bottom navigation bar** — thumb zone on modern phones is the bottom 1/3 of screen; top nav bars require awkward reach
- **Long-press for destructive actions** — confirm dialogs are fine but a long-press hold pattern for stop/restart prevents fat-finger accidents

### Log View

- Pinch-to-zoom on log text is useful (users want to read dense logs at different scales); allow it here (unlike terminal)
- Auto-scroll to bottom toggle — when user scrolls up to read, pause auto-scroll; sticky button to resume
- Line wrapping at container width — mobile screens don't have horizontal scroll room; wrap log lines

---

## Feature Dependencies

```
Auth (login + session) ──────────────────────────────────────────────── ALL features
    │
    ├── Docker socket connection ──────────────────────────────────────── Docker features
    │       │
    │       ├── Container list + status polling ──────────────────────── Status view
    │       ├── Container actions (start/stop/restart) ───────────────── Requires container list
    │       ├── Container resource stats ──────────────────────────────── Requires container list
    │       ├── Container detail view ─────────────────────────────────── Requires container list
    │       ├── Live log streaming ────────────────────────────────────── WebSocket + container list
    │       │       └── Log search/filter ─────────────────────────────── Requires log buffer
    │       └── Container exec ────────────────────────────────────────── xterm.js + WebSocket
    │
    └── SSH connection (Node → localhost) ────────────────────────────── SSH terminal
            │
            └── xterm.js terminal UI ──────────────────────────────────── WebSocket
                    └── Virtual keyboard toolbar ──────────────────────── Requires terminal
```

---

## MVP Recommendation

### Must ship in v1 (table stakes):

1. **Auth** — login/logout, session persistence via JWT
2. **Container list** — live status polling (running/stopped/exited), color-coded badges
3. **Container actions** — start, stop, restart with confirmation
4. **Live log stream** — WebSocket-based tailing, auto-scroll with pause
5. **SSH terminal** — xterm.js + WebSocket + ssh2 to server localhost
6. **Virtual keyboard toolbar** — Ctrl, Tab, Esc, arrow keys for mobile terminal use
7. **Mobile layout** — bottom nav, large tap targets, viewport keyboard handling

### Defer to v2 (differentiators, low risk):

- Container exec shell (reuses terminal plumbing; add after SSH terminal is solid)
- Container resource stats (CPU/mem) — requires streaming Docker stats API
- Log search/filter — add once log view UX is validated
- PWA manifest — minimal effort, add after core is stable
- Auto-reconnect — important but can be a quick follow-on

### Never build (anti-features confirmed):

- Multi-user, multi-server, image management, Compose UI, plugin system, notifications

---

## Sources

- Dockge README: https://github.com/louislam/dockge (HIGH confidence — official)
- Lazydocker README: https://github.com/jesseduffield/lazydocker (HIGH confidence — official)
- Yacht README: https://github.com/SelfhostedPro/Yacht (HIGH confidence — official)
- Homarr README: https://github.com/homarr-labs/homarr (HIGH confidence — official, v1 migration confirmed)
- Cockpit homepage: https://cockpit-project.org (HIGH confidence — official)
- ttyd README: https://github.com/tsl0922/ttyd (HIGH confidence — official; xterm.js production web terminal reference)
- xterm.js Context7 docs: /xtermjs/xterm.js — mobile input handling (HIGH confidence)
- ServerDeck PROJECT.md — out-of-scope constraints confirmed (HIGH confidence — authoritative)
