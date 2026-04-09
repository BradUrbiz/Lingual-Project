import { Suspense, lazy, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { AuthProvider } from './contexts/AuthContext';
import { MembershipProvider } from './contexts/MembershipContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { LearningLocaleProvider } from './contexts/LearningLocaleContext';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { AppProtectedRoute } from './components/layout/AppProtectedRoute';
import { TeacherRoute } from './components/layout/TeacherRoute';
import { LingualAdminRoute } from './components/layout/LingualAdminRoute';
import { LoadingSpinner } from './components/common';

const LandingPage = lazy(() => import('./pages/LandingPage').then((module) => ({ default: module.LandingPage })));
const AuthPage = lazy(() => import('./pages/AuthPage').then((module) => ({ default: module.AuthPage })));
const GeneralPage = lazy(() => import('./pages/GeneralPage').then((module) => ({ default: module.GeneralPage })));
const InitialOnboardingPage = lazy(() => import('./pages/InitialOnboardingPage').then((module) => ({ default: module.InitialOnboardingPage })));
const SchoolRequestPage = lazy(() => import('./pages/SchoolRequestPage').then((module) => ({ default: module.SchoolRequestPage })));
const LingualSchoolRequestsPage = lazy(() => import('./pages/LingualSchoolRequestsPage').then((module) => ({ default: module.LingualSchoolRequestsPage })));
const AssessmentPage = lazy(() => import('./pages/AssessmentPage').then((module) => ({ default: module.AssessmentPage })));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage').then((module) => ({ default: module.CategoriesPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })));
const AppLearningPage = lazy(() => import('./pages/AppLearningPage').then((module) => ({ default: module.AppLearningPage })));
const AppCurriculumPage = lazy(() => import('./pages/AppCurriculumPage').then((module) => ({ default: module.AppCurriculumPage })));
const AppCurriculumModulePage = lazy(() => import('./pages/AppCurriculumModulePage').then((module) => ({ default: module.AppCurriculumModulePage })));
const AppChatPage = lazy(() => import('./pages/AppChatPage').then((module) => ({ default: module.AppChatPage })));
const AppGamesPage = lazy(() => import('./pages/AppGamesPage').then((module) => ({ default: module.AppGamesPage })));
const PronunciationPracticePage = lazy(() => import('./pages/PronunciationPracticePage').then((module) => ({ default: module.PronunciationPracticePage })));
const AppProfilePage = lazy(() => import('./pages/AppProfilePage').then((module) => ({ default: module.AppProfilePage })));
const AppSettingsPage = lazy(() => import('./pages/AppSettingsPage').then((module) => ({ default: module.AppSettingsPage })));
const TeacherDashboardPage = lazy(() => import('./pages/TeacherDashboardPage').then((module) => ({ default: module.TeacherDashboardPage })));
const TeacherAssignmentBuilderPage = lazy(() => import('./pages/TeacherAssignmentBuilderPage').then((module) => ({ default: module.TeacherAssignmentBuilderPage })));
const TeacherAssignmentAnalyticsPage = lazy(() => import('./pages/TeacherAssignmentAnalyticsPage').then((module) => ({ default: module.TeacherAssignmentAnalyticsPage })));
const TeacherClassAnalyticsPage = lazy(() => import('./pages/TeacherClassAnalyticsPage').then((module) => ({ default: module.TeacherClassAnalyticsPage })));
const TeacherClassCompliancePage = lazy(() => import('./pages/TeacherClassCompliancePage').then((module) => ({ default: module.TeacherClassCompliancePage })));
const TeacherStudentDrillDownPage = lazy(() => import('./pages/TeacherStudentDrillDownPage').then((module) => ({ default: module.TeacherStudentDrillDownPage })));
const CanvasConnectPage = lazy(() => import('./pages/CanvasConnectPage').then((module) => ({ default: module.CanvasConnectPage })));
const StudentJoinClassPage = lazy(() => import('./pages/StudentJoinClassPage').then((module) => ({ default: module.StudentJoinClassPage })));
const TeacherJoinSchoolPage = lazy(() => import('./pages/TeacherJoinSchoolPage').then((module) => ({ default: module.TeacherJoinSchoolPage })));
const AssignmentLaunchPage = lazy(() => import('./pages/AssignmentLaunchPage').then((module) => ({ default: module.AssignmentLaunchPage })));
const GuardianConsentPage = lazy(() => import('./pages/GuardianConsentPage').then((module) => ({ default: module.GuardianConsentPage })));
const AdminDeletionRequestsPage = lazy(() => import('./pages/AdminDeletionRequestsPage').then((module) => ({ default: module.AdminDeletionRequestsPage })));
const AdminCompliancePage = lazy(() => import('./pages/AdminCompliancePage').then((module) => ({ default: module.AdminCompliancePage })));
const CompliancePage = lazy(() => import('./pages/CompliancePage'));
const CanvasPracticeBuilderPage = lazy(() => import('./pages/CanvasPracticeBuilderPage').then((module) => ({ default: module.CanvasPracticeBuilderPage })));
const LtiLinkAccountPage = lazy(() => import('./pages/LtiLinkAccountPage').then((m) => ({ default: m.LtiLinkAccountPage })));
const LtiAssignmentPickerPage = lazy(() => import('./pages/LtiAssignmentPickerPage').then((m) => ({ default: m.LtiAssignmentPickerPage })));

function RouteLoadingScreen() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );
}

