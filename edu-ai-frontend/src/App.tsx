import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { HomePage } from "./HomePage";
import StudyArea from "./pages/StudyArea";
import LoadingPage from "./pages/LoadingPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/study" element={<StudyArea />} />
        <Route path="/study/:runId" element={<StudyArea />} />
        <Route path="/load/:id" element={<LoadingPage />} />
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/study" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
