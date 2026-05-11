import { BrowserRouter, Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import StudyArea from "./pages/StudyArea";
import LoadingPage from "./pages/LoadingPage";
import LessonPage from "./pages/LessonPage";
import KnowledgeGraphPage from "./pages/KnowledgeGraphPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/study" element={<StudyArea />} />
        <Route path="/study/:runId" element={<StudyArea />} />
        <Route path="/load/:id" element={<LoadingPage />} />
        <Route path="/lesson/:id" element={<LessonPage />} />
        <Route path="/graphs/:id" element={<KnowledgeGraphPage />} />
      </Routes>
    </BrowserRouter>
  );
}
