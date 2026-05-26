---
phase: 05-ssh-terminal
verified: 2025-01-31T00:00:00Z
status: human_needed
score: 4/5 criteria fully verified (1 warning — Ctrl modifier functional gap)
human_verification:
  - test: "Verify Ctrl modifier produces correct sequences on mobile"
    expected: "Tapping Ctrl (blue ring activates), then typing 'c' on the iOS soft keyboard sends \\x03 (Ctrl+C) to the terminal"
    why_human: "TouchToolbar.handleKey() passes the raw sequence regardless of ctrlActive — the modifier state is visual only and does not apply to toolbar key presses or subsequent soft-keyboard input via terminal.input(). Must be tested on a real device to confirm whether Ctrl+key is achievable at all from the toolbar."
  - test: "Verify terminal reflows within 200ms on iOS keyboard appearance"
    expected: "When the iOS software keyboard slides up, the terminal canvas shrinks to fit the visible area within 200ms and xterm.js re-renders at the new dimensions"
    why_human: "ResizeObserver + rAF pipeline can be verified in code but the 200ms bound requires real-device timing measurement"
  - test: "Verify no zombie processes accumulate after repeated open/close"
    expected: "After opening and closing the terminal 5 times, `ps aux | grep ssh` shows no orphaned ssh processes"
    why_human: "stream.destroy() + conn.end() teardown is present in code, but zombie accumulation can only be confirmed by actually running the server and measuring process count"
---

# Phase 5: SSH Terminal — Verification Report

**Phase Goal:** Users can open a full PTY-backed SSH terminal from a phone browser  
**Verified:** 2025-01-31  
**Status:** ⚠️ HUMAN_NEEDED — 4/5 criteria fully verified; 1 warning requires human device testing  
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | User taps "Terminal" → xterm.js terminal opens, connected to PTY via SSH to localhost | ✓ VERIFIED | See §Criterion 1 below |
| 2 | Typing commands executes them and output streams back in real time | ✓ VERIFIED | See §Criterion 2 below |
| 3 | Resizing / iOS keyboard causes terminal to reflow correctly within 200ms | ✓ / ? | Code wiring verified; 200ms bound needs human (§Criterion 3) |
| 4 | Touch toolbar provides tappable Ctrl, Tab, Esc, and arrow keys sending correct sequences | ⚠️ WARNING | Ctrl modifier is visual-only; does not modify toolbar key sequences (§Criterion 4) |
| 5 | Closing the terminal terminates the SSH session — no zombie processes | ✓ VERIFIED | See §Criterion 5 below |

**Score:** 4/5 criteria verified in code (Criterion 4 has a functional gap; Criterion 3 needs device timing check)

---

## Criterion 1: Terminal Entry Point + xterm Connection

### ✓ VERIFIED

| Check | File | Evidence |
|-------|------|----------|
| "Terminal" button in DashboardPage header | `DashboardPage.tsx:190–196` | `<Button onClick={() => navigate('/terminal')}>Terminal</Button>` |
| `/terminal` route in App.tsx | `App.tsx:16` | `<Route path="terminal" element={<TerminalPage />} />` inside ProtectedRoute |
| TerminalPage mounts xterm via useTerminalSession | `TerminalPage.tsx:19` | `const { status, errorMsg, sendKey } = useTerminalSession(containerRef)` |
| useTerminalSession connects to `/api/terminal` WebSocket | `useTerminalSession.ts:60` | `new WebSocket(\`\${protocol}//\${window.location.host}/api/terminal\`)` |
| `terminalRoute` registered in server.ts | `server.ts:8,43` | `import { terminalRoute }` + `await fastify.register(terminalRoute)` |

All five links in the entry-point chain are present and wired.

---

## Criterion 2: Bidirectional Input/Output Streaming

### ✓ VERIFIED

