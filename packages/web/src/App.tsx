import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { LoginPage } from './pages/LoginPage'
import { ContainersPage } from './pages/ContainersPage'
import { StatsPage } from './pages/StatsPage'
import { DomainsPage } from './pages/DomainsPage'
import { LogPage } from './pages/LogPage'
import { TerminalPage } from './pages/TerminalPage'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AppLayout } from './components/AppLayout'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/containers" replace />} />
            <Route path="containers" element={<ContainersPage />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="domains" element={<DomainsPage />} />
            <Route path="terminal" element={<TerminalPage />} />
          </Route>
          <Route path="logs/:containerId" element={<LogPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