function withRouteSuspense(element: ReactNode) {
  return <Suspense fallback={<RouteLoadingScreen />}>{element}</Suspense>;
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        {/* Public Routes */}
        <Route path="/" element={withRouteSuspense(<LandingPage />)} />
        <Route path="/auth" element={withRouteSuspense(<AuthPage />)} />
        <Route path="/guardian/consent/:token" element={withRouteSuspense(<GuardianConsentPage />)} />
        <Route path="/compliance" element={withRouteSuspense(<CompliancePage />)} />
        <Route path="/lti/link-account" element={withRouteSuspense(<LtiLinkAccountPage />)} />
        <Route path="/lti/assignment-picker" element={withRouteSuspense(<LtiAssignmentPickerPage />)} />

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          <Route path="/general" element={withRouteSuspense(<GeneralPage />)} />
          <Route path="/onboarding" element={withRouteSuspense(<InitialOnboardingPage />)} />
          <Route path="/school/setup" element={withRouteSuspense(<SchoolRequestPage />)} />
          <Route path="/assessment" element={withRouteSuspense(<AssessmentPage />)} />
          <Route path="/categories" element={withRouteSuspense(<CategoriesPage />)} />
          <Route path="/chat" element={<Navigate to="/app/chat" replace />} />
          <Route path="/profile" element={withRouteSuspense(<ProfilePage />)} />
        </Route>

        {/* App Shell Routes */}
        <Route path="/app" element={<AppProtectedRoute />}>
          <Route index element={<Navigate to="learn" replace />} />
          <Route path="learn" element={withRouteSuspense(<AppLearningPage />)} />
          <Route path="curriculum" element={withRouteSuspense(<AppCurriculumPage />)} />
          <Route path="curriculum/:moduleId" element={withRouteSuspense(<AppCurriculumModulePage />)} />
          <Route path="chat" element={withRouteSuspense(<AppChatPage />)} />
          <Route path="games" element={withRouteSuspense(<AppGamesPage />)} />
          <Route path="progress" element={<Navigate to="/app/learn" replace />} />
          <Route path="practice" element={withRouteSuspense(<PronunciationPracticePage />)} />
          <Route path="join" element={withRouteSuspense(<StudentJoinClassPage />)} />
          <Route path="assignments/:assignmentId" element={withRouteSuspense(<AssignmentLaunchPage />)} />
          <Route path="profile" element={withRouteSuspense(<AppProfilePage />)} />
          <Route path="settings" element={withRouteSuspense(<AppSettingsPage />)} />
          <Route path="teacher/join" element={withRouteSuspense(<TeacherJoinSchoolPage />)} />
          <Route
            path="teacher"
            element={withRouteSuspense(
              <TeacherRoute>
                <TeacherDashboardPage />
              </TeacherRoute>
            )}
          />
          <Route
            path="teacher/classes/:classId/analytics"
            element={withRouteSuspense(
              <TeacherRoute>
                <TeacherClassAnalyticsPage />
              </TeacherRoute>
            )}
          />
          <Route
            path="teacher/classes/:classId/assignments"
            element={withRouteSuspense(
              <TeacherRoute>
                <TeacherAssignmentBuilderPage />
              </TeacherRoute>
            )}
          />
          <Route
            path="teacher/classes/:classId/assignments/:assignmentId/analytics"
            element={withRouteSuspense(
              <TeacherRoute>
                <TeacherAssignmentAnalyticsPage />
              </TeacherRoute>
            )}
          />
          <Route
            path="teacher/classes/:classId/compliance"
            element={withRouteSuspense(
              <TeacherRoute>
                <TeacherClassCompliancePage />
              </TeacherRoute>
            )}
          />
          <Route
            path="teacher/classes/:classId/canvas/connect"
            element={withRouteSuspense(
              <TeacherRoute>
                <CanvasConnectPage />
              </TeacherRoute>
            )}
          />
          <Route
            path="teacher/classes/:classId/canvas-practice/:canvasContentId"
            element={withRouteSuspense(
              <TeacherRoute>
                <CanvasPracticeBuilderPage />
              </TeacherRoute>
            )}
          />
          <Route
            path="teacher/canvas/connect"
            element={withRouteSuspense(
              <TeacherRoute>
                <CanvasConnectPage />
              </TeacherRoute>
            )}
          />
          <Route
            path="teacher/classes/:classId/students/:studentUid/analytics"
            element={withRouteSuspense(
              <TeacherRoute>
                <TeacherStudentDrillDownPage />
              </TeacherRoute>
            )}
          />
          <Route
            path="admin/deletion-requests"
            element={withRouteSuspense(
              <TeacherRoute>
                <AdminDeletionRequestsPage />
              </TeacherRoute>
            )}
          />
          <Route
            path="admin/compliance"
            element={withRouteSuspense(
              <TeacherRoute>
                <AdminCompliancePage />
              </TeacherRoute>
            )}
          />
          <Route
            path="admin/school-requests"
            element={withRouteSuspense(
              <LingualAdminRoute>
                <LingualSchoolRequestsPage />
              </LingualAdminRoute>
            )}
          />
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
        <MembershipProvider>
          <LanguageProvider>
            <LearningLocaleProvider>
              <AnimatedRoutes />
            </LearningLocaleProvider>
          </LanguageProvider>
        </MembershipProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
