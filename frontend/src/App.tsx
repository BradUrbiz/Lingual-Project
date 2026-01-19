import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import {
  LandingPage,
  AuthPage,
  GeneralPage,
  AssessmentPage,
  CategoriesPage,
  ChatPage,
} from './pages';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LanguageProvider>
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/auth" element={<AuthPage />} />

            {/* Protected Routes */}
            <Route element={<ProtectedRoute />}>
              <Route path="/general" element={<GeneralPage />} />
              <Route path="/assessment" element={<AssessmentPage />} />
              <Route path="/categories" element={<CategoriesPage />} />
              <Route path="/chat" element={<ChatPage />} />
            </Route>
          </Routes>
        </LanguageProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