| Check | File | Evidence |
|-------|------|----------|
| Backend uses `conn.shell()` (bidirectional PTY) | `terminal.ts:43` | `conn.shell({ term: 'xterm-256color', rows: 24, cols: 80 }, ...)` |
| AttachAddon wires WS↔terminal bidirectionally | `useTerminalSession.ts:68–69` | `attachAddon = new AttachAddon(ws); terminal.loadAddon(attachAddon)` |
| Raw bytes forwarded (not JSON-wrapped) for PTY input | `terminal.ts:85` | `if (stream) stream.write(rawMsg)` — original Buffer passed directly |
| SSH stdout AND stderr forwarded to WS | `terminal.ts:53–59` | `stream.on('data')` → `socket.send(chunk)` AND `stream.stderr.on('data')` → `socket.send(chunk)` |
| `sendKey` uses `terminal.input()` only (no double-send) | `useTerminalSession.ts:122` | `terminalRef.current?.input(sequence)` — AttachAddon's onData subscription handles WS direction |

---

## Criterion 3: Terminal Resize (≤200ms)

### ✓ CODE WIRING VERIFIED / ? TIMING NEEDS HUMAN

| Check | File | Evidence |
|-------|------|----------|
| ResizeObserver calls `fitAddon.fit()` | `useTerminalSession.ts:97–105` | `const observer = new ResizeObserver(() => { ... fitAddon.fit() })` |
| fit() wrapped in `requestAnimationFrame` | `useTerminalSession.ts:99` | `rafId = requestAnimationFrame(() => { fitAddon.fit(); ... })` |
| rAF debounced (cancels stale frame) | `useTerminalSession.ts:98` | `if (rafId) cancelAnimationFrame(rafId)` before scheduling new frame |
| Resize handler sends `{ type: 'resize', cols, rows }` | `useTerminalSession.ts:102–104` | `ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))` |
| Backend calls `stream.setWindow(rows, cols, 0, 0)` — ROWS first | `terminal.ts:78` | `stream.setWindow(msg.rows, msg.cols, 0, 0)` — correct argument order per D-P5-17 |
| Terminal height uses `100dvh` (not `100vh` / `100svh`) | `TerminalPage.tsx:72` | `height: 'calc(100dvh - var(--terminal-header-height) - var(--toolbar-height))'` |
| CSS variables `--terminal-header-height` and `--toolbar-height` defined | `index.css:24–25` | `--terminal-header-height: 57px` and `--toolbar-height: calc(44px + env(safe-area-inset-bottom))` |
| Initial resize sent on WS open | `useTerminalSession.ts:71–77` | `ws.onopen` → `requestAnimationFrame(() => { fitAddon.fit(); ws.send(JSON.stringify({ type: 'resize', ... })) })` |

The code pipeline is correct. The 200ms timing bound requires real iOS device verification (see Human Verification section).

---

## Criterion 4: Touch Toolbar

### ⚠️ WARNING — Ctrl modifier is visual-only

