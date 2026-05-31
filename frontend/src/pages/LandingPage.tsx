import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Languages,
  MessageCircle,
  Zap,
  TrendingUp,
  School,
  CheckCircle,
  Menu,
  X,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { m } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { staggerContainer, staggerItem, cardVariants } from '@/lib/animations';
import { getOnboardingDestination } from '@/lib/homeRoutes';
import { Button } from '@/components/ui/button';

const HERO_IMAGE = '/imgs/landing/hero.jpg';
const AVATAR_IMAGES = [
  '/imgs/avatars/user-1.svg',
  '/imgs/avatars/user-2.svg',
  '/imgs/avatars/user-3.svg',
  '/imgs/avatars/user-4.svg',
];

type LandingRole = 'student' | 'teacher' | 'admin';
type TranslationFn = (key: string) => string;

export function LandingPage() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { t } = useLanguage();

  const handleLogin = () => {
    if (!user) {
      navigate('/login');
      return;
    }
    const dest = getOnboardingDestination(user);
    if (dest) {
      navigate(dest);
    }
    // else: legacy user awaiting modal; stay on landing page (modal will cover it).
  };

  const handleStartAsRole = (role: LandingRole) => {
    if (user) {
      // Already signed in - route through the dispatcher and ignore the role
      // because their memberships are the source of truth.
      const dest = getOnboardingDestination(user);
      if (dest) {
        navigate(dest);
        return;
      }
    }
    navigate(`/signup?role=${role}`);
  };

  if (loading) return <LandingLoading />;

  return (
    <div className="min-h-screen bg-background font-body text-foreground">
      <LandingNav
        isMobileMenuOpen={isMobileMenuOpen}
        t={t}
        onLogin={handleLogin}
        onMobileMenuToggle={() => setIsMobileMenuOpen((isOpen) => !isOpen)}
        onStartAsRole={handleStartAsRole}
        onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
      />
      <LandingHero t={t} onStartAsRole={handleStartAsRole} />
      <OneStopShopSection />
      <FeaturesSection t={t} />
      <HowItWorksSection t={t} />
      <SchoolsSection t={t} onStartAsRole={handleStartAsRole} />
      <LandingFooter t={t} />
    </div>
  );
}

function LandingLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <m.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}>
        <Loader2 className="size-10 text-primary" strokeWidth={3} />
      </m.div>
    </div>
  );
}

type LandingNavProps = {
  isMobileMenuOpen: boolean;
  t: TranslationFn;
  onCloseMobileMenu: () => void;
  onLogin: () => void;
  onMobileMenuToggle: () => void;
  onStartAsRole: (role: LandingRole) => void;
};

function LandingNav({
  isMobileMenuOpen,
  t,
  onCloseMobileMenu,
  onLogin,
  onMobileMenuToggle,
  onStartAsRole,
}: LandingNavProps) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-b-3 border-foreground">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-20 items-center">
          <Link
            to="/"
            className="flex items-center gap-3 group"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <div className="size-12 bg-primary border-3 border-foreground rounded-xl flex items-center justify-center text-primary-foreground shadow-stamp-sm group-hover:shadow-stamp transition-shadow">
              <Languages size={26} strokeWidth={2.5} />
            </div>
            <span className="text-2xl font-display font-bold tracking-tight">Lingual</span>
          </Link>

          <DesktopNavLinks t={t} onLogin={onLogin} onStartAsRole={onStartAsRole} />

          <div className="md:hidden">
            <button
              type="button"
              onClick={onMobileMenuToggle}
              className="p-2 text-foreground hover:bg-secondary rounded-lg border-2 border-foreground"
            >
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </div>

      {isMobileMenuOpen ? (
        <MobileNavLinks
          t={t}
          onCloseMobileMenu={onCloseMobileMenu}
          onLogin={onLogin}
          onStartAsRole={onStartAsRole}
        />
      ) : null}
    </nav>
  );
}

