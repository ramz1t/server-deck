import { useNavigate, useOutletContext, NavLink, Outlet } from 'react-router-dom'
import { Server, TerminalSquare, LogOut, LayoutGrid, BarChart2 } from 'lucide-react'
import { api } from '../lib/axios'
import { Button } from './ui/button'
import { PWAInstallBanner } from './PWAInstallBanner'

type AppContext = { host: string; username: string; port: string }

export function AppLayout() {
  const navigate = useNavigate()
  const { host, username, port } = useOutletContext<AppContext>()

  async function handleLogout() {
    try {
      await api.post('/auth/logout')
    } catch {
      // redirect regardless
    }
    navigate('/login')
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-1.5 px-3 h-11 text-sm font-medium border-b-2 transition-colors ${
      isActive
        ? 'border-white text-white'
        : 'border-transparent text-muted-foreground hover:text-white'
    }`

  return (
    <div className="min-h-svh flex flex-col bg-background">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-zinc-800 px-4">
        <div className="flex items-center justify-between max-w-screen-2xl mx-auto">
          {/* Logo + nav */}
          <div className="flex items-center gap-0 min-w-0">
            <div className="flex items-center gap-2 pr-4 py-3 shrink-0">
              <Server className="h-5 w-5 text-blue-500 shrink-0" />
              <div className="grid gap-0.5">
                <span className="font-semibold leading-none">ServerDeck</span>
                <span className="text-[9px] text-muted-foreground sm:hidden">
                  {username}@{host}:{port}
                </span>
              </div>
            </div>
            <span className="text-muted-foreground text-sm hidden sm:inline pr-4 shrink-0">
              {username}@{host}:{port}
            </span>
            <nav className="flex items-end gap-0">
              <NavLink to="/containers" className={navLinkClass}>
                <LayoutGrid className="h-4 w-4" />
                <span className="hidden sm:inline">Containers</span>
              </NavLink>
              <NavLink to="/stats" className={navLinkClass}>
                <BarChart2 className="h-4 w-4" />
                <span className="hidden sm:inline">Stats</span>
              </NavLink>
            </nav>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 rounded-none"
              onClick={() => navigate('/terminal')}
              aria-label="Terminal"
            >
              <TerminalSquare className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 rounded-none border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
              onClick={handleLogout}
              aria-label="Log out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <PWAInstallBanner />

      <Outlet context={{ host, username, port }} />
    </div>
  )
}
