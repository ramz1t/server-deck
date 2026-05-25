import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/axios'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Button } from '../components/ui/button'
import { Server, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react'

export function LoginPage() {
  const navigate = useNavigate()
  const [host, setHost] = useState(() => localStorage.getItem('sd_host') ?? '')
  const [port, setPort] = useState(() => localStorage.getItem('sd_port') ?? '22')
  const [username, setUsername] = useState(() => localStorage.getItem('sd_username') ?? '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get('/auth/me')
      .then(() => navigate('/', { replace: true }))
      .catch(() => {})
  }, [navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      await api.post('/auth/login', { host, port: Number(port), username, password })
      // Only persist convenience values after successful login (IN-02: don't overwrite correct values on failure)
      localStorage.setItem('sd_host', host)
      localStorage.setItem('sd_port', port)
      localStorage.setItem('sd_username', username)
      navigate('/')
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status
      if (status === 401) {
        setError('Invalid credentials. Check your username and password.')
      } else if (status === 429) {
        setError('Too many attempts. Wait a minute and try again.')
      } else if (status === 504) {
        setError('Connection timed out. Verify host and port are reachable.')
      } else if (status === 502) {
        setError('Host unreachable. Check the host address and port.')
      } else {
        setError('An unexpected error occurred. Please try again.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-svh flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1 pb-4">
          <div className="flex items-center gap-2">
            <Server size={20} className="text-primary" />
            <CardTitle className="text-2xl font-bold">ServerDeck</CardTitle>
          </div>
          <CardDescription>Connect to your server</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="host">Host</Label>
                <Input
                  id="host"
                  type="text"
                  className="text-base"
                  placeholder="192.168.1.100"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="url"
                  disabled={isLoading}
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  type="text"
                  className="text-base"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  disabled={isLoading}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  className="text-base"
                  placeholder="ubuntu"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="username"
                  disabled={isLoading}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    className="text-base pr-11"
                    autoComplete="current-password"
                    disabled={isLoading}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-11 w-11"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
              </div>

              {error && (
                <p className="text-sm text-destructive flex items-center gap-1.5" role="alert">
                  <AlertCircle size={14} />
                  {error}
                </p>
              )}

              <Button
                type="submit"
                className="w-full h-11"
                disabled={isLoading}
                aria-busy={isLoading ? 'true' : 'false'}
              >
                {isLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin mr-2" />
                    Connecting…
                  </>
                ) : (
                  'Connect'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default LoginPage
