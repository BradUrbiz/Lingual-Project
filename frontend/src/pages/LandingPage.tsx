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
  ArrowRight,
  Star,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '@/hooks/useAuth';
import { getUserProfile } from '@/api/user';
import { useLanguage } from '@/contexts/LanguageContext';
import { staggerContainer, staggerItem, cardVariants } from '@/lib/animations';

const HERO_IMAGE = '/imgs/landing/hero.jpg';
const TEACHER_IMAGE = '/imgs/landing/teacher.jpg';
const STUDENT_IMAGE = '/imgs/landing/student.jpg';
const AVATAR_IMAGES = [
  '/imgs/avatars/user-1.svg',
  '/imgs/avatars/user-2.svg',
  '/imgs/avatars/user-3.svg',
  '/imgs/avatars/user-4.svg',
];

export function LandingPage() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [checkingProfile, setCheckingProfile] = useState(false);
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { t } = useLanguage();

  const handleLogin = () => {
    if (!user) {
      navigate('/auth');
      return;
    }
    navigate('/app/learn');
  };

  const handleGetStarted = async () => {
    if (!user) {
      navigate('/auth');
      return;
    }

    setCheckingProfile(true);
    try {
      const profile = await getUserProfile();
      if (profile.profileCompleted) {
        if (profile.assessed) {
          navigate('/app/learn');
        } else if (profile.assessmentPreference === 'skip') {
          navigate('/app/learn');
        } else if (profile.assessmentPreference === 'take') {
          navigate('/assessment');
        } else {
          navigate('/onboarding');
        }
      } else {
        navigate('/general');
      }
    } catch {
      navigate('/general');
    } finally {
      setCheckingProfile(false);
    }
  };

  if (loading || checkingProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}>
          <Loader2 className="h-10 w-10 text-primary" strokeWidth={3} />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background font-body text-foreground">
      {/* Navigation - Warm Brutalism style */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-b-3 border-foreground">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-20 items-center">
            <Link
              to="/"
              className="flex items-center gap-3 group"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            >
              <div className="w-12 h-12 bg-primary border-3 border-foreground rounded-xl flex items-center justify-center text-primary-foreground shadow-stamp-sm group-hover:shadow-stamp transition-shadow">
                <Languages size={26} strokeWidth={2.5} />
              </div>
              <span className="text-2xl font-display font-bold tracking-tight">Lingual</span>
            </Link>

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
                onClick={handleLogin}
                className="font-medium text-foreground/70 hover:text-primary transition-colors border-b-2 border-transparent hover:border-primary pb-1"
              >
                {t('landing.nav.login')}
              </button>
              <motion.button
                onClick={handleGetStarted}
                whileHover={{ y: -2, boxShadow: '6px 6px 0 0 #2D2A26' }}
                whileTap={{ y: 2, boxShadow: '2px 2px 0 0 #2D2A26' }}
                className="bg-primary text-primary-foreground font-bold py-3 px-6 rounded-xl border-3 border-foreground shadow-stamp transition-all"
              >
                {t('landing.nav.getStarted')}
              </motion.button>
            </div>

            <div className="md:hidden">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 text-foreground hover:bg-secondary rounded-lg border-2 border-foreground"
              >
                {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="md:hidden bg-card border-b-3 border-foreground p-6"
          >
            <a href="#features" className="block text-lg font-medium py-3 hover:text-primary"  onClick={() => setIsMobileMenuOpen(false)}>
              {t('landing.nav.features')}
            </a>
            <a href="#how-it-works" className="block text-lg font-medium py-3 hover:text-primary"  onClick={() => setIsMobileMenuOpen(false)}>
              {t('landing.nav.how')}
            </a>
            <a href="#schools"  className="block text-lg font-medium py-3 hover:text-primary" onClick={() => setIsMobileMenuOpen(false)}>
              {t('landing.nav.schools')}
            </a>
            <div className="pt-4 border-t-2 border-border flex flex-col gap-3">
              <button onClick={handleLogin} className="w-full text-center py-3 font-medium border-2 border-foreground rounded-xl">
                {t('landing.nav.login')}
              </button>
              <button onClick={handleGetStarted} className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-bold border-3 border-foreground shadow-stamp-sm">
                {t('landing.nav.getStarted')}
              </button>
            </div>
          </motion.div>
        )}
      </nav>

      {/* Hero Section - Bold Brutalist */}
      <section className="pt-28 pb-16 lg:pt-36 lg:pb-24 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <motion.div
              variants={staggerContainer}
              initial="initial"
              animate="animate"
            >
              <motion.div
                variants={staggerItem}
                className="inline-flex items-center gap-2 bg-accent/20 text-accent-foreground px-4 py-2 rounded-full border-2 border-accent font-medium mb-8"
              >
                <Sparkles size={18} className="text-accent" />
                <span>{t('landing.hero.badge')}</span>
              </motion.div>

              <motion.h1
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
              </motion.h1>

              <motion.p
                variants={staggerItem}
                className="text-xl text-muted-foreground mb-10 leading-relaxed max-w-lg"
              >
                {t('landing.hero.subtitle')}
              </motion.p>

              <motion.div variants={staggerItem} className="flex flex-col sm:flex-row gap-4">
                <motion.button
                  onClick={handleGetStarted}
                  whileHover={{ y: -3, boxShadow: '8px 8px 0 0 #2D2A26' }}
                  whileTap={{ y: 2, boxShadow: '2px 2px 0 0 #2D2A26' }}
                  className="bg-primary text-primary-foreground text-lg font-bold py-4 px-8 rounded-xl border-3 border-foreground shadow-stamp flex items-center justify-center gap-2 transition-all"
                >
                  {t('landing.hero.ctaPrimary')}
                  <ArrowRight size={22} strokeWidth={2.5} />
                </motion.button>
                <motion.a
                  href="#schools"
                  whileHover={{ y: -2 }}
                  whileTap={{ y: 1 }}
                  className="bg-card text-foreground text-lg font-bold py-4 px-8 rounded-xl border-3 border-foreground flex items-center justify-center transition-all hover:bg-secondary"
                >
                  {t('landing.hero.ctaSecondary')}
                </motion.a>
              </motion.div>

              <motion.div variants={staggerItem} className="mt-10 flex items-center gap-4">
                <div className="flex -space-x-3">
                  {AVATAR_IMAGES.map((src, index) => (
                    <div
                      key={src}
                      className="w-10 h-10 rounded-full border-3 border-background bg-secondary overflow-hidden"
                      style={{ zIndex: AVATAR_IMAGES.length - index }}
                    >
                      <img src={src} alt={`User avatar ${index + 1}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
                <p className="text-muted-foreground font-medium">{t('landing.hero.trusted')}</p>
              </motion.div>
            </motion.div>

            {/* Hero Image - Brutalist frame */}
            <motion.div
              variants={cardVariants}
              initial="initial"
              animate="animate"
              className="relative"
            >
              <div className="absolute -inset-3 bg-accent/30 rounded-2xl transform rotate-3"></div>
              <div className="absolute -inset-3 bg-primary/20 rounded-2xl transform -rotate-2"></div>
              <div className="relative rounded-2xl overflow-hidden border-4 border-foreground shadow-stamp bg-card">
                <img src={HERO_IMAGE} alt="Student learning" className="w-full h-auto object-cover" />

                {/* Stats card overlay */}
                <motion.div
                  initial={{ y: 30, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.6, type: 'spring', stiffness: 300 }}
                  className="absolute bottom-6 left-6 bg-card p-5 rounded-xl border-3 border-foreground shadow-stamp"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full bg-success"></div>
                    <span className="text-sm font-bold text-muted-foreground uppercase tracking-wide">
                      {t('landing.hero.fluencyLabel')}
                    </span>
                  </div>
                  <div className="text-4xl font-display font-bold">92%</div>
                  <div className="text-sm text-success font-medium mt-1">
                    {t('landing.hero.fluencyDelta')}
                  </div>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features Section - Brutalist Cards */}
      <section id="features" className="py-20 bg-secondary">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
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
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            {[
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
            ].map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1, type: 'spring', stiffness: 300 }}
                whileHover={{ y: -6, boxShadow: '8px 8px 0 0 #2D2A26' }}
                className={`bg-card p-8 rounded-2xl border-3 border-foreground shadow-stamp transition-all cursor-default`}
              >
                <div className={`w-16 h-16 ${feature.color} rounded-xl border-2 ${feature.accent} flex items-center justify-center mb-6`}>
                  {feature.icon}
                </div>
                <h3 className="text-2xl font-display font-bold mb-4">{feature.title}</h3>
                <p className="text-muted-foreground text-lg leading-relaxed">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works - Steps with brutalist numbers */}
      <section id="how-it-works" className="py-20 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="text-4xl lg:text-5xl font-display font-bold mb-10">
                {t('landing.how.title')}
              </h2>
              <div className="space-y-8">
                {[
                  { title: t('landing.how.steps.choose.title'), desc: t('landing.how.steps.choose.desc') },
                  { title: t('landing.how.steps.speak.title'), desc: t('landing.how.steps.speak.desc') },
                  { title: t('landing.how.steps.feedback.title'), desc: t('landing.how.steps.feedback.desc') },
                  { title: t('landing.how.steps.improve.title'), desc: t('landing.how.steps.improve.desc') },
                ].map((step, idx) => (
                  <motion.div
                    key={step.title}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: idx * 0.1 }}
                    className="flex gap-5"
                  >
                    <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary text-primary-foreground border-3 border-foreground flex items-center justify-center font-display font-bold text-xl shadow-stamp-sm">
                      {idx + 1}
                    </div>
                    <div>
                      <h4 className="text-xl font-display font-bold mb-2">{step.title}</h4>
                      <p className="text-muted-foreground text-lg">{step.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Chat mockup - Brutalist style */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="bg-secondary rounded-3xl p-8 border-3 border-foreground shadow-stamp"
            >
              <div className="bg-card rounded-2xl border-3 border-foreground p-6 space-y-4">
                <div className="flex items-center gap-4 border-b-2 border-border pb-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/20 border-2 border-primary flex items-center justify-center text-2xl">
                    🤖
                  </div>
                  <div>
                    <div className="font-display font-bold text-lg">AI Tutor</div>
                    <div className="text-sm text-success font-medium flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-success"></div>
                      Online
                    </div>
                  </div>
                </div>
                <div className="space-y-4 py-2">
                  <div className="bg-secondary p-4 rounded-xl rounded-tl-none border-2 border-border max-w-[85%]">
                    <div className="h-3 w-3/4 bg-border rounded mb-2"></div>
                    <div className="h-3 w-1/2 bg-border rounded"></div>
                  </div>
                  <div className="bg-primary/10 p-4 rounded-xl rounded-tr-none ml-auto border-2 border-primary max-w-[85%]">
                    <div className="h-3 w-5/6 bg-primary/30 rounded mb-2"></div>
                    <div className="h-3 w-2/3 bg-primary/30 rounded"></div>
                  </div>
                </div>
                <div className="pt-4 flex justify-center">
                  <div className="w-16 h-16 rounded-full bg-destructive border-3 border-foreground shadow-stamp-sm flex items-center justify-center">
                    <div className="w-5 h-5 bg-destructive-foreground rounded-sm"></div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* For Schools - Dark section with brutalist stats */}
      <section id="schools" className="py-20 bg-ink text-background relative overflow-hidden">
        <div className="absolute top-0 right-0 p-16 opacity-5">
          <School size={500} strokeWidth={1} />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div
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
                {[
                  t('landing.schools.bullets.assessments'),
                  t('landing.schools.bullets.curriculum'),
                  t('landing.schools.bullets.dashboard'),
                  t('landing.schools.bullets.integration'),
                ].map((item) => (
                  <li key={item} className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-lg bg-success flex items-center justify-center flex-shrink-0">
                      <CheckCircle className="text-success-foreground" size={18} strokeWidth={3} />
                    </div>
                    <span className="text-lg text-background/90">{item}</span>
                  </li>
                ))}
              </ul>

              <motion.button
                onClick={() => navigate('/app/teacher')}
                whileHover={{ y: -3, boxShadow: '6px 6px 0 0 #F5F0E8' }}
                whileTap={{ y: 2 }}
                className="bg-background text-ink font-bold py-4 px-8 rounded-xl border-3 border-background shadow-[4px_4px_0_0_#F5F0E8] transition-all"
              >
                {t('landing.schools.cta')}
              </motion.button>
            </motion.div>

            {/* Stats grid - brutalist boxes */}
            <div className="grid grid-cols-2 gap-4">
              {[
                { value: '3x', label: t('landing.schools.stats.speaking'), color: 'bg-primary' },
                { value: '40%', label: t('landing.schools.stats.grading'), color: 'bg-accent' },
              ].map((stat, idx) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.1 }}
                  className={`${stat.color} p-6 rounded-2xl border-3 border-background`}
                >
                  <div className="text-4xl font-display font-bold text-background mb-2">{stat.value}</div>
                  <div className="text-background/80 font-medium">{stat.label}</div>
                </motion.div>
              ))}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.2 }}
                className="col-span-2 bg-success p-6 rounded-2xl border-3 border-background"
              >
                <div className="text-4xl font-display font-bold text-background mb-2">100%</div>
                <div className="text-background/80 font-medium">
                  {t('landing.schools.stats.confidence')}
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials - Brutalist quote cards */}
      <section className="py-20 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl lg:text-5xl font-display font-bold">
              {t('landing.testimonials.title')}
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8">
            {[
              {
                image: TEACHER_IMAGE,
                name: 'Sarah Johnson',
                role: t('landing.testimonials.teacher.role'),
                quote: t('landing.testimonials.teacher.quote'),
              },
              {
                image: STUDENT_IMAGE,
                name: 'Michael Chen',
                role: t('landing.testimonials.student.role'),
                quote: t('landing.testimonials.student.quote'),
              },
            ].map((testimonial, idx) => (
              <motion.div
                key={testimonial.name}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.15 }}
                className="bg-card p-8 rounded-2xl border-3 border-foreground shadow-stamp relative"
              >
                <div className="absolute -top-4 -right-4 w-12 h-12 bg-accent rounded-xl border-3 border-foreground flex items-center justify-center rotate-12">
                  <Star size={24} fill="currentColor" className="text-accent-foreground" />
                </div>
                <div className="flex items-center gap-4 mb-6">
                  <img
                    src={testimonial.image}
                    alt={testimonial.name}
                    className="w-16 h-16 rounded-xl object-cover border-3 border-foreground"
                  />
                  <div>
                    <div className="font-display font-bold text-xl">{testimonial.name}</div>
                    <div className="text-muted-foreground font-medium">{testimonial.role}</div>
                  </div>
                </div>
                <p className="text-lg leading-relaxed italic text-foreground/80">
                  "{testimonial.quote}"
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer - Clean brutalist */}
      <footer className="bg-ink text-background py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-10 mb-12">
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-primary border-2 border-background rounded-lg flex items-center justify-center">
                  <Languages size={22} className="text-primary-foreground" />
                </div>
                <span className="text-xl font-display font-bold">Lingual</span>
              </div>
              <p className="text-background/60 leading-relaxed">
                {t('landing.footer.tagline')}
              </p>
            </div>

            <div>
              <h4 className="font-display font-bold text-lg mb-4">{t('landing.footer.product')}</h4>
              <ul className="space-y-3">
                <li>
                  <a href="#features" className="text-background/60 hover:text-primary transition-colors">
                    {t('landing.footer.links.features')}
                  </a>
                </li>
                <li>
                  <a href="#schools" className="text-background/60 hover:text-primary transition-colors">
                    {t('landing.footer.links.schools')}
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-display font-bold text-lg mb-4">{t('landing.footer.company')}</h4>
              <ul className="space-y-3">
                <li><a href="#" className="text-background/60 hover:text-primary transition-colors">{t('landing.footer.links.about')}</a></li>
                <li><a href="#" className="text-background/60 hover:text-primary transition-colors">{t('landing.footer.links.careers')}</a></li>
                <li><a href="#" className="text-background/60 hover:text-primary transition-colors">{t('landing.footer.links.contact')}</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-display font-bold text-lg mb-4">{t('landing.footer.legal')}</h4>
              <ul className="space-y-3">
                <li><a href="#" className="text-background/60 hover:text-primary transition-colors">{t('landing.footer.links.privacy')}</a></li>
                <li><a href="#" className="text-background/60 hover:text-primary transition-colors">{t('landing.footer.links.terms')}</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t-2 border-background/20 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="text-background/50">{t('landing.footer.copyright')}</div>
            <div className="flex gap-6">
              <a href="#" className="text-background/50 hover:text-background transition-colors font-medium">
                {t('landing.footer.social.twitter')}
              </a>
              <a href="#" className="text-background/50 hover:text-background transition-colors font-medium">
                {t('landing.footer.social.linkedin')}
              </a>
              <a href="#" className="text-background/50 hover:text-background transition-colors font-medium">
                {t('landing.footer.social.instagram')}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
