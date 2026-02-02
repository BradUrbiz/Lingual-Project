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
  ChevronRight,
  Star,
  Loader2,
  Waves,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '@/hooks/useAuth';
import { getUserProfile } from '@/api/user';
import { useLanguage } from '@/contexts/LanguageContext';

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
        } else {
          navigate('/assessment');
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
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
          <Loader2 className="h-8 w-8 text-primary" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background font-sans text-foreground overflow-x-hidden">
      {/* Animated background blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-gradient-to-br from-primary/20 via-cyan-400/15 to-accent/10 blob-animated opacity-60" />
        <div className="absolute top-1/3 -left-32 w-[500px] h-[500px] bg-gradient-to-tr from-accent/15 via-primary/10 to-cyan-400/15 blob-animated opacity-50" style={{ animationDelay: '-2s' }} />
        <div className="absolute -bottom-40 right-1/4 w-[400px] h-[400px] bg-gradient-to-tl from-cyan-400/15 to-primary/20 blob-animated opacity-40" style={{ animationDelay: '-4s' }} />
      </div>

      {/* Navigation - Glass effect */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass-fluid border-b border-white/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-20 items-center">
            <Link to="/" className="flex items-center space-x-3" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              <div className="w-11 h-11 bg-gradient-to-br from-primary to-cyan-500 rounded-2xl flex items-center justify-center text-white shadow-glow-teal">
                <Languages size={24} />
              </div>
              <span className="text-xl font-bold tracking-tight text-foreground">Lingual</span>
            </Link>

            <div className="hidden md:flex items-center space-x-8">
              <a href="#features" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors duration-300">
                {t('landing.nav.features')}
              </a>
              <a href="#how-it-works" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors duration-300">
                {t('landing.nav.how')}
              </a>
              <a href="#schools" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors duration-300">
                {t('landing.nav.schools')}
              </a>
              <button
                onClick={handleLogin}
                className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors duration-300"
              >
                {t('landing.nav.login')}
              </button>
              <button
                onClick={handleGetStarted}
                className="bg-gradient-to-r from-primary via-teal-500 to-cyan-500 text-white text-sm font-semibold py-2.5 px-6 rounded-full shadow-[0_4px_16px_rgba(13,148,136,0.3)] hover:shadow-[0_8px_24px_rgba(13,148,136,0.4)] transition-all duration-300 hover:-translate-y-0.5"
              >
                {t('landing.nav.getStarted')}
              </button>
            </div>

            <div className="md:hidden">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 text-muted-foreground hover:bg-secondary rounded-xl transition-colors"
              >
                {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>
        </div>

        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="md:hidden glass-fluid border-b border-white/20 p-4 space-y-4"
          >
            <a href="#features" className="block text-base font-medium text-muted-foreground hover:text-primary transition-colors" onClick={() => setIsMobileMenuOpen(false)}>
              {t('landing.nav.features')}
            </a>
            <a href="#how-it-works" className="block text-base font-medium text-muted-foreground hover:text-primary transition-colors" onClick={() => setIsMobileMenuOpen(false)}>
              {t('landing.nav.how')}
            </a>
            <a href="#schools" className="block text-base font-medium text-muted-foreground hover:text-primary transition-colors" onClick={() => setIsMobileMenuOpen(false)}>
              {t('landing.nav.schools')}
            </a>
            <div className="pt-4 border-t border-border flex flex-col space-y-3">
              <button onClick={handleLogin} className="w-full text-center py-2 text-muted-foreground font-medium">
                {t('landing.nav.login')}
              </button>
              <button onClick={handleGetStarted} className="w-full bg-gradient-to-r from-primary to-cyan-500 text-white py-3 rounded-full font-semibold shadow-glow-teal">
                {t('landing.nav.getStarted')}
              </button>
            </div>
          </motion.div>
        )}
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 lg:pt-44 lg:pb-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
            >
              <div className="inline-flex items-center space-x-2 bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-medium mb-6 backdrop-blur-sm">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                <span>{t('landing.hero.badge')}</span>
              </div>
              <h1 className="text-4xl lg:text-6xl font-bold tracking-tight text-foreground leading-[1.1] mb-6">
                {t('landing.hero.titleLine1')} <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-teal-500 to-cyan-500">
                  {t('landing.hero.titleLine2')}
                </span>
              </h1>
              <p className="text-lg text-muted-foreground mb-8 leading-relaxed max-w-lg">
                {t('landing.hero.subtitle')}
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  onClick={handleGetStarted}
                  className="bg-gradient-to-r from-primary via-teal-500 to-cyan-500 text-white text-lg font-semibold py-4 px-8 rounded-full shadow-[0_8px_24px_rgba(13,148,136,0.35)] hover:shadow-[0_12px_32px_rgba(13,148,136,0.45)] transition-all duration-300 hover:-translate-y-1 flex items-center justify-center"
                >
                  {t('landing.hero.ctaPrimary')} <ChevronRight size={20} className="ml-2" />
                </button>
                <a
                  href="#schools"
                  className="bg-white border-2 border-border text-foreground hover:border-primary/40 text-lg font-semibold py-4 px-8 rounded-full transition-all duration-300 hover:-translate-y-0.5 shadow-fluid hover:shadow-fluid-hover flex items-center justify-center"
                >
                  {t('landing.hero.ctaSecondary')}
                </a>
              </div>
              <div className="mt-10 flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex -space-x-2">
                  {AVATAR_IMAGES.map((src, index) => (
                    <div key={src} className="w-9 h-9 rounded-full border-2 border-white bg-secondary overflow-hidden shadow-sm">
                      <img src={src} alt={`User avatar ${index + 1}`} />
                    </div>
                  ))}
                </div>
                <p>{t('landing.hero.trusted')}</p>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="relative"
            >
              {/* Fluid gradient background */}
              <div className="absolute -inset-6 bg-gradient-to-br from-primary/20 via-cyan-400/15 to-accent/10 rounded-[3rem] transform rotate-2 blob"></div>
              <div className="relative rounded-3xl overflow-hidden shadow-fluid-hover border-4 border-white/80">
                <img src={HERO_IMAGE} alt="Student learning" className="w-full h-auto object-cover" />

                <motion.div
                  initial={{ y: 30, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 1, ease: [0.4, 0, 0.2, 1] }}
                  className="absolute bottom-8 left-8 glass-fluid p-5 rounded-2xl shadow-fluid max-w-[220px] border border-white/30"
                >
                  <div className="flex items-center space-x-2 mb-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-success animate-pulse"></div>
                    <span className="text-xs font-semibold text-muted-foreground">
                      {t('landing.hero.fluencyLabel')}
                    </span>
                  </div>
                  <div className="text-3xl font-bold text-foreground">92%</div>
                  <div className="text-xs text-success font-medium mt-1">
                    {t('landing.hero.fluencyDelta')}
                  </div>
                </motion.div>

                {/* Floating wave icon */}
                <motion.div
                  className="absolute top-6 right-6 w-12 h-12 bg-gradient-to-br from-primary to-cyan-500 rounded-2xl flex items-center justify-center text-white shadow-glow-teal"
                  animate={{ y: [0, -8, 0] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Waves size={24} />
                </motion.div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative py-24 bg-gradient-to-b from-transparent via-secondary/30 to-transparent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
              {t('landing.features.title')}
            </h2>
            <p className="text-muted-foreground text-lg">
              {t('landing.features.subtitle')}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: <MessageCircle className="text-primary" size={28} />,
                title: t('landing.features.cards.speaking.title'),
                desc: t('landing.features.cards.speaking.desc'),
                gradient: 'from-primary/10 to-cyan-400/10',
              },
              {
                icon: <Zap className="text-amber-500" size={28} />,
                title: t('landing.features.cards.feedback.title'),
                desc: t('landing.features.cards.feedback.desc'),
                gradient: 'from-amber-400/10 to-orange-400/10',
              },
              {
                icon: <TrendingUp className="text-accent" size={28} />,
                title: t('landing.features.cards.adaptive.title'),
                desc: t('landing.features.cards.adaptive.desc'),
                gradient: 'from-accent/10 to-violet-400/10',
              },
            ].map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1, ease: [0.4, 0, 0.2, 1] }}
                viewport={{ once: true }}
                whileHover={{ y: -6, scale: 1.02 }}
                className="bg-card p-8 rounded-3xl shadow-fluid hover:shadow-fluid-hover transition-all duration-400 ease-[cubic-bezier(0.4,0,0.2,1)] border border-border/50"
              >
                <div className={`w-14 h-14 bg-gradient-to-br ${feature.gradient} rounded-2xl flex items-center justify-center mb-6`}>
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold text-foreground mb-3">{feature.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-10">
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
                    className="flex gap-5"
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.1, ease: [0.4, 0, 0.2, 1] }}
                    viewport={{ once: true }}
                  >
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-primary to-cyan-500 text-white flex items-center justify-center font-bold text-sm shadow-glow-teal">
                      {idx + 1}
                    </div>
                    <div>
                      <h4 className="text-lg font-bold text-foreground">{step.title}</h4>
                      <p className="text-muted-foreground mt-1 leading-relaxed">{step.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
            <div className="bg-gradient-to-br from-primary/5 via-cyan-400/5 to-accent/5 rounded-[2.5rem] p-8 aspect-square flex items-center justify-center relative overflow-hidden">
              {/* Decorative blobs */}
              <div className="absolute top-0 right-0 w-40 h-40 bg-primary/10 blob-animated opacity-60" style={{ animationDelay: '-2s' }} />
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-accent/10 blob-animated opacity-50" />

              <div className="relative w-full max-w-sm bg-card rounded-3xl shadow-fluid-hover p-6 space-y-4 border border-border/50">
                <div className="flex items-center space-x-3 border-b border-border pb-4">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-primary to-cyan-500 flex items-center justify-center text-white shadow-sm">
                    <Languages size={20} />
                  </div>
                  <div>
                    <div className="h-3 w-24 bg-secondary rounded-full"></div>
                    <div className="h-2 w-16 bg-secondary/50 rounded-full mt-2"></div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="bg-secondary/50 p-4 rounded-2xl rounded-tl-sm">
                    <div className="h-2.5 w-3/4 bg-border rounded-full mb-2"></div>
                    <div className="h-2.5 w-1/2 bg-border rounded-full"></div>
                  </div>
                  <div className="bg-primary/10 p-4 rounded-2xl rounded-tr-sm ml-8 border border-primary/20">
                    <div className="h-2.5 w-5/6 bg-primary/30 rounded-full mb-2"></div>
                    <div className="h-2.5 w-2/3 bg-primary/30 rounded-full"></div>
                  </div>
                </div>
                <div className="pt-4 flex justify-center">
                  <motion.div
                    className="w-14 h-14 rounded-full bg-gradient-to-br from-destructive to-rose-400 shadow-lg flex items-center justify-center text-white"
                    animate={{ scale: [1, 1.05, 1] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <div className="w-4 h-4 bg-white rounded-sm"></div>
                  </motion.div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* For Schools */}
      <section id="schools" className="py-24 bg-gradient-to-br from-primary via-teal-600 to-cyan-600 text-white relative overflow-hidden">
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 blob-animated" />
          <div className="absolute bottom-0 left-0 w-80 h-80 bg-white/5 blob-animated" style={{ animationDelay: '-3s' }} />
        </div>
        <div className="absolute top-0 right-0 p-20 opacity-10">
          <School size={400} />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-block bg-white/10 backdrop-blur-sm px-4 py-1.5 rounded-full text-teal-100 text-sm font-medium mb-6">
                {t('landing.schools.badge')}
              </div>
              <h2 className="text-3xl lg:text-4xl font-bold mb-6">
                {t('landing.schools.title')}
              </h2>
              <p className="text-teal-100 text-lg mb-8 leading-relaxed">
                {t('landing.schools.subtitle')}
              </p>

              <ul className="space-y-4 mb-8">
                {[
                  t('landing.schools.bullets.assessments'),
                  t('landing.schools.bullets.curriculum'),
                  t('landing.schools.bullets.dashboard'),
                  t('landing.schools.bullets.integration'),
                ].map((item) => (
                  <li key={item} className="flex items-center space-x-3">
                    <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                      <CheckCircle className="text-white" size={16} />
                    </div>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <button className="bg-white text-primary font-bold py-3.5 px-8 rounded-full hover:bg-teal-50 transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-0.5">
                {t('landing.schools.cta')}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <motion.div
                className="bg-white/10 backdrop-blur-sm p-6 rounded-3xl border border-white/20"
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.3 }}
              >
                <div className="text-4xl font-bold text-white mb-2">3x</div>
                <div className="text-teal-100 text-sm">{t('landing.schools.stats.speaking')}</div>
              </motion.div>
              <motion.div
                className="bg-white/10 backdrop-blur-sm p-6 rounded-3xl border border-white/20"
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.3 }}
              >
                <div className="text-4xl font-bold text-white mb-2">40%</div>
                <div className="text-teal-100 text-sm">{t('landing.schools.stats.grading')}</div>
              </motion.div>
              <motion.div
                className="bg-white/10 backdrop-blur-sm p-6 rounded-3xl col-span-2 border border-white/20"
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.3 }}
              >
                <div className="text-4xl font-bold text-white mb-2">100%</div>
                <div className="text-teal-100 text-sm">
                  {t('landing.schools.stats.confidence')}
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground">
              {t('landing.testimonials.title')}
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            <motion.div
              className="bg-gradient-to-br from-secondary/50 to-transparent p-8 rounded-3xl relative border border-border/50"
              whileHover={{ y: -4 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex items-center space-x-4 mb-6">
                <img
                  src={TEACHER_IMAGE}
                  alt="Teacher"
                  className="w-16 h-16 rounded-full object-cover border-4 border-white shadow-fluid"
                />
                <div>
                  <div className="font-bold text-foreground">Sarah Johnson</div>
                  <div className="text-sm text-muted-foreground">
                    {t('landing.testimonials.teacher.role')}
                  </div>
                </div>
              </div>
              <p className="text-secondary-foreground italic text-lg leading-relaxed">
                {t('landing.testimonials.teacher.quote')}
              </p>
              <div className="absolute top-8 right-8 text-primary/20">
                <Star size={48} fill="currentColor" />
              </div>
            </motion.div>

            <motion.div
              className="bg-gradient-to-br from-secondary/50 to-transparent p-8 rounded-3xl relative border border-border/50"
              whileHover={{ y: -4 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex items-center space-x-4 mb-6">
                <img
                  src={STUDENT_IMAGE}
                  alt="Student"
                  className="w-16 h-16 rounded-full object-cover border-4 border-white shadow-fluid"
                />
                <div>
                  <div className="font-bold text-foreground">Michael Chen</div>
                  <div className="text-sm text-muted-foreground">
                    {t('landing.testimonials.student.role')}
                  </div>
                </div>
              </div>
              <p className="text-secondary-foreground italic text-lg leading-relaxed">
                {t('landing.testimonials.student.quote')}
              </p>
              <div className="absolute top-8 right-8 text-accent/20">
                <Star size={48} fill="currentColor" />
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-cyan-400/5 to-accent/5" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-to-br from-primary/10 to-cyan-400/10 blob-animated opacity-30" />

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl lg:text-5xl font-bold text-foreground mb-6">
              Ready to flow into fluency?
            </h2>
            <p className="text-lg text-muted-foreground mb-10 max-w-2xl mx-auto">
              Join thousands of learners who have transformed their Korean speaking skills with AI-powered conversation practice.
            </p>
            <button
              onClick={handleGetStarted}
              className="bg-gradient-to-r from-primary via-teal-500 to-cyan-500 text-white text-lg font-semibold py-4 px-10 rounded-full shadow-[0_8px_32px_rgba(13,148,136,0.35)] hover:shadow-[0_12px_40px_rgba(13,148,136,0.45)] transition-all duration-300 hover:-translate-y-1"
            >
              Start Your Journey <ChevronRight size={20} className="ml-2 inline" />
            </button>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-foreground text-muted py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-12">
            <div>
              <div className="flex items-center space-x-2 mb-6">
                <div className="w-10 h-10 bg-gradient-to-br from-primary to-cyan-500 rounded-xl flex items-center justify-center text-white">
                  <Languages size={20} />
                </div>
                <span className="text-lg font-bold text-white">Lingual</span>
              </div>
              <p className="text-sm leading-relaxed text-slate-400 max-w-xs">
                {t('landing.footer.tagline')}
              </p>
            </div>

            <div>
              <h4 className="text-white font-bold mb-4">{t('landing.footer.product')}</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#features" className="text-slate-400 hover:text-primary transition-colors">
                    {t('landing.footer.links.features')}
                  </a>
                </li>
                <li>
                  <a href="#schools" className="text-slate-400 hover:text-primary transition-colors">
                    {t('landing.footer.links.schools')}
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-bold mb-4">{t('landing.footer.company')}</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#" className="text-slate-400 hover:text-primary transition-colors">
                    {t('landing.footer.links.about')}
                  </a>
                </li>
                <li>
                  <a href="#" className="text-slate-400 hover:text-primary transition-colors">
                    {t('landing.footer.links.careers')}
                  </a>
                </li>
                <li>
                  <a href="#" className="text-slate-400 hover:text-primary transition-colors">
                    {t('landing.footer.links.contact')}
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-bold mb-4">{t('landing.footer.legal')}</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#" className="text-slate-400 hover:text-primary transition-colors">
                    {t('landing.footer.links.privacy')}
                  </a>
                </li>
                <li>
                  <a href="#" className="text-slate-400 hover:text-primary transition-colors">
                    {t('landing.footer.links.terms')}
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row justify-between items-center text-sm">
            <div className="text-slate-400">{t('landing.footer.copyright')}</div>
            <div className="flex space-x-6 mt-4 md:mt-0">
              <a href="#" className="text-slate-400 hover:text-white transition-colors">
                {t('landing.footer.social.twitter')}
              </a>
              <a href="#" className="text-slate-400 hover:text-white transition-colors">
                {t('landing.footer.social.linkedin')}
              </a>
              <a href="#" className="text-slate-400 hover:text-white transition-colors">
                {t('landing.footer.social.instagram')}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
