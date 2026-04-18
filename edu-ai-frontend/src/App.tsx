import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import StudyArea from "./pages/StudyArea";
import LoadingPage from "./pages/LoadingPage";
import { HomePage } from "./pages/HomePage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="/study" element={<StudyArea />} />
        <Route path="/study/:runId" element={<StudyArea />} />
        <Route path="/load/:id" element={<LoadingPage />} />
      </Routes>
    </BrowserRouter>
  );
}
