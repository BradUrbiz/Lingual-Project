import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';

export function SchoolAdminHomePage() {
  const { t } = useLanguage();
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-neutral-900">{t('admin.home.title')}</h1>
      <p className="mt-3 text-neutral-600">
        {t('admin.home.welcome')}
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          to="/app/teacher"
          className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm hover:border-neutral-300"
        >
          <h2 className="text-base font-semibold">{t('admin.home.teacherTools.title')}</h2>
          <p className="mt-1 text-sm text-neutral-600">
            {t('admin.home.teacherTools.subtitle')}
          </p>
        </Link>
        <Link
          to="/app/admin/compliance"
          className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm hover:border-neutral-300"
        >
          <h2 className="text-base font-semibold">{t('admin.home.compliance.title')}</h2>
          <p className="mt-1 text-sm text-neutral-600">
            {t('admin.home.compliance.subtitle')}
          </p>
        </Link>
      </div>
    </div>
  );
}

export default SchoolAdminHomePage;
