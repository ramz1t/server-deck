---
phase: 2
plan: 1
name: docker-api
wave: 1
title: Docker SSH service + REST container routes
---

# Plan 02-01: Docker SSH Service + REST Routes

## Goal
Add a Docker SSH execution service and REST endpoints for listing containers and performing start/stop/restart actions. All endpoints are automatically protected by the Phase 1 preHandler.

## Files to Create / Modify

### New Files
- `packages/server/src/services/docker-ssh.ts` — SSH exec Docker client
- `packages/server/src/routes/containers.ts` — container REST endpoints

### Modified Files
- `packages/server/src/server.ts` — register container routes
- `packages/server/src/types/session.ts` — ensure session request augmentation is accessible

## Tasks

### Task 1: Install server dependencies
```bash
cd packages/server
pnpm add dockerode  # not used directly but keeping for Phase 3
# No new deps needed — ssh2 already installed
```
Actually: **no new server dependencies needed**. ssh2 is already installed.

### Task 2: Create `packages/server/src/services/docker-ssh.ts`

```typescript
import { Client } from 'ssh2'
import type { SessionData } from '../types/session.js'

export interface ContainerInfo {
  id: string
  shortId: string
  names: string[]
  image: string
  status: string      // human-readable: "Up 2 hours", "Exited (0) 3 days ago"
  state: string       // machine-readable: "running", "exited", "paused", "created", "restarting", "dead"
  createdAt: string   // ISO string
}

// Container ID must be 12–64 hex chars (Docker short or full ID)
const CONTAINER_ID_RE = /^[a-zA-Z0-9]{12,64}$/

export function isValidContainerId(id: string): boolean {
  return CONTAINER_ID_RE.test(id)
}

async function sshExec(session: SessionData, command: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const client = new Client()
    let stdout = ''
    let settled = false

    function settle(err: Error | null, out: string) {
      if (settled) return
      settled = true
      client.end()
      if (err) reject(err)
      else resolve(out)
    }

    client.on('ready', () => {
      client.exec(command, (err, stream) => {
        if (err) return settle(err, '')
        stream.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
        stream.stderr.on('data', () => { /* ignore */ })
        stream.on('close', (code: number) => {
          if (code !== 0) settle(new Error(`docker command exited with code ${code}`), '')
          else settle(null, stdout)
        })
      })
    })

    client.on('error', (err) => settle(err, ''))

    client.connect({
      host: session.host,
      port: session.port,
      username: session.username,
      password: session.password,
      readyTimeout: 10_000,
      keepaliveInterval: 0,
    })
  })
}

export async function listContainers(session: SessionData): Promise<ContainerInfo[]> {
  // docker ps -a --format '{{json .}}' outputs one JSON object per line (NDJSON)
  const raw = await sshExec(
    session,
    `docker ps -a --no-trunc --format '{{json .}}'`
  )

  return raw
    .trim()
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const obj = JSON.parse(line)
      // docker format keys: ID, Names, Image, Status, State, CreatedAt
      const names = (obj.Names as string)
        .split(',')
        .map((n: string) => n.replace(/^\//, '').trim())
      return {
        id: obj.ID as string,
        shortId: (obj.ID as string).slice(0, 12),
        names,
        image: obj.Image as string,
        status: obj.Status as string,
        state: (obj.State as string).toLowerCase(),
        createdAt: obj.CreatedAt as string,
      }
    })
}

export async function startContainer(session: SessionData, id: string): Promise<void> {
  await sshExec(session, `docker start ${id}`)
}

export async function stopContainer(session: SessionData, id: string): Promise<void> {
  await sshExec(session, `docker stop ${id}`)
}

export async function restartContainer(session: SessionData, id: string): Promise<void> {
  await sshExec(session, `docker restart ${id}`)
}
```

### Task 3: Create `packages/server/src/routes/containers.ts`

```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import {
  listContainers,
  startContainer,
  stopContainer,
  restartContainer,
  isValidContainerId,
} from '../services/docker-ssh.js'
import type { SessionData } from '../types/session.js'

type ActionParams = { id: string }

function getSession(request: FastifyRequest): SessionData {
  return (request as unknown as { session: SessionData }).session
}

export async function containerRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/containers', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = getSession(request)
    try {
      const containers = await listContainers(session)
      return containers
    } catch (err) {
      fastify.log.error(err, 'Failed to list containers')
      return reply.status(502).send({ error: 'Failed to connect to Docker on target server' })
    }
  })

  for (const action of ['start', 'stop', 'restart'] as const) {
    fastify.post<{ Params: ActionParams }>(
      `/api/containers/:id/${action}`,
      async (request: FastifyRequest<{ Params: ActionParams }>, reply: FastifyReply) => {
        const { id } = request.params
        if (!isValidContainerId(id)) {
          return reply.status(400).send({ error: 'Invalid container ID' })
        }
        const session = getSession(request)
        try {
          if (action === 'start') await startContainer(session, id)
          else if (action === 'stop') await stopContainer(session, id)
          else await restartContainer(session, id)
          return { ok: true }
        } catch (err) {
          fastify.log.error(err, `Failed to ${action} container ${id}`)
          return reply.status(502).send({ error: `Failed to ${action} container` })
        }
      }
    )
  }
}
```

### Task 4: Register container routes in `packages/server/src/server.ts`

Add after `await fastify.register(authRoutes)`:
```typescript
import { containerRoutes } from './routes/containers.js'
// ...
await fastify.register(containerRoutes)
```

## Verification

After implementation:
```bash
# Start server
cd packages/server && npx tsx src/index.ts

# Check TypeScript
npx tsc --noEmit

# Test endpoint protection (should return 401, not 404)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/containers
# Expected: 401

# Test invalid ID rejection
curl -s -X POST http://localhost:3001/api/containers/../../etc/passwd/start
# Expected: 401 (auth gate fires first)
```

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Command injection via container ID | `isValidContainerId()` validates `[a-zA-Z0-9]{12,64}` before use in shell |
| Unauthenticated Docker access | Global `verifyAuth` preHandler protects all `/api/*` routes (Phase 1) |
| SSH credentials in API response | Container routes return container data only; session retrieved server-side |
| Docker daemon unavailable on Server B | Returns 502 with descriptive error; no crash |
