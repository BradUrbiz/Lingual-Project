import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/lingual-admin/dashboard', label: 'Dashboard' },
  { to: '/lingual-admin/requests', label: 'Requests' },
  { to: '/lingual-admin/organizations', label: 'Organizations' },
];

export function LingualAdminShell() {
  // NavLink in react-router v7 automatically sets aria-current="page" when
  // active (default value of the aria-current prop), so no extra wiring is
  // required to satisfy the accessibility contract for the active link.
  return (
    <div className="flex min-h-screen bg-neutral-50">
      <aside className="w-56 shrink-0 border-r border-neutral-200 bg-white">
        <div className="px-5 py-5 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Lingual Admin
        </div>
        <nav
          aria-label="Lingual admin navigation"
          className="flex flex-col gap-1 px-3 pb-6"
        >
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm transition ${
                  isActive
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-700 hover:bg-neutral-100'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}