function DesktopNavLinks({
  t,
  onLogin,
  onStartAsRole,
}: {
  t: TranslationFn;
  onLogin: () => void;
  onStartAsRole: (role: LandingRole) => void;
}) {
  return (
    <div className="hidden md:flex items-center gap-8">
      <a
        href="#features"
        className="font-medium text-foreground/70 hover:text-primary transition-colors border-b-2 border-transparent hover:border-primary pb-1"
      >
        {t('landing.nav.features')}
      </a>
      <a
        href="#how-it-works"
        className="font-medium text-foreground/70 hover:text-primary transition-colors border-b-2 border-transparent hover:border-primary pb-1"
      >
        {t('landing.nav.how')}
      </a>
      <a
        href="#schools"
        className="font-medium text-foreground/70 hover:text-primary transition-colors border-b-2 border-transparent hover:border-primary pb-1"
      >
        {t('landing.nav.schools')}
      </a>
      <button
        type="button"
        onClick={onLogin}
        className="font-medium text-foreground/70 hover:text-primary transition-colors border-b-2 border-transparent hover:border-primary pb-1"
      >
        {t('landing.nav.login')}
      </button>
      <m.button
        type="button"
        onClick={() => onStartAsRole('student')}
        whileHover={{ y: -2, boxShadow: '6px 6px 0 0 #2D2A26' }}
        whileTap={{ y: 2, boxShadow: '2px 2px 0 0 #2D2A26' }}
        className="bg-primary text-primary-foreground font-bold py-3 px-6 rounded-xl border-3 border-foreground shadow-stamp transition-all"
      >
        {t('landing.nav.getStarted')}
      </m.button>
    </div>
  );
}

function MobileNavLinks({
  t,
  onCloseMobileMenu,
  onLogin,
  onStartAsRole,
}: {
  t: TranslationFn;
  onCloseMobileMenu: () => void;
  onLogin: () => void;
  onStartAsRole: (role: LandingRole) => void;
}) {
  return (
    <m.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="md:hidden bg-card border-b-3 border-foreground p-6"
    >
      <a href="#features" className="block text-lg font-medium py-3 hover:text-primary" onClick={onCloseMobileMenu}>
        {t('landing.nav.features')}
      </a>
      <a href="#how-it-works" className="block text-lg font-medium py-3 hover:text-primary" onClick={onCloseMobileMenu}>
        {t('landing.nav.how')}
      </a>
      <a href="#schools" className="block text-lg font-medium py-3 hover:text-primary" onClick={onCloseMobileMenu}>
        {t('landing.nav.schools')}
      </a>
      <div className="pt-4 border-t-2 border-border flex flex-col gap-3">
        <button type="button" onClick={onLogin} className="w-full text-center py-3 font-medium border-2 border-foreground rounded-xl">
          {t('landing.nav.login')}
        </button>
        <button
          type="button"
          onClick={() => onStartAsRole('student')}
          className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-bold border-3 border-foreground shadow-stamp-sm"
        >
          {t('landing.nav.getStarted')}
        </button>
      </div>
    </m.div>
  );
}

function LandingHero({
  t,
  onStartAsRole,
}: {
  t: TranslationFn;
  onStartAsRole: (role: LandingRole) => void;
}) {
  return (
    <section className="pt-28 pb-16 lg:pt-36 lg:pb-24 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <m.div variants={staggerContainer} initial="initial" animate="animate">
            <m.div
              variants={staggerItem}
              className="inline-flex items-center gap-2 bg-accent/20 text-accent-foreground px-4 py-2 rounded-full border-2 border-accent font-medium mb-8"
            >
              <Sparkles size={18} className="text-accent" />
              <span>{t('landing.hero.badge')}</span>
            </m.div>

            <m.h1
              variants={staggerItem}
              className="text-5xl lg:text-7xl font-display font-bold tracking-tight leading-[1.05] mb-6"
            >
              {t('landing.hero.titleLine1')} <br />
              <span className="text-primary relative">
                {t('landing.hero.titleLine2')}
                <svg className="absolute -bottom-2 left-0 w-full h-3 text-accent" viewBox="0 0 200 12" preserveAspectRatio="none">
                  <path d="M0,8 Q50,0 100,8 T200,8" stroke="currentColor" strokeWidth="4" fill="none" />
                </svg>
              </span>
            </m.h1>

            <m.p
              variants={staggerItem}
              className="text-xl text-muted-foreground mb-10 leading-relaxed max-w-lg"
            >
              {t('landing.hero.subtitle')}
            </m.p>

            <m.div variants={staggerItem} className="grid gap-3 sm:grid-cols-3">
              <Button onClick={() => onStartAsRole('student')} className="w-full justify-center">
                I'm a Student
              </Button>
              <Button onClick={() => onStartAsRole('teacher')} variant="secondary" className="w-full justify-center">
                I'm a Teacher
              </Button>
              <Button onClick={() => onStartAsRole('admin')} variant="outline" className="w-full justify-center">
                I'm a School Admin
              </Button>
            </m.div>

            <AvatarTrustBar t={t} />
          </m.div>

          <HeroImageCard t={t} />
        </div>
      </div>
    </section>
  );
}

