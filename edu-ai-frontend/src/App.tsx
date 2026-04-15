import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import StudyArea from "./pages/StudyArea";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/study" replace />} />
        <Route path="/study" element={<StudyArea />} />
        <Route path="/study/:runId" element={<StudyArea />} />
      </Routes>
    </BrowserRouter>
  );
}
