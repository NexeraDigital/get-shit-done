import { BrowserRouter, Routes, Route } from 'react-router';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div>Dashboard Home</div>} />
        <Route path="questions/:questionId" element={<div>Question Detail</div>} />
        <Route path="phases/:phaseNumber" element={<div>Phase Detail</div>} />
        <Route path="logs" element={<div>Logs</div>} />
      </Routes>
    </BrowserRouter>
  );
}