function AvatarTrustBar({ t }: { t: TranslationFn }) {
  return (
    <m.div variants={staggerItem} className="mt-10 flex items-center gap-4">
      <div className="flex -gap-x-3">
        {AVATAR_IMAGES.map((src, index) => (
          <div
            key={src}
            className="size-10 rounded-full border-3 border-background bg-secondary overflow-hidden"
            style={{ zIndex: AVATAR_IMAGES.length - index }}
          >
            <img src={src} alt={`User avatar ${index + 1}`} className="w-full h-full object-cover" />
          </div>
        ))}
      </div>
      <p className="text-muted-foreground font-medium">{t('landing.hero.trusted')}</p>
    </m.div>
  );
}

function HeroImageCard({ t }: { t: TranslationFn }) {
  return (
    <m.div variants={cardVariants} initial="initial" animate="animate" className="relative">
      <div className="absolute -inset-3 bg-accent/30 rounded-2xl transform rotate-3"></div>
      <div className="absolute -inset-3 bg-primary/20 rounded-2xl transform -rotate-2"></div>
      <div className="relative rounded-2xl overflow-hidden border-4 border-foreground shadow-stamp bg-card">
        <img src={HERO_IMAGE} alt="Student learning" className="w-full h-auto object-cover" />
        <m.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6, type: 'spring', stiffness: 300 }}
          className="absolute bottom-6 left-6 bg-card p-5 rounded-xl border-3 border-foreground shadow-stamp"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="size-3 rounded-full bg-success"></div>
            <span className="text-sm font-bold text-muted-foreground uppercase tracking-wide">
              {t('landing.hero.fluencyLabel')}
            </span>
          </div>
          <div className="text-4xl font-display font-bold">92%</div>
          <div className="text-sm text-success font-medium mt-1">
            {t('landing.hero.fluencyDelta')}
          </div>
        </m.div>
      </div>
    </m.div>
  );
}

