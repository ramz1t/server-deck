import { Client } from 'ssh2'

export type SshAuthResult = 'ok' | 'auth_failed' | 'unreachable' | 'timeout'

export function validateSshCredentials(
  host: string,
  port: number,
  username: string,
  password: string
): Promise<SshAuthResult> {
  return new Promise<SshAuthResult>((resolve) => {
    const client = new Client()
    let settled = false

    function settle(result: SshAuthResult) {
      if (settled) return
      settled = true
      try { client.end() } catch { /* ignore */ }
      resolve(result)
    }

    client.on('ready', () => settle('ok'))

    client.on('error', (err: Error & { level?: string; code?: string }) => {
      if (err.level === 'client-authentication') {
        settle('auth_failed')
      } else if ((err as NodeJS.ErrnoException).code === 'ETIMEDOUT' || err.message?.includes('Timed out')) {
        settle('timeout')
      } else {
        settle('unreachable')
      }
    })

    client.connect({
      host,
      port,
      username,
      password,
      readyTimeout: 10000,
      keepaliveInterval: 0,
    })
  })
}
