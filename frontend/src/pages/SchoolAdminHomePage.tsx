import { Link } from 'react-router-dom';

export function SchoolAdminHomePage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-neutral-900">School Admin Home</h1>
      <p className="mt-3 text-neutral-600">
        Welcome. From here you can manage your school's teachers, classes, and
        compliance state.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          to="/app/teacher"
          className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm hover:border-neutral-300"
        >
          <h2 className="text-base font-semibold">Teacher tools</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Classes, assignments, analytics, and roster.
          </p>
        </Link>
        <Link
          to="/app/admin/compliance"
          className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm hover:border-neutral-300"
        >
          <h2 className="text-base font-semibold">Compliance</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Org-wide consent, guardian packets, deletion requests.
          </p>
        </Link>
      </div>
    </div>
  );
}

export default SchoolAdminHomePage;
