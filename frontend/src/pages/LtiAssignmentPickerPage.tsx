import { useEffect, useRef, useState } from 'react';
import { GraduationCap, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, Button, Card, Input } from '@/components/ui';
import { getDeepLinkAssignments, submitDeepLinkResponse } from '@/api/lti';
import type { DeepLinkAssignment } from '@/api/lti';

export function LtiAssignmentPickerPage() {
  const [assignments, setAssignments] = useState<DeepLinkAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [points, setPoints] = useState<string>('10');
  const [submitting, setSubmitting] = useState(false);
  const [responseHtml, setResponseHtml] = useState<string | null>(null);
  const formContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchAssignments = async () => {
      try {
        const data = await getDeepLinkAssignments();
        setAssignments(data);
        if (data.length > 0) {
          setSelectedId(data[0].id);
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load assignments. Make sure you launched this page from Canvas.',
        );
      } finally {
        setLoading(false);
      }
    };
    fetchAssignments();
  }, []);

  // When responseHtml is set, auto-submit the deep link form back to Canvas.
  // The HTML is generated server-side by pylti1p3 and contains a self-submitting
  // form that posts the signed JWT back to the LMS. This is the standard LTI
  // deep linking response flow and the content is trusted (from our own backend).
  useEffect(() => {
    if (responseHtml && formContainerRef.current) {
      const container = formContainerRef.current;
      // Use a range to safely parse and insert the server-generated form
      const range = document.createRange();
      range.selectNode(container);
      const fragment = range.createContextualFragment(responseHtml);
      container.appendChild(fragment);
      // Auto-submit the form if pylti1p3 didn't include an auto-submit script
      const form = container.querySelector('form');
      if (form) {
        form.submit();
      }
    }
  }, [responseHtml]);

  const handleSubmit = async () => {
    if (!selectedId) return;
    setSubmitting(true);
    setError(null);
    try {
      const pointsNum = points ? parseFloat(points) : undefined;
      const result = await submitDeepLinkResponse({
        assignmentId: selectedId,
        points: pointsNum && pointsNum > 0 ? pointsNum : undefined,
      });
      setResponseHtml(result.responseHtml);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to embed assignment in Canvas.');
    } finally {
      setSubmitting(false);
    }
  };

  // If we have responseHtml, render only the hidden form container
  if (responseHtml) {
    return <div ref={formContainerRef} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <Card className="border-3 border-foreground p-8 shadow-stamp space-y-6">
          <div className="text-center space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-foreground bg-primary/10 text-primary">
              <GraduationCap size={28} strokeWidth={2.5} />
            </div>
            <h1 className="text-2xl font-display font-bold text-foreground">
              Select Assignment
            </h1>
            <p className="text-sm text-muted-foreground">
              Choose a Lingual practice assignment to embed in your Canvas module.
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : assignments.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <GraduationCap className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground">
                No published assignments found for this class. Create an assignment in Lingual first, then return here.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {assignments.map((assignment) => (
                  <label
                    key={assignment.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-4 transition-colors ${
                      assignment.id === selectedId
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-secondary/40 hover:border-primary/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="assignment"
                      value={assignment.id}
                      checked={assignment.id === selectedId}
                      onChange={(e) => setSelectedId(e.target.value)}
                      className="accent-primary"
                    />
                    <div>
                      <div className="font-display font-bold text-foreground">
                        {assignment.title}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {assignment.status}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="space-y-1">
                <Input
                  id="lti-points"
                  label="Points (for grade passback)"
                  type="number"
                  min="0"
                  step="1"
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                  placeholder="10"
                />
                <p className="text-xs text-muted-foreground">
                  Leave at 0 to skip grade passback. Otherwise, Lingual will report scores out of this total.
                </p>
              </div>

              <Button
                className="w-full"
                onClick={handleSubmit}
                loading={submitting}
                disabled={!selectedId || submitting}
              >
                {submitting ? 'Embedding...' : 'Embed in Canvas'}
              </Button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
