import { Client } from 'ssh2'
import type { SessionData } from '../types/session.js'

export interface ContainerInfo {
  id: string
  shortId: string
  names: string[]
  image: string
  status: string      // human-readable: "Up 2 hours"
  state: string       // machine-readable: "running", "exited", "paused", "created", "restarting", "dead"
  createdAt: string
}

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
      try { client.end() } catch { /* ignore */ }
      if (err) reject(err)
      else resolve(out)
    }

    client.on('ready', () => {
      client.exec(command, (err, stream) => {
        if (err) return settle(err, '')
        stream.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
        stream.stderr.on('data', () => { /* ignore stderr */ })
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
  const raw = await sshExec(session, `docker ps -a --no-trunc --format '{{json .}}'`)
  const results: ContainerInfo[] = []
  for (const line of raw.trim().split('\n')) {
    if (!line.trim()) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line)
    } catch {
      // Skip non-JSON lines (e.g. Docker daemon warnings) rather than failing the whole list (WR-01)
      continue
    }
    const names = (obj.Names as string)
      .split(',')
      .map((n: string) => n.replace(/^\//, '').trim())
    results.push({
      id: obj.ID as string,
      shortId: (obj.ID as string).slice(0, 12),
      names,
      image: obj.Image as string,
      status: obj.Status as string,
      state: (obj.State as string).toLowerCase(),
      createdAt: obj.CreatedAt as string,
    })
  }
  return results
}

export async function startContainer(session: SessionData, id: string): Promise<void> {
  // Defense-in-depth: validate ID at service layer too (CR-01)
  if (!isValidContainerId(id)) throw new Error(`Invalid container ID: ${id}`)
  await sshExec(session, `docker start ${id}`)
}

export async function stopContainer(session: SessionData, id: string): Promise<void> {
  if (!isValidContainerId(id)) throw new Error(`Invalid container ID: ${id}`)
  await sshExec(session, `docker stop ${id}`)
}

export async function restartContainer(session: SessionData, id: string): Promise<void> {
  if (!isValidContainerId(id)) throw new Error(`Invalid container ID: ${id}`)
  await sshExec(session, `docker restart ${id}`)
}
