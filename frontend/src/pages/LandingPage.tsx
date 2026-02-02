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
      <div className="min-h-screen flex items-center justify-center bg-white">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
          <Loader2 className="h-8 w-8 text-purple-600" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white font-sans text-slate-800">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-20 items-center">
            <Link to="/" className="flex items-center space-x-2" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-purple-200">
                <Languages size={24} />
              </div>
              <span className="text-xl font-bold tracking-tight text-slate-900">Lingual</span>
            </Link>

            <div className="hidden md:flex items-center space-x-8">
              <a href="#features" className="text-sm font-medium text-slate-600 hover:text-purple-600 transition-colors">
                {t('landing.nav.features')}
              </a>
              <a href="#how-it-works" className="text-sm font-medium text-slate-600 hover:text-purple-600 transition-colors">
                {t('landing.nav.how')}
              </a>
              <a href="#schools" className="text-sm font-medium text-slate-600 hover:text-purple-600 transition-colors">
                {t('landing.nav.schools')}
              </a>
              <button
                onClick={handleLogin}
                className="text-sm font-medium text-slate-600 hover:text-purple-600 transition-colors"
              >
                {t('landing.nav.login')}
              </button>
              <button
                onClick={handleGetStarted}
                className="bg-indigo-900 hover:bg-indigo-800 text-white text-sm font-semibold py-2.5 px-5 rounded-full shadow-md hover:shadow-lg transition-all transform hover:-translate-y-0.5"
              >
                {t('landing.nav.getStarted')}
              </button>
            </div>

            <div className="md:hidden">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 text-slate-600 hover:bg-slate-50 rounded-lg"
              >
                {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>
        </div>

          {isMobileMenuOpen && (
          <div className="md:hidden bg-white border-b border-slate-100 p-4 space-y-4 shadow-xl">
            <a href="#features" className="block text-base font-medium text-slate-600 hover:text-purple-600" onClick={() => setIsMobileMenuOpen(false)}>
              {t('landing.nav.features')}
            </a>
            <a href="#how-it-works" className="block text-base font-medium text-slate-600 hover:text-purple-600" onClick={() => setIsMobileMenuOpen(false)}>
              {t('landing.nav.how')}
            </a>
            <a href="#schools" className="block text-base font-medium text-slate-600 hover:text-purple-600" onClick={() => setIsMobileMenuOpen(false)}>
              {t('landing.nav.schools')}
            </a>
            <div className="pt-4 border-t border-slate-100 flex flex-col space-y-3">
              <button onClick={handleLogin} className="w-full text-center py-2 text-slate-600 font-medium">
                {t('landing.nav.login')}
              </button>
              <button onClick={handleGetStarted} className="w-full bg-indigo-900 text-white py-3 rounded-xl font-semibold">
                {t('landing.nav.getStarted')}
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 lg:pt-40 lg:pb-32 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              <div className="inline-flex items-center space-x-2 bg-purple-50 text-purple-700 px-3 py-1 rounded-full text-sm font-medium mb-6">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                </span>
                <span>{t('landing.hero.badge')}</span>
              </div>
              <h1 className="text-4xl lg:text-6xl font-bold tracking-tight text-slate-900 leading-[1.15] mb-6">
                {t('landing.hero.titleLine1')} <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-indigo-600">
                  {t('landing.hero.titleLine2')}
                </span>
              </h1>
              <p className="text-lg text-slate-600 mb-8 leading-relaxed max-w-lg">
                {t('landing.hero.subtitle')}
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  onClick={handleGetStarted}
                  className="bg-purple-600 hover:bg-purple-700 text-white text-lg font-semibold py-4 px-8 rounded-full shadow-lg hover:shadow-purple-200 transition-all flex items-center justify-center"
                >
                  {t('landing.hero.ctaPrimary')} <ChevronRight size={20} className="ml-2" />
                </button>
                <a
                  href="#schools"
                  className="bg-white border-2 border-slate-200 hover:border-purple-200 text-slate-700 hover:text-purple-700 text-lg font-semibold py-4 px-8 rounded-full transition-all flex items-center justify-center"
                >
                  {t('landing.hero.ctaSecondary')}
                </a>
              </div>
              <div className="mt-8 flex items-center gap-4 text-sm text-slate-500">
                <div className="flex -space-x-2">
                  {AVATAR_IMAGES.map((src, index) => (
                    <div key={src} className="w-8 h-8 rounded-full border-2 border-white bg-slate-200 overflow-hidden">
                      <img src={src} alt={`User avatar ${index + 1}`} />
                    </div>
                  ))}
                </div>
                <p>{t('landing.hero.trusted')}</p>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="relative"
            >
              <div className="absolute -inset-4 bg-gradient-to-r from-purple-100 to-indigo-100 rounded-[2.5rem] transform rotate-2"></div>
              <div className="relative rounded-2xl overflow-hidden shadow-2xl border-4 border-white">
                <img src={HERO_IMAGE} alt="Student learning" className="w-full h-auto object-cover" />

                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.8 }}
                  className="absolute bottom-8 left-8 bg-white p-4 rounded-xl shadow-xl border border-slate-100 max-w-[200px]"
                >
                  <div className="flex items-center space-x-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span className="text-xs font-semibold text-slate-500">
                      {t('landing.hero.fluencyLabel')}
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-slate-900">92%</div>
                  <div className="text-xs text-green-600 mt-1">
                    {t('landing.hero.fluencyDelta')}
                  </div>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">
              {t('landing.features.title')}
            </h2>
            <p className="text-slate-600 text-lg">
              {t('landing.features.subtitle')}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: <MessageCircle className="text-purple-600" size={32} />,
                title: t('landing.features.cards.speaking.title'),
                desc: t('landing.features.cards.speaking.desc'),
              },
              {
                icon: <Zap className="text-amber-500" size={32} />,
                title: t('landing.features.cards.feedback.title'),
                desc: t('landing.features.cards.feedback.desc'),
              },
              {
                icon: <TrendingUp className="text-blue-500" size={32} />,
                title: t('landing.features.cards.adaptive.title'),
                desc: t('landing.features.cards.adaptive.desc'),
              },
            ].map((feature) => (
              <motion.div
                key={feature.title}
                whileHover={{ y: -5 }}
                className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 hover:shadow-xl transition-all"
              >
                <div className="w-14 h-14 bg-slate-50 rounded-xl flex items-center justify-center mb-6">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">{feature.title}</h3>
                <p className="text-slate-600 leading-relaxed">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl font-bold text-slate-900 mb-8">
                {t('landing.how.title')}
              </h2>
              <div className="space-y-8">
                {[
                  { title: t('landing.how.steps.choose.title'), desc: t('landing.how.steps.choose.desc') },
                  { title: t('landing.how.steps.speak.title'), desc: t('landing.how.steps.speak.desc') },
                  { title: t('landing.how.steps.feedback.title'), desc: t('landing.how.steps.feedback.desc') },
                  { title: t('landing.how.steps.improve.title'), desc: t('landing.how.steps.improve.desc') },
                ].map((step, idx) => (
                  <div key={step.title} className="flex gap-4">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold text-sm">
                      {idx + 1}
                    </div>
                    <div>
                      <h4 className="text-lg font-bold text-slate-900">{step.title}</h4>
                      <p className="text-slate-600 mt-1">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-slate-100 rounded-3xl p-8 aspect-square flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-blue-500/10"></div>
              <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 space-y-4">
                <div className="flex items-center space-x-3 border-b border-slate-100 pb-4">
                  <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">🤖</div>
                  <div>
                    <div className="h-3 w-24 bg-slate-200 rounded"></div>
                    <div className="h-2 w-16 bg-slate-100 rounded mt-2"></div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="bg-slate-50 p-3 rounded-lg rounded-tl-none">
                    <div className="h-2 w-3/4 bg-slate-200 rounded mb-2"></div>
                    <div className="h-2 w-1/2 bg-slate-200 rounded"></div>
                  </div>
                  <div className="bg-purple-50 p-3 rounded-lg rounded-tr-none ml-8 border border-purple-100">
                    <div className="h-2 w-5/6 bg-purple-200 rounded mb-2"></div>
                    <div className="h-2 w-2/3 bg-purple-200 rounded"></div>
                  </div>
                </div>
                <div className="pt-4 flex justify-center">
                  <div className="w-12 h-12 rounded-full bg-red-500 shadow-lg flex items-center justify-center text-white">
                    <div className="w-4 h-4 bg-white rounded-sm"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* For Schools */}
      <section id="schools" className="py-20 bg-indigo-900 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 p-20 opacity-10">
          <School size={400} />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-block bg-indigo-800 px-3 py-1 rounded-full text-indigo-200 text-sm font-medium mb-6">
                {t('landing.schools.badge')}
              </div>
              <h2 className="text-3xl lg:text-4xl font-bold mb-6">
                {t('landing.schools.title')}
              </h2>
              <p className="text-indigo-200 text-lg mb-8 leading-relaxed">
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
                    <CheckCircle className="text-green-400 flex-shrink-0" size={20} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <button className="bg-white text-indigo-900 font-bold py-3 px-8 rounded-full hover:bg-indigo-50 transition-colors">
                {t('landing.schools.cta')}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-indigo-800/50 p-6 rounded-2xl backdrop-blur-sm">
                <div className="text-3xl font-bold text-white mb-2">3x</div>
                <div className="text-indigo-200 text-sm">{t('landing.schools.stats.speaking')}</div>
              </div>
              <div className="bg-indigo-800/50 p-6 rounded-2xl backdrop-blur-sm">
                <div className="text-3xl font-bold text-white mb-2">40%</div>
                <div className="text-indigo-200 text-sm">{t('landing.schools.stats.grading')}</div>
              </div>
              <div className="bg-indigo-800/50 p-6 rounded-2xl backdrop-blur-sm col-span-2">
                <div className="text-3xl font-bold text-white mb-2">100%</div>
                <div className="text-indigo-200 text-sm">
                  {t('landing.schools.stats.confidence')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900">
              {t('landing.testimonials.title')}
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-slate-50 p-8 rounded-2xl relative">
              <div className="flex items-center space-x-4 mb-6">
                <img
                  src={TEACHER_IMAGE}
                  alt="Teacher"
                  className="w-16 h-16 rounded-full object-cover border-4 border-white shadow-md"
                />
                <div>
                  <div className="font-bold text-slate-900">Sarah Johnson</div>
                  <div className="text-sm text-slate-500">
                    {t('landing.testimonials.teacher.role')}
                  </div>
                </div>
              </div>
              <p className="text-slate-700 italic text-lg">
                {t('landing.testimonials.teacher.quote')}
              </p>
              <div className="absolute top-8 right-8 text-purple-200">
                <Star size={40} fill="currentColor" />
              </div>
            </div>

            <div className="bg-slate-50 p-8 rounded-2xl relative">
              <div className="flex items-center space-x-4 mb-6">
                <img
                  src={STUDENT_IMAGE}
                  alt="Student"
                  className="w-16 h-16 rounded-full object-cover border-4 border-white shadow-md"
                />
                <div>
                  <div className="font-bold text-slate-900">Michael Chen</div>
                  <div className="text-sm text-slate-500">
                    {t('landing.testimonials.student.role')}
                  </div>
                </div>
              </div>
              <p className="text-slate-700 italic text-lg">
                {t('landing.testimonials.student.quote')}
              </p>
              <div className="absolute top-8 right-8 text-purple-200">
                <Star size={40} fill="currentColor" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-12">
            <div>
              <div className="flex items-center space-x-2 mb-6">
                <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center text-white">
                  <Languages size={18} />
                </div>
                <span className="text-lg font-bold text-white">Lingual</span>
              </div>
              <p className="text-sm leading-relaxed max-w-xs">
                {t('landing.footer.tagline')}
              </p>
            </div>

            <div>
              <h4 className="text-white font-bold mb-4">{t('landing.footer.product')}</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#features" className="hover:text-purple-400">
                    {t('landing.footer.links.features')}
                  </a>
                </li>
                <li>
                  <a href="#schools" className="hover:text-purple-400">
                    {t('landing.footer.links.schools')}
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-bold mb-4">{t('landing.footer.company')}</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#" className="hover:text-purple-400">
                    {t('landing.footer.links.about')}
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-purple-400">
                    {t('landing.footer.links.careers')}
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-purple-400">
                    {t('landing.footer.links.contact')}
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-bold mb-4">{t('landing.footer.legal')}</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#" className="hover:text-purple-400">
                    {t('landing.footer.links.privacy')}
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-purple-400">
                    {t('landing.footer.links.terms')}
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row justify-between items-center text-sm">
            <div>{t('landing.footer.copyright')}</div>
            <div className="flex space-x-6 mt-4 md:mt-0">
              <a href="#" className="hover:text-white">
                {t('landing.footer.social.twitter')}
              </a>
              <a href="#" className="hover:text-white">
                {t('landing.footer.social.linkedin')}
              </a>
              <a href="#" className="hover:text-white">
                {t('landing.footer.social.instagram')}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
