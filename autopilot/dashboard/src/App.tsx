import { BrowserRouter, Routes, Route } from 'react-router';
import { Layout } from './components/Layout.js';
import { Overview } from './pages/Overview.js';
import { QuestionResponse } from './pages/QuestionResponse.js';
import { PhaseDetail } from './pages/PhaseDetail.js';
import { LogViewer } from './pages/LogViewer.js';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="questions/:questionId" element={<QuestionResponse />} />
          <Route path="phases/:phaseNumber" element={<PhaseDetail />} />
          <Route path="logs" element={<LogViewer />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