function OneStopShopSection() {
  return (
    <section className="bg-ink text-cream min-h-[25vh] py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] items-center">
          <div>
            <span
              className="font-display font-black text-cream tracking-tighter leading-none select-none whitespace-nowrap block"
              style={{ fontSize: 'clamp(2.6rem, 4.2vw, 5rem)' }}
            >
              L
              <span className="text-primary">1</span>
              ngual.com
            </span>
          </div>

          <div className="flex items-center gap-6 lg:gap-10">
            <span
              className="font-display font-black text-primary select-none leading-none flex-shrink-0"
              style={{ fontSize: 'clamp(3.6rem, 7vw, 7rem)' }}
            >
              #1
            </span>
            <div className="w-px self-stretch bg-cream/30 flex-shrink-0" />
            <div className="flex flex-col gap-2">
              <span className="font-display font-bold text-cream" style={{ fontSize: 'clamp(1rem, 1.5vw, 1.35rem)' }}>
                platform trusted by schools
              </span>
              <span className="font-display font-bold text-cream" style={{ fontSize: 'clamp(1rem, 1.5vw, 1.35rem)' }}>
                AI tutor for every student
              </span>
              <span className="font-display font-bold text-cream whitespace-nowrap" style={{ fontSize: 'clamp(1rem, 1.5vw, 1.35rem)' }}>
                one-stop shop for language learning
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeaturesSection({ t }: { t: TranslationFn }) {
  const features = [
    {
      icon: <MessageCircle className="text-primary" size={36} strokeWidth={2.5} />,
      title: t('landing.features.cards.speaking.title'),
      desc: t('landing.features.cards.speaking.desc'),
      color: 'bg-primary/10',
      accent: 'border-primary',
    },
    {
      icon: <Zap className="text-accent" size={36} strokeWidth={2.5} />,
      title: t('landing.features.cards.feedback.title'),
      desc: t('landing.features.cards.feedback.desc'),
      color: 'bg-accent/10',
      accent: 'border-accent',
    },
    {
      icon: <TrendingUp className="text-success" size={36} strokeWidth={2.5} />,
      title: t('landing.features.cards.adaptive.title'),
      desc: t('landing.features.cards.adaptive.desc'),
      color: 'bg-success/20',
      accent: 'border-success',
    },
  ];

  return (
    <section id="features" className="py-20 bg-secondary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <m.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-2xl mx-auto mb-16"
        >
          <h2 className="text-4xl lg:text-5xl font-display font-bold mb-6">
            {t('landing.features.title')}
          </h2>
          <p className="text-xl text-muted-foreground">
            {t('landing.features.subtitle')}
          </p>
        </m.div>

        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {features.map((feature, index) => (
            <m.div
              key={feature.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1, type: 'spring', stiffness: 300 }}
              whileHover={{ y: -6, boxShadow: '8px 8px 0 0 #2D2A26' }}
              className="bg-card p-8 rounded-2xl border-3 border-foreground shadow-stamp transition-all cursor-default"
            >
              <div className={`size-16 ${feature.color} rounded-xl border-2 ${feature.accent} flex items-center justify-center mb-6`}>
                {feature.icon}
              </div>
              <h3 className="text-2xl font-display font-bold mb-4">{feature.title}</h3>
              <p className="text-muted-foreground text-lg leading-relaxed">{feature.desc}</p>
            </m.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection({ t }: { t: TranslationFn }) {
  const steps = [
    { title: t('landing.how.steps.choose.title'), desc: t('landing.how.steps.choose.desc') },
    { title: t('landing.how.steps.speak.title'), desc: t('landing.how.steps.speak.desc') },
    { title: t('landing.how.steps.feedback.title'), desc: t('landing.how.steps.feedback.desc') },
    { title: t('landing.how.steps.improve.title'), desc: t('landing.how.steps.improve.desc') },
  ];

  return (
    <section id="how-it-works" className="py-20 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <m.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-4xl lg:text-5xl font-display font-bold mb-10">
              {t('landing.how.title')}
            </h2>
            <div className="space-y-8">
              {steps.map((step, index) => (
                <m.div
                  key={step.title}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="flex gap-5"
                >
                  <div className="flex-shrink-0 size-12 rounded-xl bg-primary text-primary-foreground border-3 border-foreground flex items-center justify-center font-display font-bold text-xl shadow-stamp-sm">
                    {index + 1}
                  </div>
                  <div>
                    <h4 className="text-xl font-display font-bold mb-2">{step.title}</h4>
                    <p className="text-muted-foreground text-lg">{step.desc}</p>
                  </div>
                </m.div>
              ))}
            </div>
          </m.div>

          <ChatMockup />
        </div>
      </div>
    </section>
  );
}

function ChatMockup() {
  return (
    <m.div
      initial={{ opacity: 0, x: 30 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      className="bg-secondary rounded-3xl p-8 border-3 border-foreground shadow-stamp"
    >
      <div className="bg-card rounded-2xl border-3 border-foreground p-6 space-y-4">
        <div className="flex items-center gap-4 border-b-2 border-border pb-4">
          <div className="size-12 rounded-xl bg-primary/20 border-2 border-primary flex items-center justify-center text-2xl">
            🤖
          </div>
          <div>
            <div className="font-display font-bold text-lg">AI Tutor</div>
            <div className="text-sm text-success font-medium flex items-center gap-1">
              <div className="size-2 rounded-full bg-success"></div>
              Online
            </div>
          </div>
        </div>
        <div className="space-y-4 py-2">
          <div className="bg-secondary p-4 rounded-xl rounded-tl-none border-2 border-border max-w-[85%]">
            <div className="size-3/4 bg-border rounded mb-2"></div>
            <div className="h-3 w-1/2 bg-border rounded"></div>
          </div>
          <div className="bg-primary/10 p-4 rounded-xl rounded-tr-none ml-auto border-2 border-primary max-w-[85%]">
            <div className="h-3 w-5/6 bg-primary/30 rounded mb-2"></div>
            <div className="h-3 w-2/3 bg-primary/30 rounded"></div>
          </div>
        </div>
        <div className="pt-4 flex justify-center">
          <div className="size-16 rounded-full bg-destructive border-3 border-foreground shadow-stamp-sm flex items-center justify-center">
            <div className="size-5 bg-destructive-foreground rounded-sm"></div>
          </div>
        </div>
      </div>
    </m.div>
  );
}

function SchoolsSection({
  t,
  onStartAsRole,
}: {
  t: TranslationFn;
  onStartAsRole: (role: LandingRole) => void;
}) {
  const bullets = [
    t('landing.schools.bullets.assessments'),
    t('landing.schools.bullets.curriculum'),
    t('landing.schools.bullets.dashboard'),
    t('landing.schools.bullets.integration'),
  ];

  return (
    <section id="schools" className="py-20 bg-ink text-background relative overflow-hidden">
      <div className="absolute top-0 right-0 p-16 opacity-5">
        <School size={500} strokeWidth={1} />
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <m.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="inline-block bg-background/10 border-2 border-background/30 px-4 py-2 rounded-full text-background/80 font-medium mb-8">
              {t('landing.schools.badge')}
            </div>
            <h2 className="text-4xl lg:text-5xl font-display font-bold mb-6 text-background">
              {t('landing.schools.title')}
            </h2>
            <p className="text-background/70 text-xl mb-10 leading-relaxed">
              {t('landing.schools.subtitle')}
            </p>

            <ul className="space-y-4 mb-10">
              {bullets.map((item) => (
                <li key={item} className="flex items-center gap-4">
                  <div className="size-8 rounded-lg bg-success flex items-center justify-center flex-shrink-0">
                    <CheckCircle className="text-success-foreground" size={18} strokeWidth={3} />
                  </div>
                  <span className="text-lg text-background/90">{item}</span>
                </li>
              ))}
            </ul>

            <m.button
              type="button"
              onClick={() => onStartAsRole('admin')}
              whileHover={{ y: -3, boxShadow: '6px 6px 0 0 #F5F0E8' }}
              whileTap={{ y: 2 }}
              className="bg-background text-ink font-bold py-4 px-8 rounded-xl border-3 border-background shadow-[4px_4px_0_0_#F5F0E8] transition-all"
            >
              {t('landing.schools.cta')}
            </m.button>
          </m.div>

          <SchoolStatsGrid t={t} />
        </div>
      </div>
    </section>
  );
}

function SchoolStatsGrid({ t }: { t: TranslationFn }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <m.div
        initial={{ opacity: 0, scale: 0.9 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 0 }}
        className="col-span-2 bg-primary p-6 rounded-2xl border-3 border-background"
      >
        <div className="text-4xl font-display font-bold text-background mb-2">3x</div>
        <div className="text-background/80 font-medium">
          {t('landing.schools.stats.speaking')}
        </div>
      </m.div>
      <m.div
        initial={{ opacity: 0, scale: 0.9 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 0.1 }}
        className="col-span-2 bg-success p-6 rounded-2xl border-3 border-background"
      >
        <div className="text-4xl font-display font-bold text-background mb-2">100%</div>
        <div className="text-background/80 font-medium">
          {t('landing.schools.stats.confidence')}
        </div>
      </m.div>
    </div>
  );
}

function LandingFooter({ t }: { t: TranslationFn }) {
  return (
    <footer className="bg-ink text-background py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-4 gap-10 mb-12">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="size-10 bg-primary border-2 border-background rounded-lg flex items-center justify-center">
                <Languages size={22} className="text-primary-foreground" />
              </div>
              <span className="text-xl font-display font-bold">Lingual</span>
            </div>
            <p className="text-background/60 leading-relaxed">
              {t('landing.footer.tagline')}
            </p>
          </div>

          <FooterColumn
            title={t('landing.footer.product')}
            links={[
              { href: '#features', label: t('landing.footer.links.features') },
              { href: '#schools', label: t('landing.footer.links.schools') },
            ]}
          />
          <FooterColumn
            title={t('landing.footer.company')}
            links={[
              { href: '#features', label: t('landing.footer.links.about') },
              { href: '#schools', label: t('landing.footer.links.careers') },
              { href: '#schools', label: t('landing.footer.links.contact') },
            ]}
          />
          <FooterColumn
            title={t('landing.footer.legal')}
            links={[
              { href: '/compliance', label: t('landing.footer.links.privacy') },
              { href: '/compliance', label: t('landing.footer.links.terms') },
            ]}
          />
        </div>

        <div className="border-t-2 border-background/20 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-background/50">{t('landing.footer.copyright')}</div>
          <div className="flex gap-6">
            <span className="text-background/50 font-medium">
              {t('landing.footer.social.twitter')}
            </span>
            <span className="text-background/50 font-medium">
              {t('landing.footer.social.linkedin')}
            </span>
            <span className="text-background/50 font-medium">
              {t('landing.footer.social.instagram')}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

type FooterColumnProps = {
  title: string;
  links: Array<{ href: string; label: string }>;
};

function FooterColumn({ title, links }: FooterColumnProps) {
  return (
    <div>
      <h4 className="font-display font-bold text-lg mb-4">{title}</h4>
      <ul className="space-y-3">
        {links.map((link) => (
          <li key={`${link.href}-${link.label}`}>
            <a href={link.href} className="text-background/60 hover:text-primary transition-colors">
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
