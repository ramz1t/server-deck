# ServerDeck

> **Note:** This repository is a test playground for [GSD (Get Shit Done)](https://github.com/open-gsd/gsd-core) — an AI-driven development workflow. The app itself is real and functional, but the primary purpose of this repo is to exercise GSD's plan/execute/verify cycle.

A mobile-friendly personal server dashboard for monitoring Docker containers and SSH terminal access — built to look good on your phone.

![Stack](https://img.shields.io/badge/Fastify_5-black?logo=fastify) ![Stack](https://img.shields.io/badge/React_19-black?logo=react) ![Stack](https://img.shields.io/badge/Tailwind_v4-black?logo=tailwindcss)

## Features

- **Docker dashboard** — live container status, start / stop / restart actions, grouped by compose project
- **Real-time updates** — container state changes appear instantly via WebSocket (no refresh needed)
- **Live log streaming** — tail any container's logs with ANSI colour support
- **SSH terminal** — full PTY shell in the browser with a mobile touch toolbar (Ctrl, Tab, Esc, arrows)
- **Mobile-first** — designed for a 390 px phone screen, installable as a PWA

---

## Requirements

### On your server

- **Node.js 20+** and **pnpm 9+**
- **Docker** running (the app connects via SSH and runs `docker` commands)
- **sshd** listening on port 22 (standard on most Linux servers)
- A user with permission to run `docker` commands (either root or in the `docker` group)

### On your local machine (development only)

- Node.js 20+ and pnpm 9+

---

## Setup

### 1. Clone and install

```bash
git clone <your-repo-url> serverdeck
cd serverdeck
pnpm install
```

### 2. Configure the server

Copy the example env file:

```bash
cp packages/server/.env.example packages/server/.env
```

Edit `packages/server/.env`:

```env
PORT=3001
JWT_SECRET=          # generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
LOG_LEVEL=info
```

**Generate a strong JWT secret:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

That's it — no additional SSH key setup needed. The terminal reuses the same SSH password you log in with.

---

## Running

### Development (local machine)

Starts both the API server (port 3001) and the Vite dev server (port 5173) with hot reload:

```bash
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) and log in with your server's SSH credentials.

### Production (on your server)

**Build:**

```bash
pnpm build
```

**Start:**

```bash
# From the repo root
node packages/server/dist/index.js
```

Or with a process manager (recommended):

```bash
# Using PM2
pm2 start packages/server/dist/index.js --name serverdeck
pm2 save
```

The built frontend (`packages/web/dist/`) is served statically by the Fastify server on the same port — no separate web server needed.

---

## Login

Open the app in your browser and enter your **server's SSH credentials**:

| Field    | Value                                              |
| -------- | -------------------------------------------------- |
| Host     | your server's IP or hostname (e.g. `192.168.1.10`) |
| Port     | SSH port, usually `22`                             |
| Username | your Linux username                                |
| Password | your Linux password (or SSH password)              |

The app validates the credentials by attempting an SSH connection — no separate user database.

---

## Docker group (if you see "permission denied" errors)

If the app can connect but can't list containers, your user may not have Docker access:

```bash
sudo usermod -aG docker $USER
# Log out and back in for the change to take effect
```

---

## Environment variables reference

| Variable     | Required           | Description                                                  |
| ------------ | ------------------ | ------------------------------------------------------------ |
| `PORT`       | No (default: 3001) | Port the server listens on                                   |
| `JWT_SECRET` | **Yes**            | Secret for signing session cookies — must be long and random |
| `LOG_LEVEL`  | No (default: info) | Fastify log level: `trace`, `debug`, `info`, `warn`, `error` |

---

## Deploying behind a reverse proxy (nginx / Caddy)

WebSocket connections (`/api/terminal`, `/api/containers/events`, `/api/containers/*/logs`) require proper proxy headers. Minimal nginx snippet:

```nginx
location / {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

---

## Project structure

```
serverdeck/
├── packages/
│   ├── server/          # Fastify 5 API + WebSocket server
│   │   ├── src/
│   │   │   ├── routes/  # auth, containers, events, logs, terminal
│   │   │   ├── services/ # docker-ssh, ssh-auth, session-store
│   │   │   └── middleware/
│   │   └── .env         # ← your config goes here
│   └── web/             # React 19 + Tailwind v4 frontend
│       └── src/
│           ├── pages/   # Dashboard, LogPage, TerminalPage
│           ├── hooks/   # useContainerEvents, useLogStream, useTerminalSession
│           └── components/
└── package.json         # pnpm workspace root
```
