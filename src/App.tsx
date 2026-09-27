import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import CatalogPage from './pages/CatalogPage';
import AdminPage from './pages/AdminPage';
import JwtDebuggerPage from './pages/JwtDebuggerPage';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<CatalogPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/jwt" element={<JwtDebuggerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
