import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Link as LinkIcon, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { validateCanvasConnection, connectCanvas } from '@/api/canvas';
import { Alert, AlertDescription, Badge, Button, Card, Input } from '@/components/ui';
import type { CanvasCourse } from '@/types/canvas';

type Step = 'credentials' | 'course-select';

export function CanvasConnectPage() {
  const { classId } = useParams<{ classId: string }>();
  const [searchParams] = useSearchParams();
  const existingClassId = classId || searchParams.get('classId') || '';
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('credentials');
  const [instanceUrl, setInstanceUrl] = useState('');
  const [pat, setPat] = useState('');
  const [courses, setCourses] = useState<CanvasCourse[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleValidate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await validateCanvasConnection(instanceUrl.trim(), pat.trim());
      if (!result.success) {
        setError(result.error || 'Validation failed');
        return;
      }
      setCourses(result.courses);
      if (result.courses.length > 0) {
        setSelectedCourseId(String(result.courses[0].id));
      }
      setStep('course-select');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    const course = courses.find((c) => String(c.id) === selectedCourseId);
    if (!course) return;

    setError(null);
    setLoading(true);
    try {
      const result = await connectCanvas({
        canvasInstanceUrl: instanceUrl.trim(),
        pat: pat.trim(),
        canvasCourseId: String(course.id),
        canvasCourseName: course.name,
        existingClassId: existingClassId || undefined,
      });
      if (!result.success) {
        setError(result.error || 'Connection failed');
        return;
      }
      navigate(`/app/teacher/classes/${result.classId}/analytics`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border-3 border-foreground bg-primary text-primary-foreground shadow-stamp-sm">
          <LinkIcon size={24} strokeWidth={2.5} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
            LMS Integration
          </p>
          <h1 className="text-3xl font-display font-bold text-foreground">
            Connect Canvas
          </h1>
          <p className="text-sm text-muted-foreground">
            Link your Canvas course so assignments appear in both Lingual and Canvas.
          </p>
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {step === 'credentials' && (
        <Card className="border-3 border-foreground p-6 shadow-stamp">
          <div className="mb-5">
            <h2 className="text-lg font-display font-bold text-foreground">Step 1: Canvas credentials</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your Canvas instance URL and a Personal Access Token.
            </p>
          </div>

          <form onSubmit={handleValidate} className="space-y-4">
            <div className="space-y-1">
              <Input
                id="canvas-url"
                label="Canvas Instance URL"
                type="url"
                required
                placeholder="https://school.instructure.com"
                value={instanceUrl}
                onChange={(e) => setInstanceUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                This is your school's Canvas address. It usually looks like yourschool.instructure.com
              </p>
            </div>

            <div className="space-y-1">
              <Input
                id="canvas-pat"
                label="Personal Access Token"
                type="password"
                required
                placeholder="Your Canvas PAT"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                In Canvas, go to Account &gt; Settings &gt; New Access Token. Your token is encrypted and stored securely.
              </p>
            </div>

            <Button type="submit" className="w-full" loading={loading}>
              {loading ? 'Validating...' : 'Validate & continue'}
            </Button>
          </form>
        </Card>
      )}

      {step === 'course-select' && (
        <Card className="border-3 border-foreground p-6 shadow-stamp">
          <div className="mb-5">
            <div className="mb-3 flex items-center gap-2">
              <CheckCircle2 size={18} className="text-success" />
              <span className="text-sm font-medium text-success">Canvas credentials verified</span>
            </div>
            <h2 className="text-lg font-display font-bold text-foreground">Step 2: Select course</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose the Canvas course to connect to this class.
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
                  onChange={(e) => setSelectedCourseId(e.target.value)}
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
            <Button variant="outline" onClick={() => setStep('credentials')}>
              <ArrowLeft size={16} className="mr-2" />
              Back
            </Button>
            <Button
              className="flex-1"
              onClick={handleConnect}
              loading={loading}
              disabled={!selectedCourseId}
            >
              {loading ? 'Connecting...' : 'Connect course'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
