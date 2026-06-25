import { useEffect, useReducer, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Link as LinkIcon, ArrowLeft, CheckCircle2, ShieldCheck } from 'lucide-react';
import { validateCanvasConnection, connectCanvas } from '@/api/canvas';
import { getLtiPlatform } from '@/api/lti';
import { Alert, AlertDescription, Badge, Button, Card, Input } from '@/components/ui';
import { useLanguage } from '@/contexts/LanguageContext';
import type { CanvasCourse } from '@/types/canvas';

type Step = 'credentials' | 'course-select';

type CanvasConnectState = {
  step: Step;
  instanceUrl: string;
  pat: string;
  courses: CanvasCourse[];
  selectedCourseId: string;
  loading: boolean;
  error: string | null;
  ltiConfigured: boolean | null;
};

type CanvasConnectAction =
  | { type: 'set-field'; field: 'instanceUrl' | 'pat' | 'selectedCourseId'; value: string }
  | { type: 'set-step'; step: Step }
  | { type: 'set-lti-configured'; value: boolean }
  | { type: 'request-start' }
  | { type: 'request-error'; error: string }
  | { type: 'request-finished' }
  | { type: 'validated'; courses: CanvasCourse[] };

const initialCanvasConnectState: CanvasConnectState = {
  step: 'credentials',
  instanceUrl: '',
  pat: '',
  courses: [],
  selectedCourseId: '',
  loading: false,
  error: null,
  ltiConfigured: null,
};

function canvasConnectReducer(state: CanvasConnectState, action: CanvasConnectAction): CanvasConnectState {
  switch (action.type) {
    case 'set-field':
      return { ...state, [action.field]: action.value };
    case 'set-step':
      return { ...state, step: action.step };
    case 'set-lti-configured':
      return { ...state, ltiConfigured: action.value };
    case 'request-start':
      return { ...state, error: null, loading: true };
    case 'request-error':
      return { ...state, error: action.error, loading: false };
    case 'request-finished':
      return { ...state, loading: false };
    case 'validated':
      return {
        ...state,
        courses: action.courses,
        selectedCourseId: action.courses.length > 0 ? String(action.courses[0].id) : '',
        step: 'course-select',
      };
    default:
      return state;
  }
}

