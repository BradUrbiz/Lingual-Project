import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { LandingPage } from '@/app/pages/LandingPage';
import { LearningPage } from '@/app/pages/LearningPage';
import { ProfilePage } from '@/app/pages/ProfilePage';
import { SettingsPage } from '@/app/pages/SettingsPage';
import { TeacherDashboard } from '@/app/pages/TeacherDashboard';
import { AppLayout } from '@/app/layouts/AppLayout';

function ScrollToTop() {
  const { pathname } = useLocation();

  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        
        <Route path="/app" element={<AppLayout />}>
          <Route index element={<Navigate to="/app/learn" replace />} />
          <Route path="learn" element={<LearningPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="teacher" element={<TeacherDashboard />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
