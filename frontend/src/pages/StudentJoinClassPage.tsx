import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Loader2, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { AnimatedPage } from '@/components/layout';
import { Alert, AlertDescription, Button, Card, Input } from '@/components/ui';
import { joinClassByCode } from '@/api/schools';
import type { JoinClassResult } from '@/types';

export function StudentJoinClassPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JoinClassResult | null>(null);

  const handleCodeChange = (value: string) => {
    // Auto-uppercase, strip non-alphanumeric, max 6 chars
    setCode(value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
    setError(null);
  };

  const handleSubmit = async () => {
    if (code.length !== 6) {
      setError('Please enter a 6-character class code.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const joinResult = await joinClassByCode(code);
      setResult(joinResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join class. Please check the code and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <AnimatedPage>
        <div className="min-h-screen flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md"
          >
            <Card className="p-8 text-center space-y-6">
              <div className="flex justify-center">
                <CheckCircle2 className="h-16 w-16 text-green-500" />
              </div>

              <div className="space-y-2">
                <h1 className="text-2xl font-bold">
                  {result.alreadyEnrolled ? 'Already Enrolled' : 'Successfully Joined!'}
                </h1>
                <p className="text-muted-foreground">
                  {result.alreadyEnrolled
                    ? `You're already enrolled in this class.`
                    : `You've been added to the class.`}
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 text-left space-y-1">
                <p className="font-semibold text-lg">{result.class.name}</p>
                {result.class.subject && (
                  <p className="text-sm text-muted-foreground">{result.class.subject}</p>
                )}
              </div>

              <Button onClick={() => navigate('/app/learn', { replace: true })} className="w-full">
                Go to Learning
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Card>
          </motion.div>
        </div>
      </AnimatedPage>
    );
  }

  return (
    <AnimatedPage>
      <div className="min-h-screen flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <Card className="p-8 space-y-6">
            <div className="text-center space-y-2">
              <div className="flex justify-center">
                <Users className="h-12 w-12 text-primary" />
              </div>
              <h1 className="text-2xl font-bold">Join a Class</h1>
              <p className="text-muted-foreground">
                Enter the 6-character code your teacher shared with you.
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              <Input
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
                placeholder="ABC123"
                className="text-center text-2xl tracking-[0.3em] font-mono uppercase"
                maxLength={6}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                }}
              />

              <Button onClick={handleSubmit} disabled={loading || code.length !== 6} className="w-full">
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Joining...
                  </>
                ) : (
                  <>
                    Join Class
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </Card>
        </motion.div>
      </div>
    </AnimatedPage>
  );
}
