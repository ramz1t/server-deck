# Phase 5: SSH Terminal - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-26
**Phase:** 5-SSH Terminal
**Mode:** Autopilot (user unavailable — agent made decisions autonomously based on established patterns)
**Areas discussed:** Terminal entry point, Touch toolbar, Terminal layout, SSH connection UX

---

## Terminal Entry Point

| Option | Description | Selected |
|--------|-------------|----------|
| Header nav button | "Terminal" in sticky header, always visible | ✓ |
| Dashboard action button | Button on the container dashboard page | |
| Floating action button | FAB overlay on dashboard | |

**Decision:** Header nav button — always accessible, consistent with single-server tool where terminal isn't tied to any specific container.
**Notes:** Route `/terminal`, push navigation, back button returns to dashboard.

---

## Touch Toolbar

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal (Ctrl, Tab, Esc, arrows only) | Roadmap minimum | |
| Extended (+ pipe, backtick, tilde, slash) | Common shell chars hard on mobile | ✓ |
| User-configurable | Custom key sets | |

**Decision:** Extended toolbar — Ctrl, Tab, Esc, ↑↓←→, `|`, `` ` ``, `~`, `/`. Fixed bottom with `env(safe-area-inset-bottom)`. Always visible (no dismiss).
**Notes:** Ctrl is a modifier with active state. All other keys write directly.

---

## Terminal Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Full-page (like LogPage) | Header + full viewport terminal | ✓ |
| Split view | Terminal alongside dashboard | |
| Embedded panel | Drawer/modal over dashboard | |

**Decision:** Full-page — same structural pattern as LogPage. Terminal fills `calc(100dvh - header - toolbar)`. Background matches xterm zinc-950 theme.
**Notes:** Split view deferred to v2.

---

## SSH Connection UX

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-reconnect | Reconnect automatically on disconnect | |
| Manual reconnect only | "Session ended" + Reconnect button | ✓ |
| Background reconnect with notification | Reconnect silently, notify user | |

**Decision:** Manual reconnect only. SSH sessions are stateful — auto-reconnect would start a fresh shell, losing context. Error state shows inline error with Retry button.
**Notes:** Connecting → Connected | Failed state machine. Spinner during connecting, inline error on failure.

---

## the agent's Discretion

- Toolbar scrollability on narrow screens (< 375px): horizontal scroll
- Exact xterm ANSI color palette values (0-15): standard terminal palette, zinc-aligned
- PTY output position relative to connecting overlay

## Deferred Ideas

- Split view / side-by-side dashboard + terminal → v2 desktop feature
- `docker exec` into container → future phase (EXEC-01/02 in v2 requirements)
- Multiple terminal tabs → v2 feature
- Terminal history persistence → future phase
