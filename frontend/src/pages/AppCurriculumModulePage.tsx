import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowUpRight, BookOpen, Loader2, Mic } from 'lucide-react';
import { clsx } from 'clsx';
import { getSampleCurriculumPackage } from '@/api/curriculum';
import { createChatSession, saveMessageToChat } from '@/api/chat';
import { Button } from '@/components/ui';
import { useLanguage } from '@/contexts/LanguageContext';
import { useRealtimeChat } from '@/hooks/useRealtimeChat';
import type {
  CurriculumMode,
  CurriculumPackageV1,
  I18nText,
  Module,
  Situation,
  SupportDomain,
  Unit,
} from '@/types';

const SUPPORT_DOMAIN_ORDER: SupportDomain[] = [
  'comprehension',
  'comprehensibility',
  'vocabulary_usage',
  'language_control',
  'communication_strategies',
  'cultural_awareness',
];

const SUPPORT_DOMAIN_LABELS: Record<SupportDomain, string> = {
  comprehension: 'Comprehension',
  comprehensibility: 'Comprehensibility',
  vocabulary_usage: 'Vocabulary Usage',
  language_control: 'Language Control',
  communication_strategies: 'Communication Strategies',
  cultural_awareness: 'Cultural Awareness',
};

const MODE_LABELS: Record<CurriculumMode, string> = {
  interpretive_listening: 'Interpretive Listening',
  interpersonal_speaking: 'Interpersonal Speaking',
  presentational_speaking: 'Presentational Speaking',
};

const getLocalizedText = (value: I18nText | undefined, lang: 'en' | 'ko', fallback = ''): string => {
  if (!value) return fallback;
  return value[lang] || value.en || Object.values(value)[0] || fallback;
};

const formatConstraintSummary = (situation: Situation): string => {
  const constraints = situation.seed.constraints;
  if (!constraints) return 'No strict constraints';
  const items: string[] = [];
  if (constraints.minTurns) items.push(`min ${constraints.minTurns} turns`);
  if (constraints.maxTurns) items.push(`max ${constraints.maxTurns} turns`);
  if (constraints.timeLimitSec) items.push(`${constraints.timeLimitSec}s limit`);
  if (constraints.maxReplays !== undefined) items.push(`replays: ${constraints.maxReplays}`);
  return items.join(' • ') || 'No strict constraints';
};

type PracticeSituation = {
  mode: CurriculumMode;
  situation: Situation;
};

