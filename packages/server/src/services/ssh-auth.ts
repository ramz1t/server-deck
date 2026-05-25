import { Client } from 'ssh2'

export function validateSshCredentials(
  host: string,
  port: number,
  username: string,
  password: string
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const client = new Client()

    client.on('ready', () => {
      client.end()
      resolve(true)
    })

    client.on('error', () => {
      resolve(false)
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