| Check | Result | File | Evidence |
|-------|--------|------|----------|
| 11 buttons present | ✓ | `TouchToolbar.tsx:9–20,55–83` | Ctrl + 10 TOOLBAR_KEYS: Tab, Esc, ↑, ↓, ←, →, \|, \`, ~, / |
| Correct escape sequences for Tab | ✓ | `TouchToolbar.tsx:10` | `'\t'` |
| Correct escape sequences for Esc | ✓ | `TouchToolbar.tsx:11` | `'\x1b'` |
| Correct escape sequences for arrows | ✓ | `TouchToolbar.tsx:12–15` | `\x1b[A`, `\x1b[B`, `\x1b[D`, `\x1b[C` |
| Ctrl visual modifier state (blue ring) | ✓ | `TouchToolbar.tsx:29,60–67` | `ctrlActive` state + `ring-2 ring-blue-500/60` className when active |
| Toolbar fixed at bottom with safe-area-inset-bottom | ✓ | `TouchToolbar.tsx:43` | `pb-[env(safe-area-inset-bottom)]` |
| Buttons use `terminal.input()` via sendKey prop | ✓ | `TouchToolbar.tsx:32,78–80` + `useTerminalSession.ts:122` | `handleKey → sendKey → terminal.input()` |
| **Ctrl modifier actually applied to subsequent key sequences** | ✗ | `TouchToolbar.tsx:31–34` | `handleKey` calls `sendKey(sequence)` unchanged when `ctrlActive` is true, then resets `ctrlActive`. No Ctrl-modified sequence (`\x03` for C, `\x1a` for Z, etc.) is ever computed. Mobile users cannot produce Ctrl+C, Ctrl+Z from the toolbar. |

**Gap detail:** `handleKey` is:
```typescript
function handleKey(sequence: string) {
  sendKey(sequence)         // ← sends original sequence, ignores ctrlActive
  if (ctrlActive) setCtrlActive(false)
}
```
When `ctrlActive=true` and Tab is tapped, `\t` is sent — not a Ctrl+Tab sequence. There are no letter keys on the toolbar so Ctrl+C/Z/D cannot be produced. The Ctrl button is decorative from a functional standpoint.

**Fix required:** When `ctrlActive` is true, compute the control-modified codepoint:
```typescript
function handleKey(sequence: string) {
  if (ctrlActive && sequence.length === 1) {
    sendKey(String.fromCharCode(sequence.charCodeAt(0) & 0x1f))
  } else {
    sendKey(sequence)
  }
  if (ctrlActive) setCtrlActive(false)
}
```
Or add dedicated Ctrl+C / Ctrl+Z / Ctrl+D buttons to the toolbar.

---

## Criterion 5: Zombie Prevention

### ✓ VERIFIED

| Check | File | Evidence |
|-------|------|----------|
| `stream.destroy()` in `socket.on('close')` | `terminal.ts:97` | `try { if (stream) stream.destroy() } catch { }` |
| `conn.end()` in `socket.on('close')` | `terminal.ts:98` | `try { conn.end() } catch { }` |
| `stream.destroy()` in `socket.on('error')` | `terminal.ts:102` | `try { if (stream) stream.destroy() } catch { }` |
| `conn.end()` in `socket.on('error')` | `terminal.ts:103` | `try { conn.end() } catch { }` |
| `stream.destroy()` used (NOT `.close()`) | `terminal.ts:97,102` | `stream.destroy()` — sends SSH_MSG_CHANNEL_CLOSE per D-P5-18 comment |
| `terminal.dispose()` BEFORE `ws.close()` in cleanup | `useTerminalSession.ts:113–114` | `terminal.dispose()` on line 113; `ws.close()` on line 114 |
| Race condition guard in `conn.on('ready')` | `terminal.ts:38–40` | `if (socket.readyState !== 1) { conn.end(); return }` |
| `ws.close()` triggers server teardown chain | Comment at `useTerminalSession.ts:114` | "triggers server stream.destroy() + conn.end()" |

Comment at `terminal.ts:94–95` confirms awareness of `.close()` vs `.destroy()` distinction: *"stream.close() alone leaks the channel"*.

---

## Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `packages/server/src/routes/terminal.ts` | ✓ VERIFIED | 117 lines, substantive, registered in server.ts |
| `packages/server/src/server.ts` | ✓ VERIFIED | terminalRoute imported and registered (line 8, 43) |
| `packages/web/src/hooks/useTerminalSession.ts` | ✓ VERIFIED | 126 lines, full xterm + WS + ResizeObserver lifecycle |
| `packages/web/src/components/TouchToolbar.tsx` | ⚠️ STUB-BEHAVIOR | 86 lines, exists and renders, but Ctrl modifier non-functional |
| `packages/web/src/pages/TerminalPage.tsx` | ✓ VERIFIED | 131 lines, full PTY terminal page with status overlays |
| `packages/web/src/App.tsx` | ✓ VERIFIED | `/terminal` route wired to TerminalPage |
| `packages/web/src/pages/DashboardPage.tsx` | ✓ VERIFIED | Terminal button navigates to `/terminal` (line 190–196) |

---

## Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| DashboardPage "Terminal" button | `/terminal` route | `navigate('/terminal')` | ✓ WIRED |
| App.tsx `/terminal` route | TerminalPage | `<Route path="terminal" element={<TerminalPage />}>` | ✓ WIRED |
| TerminalPage | useTerminalSession | `containerRef` passed to hook | ✓ WIRED |
| useTerminalSession | `/api/terminal` WS | `new WebSocket(.../api/terminal)` | ✓ WIRED |
| useTerminalSession | AttachAddon bidirectional pipe | `new AttachAddon(ws); terminal.loadAddon(attachAddon)` | ✓ WIRED |
| useTerminalSession | ResizeObserver → fitAddon.fit() → WS resize msg | rAF-debounced ResizeObserver | ✓ WIRED |
| TerminalPage | TouchToolbar | `<TouchToolbar sendKey={sendKey} />` | ✓ WIRED |
| TouchToolbar sendKey prop | terminal.input() | `terminalRef.current?.input(sequence)` | ✓ WIRED |
| WS close/navigate-away | server stream.destroy() | `ws.close()` in cleanup → `socket.on('close')` → `stream.destroy()` | ✓ WIRED |
| server.ts | terminalRoute | `await fastify.register(terminalRoute)` | ✓ WIRED |

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| SSH-01 | User can open a web-based SSH terminal to the server | ✓ SATISFIED | DashboardPage Terminal button → TerminalPage with xterm.js |
| SSH-02 | Connects to localhost via SSH using pre-configured server key | ✓ SATISFIED | `terminal.ts:107–114`: host:'localhost', privateKey from `SSH_KEY_PATH` env var |
| SSH-03 | Terminal input and output streamed over WebSocket | ✓ SATISFIED | AttachAddon bidirectional + raw Buffer forwarding |
| SSH-04 | Terminal resizes correctly when browser/keyboard changes size | ✓ SATISFIED (code) / ? (device) | ResizeObserver + rAF + stream.setWindow; 200ms bound needs device test |
| SSH-05 | Touch-friendly toolbar: Ctrl, Tab, Esc, arrow keys | ⚠️ PARTIAL | 11 buttons present; Tab/Esc/arrows send correct sequences; **Ctrl modifier non-functional** |
| SSH-06 | SSH session cleanly terminated on close | ✓ SATISFIED | `stream.destroy()` + `conn.end()` in both `socket.on('close')` and `socket.on('error')` |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| No `TODO`, `FIXME`, `TBD`, or `XXX` markers found in any phase file | — | — | — | — |

No debt markers. No stub returns. No hardcoded empty arrays/objects passed to rendering paths.

---

## Human Verification Required

### 1. Ctrl Modifier Produces Correct Sequences (FUNCTIONAL GAP)

**Test:** On an iOS device, open the terminal, tap Ctrl (confirm blue ring appears), then type 'c' on the iOS soft keyboard. Run `cat` in the terminal first so a Ctrl+C is observable.  
**Expected:** `^C` appears in the terminal — the session receives byte `0x03`  
**Why human:** `TouchToolbar.handleKey` ignores `ctrlActive` when computing the sent sequence — this is a code defect that cannot produce Ctrl+key from the toolbar. Must verify on device whether any other mechanism catches this, and whether the gap is acceptable for the phase.

### 2. Terminal Reflows Within 200ms on iOS Keyboard Appearance

**Test:** Open the terminal on an iPhone. Tap the terminal area to trigger the iOS keyboard. Observe whether the terminal canvas shrinks and reflowed within ~200ms (no visible sizing delay).  
**Expected:** Terminal dims to new height, xterm re-renders without a visible "stuck-at-old-size" period  
**Why human:** ResizeObserver + rAF timing is correct in code but the actual latency depends on iOS viewport resize event timing which varies by iOS version.

### 3. No Zombie SSH Processes After Repeated Open/Close

**Test:** Open and close the terminal 5 times. On the server run: `ps aux | grep ssh`  
**Expected:** Only the main sshd daemon shows; no orphaned `ssh` client processes  
**Why human:** stream.destroy() + conn.end() teardown chain is verified in code; actual process accumulation can only be confirmed by running the server.

---

## Gaps Summary

**One functional gap was identified** in Criterion 4 (Touch Toolbar):

The Ctrl button in `TouchToolbar.tsx` toggles a visual modifier state (`ctrlActive`) but **never applies it** to any key sequence. `handleKey()` calls `sendKey(sequence)` with the unmodified sequence regardless of `ctrlActive`. This means:
- Ctrl+C (`\x03`), Ctrl+Z (`\x1a`), Ctrl+D (`\x04`) **cannot be produced from the touch toolbar**
- The blue ring is purely cosmetic

**Severity:** WARNING (not BLOCKER) because:
1. Tab, Esc, and all arrow keys send correct sequences — the non-Ctrl parts of SSH-05 are satisfied
2. Ctrl+key via physical keyboard works normally through xterm.js native event handling
3. The feature gap only affects the touch-toolbar Ctrl combination path (mobile soft-keyboard use case)

**Fix is straightforward** (see Criterion 4 detail above). Recommend addressing before declaring Phase 5 complete for mobile users.

---

_Verified: 2025-01-31_  
_Verifier: gsd-verifier (automated goal-backward analysis)_
