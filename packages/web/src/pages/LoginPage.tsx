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
  const [serverHost, setServerHost] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get('/auth/me')
      .then(() => navigate('/', { replace: true }))
      .catch(() => {})
  }, [navigate])

  useEffect(() => {
    const controller = new AbortController()
    api.get<{ host: string }>('/config', { signal: controller.signal })
      .then(({ data }) => setServerHost(data.host ?? ''))
      .catch(() => {})
    return () => controller.abort()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      await api.post('/auth/login', { password })
      navigate('/')
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status
      if (status === 401) {
        setError('Invalid credentials. Check your password.')
      } else if (status === 429) {
        setError('Too many attempts. Wait a minute and try again.')
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
            <CardTitle className="text-2xl font-bold">
              {serverHost ? `${serverHost} ServerDeck` : 'ServerDeck'}
            </CardTitle>
          </div>
          <CardDescription>Enter your password to connect</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
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
