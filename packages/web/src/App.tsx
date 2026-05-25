import { BrowserRouter, Routes, Route } from 'react-router-dom'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<div>Login placeholder</div>} />
        <Route path="/" element={<div>Dashboard placeholder</div>} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