export function CanvasConnectPage() {
  const { classId } = useParams<{ classId: string }>();
  const [searchParams] = useSearchParams();
  const existingClassId = classId || searchParams.get('classId') || '';
  const navigate = useNavigate();
  const { t } = useLanguage();

  const [state, dispatch] = useReducer(canvasConnectReducer, initialCanvasConnectState);
  const { step, instanceUrl, pat, courses, selectedCourseId, loading, error, ltiConfigured } = state;

  useEffect(() => {
    getLtiPlatform()
      .then((platform) => dispatch({ type: 'set-lti-configured', value: platform !== null }))
      .catch(() => dispatch({ type: 'set-lti-configured', value: false }));
  }, []);

  const handleValidate = async (e: FormEvent) => {
    e.preventDefault();
    dispatch({ type: 'request-start' });
    try {
      const result = await validateCanvasConnection(instanceUrl.trim(), pat.trim());
      if (!result.success) {
        dispatch({ type: 'request-error', error: result.error || t('integrations.canvas.validationFailed') });
        return;
      }
      dispatch({ type: 'validated', courses: result.courses });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('integrations.canvas.connectionFailed');
      dispatch({ type: 'request-error', error: msg });
    } finally {
      dispatch({ type: 'request-finished' });
    }
  };

  const handleConnect = async () => {
    const course = courses.find((c) => String(c.id) === selectedCourseId);
    if (!course) return;

    dispatch({ type: 'request-start' });
    try {
      const result = await connectCanvas({
        canvasInstanceUrl: instanceUrl.trim(),
        pat: pat.trim(),
        canvasCourseId: String(course.id),
        canvasCourseName: course.name,
        existingClassId: existingClassId || undefined,
      });
      if (!result.success) {
        dispatch({ type: 'request-error', error: result.error || t('integrations.canvas.connectionFailed') });
        return;
      }
      navigate(`/app/teacher/classes/${result.classId}/analytics`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('integrations.canvas.connectionFailed');
      dispatch({ type: 'request-error', error: msg });
    } finally {
      dispatch({ type: 'request-finished' });
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header className="flex items-start gap-4">
        <div className="flex size-12 items-center justify-center rounded-xl border-3 border-foreground bg-primary text-primary-foreground shadow-stamp-sm">
          <LinkIcon size={24} strokeWidth={2.5} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
            {t('integrations.canvas.kicker')}
          </p>
          <h1 className="text-3xl font-display font-bold text-foreground">
            {t('integrations.canvas.title')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('integrations.canvas.subtitle')}
          </p>
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {ltiConfigured && step === 'credentials' && (
        <Card className="border-3 border-primary/40 bg-primary/5 p-6 shadow-stamp">
          <div className="flex items-start gap-3">
            <ShieldCheck size={22} className="mt-0.5 text-primary" />
            <div>
              <h2 className="text-lg font-display font-bold text-foreground">
                {t('integrations.canvas.ltiCard.title')}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('integrations.canvas.ltiCard.desc')}
              </p>
              <p className="mt-2 text-sm font-medium text-primary">
                {t('integrations.canvas.ltiCard.hint')}
              </p>
            </div>
          </div>
        </Card>
      )}

      {step === 'credentials' && (
        <Card className="border-3 border-foreground p-6 shadow-stamp">
          <div className="mb-5">
            <h2 className="text-lg font-display font-bold text-foreground">
              {ltiConfigured ? t('integrations.canvas.manualTitle') : t('integrations.canvas.credentialsTitle')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('integrations.canvas.credentialsSubtitle')}
            </p>
          </div>

          <form onSubmit={handleValidate} className="space-y-4">
            <div className="space-y-1">
              <Input
                id="canvas-url"
                label={t('integrations.canvas.instanceUrlLabel')}
                type="url"
                required
                placeholder="https://school.instructure.com"
                value={instanceUrl}
                onChange={(e) => dispatch({ type: 'set-field', field: 'instanceUrl', value: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {t('integrations.canvas.instanceUrlHint')}
              </p>
            </div>

            <div className="space-y-1">
              <Input
                id="canvas-pat"
                label={t('integrations.canvas.patLabel')}
                type="password"
                required
                placeholder={t('integrations.canvas.patPlaceholder')}
                value={pat}
                onChange={(e) => dispatch({ type: 'set-field', field: 'pat', value: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {t('integrations.canvas.patHint')}
              </p>
            </div>

            <Button type="submit" className="w-full" loading={loading}>
              {loading ? t('integrations.canvas.validating') : t('integrations.canvas.validateBtn')}
            </Button>
          </form>
        </Card>
      )}

      {step === 'course-select' && (
        <Card className="border-3 border-foreground p-6 shadow-stamp">
          <div className="mb-5">
            <div className="mb-3 flex items-center gap-2">
              <CheckCircle2 size={18} className="text-success" />
              <span className="text-sm font-medium text-success">{t('integrations.canvas.verified')}</span>
            </div>
            <h2 className="text-lg font-display font-bold text-foreground">{t('integrations.canvas.selectCourseTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('integrations.canvas.selectCourseSubtitle')}
            </p>
          </div>

          <div className="space-y-2">
            {courses.map((course) => (
              <label
                key={course.id}
                className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-4 transition-colors ${
                  String(course.id) === selectedCourseId
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-secondary/40 hover:border-primary/40'
                }`}
              >
                <input
                  type="radio"
                  name="course"
                  value={String(course.id)}
                  checked={String(course.id) === selectedCourseId}
                  onChange={(e) => dispatch({ type: 'set-field', field: 'selectedCourseId', value: e.target.value })}
                  className="accent-primary"
                />
                <div>
                  <div className="font-display font-bold text-foreground">{course.name}</div>
                  {course.courseCode && (
                    <Badge variant="secondary" size="sm" className="mt-1">
                      {course.courseCode}
                    </Badge>
                  )}
                </div>
              </label>
            ))}
          </div>

          <div className="mt-5 flex gap-3">
            <Button variant="outline" onClick={() => dispatch({ type: 'set-step', step: 'credentials' })}>
              <ArrowLeft size={16} className="mr-2" />
              {t('general.back')}
            </Button>
            <Button
              className="flex-1"
              onClick={handleConnect}
              loading={loading}
              disabled={!selectedCourseId}
            >
              {loading ? t('app.learn.status.connecting') : t('integrations.canvas.connectCourseBtn')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
