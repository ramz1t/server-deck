# Phase 4: Log Streaming — Discussion Log

**Date:** 2026-05-25
**Mode:** auto (user unavailable — autonomous decisions)
**Areas discussed:** 6

---

## Area 1: Log Entry Point

**Question asked:** Where/how does the user open a log view from the dashboard?

**Options considered:**
- Tap the container card body (ambiguous on mobile, conflicts with expansion)
- Dedicated "Logs" button in the card action area
- Long-press gesture (not accessible on desktop)

**Decision:** Dedicated "Logs" button on ContainerCard actions area → navigates to `/logs/:containerId`

**Rationale:** Touch-safe, unambiguous intent, consistent with existing button-based actions (Start/Stop/Restart).

---

## Area 2: Log View Layout

**Question asked:** Full page route, bottom sheet, or inline expansion?

**Options considered:**
- Bottom sheet / drawer: mobile-friendly slide-up, but limited height, competes with keyboard
- Inline expansion in ContainerCard: cramped, hard to read logs
- Full-page route `/logs/:containerId`: maximum screen space, natural back navigation

**Decision:** Full-page route `/logs/:containerId` with back button to dashboard

**Rationale:** Log viewing benefits from full-screen real estate on mobile. React Router's browser history handles back navigation naturally.

---

## Area 3: ANSI Renderer

**Question asked:** `ansi-to-html`, `xterm.js`, or plain text stripping?

**Options considered:**
- `xterm.js`: powerful PTY emulator, but heavyweight; already planned for Phase 5 SSH terminal; overkill for read-only log display
- Plain text strip: fast but loses color information (violates success criterion 3)
- `ansi-to-html`: lightweight, CSS-based color spans, no DOM overhead of a full terminal emulator

**Decision:** `ansi-to-html` for Phase 4; `xterm.js` reserved for Phase 5

**Rationale:** Consistent with YAGNI — use the minimal tool that satisfies the requirement. Avoids two separate xterm.js instances if both log view and SSH terminal were open simultaneously.

---

## Area 4: Scroll Behavior

**Question asked:** Always auto-scroll or smart pause-on-scroll?

**Options considered:**
- Always auto-scroll: simple, but frustrating if user tries to read older lines
- No auto-scroll: user manually scrolls, misses new lines
- Smart auto-scroll: auto-scroll to bottom, pause when user scrolls up, resume button

**Decision:** Smart auto-scroll with 50px threshold and floating "↓ Resume" button

**Rationale:** Standard UX for log viewers (e.g., Portainer, Lens, k9s). Prevents user frustration. 50px threshold tolerates minor scroll jitter.

---

## Area 5: WS Architecture

**Question asked:** One WS per log view vs shared/multiplexed?

**Options considered:**
- Shared WS with container ID in message: complex multiplexing, shared lifecycle issues
- One WS per log view with container ID in URL: simple 1-to-1 pipe, independent lifecycle

**Decision:** One WS per log view: `GET /api/containers/:id/logs` → SSH exec → WS pipe

**Rationale:** Simplest architecture. Multiple log views rarely open simultaneously. Container ID in URL path allows server-side validation with `isValidContainerId()` before SSH exec.

---

## Area 6: Memory Management

**Question asked:** Should in-memory lines be capped?

**Decision:** Cap at 5,000 lines — drop oldest when exceeded

**Rationale:** Very verbose containers (e.g., web servers with access logs) can produce thousands of lines per minute. Uncapped growth would degrade browser performance on mobile. 5,000 lines provides ~60 seconds of fast-logging context before pruning begins.

---

## Deferred Ideas

- Log search/filter
- Log download
- Timestamps toggle
- Configurable tail size

---

*[auto mode — all decisions made autonomously; user to review before planning]*
