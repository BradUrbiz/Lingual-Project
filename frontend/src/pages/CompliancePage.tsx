import { Link } from 'react-router-dom';
import { Shield, Database, Users, Clock, Trash2, Scale, Cloud } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="size-5 text-blue-600" />
        <h2 className="text-xl font-semibold">{title}</h2>
      </div>
      <div className="text-gray-700 dark:text-gray-300 space-y-2">{children}</div>
    </section>
  );
}

export default function CompliancePage() {
  const { t } = useLanguage();
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">{t('compliance.page.title')}</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          {t('compliance.page.subtitle')}
        </p>
      </div>

      <div className="space-y-8">
        <Section icon={Database} title={t('compliance.page.whatWeCollect.title')}>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t('compliance.page.whatWeCollect.item1')}</li>
            <li>{t('compliance.page.whatWeCollect.item2')}</li>
            <li>{t('compliance.page.whatWeCollect.item3')}</li>
            <li>{t('compliance.page.whatWeCollect.item4')}</li>
            <li>{t('compliance.page.whatWeCollect.item5')}</li>
          </ul>
          <p>{t('compliance.page.whatWeCollect.noBiometric')}</p>
        </Section>

        <Section icon={Shield} title={t('compliance.page.howConsent.title')}>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t('compliance.page.howConsent.item1')}</li>
            <li>{t('compliance.page.howConsent.item2')}</li>
            <li>{t('compliance.page.howConsent.item3')}</li>
            <li>{t('compliance.page.howConsent.item4')}</li>
            <li>{t('compliance.page.howConsent.item5')}</li>
          </ul>
        </Section>

        <Section icon={Cloud} title={t('compliance.page.thirdPartyAI.title')}>
          <p>
            {t('compliance.page.thirdPartyAI.intro')}
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>{t('compliance.page.thirdPartyAI.sentLabel')}</strong>{' '}
              {t('compliance.page.thirdPartyAI.sentDetail')}
            </li>
            <li>
              <strong>{t('compliance.page.thirdPartyAI.notSentLabel')}</strong>{' '}
              {t('compliance.page.thirdPartyAI.notSentDetail')}
            </li>
          </ul>
          <p>
            {t('compliance.page.thirdPartyAI.retention')}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('compliance.page.thirdPartyAI.reference')}{' '}
            <a
              href="https://openai.com/policies/api-data-usage-policies"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              {t('compliance.page.thirdPartyAI.referenceLink')}
            </a>
            .
          </p>
        </Section>

        <Section icon={Users} title={t('compliance.page.whoCanAccess.title')}>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>{t('compliance.page.whoCanAccess.studentsLabel')}</strong> {t('compliance.page.whoCanAccess.studentsDetail')}</li>
            <li><strong>{t('compliance.page.whoCanAccess.teachersLabel')}</strong> {t('compliance.page.whoCanAccess.teachersDetail')}</li>
            <li><strong>{t('compliance.page.whoCanAccess.adminsLabel')}</strong> {t('compliance.page.whoCanAccess.adminsDetail')}</li>
          </ul>
          <p>{t('compliance.page.whoCanAccess.roleScoping')}</p>
        </Section>

        <Section icon={Clock} title={t('compliance.page.retention.title')}>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>{t('compliance.page.retention.rawAudioLabel')}</strong> {t('compliance.page.retention.rawAudioDetail')}</li>
            <li><strong>{t('compliance.page.retention.transcriptsLabel')}</strong> {t('compliance.page.retention.transcriptsDetail')}</li>
            <li><strong>{t('compliance.page.retention.analyticsLabel')}</strong> {t('compliance.page.retention.analyticsDetail')}</li>
          </ul>
          <p>{t('compliance.page.retention.configurable')}</p>
        </Section>

        <Section icon={Trash2} title={t('compliance.page.deletion.title')}>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t('compliance.page.deletion.item1')}</li>
            <li>{t('compliance.page.deletion.item2')}</li>
            <li>{t('compliance.page.deletion.item3')}</li>
          </ul>
        </Section>

        <Section icon={Scale} title={t('compliance.page.posture.title')}>
          <p>
            {t('compliance.page.posture.para1')}
          </p>
          <p>
            {t('compliance.page.posture.para2')}
          </p>
        </Section>
      </div>

      <div className="mt-12 border-t pt-6 text-sm text-gray-500 dark:text-gray-400">
        <p>
          <Link to="/" className="text-blue-600 hover:underline">{t('compliance.page.backToLingual')}</Link>
        </p>
      </div>
    </div>
  );
}
