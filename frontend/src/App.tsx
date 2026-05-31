import { Suspense, lazy, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation } from 'framer-motion';
import { AuthProvider } from './contexts/AuthContext';
import { MembershipProvider } from './contexts/MembershipContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { LearningLocaleProvider } from './contexts/LearningLocaleContext';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { AppProtectedRoute } from './components/layout/AppProtectedRoute';
import { TeacherRoute } from './components/layout/TeacherRoute';
import { SchoolAdminRoute } from './components/layout/SchoolAdminRoute';
import { LingualAdminRoute } from './components/layout/LingualAdminRoute';
import { LoadingSpinner } from './components/common/LoadingSpinner';
import { useAuth } from './hooks/useAuth';
import { getOnboardingDestination } from './lib/homeRoutes';

const LandingPage = lazy(() => import('./pages/LandingPage').then((module) => ({ default: module.LandingPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const SignupPage = lazy(() => import('./pages/SignupPage').then((module) => ({ default: module.SignupPage })));
const TeacherJoinOrgPage = lazy(() =>
  import('./pages/TeacherJoinOrgPage').then(m => ({ default: m.TeacherJoinOrgPage }))
);
const TeacherJoinPendingPage = lazy(() =>
  import('./pages/TeacherJoinPendingPage').then(m => ({ default: m.TeacherJoinPendingPage }))
);
const AdminOrgWizardPage = lazy(() => import('./pages/AdminOrgWizard/AdminOrgWizardPage').then((module) => ({ default: module.AdminOrgWizardPage })));
const AdminPendingPage = lazy(() => import('./pages/AdminPendingPage').then((module) => ({ default: module.AdminPendingPage })));
const GeneralPage = lazy(() => import('./pages/GeneralPage').then((module) => ({ default: module.GeneralPage })));
const InitialOnboardingPage = lazy(() => import('./pages/InitialOnboardingPage').then((module) => ({ default: module.InitialOnboardingPage })));
const AssessmentPage = lazy(() => import('./pages/AssessmentPage').then((module) => ({ default: module.AssessmentPage })));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage').then((module) => ({ default: module.CategoriesPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })));
const AppLearningPage = lazy(() => import('./pages/AppLearningPage').then((module) => ({ default: module.AppLearningPage })));
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
const AssignmentLaunchPage = lazy(() => import('./pages/AssignmentLaunchPage').then((module) => ({ default: module.AssignmentLaunchPage })));
const VoiceConsentPage = lazy(() => import('./pages/VoiceConsentPage').then((module) => ({ default: module.VoiceConsentPage })));
const GuardianConsentPage = lazy(() => import('./pages/GuardianConsentPage').then((module) => ({ default: module.GuardianConsentPage })));
const AdminDeletionRequestsPage = lazy(() => import('./pages/AdminDeletionRequestsPage').then((module) => ({ default: module.AdminDeletionRequestsPage })));
const AdminCompliancePage = lazy(() => import('./pages/AdminCompliancePage').then((module) => ({ default: module.AdminCompliancePage })));
const CompliancePage = lazy(() => import('./pages/CompliancePage'));
const LtiLinkAccountPage = lazy(() => import('./pages/LtiLinkAccountPage').then((m) => ({ default: m.LtiLinkAccountPage })));
const LtiAssignmentPickerPage = lazy(() => import('./pages/LtiAssignmentPickerPage').then((m) => ({ default: m.LtiAssignmentPickerPage })));
const SchoolAdminHomePage = lazy(() =>
  import('./pages/SchoolAdminHomePage').then((m) => ({ default: m.SchoolAdminHomePage })),
);
const LingualAdminShell = lazy(() =>
  import('./pages/LingualAdmin/LingualAdminShell').then((m) => ({ default: m.LingualAdminShell })),
);
const LingualAdminDashboardPage = lazy(() =>
  import('./pages/LingualAdmin/LingualAdminDashboardPage').then((m) => ({
    default: m.LingualAdminDashboardPage,
  })),
);
const LingualRequestsPage = lazy(() =>
  import('./pages/LingualAdmin/LingualRequestsPage').then((m) => ({ default: m.LingualRequestsPage })),
);
const LingualOrgsListPage = lazy(() =>
  import('./pages/LingualAdmin/LingualOrgsListPage').then((m) => ({ default: m.LingualOrgsListPage })),
);
const LingualOrgDetailPage = lazy(() =>
  import('./pages/LingualAdmin/LingualOrgDetailPage').then((m) => ({ default: m.LingualOrgDetailPage })),
);

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

function AppIndexRedirect() {
  const { user } = useAuth();
  const dest = getOnboardingDestination(user);
  // Plan 6: when dest is null (legacy user awaiting modal), render nothing.
  // AuthProvider's `LegacyRoleMigrationModal` is already mounted and will
  // overlay this empty render until the user picks a role.
  if (!dest) return null;
  return <Navigate to={dest} replace />;
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        {/* Public Routes */}
        <Route path="/" element={withRouteSuspense(<LandingPage />)} />
        <Route path="/login" element={withRouteSuspense(<LoginPage />)} />
        <Route path="/signup" element={withRouteSuspense(<SignupPage />)} />
        <Route path="/auth" element={<Navigate to="/login" replace />} />
        <Route path="/guardian/consent/:token" element={withRouteSuspense(<GuardianConsentPage />)} />
        <Route path="/compliance" element={withRouteSuspense(<CompliancePage />)} />
        <Route path="/lti/link-account" element={withRouteSuspense(<LtiLinkAccountPage />)} />
        <Route path="/lti/assignment-picker" element={withRouteSuspense(<LtiAssignmentPickerPage />)} />

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          <Route path="/general" element={withRouteSuspense(<GeneralPage />)} />
          <Route path="/signup/student/setup" element={withRouteSuspense(<GeneralPage />)} />
          <Route path="/signup/teacher/join-org" element={withRouteSuspense(<TeacherJoinOrgPage />)} />
          <Route path="/signup/teacher/pending" element={withRouteSuspense(<TeacherJoinPendingPage />)} />
          <Route path="/signup/admin/org-wizard" element={withRouteSuspense(<AdminOrgWizardPage />)} />
          <Route path="/signup/admin/pending" element={withRouteSuspense(<AdminPendingPage />)} />
          <Route path="/onboarding" element={withRouteSuspense(<InitialOnboardingPage />)} />
          <Route path="/school/setup" element={<Navigate to="/signup/admin/org-wizard" replace />} />
          <Route path="/assessment" element={withRouteSuspense(<AssessmentPage />)} />
          <Route path="/categories" element={withRouteSuspense(<CategoriesPage />)} />
          <Route path="/chat" element={<Navigate to="/app/chat" replace />} />
          <Route path="/profile" element={withRouteSuspense(<ProfilePage />)} />
        </Route>

        {/* App Shell Routes */}
        <Route path="/app" element={<AppProtectedRoute />}>
          <Route index element={<AppIndexRedirect />} />
          <Route path="learn" element={withRouteSuspense(<AppLearningPage />)} />
          <Route path="chat" element={withRouteSuspense(<AppChatPage />)} />
          <Route path="games" element={withRouteSuspense(<AppGamesPage />)} />
          <Route path="progress" element={<Navigate to="/app/learn" replace />} />
          <Route path="practice" element={withRouteSuspense(<PronunciationPracticePage />)} />
          <Route path="join" element={withRouteSuspense(<StudentJoinClassPage />)} />
          <Route path="assignments/:assignmentId" element={withRouteSuspense(<AssignmentLaunchPage />)} />
          <Route path="consent/voice" element={withRouteSuspense(<VoiceConsentPage />)} />
          <Route path="profile" element={withRouteSuspense(<AppProfilePage />)} />
          <Route path="settings" element={withRouteSuspense(<AppSettingsPage />)} />
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
          {/*
            /app/admin/* requires a school_admin membership specifically.
            TeacherRoute allows both teacher and school_admin (P2 #5 fix);
            SchoolAdminRoute narrows to school_admin so a teacher-only user
            who manually navigates here is redirected to /app/teacher.
          */}
          <Route
            path="admin"
            element={withRouteSuspense(
              <SchoolAdminRoute>
                <SchoolAdminHomePage />
              </SchoolAdminRoute>
            )}
          />
          <Route
            path="admin/deletion-requests"
            element={withRouteSuspense(
              <SchoolAdminRoute>
                <AdminDeletionRequestsPage />
              </SchoolAdminRoute>
            )}
          />
          <Route
            path="admin/compliance"
            element={withRouteSuspense(
              <SchoolAdminRoute>
                <AdminCompliancePage />
              </SchoolAdminRoute>
            )}
          />
          {/*
            Legacy redirect: Plan 5 (Task 30) retires the in-app-shell mount
            of LingualSchoolRequestsPage at /app/admin/school-requests. The
            Lingual admin surface now lives at /lingual-admin (top-level).
          */}
          <Route
            path="admin/school-requests"
            element={<Navigate to="/lingual-admin/requests" replace />}
          />
        </Route>

        {/*
          Lingual admin panel - mounted at the top level (outside /app) so its
          own LingualAdminShell chrome does not double-nest inside AppLayout.
          `LingualAdminRoute` enforces both auth (redirect to /login when
          signed-out) and the lingual_admin role.
        */}
        <Route
          path="/lingual-admin"
          element={withRouteSuspense(
            <LingualAdminRoute>
              <LingualAdminShell />
            </LingualAdminRoute>
          )}
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={withRouteSuspense(<LingualAdminDashboardPage />)} />
          <Route path="requests" element={withRouteSuspense(<LingualRequestsPage />)} />
          <Route path="organizations" element={withRouteSuspense(<LingualOrgsListPage />)} />
          <Route
            path="organizations/:orgId"
            element={withRouteSuspense(<LingualOrgDetailPage />)}
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
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation}>
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
      </LazyMotion>
    </MotionConfig>
  );
}

export default App;
