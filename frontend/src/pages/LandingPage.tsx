import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../contexts/LanguageContext';
import { Button, AnimatedCard } from '@/components/ui';
import { AnimatedPage } from '@/components/layout/AnimatedPage';

export function LandingPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { t } = useLanguage();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="h-8 w-8 text-primary" />
        </motion.div>
      </div>
    );
  }

  return (
    <AnimatedPage className="min-h-screen flex items-center justify-center p-4">
      <AnimatedCard className="p-8 max-w-md w-full text-center">
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-4xl font-bold text-accent mb-2"
        >
          {t('app.title')}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-muted-foreground mb-6"
        >
          {t('app.subtitle')}
        </motion.p>

        <motion.img
          src="/imgs/c-notalk.png"
          alt="Lingu"
          className="w-48 h-48 mx-auto mb-6 object-contain"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{
            opacity: 1,
            scale: 1,
            y: [0, -8, 0],
          }}
          transition={{
            opacity: { delay: 0.4, duration: 0.4 },
            scale: { delay: 0.4, duration: 0.4 },
            y: { delay: 0.8, duration: 3, repeat: Infinity, ease: 'easeInOut' },
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <Button
            onClick={() => {
              if (user) {
                navigate('/general');
              } else {
                navigate('/auth');
              }
            }}
            className="w-full"
            size="lg"
          >
            {t('app.getStarted')}
          </Button>
        </motion.div>
      </AnimatedCard>
    </AnimatedPage>
  );
}
