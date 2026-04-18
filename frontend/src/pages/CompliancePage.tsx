import { Link } from 'react-router-dom';
import { Shield, Database, Users, Clock, Trash2, Scale, Cloud } from 'lucide-react';

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
            <li>Voice-enabled practice requires explicit student consent before any session can start.</li>
            <li>Students self-consent on their own profile — teachers and admins can also grant or revoke consent on their behalf.</li>
            <li>If voice consent is not granted, sessions are downgraded to text-only practice (typing with the AI tutor) where the assignment allows it.</li>
            <li>Consent status is tracked per student per organization with a full audit trail.</li>
            <li>Schools can issue secure-link guardian notices as supplementary parent communication.</li>
          </ul>
        </Section>

        <Section icon={Cloud} title="Third-party AI processing">
          <p>
            Voice and text conversations are processed by{' '}
            <strong>OpenAI's GPT and Realtime APIs</strong> so the AI tutor can understand the
            student's response and generate the next turn in the target language. What leaves
            Lingual and what doesn't:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Sent to OpenAI:</strong> student audio (voice mode), typed text, prior turns
              in the current session, and a system prompt that carries assignment context —
              scenario, target expressions, focus grammar, and learning locale.
            </li>
            <li>
              <strong>Not sent:</strong> student email, account identifiers, Firebase auth data,
              transcripts from past sessions, or any aggregated analytics.
            </li>
          </ul>
          <p>
            OpenAI does not use data sent through its API to train its models. Under OpenAI's
            default API terms, payloads may be retained for up to 30 days for abuse monitoring
            and then deleted — that window is controlled by OpenAI, not Lingual. Transcripts that
            Lingual itself retains in Firestore are separate from OpenAI's processing and follow
            the retention defaults below.
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Reference:{' '}
            <a
              href="https://openai.com/policies/api-data-usage-policies"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              OpenAI API Data Usage Policies
            </a>
            .
          </p>
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
            <li><strong>Raw audio:</strong> 30 days (when stored under the standard school policy; can be set to zero via the <em>no-raw-audio</em> policy)</li>
            <li><strong>Transcripts and session summaries:</strong> 365 days</li>
            <li><strong>Aggregated analytics:</strong> 730 days (2 years)</li>
          </ul>
          <p>Retention policies are configurable per organization. These are conservative defaults.</p>
        </Section>

        <Section icon={Trash2} title="Deletion process">
          <ul className="list-disc pl-5 space-y-1">
            <li>School administrators can submit deletion requests for student, class, or organization scope.</li>
            <li>Requests go through an approval gate before execution.</li>
            <li>Execution is auditable with detailed summaries of what was deleted.</li>
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
