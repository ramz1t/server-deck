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

export async function deleteContainer(session: SessionData, id: string): Promise<void> {
  if (!isValidContainerId(id)) throw new Error(`Invalid container ID: ${id}`)
  await sshExec(session, `docker rm ${id}`)
}

// ── Server Stats (STATS-01–04) ────────────────────────────────────────────────

export interface ServerStats {
  disk: {
    filesystem: string
    total: number      // bytes
    used: number       // bytes
    available: number  // bytes
    usePercent: number // 0-100
  }
  ram: {
    total: number      // bytes
    used: number       // bytes
    available: number  // bytes
    usePercent: number // 0-100
  }
  uptime: {
    seconds: number    // floor of /proc/uptime first field
    human: string      // e.g. "14d 6h 32m" | "3h 5m" | "47m"
  }
  mntSdb: Array<{
    name: string       // basename only, e.g. "data"
    bytes: number
    human: string      // e.g. "12.3 GB"
  }> | null            // null when /mnt/sdb is absent or empty
}

// Single combined command — semicolons (not &&) so every section runs regardless.
// ; true at the end guarantees exit code 0 even if du finds nothing.
const STATS_CMD =
  "echo '__DISK__'; df -B1 /; " +
  "echo '__RAM__'; free -b; " +
  "echo '__UPTIME__'; cat /proc/uptime; " +
  "echo '__MNT__'; du -sb /mnt/sdb/* 2>/dev/null; " +
  "echo '__END__'; true"

// 30-second in-memory cache — stats don't change meaningfully in 30 s.
// Cache is session-agnostic: all callers share the same server stats.
let _statsCache: { data: ServerStats; expiresAt: number } | null = null
const STATS_CACHE_TTL = 30_000

function _splitSections(raw: string): Record<string, string> {
  const MARKERS = ['__DISK__', '__RAM__', '__UPTIME__', '__MNT__', '__END__']
  const sections: Record<string, string> = {}
  let current = ''
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (MARKERS.includes(trimmed)) {
      current = trimmed
      sections[current] = ''
    } else if (current && current !== '__END__') {
      sections[current] = (sections[current] ?? '') + line + '\n'
    }
  }
  return sections
}

function _formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function _parseDisk(section: string): ServerStats['disk'] {
  // Join all non-header lines to handle long LVM device names that wrap onto the next line
  const lines = section.trim().split('\n').filter(Boolean)
  const data = lines.slice(1).join(' ').trim()
  const parts = data.split(/\s+/)
  // parts: [filesystem, 1B-blocks, used, available, use%, mountpoint]
  const total = parseInt(parts[1], 10)
  const used = parseInt(parts[2], 10)
  const available = parseInt(parts[3], 10)
  const usePercent = parseInt(parts[4], 10) // parseInt strips trailing %
  if (!parts[0] || isNaN(total) || isNaN(used) || isNaN(available) || isNaN(usePercent)) {
    throw new Error(`Failed to parse disk section: ${JSON.stringify(parts)}`)
  }
  return { filesystem: parts[0], total, used, available, usePercent }
}

function _parseRam(section: string): ServerStats['ram'] {
  const lines = section.trim().split('\n').filter(Boolean)
  const memLine = lines.find((l) => l.startsWith('Mem:'))
  if (!memLine) throw new Error('Mem: line not found in free -b output')
  const parts = memLine.split(/\s+/)
  // parts: ['Mem:', total, used, free, shared, buff/cache, available]
  const total = parseInt(parts[1], 10)
  const used = parseInt(parts[2], 10)
  const available = parseInt(parts[6], 10)
  if (isNaN(total) || isNaN(used) || isNaN(available)) {
    throw new Error(`Failed to parse RAM section: ${JSON.stringify(parts)}`)
  }
  return {
    total,
    used,
    available,
    usePercent: Math.round((used / total) * 100),
  }
}

function _parseUptime(section: string): ServerStats['uptime'] {
  const raw = section.trim().split(/\s+/)[0]
  const seconds = Math.floor(parseFloat(raw))
  if (isNaN(seconds)) throw new Error(`Failed to parse uptime: ${JSON.stringify(raw)}`)
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  parts.push(`${minutes}m`)
  return { seconds, human: parts.join(' ') }
}

function _parseMntSdb(section: string): ServerStats['mntSdb'] {
  const lines = section.trim().split('\n').filter(Boolean)
  if (lines.length === 0) return null
  return lines.map((line) => {
    const [bytesStr, fullPath] = line.split('\t')
    const bytes = parseInt(bytesStr, 10)
    const name = (fullPath ?? '').split('/').pop() ?? fullPath
    return { name, bytes, human: _formatBytes(bytes) }
  })
}

function _parseStats(raw: string): ServerStats {
  const s = _splitSections(raw)
  return {
    disk: _parseDisk(s['__DISK__'] ?? ''),
    ram: _parseRam(s['__RAM__'] ?? ''),
    uptime: _parseUptime(s['__UPTIME__'] ?? ''),
    mntSdb: _parseMntSdb(s['__MNT__'] ?? ''),
  }
}

export async function getServerStats(session: SessionData): Promise<ServerStats> {
  if (_statsCache && Date.now() < _statsCache.expiresAt) {
    return _statsCache.data
  }
  const raw = await sshExec(session, STATS_CMD)
  const data = _parseStats(raw)
  _statsCache = { data, expiresAt: Date.now() + STATS_CACHE_TTL }
  return data
}
