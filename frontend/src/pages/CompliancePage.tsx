import { Link } from 'react-router-dom';
import { Shield, Database, Users, Clock, Trash2, Scale } from 'lucide-react';

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-blue-600" />
        <h2 className="text-xl font-semibold">{title}</h2>
      </div>
      <div className="text-gray-700 dark:text-gray-300 space-y-2">{children}</div>
    </section>
  );
}

export default function CompliancePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Lingual — Data & Compliance Overview</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Information for school administrators and coordinators evaluating Lingual for pilot use.
        </p>
      </div>

      <div className="space-y-8">
        <Section icon={Database} title="What data we collect">
          <ul className="list-disc pl-5 space-y-1">
            <li>Student text transcripts from practice sessions</li>
            <li>Voice transcripts when voice mode is enabled and consented</li>
            <li>Session metadata: duration, turn counts, modality used</li>
            <li>Learning events: target expression usage, feedback events, self-corrections</li>
            <li>Consent records and audit trails for compliance tracking</li>
          </ul>
          <p>We do not collect biometric identifiers, voiceprints, or speaker recognition data.</p>
        </Section>

        <Section icon={Shield} title="How consent works">
          <ul className="list-disc pl-5 space-y-1">
            <li>Voice-enabled practice requires explicit consent before any session can start.</li>
            <li>If voice consent is not granted, sessions are blocked or downgraded to text-only when the teacher has enabled text fallback.</li>
            <li>Guardian consent can be collected via secure-link packets issued by school staff.</li>
            <li>Consent status is tracked per student per organization with a full audit trail.</li>
            <li>Teachers and school admins can review and update consent within their authorized scope.</li>
          </ul>
        </Section>

        <Section icon={Users} title="Who can access what">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Students</strong> can view their own profile, practice history, and compliance state.</li>
            <li><strong>Teachers</strong> can view data for students in their own classes only.</li>
            <li><strong>School administrators</strong> can view organization-wide data, manage consent, and initiate deletion requests.</li>
          </ul>
          <p>All access follows role-based scoping enforced at both the API and database rule level.</p>
        </Section>

        <Section icon={Clock} title="Data retention defaults">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Raw audio:</strong> 30 days (when stored)</li>
            <li><strong>Transcripts and session summaries:</strong> 365 days</li>
            <li><strong>Aggregated analytics:</strong> academic term length plus 1 year</li>
          </ul>
          <p>Retention policies are configurable per organization. These are conservative defaults.</p>
        </Section>

        <Section icon={Trash2} title="Deletion process">
          <ul className="list-disc pl-5 space-y-1">
            <li>School administrators can submit deletion requests for student, class, or organization scope.</li>
            <li>Requests go through an approval gate before execution.</li>
            <li>Execution is auditable with detailed summaries of what was deleted.</li>
            <li>Failed or partial deletions can be retried.</li>
            <li>Target SLA: 7 days from approval to completion.</li>
          </ul>
        </Section>

        <Section icon={Scale} title="Compliance posture">
          <p>
            Lingual's school integration is designed with awareness of COPPA, FERPA, and state
            biometric privacy laws including Illinois BIPA. The architecture enforces consent-gated
            voice access, role-scoped data visibility, auditable consent trails, and configurable
            retention policies.
          </p>
          <p>
            This is not a certification claim. Formal counsel review is part of our production
            readiness process. Schools should evaluate Lingual's controls against their own
            compliance requirements.
          </p>
        </Section>
      </div>

      <div className="mt-12 border-t pt-6 text-sm text-gray-500 dark:text-gray-400">
        <p>
          Questions? Contact us at{' '}
          <a href="mailto:support@lingual.app" className="text-blue-600 hover:underline">
            support@lingual.app
          </a>
        </p>
        <p className="mt-1">
          <Link to="/" className="text-blue-600 hover:underline">&larr; Back to Lingual</Link>
        </p>
      </div>
    </div>
  );
}
