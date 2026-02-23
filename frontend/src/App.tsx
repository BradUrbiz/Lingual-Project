import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { AuthProvider } from './contexts/AuthContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { LearningLocaleProvider } from './contexts/LearningLocaleContext';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { AppProtectedRoute } from './components/layout/AppProtectedRoute';
import {
  LandingPage,
  AuthPage,
  GeneralPage,
  AssessmentPage,
  CategoriesPage,
  ProfilePage,
  AppLearningPage,
  AppCurriculumPage,
  AppCurriculumModulePage,
  AppChatPage,
  AppGamesPage,
  AppProgressPage,
  AppProfilePage,
  AppSettingsPage,
  PronunciationPracticePage,
  TeacherDashboardPage,
} from './pages';

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        {/* Public Routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth" element={<AuthPage />} />

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          <Route path="/general" element={<GeneralPage />} />
          <Route path="/assessment" element={<AssessmentPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/chat" element={<Navigate to="/app/chat" replace />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>

        {/* App Shell Routes */}
        <Route path="/app" element={<AppProtectedRoute />}>
          <Route index element={<Navigate to="learn" replace />} />
          <Route path="learn" element={<AppLearningPage />} />
          <Route path="curriculum" element={<AppCurriculumPage />} />
          <Route path="curriculum/:moduleId" element={<AppCurriculumModulePage />} />
          <Route path="chat" element={<AppChatPage />} />
          <Route path="games" element={<AppGamesPage />} />
          <Route path="progress" element={<AppProgressPage />} />
          <Route path="practice" element={<PronunciationPracticePage />} />
          <Route path="profile" element={<AppProfilePage />} />
          <Route path="settings" element={<AppSettingsPage />} />
          <Route path="teacher" element={<TeacherDashboardPage />} />
        </Route>
      </Routes>
    </AnimatePresence>
  );
}

function App() {
  // Use /app as base path in production (when built with base: '/app/')
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '';

  return (
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <LanguageProvider>
          <LearningLocaleProvider>
            <AnimatedRoutes />
          </LearningLocaleProvider>
        </LanguageProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
