import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { LogPage } from './pages/LogPage'
import { TerminalPage } from './pages/TerminalPage'
import { ProtectedRoute } from './components/ProtectedRoute'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<ProtectedRoute />}>
          <Route index element={<DashboardPage />} />
          <Route path="logs/:containerId" element={<LogPage />} />
          <Route path="terminal" element={<TerminalPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
