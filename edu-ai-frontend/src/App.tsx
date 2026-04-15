import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { HomePage } from './HomePage'
import StudyArea from './pages/StudyArea'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/study" element={<StudyArea />} />
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/study" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
