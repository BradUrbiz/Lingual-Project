import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';

const useAuthMock = vi.fn();

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('./LegacyAppLayout', () => ({
  LegacyAppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('ProtectedRoute', () => {
  it('redirects unauthenticated users to /login', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    render(
      <MemoryRouter initialEntries={['/general']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/general" element={<div>protected</div>} />
          </Route>
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('renders the outlet when authenticated', () => {
    useAuthMock.mockReturnValue({
      user: { uid: 'u1', email: 'a@b.test', name: 'A' },
      loading: false,
    });
    render(
      <MemoryRouter initialEntries={['/general']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/general" element={<div>protected</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('protected')).toBeInTheDocument();
  });
});
