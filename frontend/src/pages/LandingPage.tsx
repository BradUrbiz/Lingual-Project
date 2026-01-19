import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../contexts/LanguageContext';
import { Button } from '../components/common';
import { useEffect } from 'react';

export function LandingPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    if (user && !loading) {
      navigate('/general');
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
        <h1 className="text-4xl font-bold text-purple-accent mb-2">{t('app.title')}</h1>
        <p className="text-text-secondary mb-6">{t('app.subtitle')}</p>

        <img
          src="/imgs/c-notalk.png"
          alt="Lingu"
          className="w-48 h-48 mx-auto mb-6 object-contain"
        />

        <Button onClick={() => navigate('/auth')} className="w-full">
          {t('app.getStarted')}
        </Button>
      </div>
    </div>
  );
}
