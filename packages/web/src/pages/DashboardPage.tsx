import { useNavigate, useOutletContext } from 'react-router-dom'
import { api } from '../lib/axios'
import { Button } from '../components/ui/button'

type DashboardContext = { host: string }

export function DashboardPage() {
  const navigate = useNavigate()
  const { host } = useOutletContext<DashboardContext>()

  async function handleLogout() {
    try {
      await api.post('/auth/logout')
    } catch {
      // even if logout fails, redirect to login
    }
    navigate('/login')
  }

  return (
    <div className="min-h-svh flex flex-col items-center justify-center gap-6 bg-background">
      <h1 className="text-2xl font-bold">ServerDeck</h1>
      <p className="text-muted-foreground">Connected to {host}</p>
      <Button variant="outline" className="h-11" onClick={handleLogout}>
        Log out
      </Button>
    </div>
  )
}

export default DashboardPage