export function AppCurriculumModulePage() {
  const { moduleId } = useParams<{ moduleId: string }>();
  const navigate = useNavigate();
  const { t, lang } = useLanguage();

  const [curriculum, setCurriculum] = useState<CurriculumPackageV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSituationId, setSelectedSituationId] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatTitle, setChatTitle] = useState<string | null>(null);
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [isStartingPractice, setIsStartingPractice] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const chatIdRef = useRef<string | null>(null);
  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  useEffect(() => {
    let isActive = true;

    const loadCurriculum = async () => {
      setLoading(true);
      setError(null);
      try {
        const pkg = await getSampleCurriculumPackage();
        if (!isActive) return;
        setCurriculum(pkg);
      } catch (err) {
        if (!isActive) return;
        setError(err instanceof Error ? err.message : 'Failed to load curriculum');
      } finally {
        if (isActive) setLoading(false);
      }
    };

    void loadCurriculum();
    return () => {
      isActive = false;
    };
  }, []);

  const module = useMemo<Module | null>(() => {
    if (!curriculum || !moduleId) return null;
    return curriculum.modules.find((item) => item.id === moduleId) || null;
  }, [curriculum, moduleId]);

  const unit = useMemo<Unit | null>(() => {
    if (!curriculum || !module) return null;
    return curriculum.units.find((item) => item.id === module.unitId) || null;
  }, [curriculum, module]);

  const practiceSituations = useMemo<PracticeSituation[]>(() => {
    if (!module) return [];
    return [
      ...module.situations.interpersonal_speaking.map((situation) => ({
        mode: 'interpersonal_speaking' as const,
        situation,
      })),
      ...module.situations.presentational_speaking.map((situation) => ({
        mode: 'presentational_speaking' as const,
        situation,
      })),
    ];
  }, [module]);

  useEffect(() => {
    if (!module) {
      setSelectedSituationId(null);
      return;
    }

    const capstoneSituationId = module.capstone?.situationId;
    const hasCapstoneSituation = capstoneSituationId
      ? practiceSituations.some((entry) => entry.situation.id === capstoneSituationId)
      : false;

    const defaultSituationId = hasCapstoneSituation
      ? capstoneSituationId ?? null
      : practiceSituations[0]?.situation.id || null;

    setSelectedSituationId(defaultSituationId);
  }, [module, practiceSituations]);

  const selectedPracticeSituation = useMemo<PracticeSituation | null>(() => {
    if (!practiceSituations.length || !selectedSituationId) return practiceSituations[0] || null;
    return (
      practiceSituations.find((entry) => entry.situation.id === selectedSituationId) ||
      practiceSituations[0] ||
      null
    );
  }, [practiceSituations, selectedSituationId]);

  const persistRealtimeMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    const activeChatId = chatIdRef.current;
    if (!activeChatId || !content.trim()) return;
    saveMessageToChat(activeChatId, role, content).catch((saveError) => {
      console.error('Failed to save curriculum realtime message:', saveError);
    });
  }, []);

  const sessionParams = useMemo(() => {
    if (!curriculum || !module || !selectedPracticeSituation) return undefined;
    return {
      uiLanguage: lang,
      practice: {
        type: 'curriculum_module',
        curriculumId: curriculum.curriculum.id,
        moduleId: module.id,
        situationId: selectedPracticeSituation.situation.id,
      },
    };
  }, [curriculum, module, selectedPracticeSituation, lang]);

  const {
    isConnected,
    isListening,
    isSpeaking,
    messages,
    error: realtimeError,
    connect,
    disconnect,
    clearMessages,
  } = useRealtimeChat({
    onMessage: persistRealtimeMessage,
    sessionParams,
  });

  const startVoicePractice = async () => {
    if (!module || !selectedPracticeSituation) return;
    setPracticeError(null);
    setIsStartingPractice(true);

    try {
      disconnect();
      clearMessages();

      const title = `CUR ${module.id} - ${getLocalizedText(module.title, lang, module.id)}`;
      const created = await createChatSession(title);
      setChatId(created.chatId);
      chatIdRef.current = created.chatId;
      setChatTitle(created.title);
      await connect();
    } catch (err) {
      setPracticeError(err instanceof Error ? err.message : 'Failed to start practice');
    } finally {
      setIsStartingPractice(false);
    }
  };

  const toggleConnection = async () => {
    if (!chatId) return;
    setPracticeError(null);

    if (isConnected) {
      disconnect();
      return;
    }

    setIsConnecting(true);
    try {
      await connect();
    } catch (err) {
      setPracticeError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setIsConnecting(false);
    }
  };

  const openInChat = () => {
    if (!chatId) return;
    navigate(`/app/chat?chatId=${encodeURIComponent(chatId)}`);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!module || !unit || !curriculum) {
    return (
      <section className="rounded-2xl border-3 border-destructive bg-destructive/10 p-5 text-sm font-medium text-destructive">
        {error || 'Module not found.'}
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="rounded-2xl border-3 border-foreground bg-card p-5 shadow-stamp">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-foreground bg-primary text-primary-foreground">
            <BookOpen size={22} strokeWidth={2.5} />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
              {(t('app.curriculum.unitLabel') || 'Unit')} {unit.ap.unitNumber} • {(t('app.curriculum.moduleLabel') || 'Module')} {module.id}
            </p>
            <h1 className="text-2xl font-display font-bold text-foreground">
              {getLocalizedText(module.title, lang, module.id)}
            </h1>
            <p className="text-sm text-muted-foreground">{getLocalizedText(module.moduleGoal, lang)}</p>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border-3 border-foreground bg-card p-5 shadow-stamp">
        <h2 className="text-lg font-display font-bold text-foreground">Support Targets</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {SUPPORT_DOMAIN_ORDER.map((domain) => {
            const targets = module.supportTargets[domain] || [];
            return (
              <div key={domain} className="rounded-xl border-2 border-border bg-secondary/60 p-3">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">
                  {SUPPORT_DOMAIN_LABELS[domain]}
                </p>
                <ul className="mt-2 space-y-1 text-sm text-foreground">
                  {targets.slice(0, 3).map((target) => (
                    <li key={target.id} className="leading-relaxed">
                      • {getLocalizedText(target.label, lang)}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border-3 border-foreground bg-card p-5 shadow-stamp">
        <h2 className="text-lg font-display font-bold text-foreground">
          {t('app.curriculum.practice.chooseSituation') || 'Choose a speaking situation'}
        </h2>
        <div className="mt-4 grid gap-3">
          {practiceSituations.map((entry) => {
            const isSelected = entry.situation.id === selectedPracticeSituation?.situation.id;
            return (
              <button
                key={entry.situation.id}
                type="button"
                onClick={() => setSelectedSituationId(entry.situation.id)}
                className={clsx(
                  'rounded-xl border-2 p-4 text-left transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-card hover:border-foreground hover:bg-secondary/50'
                )}
              >
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-primary">
                  {MODE_LABELS[entry.mode]}
                </p>
                <h3 className="mt-1 text-base font-semibold text-foreground">{entry.situation.seed.setting}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatConstraintSummary(entry.situation)}
                </p>
              </button>
            );
          })}

          {module.situations.interpretive_listening.map((situation) => (
            <div
              key={situation.id}
              className="rounded-xl border-2 border-dashed border-border bg-secondary/40 p-4 text-sm text-muted-foreground"
            >
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-primary">
                {MODE_LABELS.interpretive_listening}
              </p>
              <p className="mt-1 font-medium">{situation.seed.setting}</p>
              <p className="mt-1">
                {t('app.curriculum.practice.comingSoonListening') || 'Coming soon'}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border-3 border-foreground bg-card p-5 shadow-stamp">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-display font-bold text-foreground">Voice Practice</h2>
            <p className="text-sm text-muted-foreground">
              {chatTitle ? `Session: ${chatTitle}` : 'Start a new voice practice session for this module.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={startVoicePractice}
              disabled={!selectedPracticeSituation || isStartingPractice}
              loading={isStartingPractice}
            >
              <Mic size={16} className="mr-2" />
              {t('app.curriculum.practice.start') || 'Start voice practice'}
            </Button>
            <Button
              type="button"
              variant={isConnected ? 'destructive' : 'outline'}
              onClick={toggleConnection}
              disabled={!chatId || isStartingPractice || isConnecting}
              loading={isConnecting}
            >
              {isConnected ? 'Disconnect' : 'Connect'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={openInChat}
              disabled={!chatId}
            >
              <ArrowUpRight size={16} className="mr-2" />
              {t('app.curriculum.practice.openInChat') || 'Open in Chat'}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
          <span className={clsx('rounded-lg border px-2 py-1', isConnected ? 'border-success/40 text-success' : 'border-border')}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
          <span className={clsx('rounded-lg border px-2 py-1', isListening ? 'border-primary/40 text-primary' : 'border-border')}>
            {isListening ? 'Listening' : 'Idle'}
          </span>
          <span className={clsx('rounded-lg border px-2 py-1', isSpeaking ? 'border-accent/40 text-accent' : 'border-border')}>
            {isSpeaking ? 'AI speaking' : 'AI silent'}
          </span>
        </div>

        {(practiceError || realtimeError) ? (
          <div className="mt-4 rounded-xl border-2 border-destructive bg-destructive/10 p-3 text-sm font-medium text-destructive">
            {practiceError || realtimeError}
          </div>
        ) : null}

        <div className="mt-4 max-h-[360px] space-y-3 overflow-y-auto rounded-xl border-2 border-border bg-secondary/40 p-4">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Realtime transcripts will appear here once practice starts.
            </p>
          ) : (
            messages.map((message) => {
              const isUser = message.role === 'user';
              return (
                <div
                  key={message.id}
                  className={clsx(
                    'max-w-[85%] rounded-xl border-2 p-3 text-sm',
                    isUser
                      ? 'ml-auto border-primary/30 bg-primary/10 text-foreground'
                      : 'mr-auto border-border bg-card text-foreground'
                  )}
                >
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    {isUser ? 'You' : 'Lingu'}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed">{message.content}</p>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
