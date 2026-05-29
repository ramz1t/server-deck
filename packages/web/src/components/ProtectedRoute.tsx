import { useState, useEffect } from 'react'
import { Outlet, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { api } from '../lib/axios'

type AuthState = 'loading' | 'authenticated' | 'unauthenticated'

export function ProtectedRoute() {
  const [authState, setAuthState] = useState<AuthState>('loading')
  const [host, setHost] = useState('')
  const [username, setUsername] = useState('')
  const [port, setPort] = useState('')

  useEffect(() => {
    api.get('/auth/me')
      .then((response) => {
        setHost(response.data.host)
        setUsername(response.data.username)
        setPort(String(response.data.port ?? ''))
        setAuthState('authenticated')
      })
      .catch(() => {
        setAuthState('unauthenticated')
      })
  }, [])

  if (authState === 'loading') {
    return (
      <div className="min-h-svh flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (authState === 'unauthenticated') {
    return <Navigate to="/login" replace />
  }

  return <Outlet context={{ host, username, port }} />
}

export default ProtectedRoute
