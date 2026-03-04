import React, { useState } from 'react';
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
  Globe,
  Star
} from 'lucide-react';
import { motion } from 'motion/react';

// Images
const HERO_IMAGE = "https://images.unsplash.com/photo-1758874384930-6e1452bb9c71?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzdHVkZW50JTIwbGVhcm5pbmclMjBvbiUyMGxhcHRvcCUyMGhhcHB5fGVufDF8fHx8MTc2OTk4NTk3MXww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral";
const TEACHER_IMAGE = "https://images.unsplash.com/photo-1758685848006-1bc450061624?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwcm9mZXNzaW9uYWwlMjB0ZWFjaGVyJTIwcG9ydHJhaXQlMjB3b21hbnxlbnwxfHx8fDE3Njk5ODU5NzV8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral";
const STUDENT_IMAGE = "https://images.unsplash.com/photo-1574888121821-1dc5d49eeba1?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzbWlsaW5nJTIwdGVlbiUyMHN0dWRlbnQlMjBwb3J0cmFpdHxlbnwxfHx8fDE3Njk5ODU5Nzl8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral";

export function LandingPage() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogin = () => {
    navigate('/app');
  };

  return (
    <div className="min-h-screen bg-white font-sans text-slate-800">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-20 items-center">
            {/* Logo */}
            <Link to="/" className="flex items-center space-x-2" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-purple-200">
                <Languages size={24} />
              </div>
              <span className="text-xl font-bold tracking-tight text-slate-900">Lingual</span>
            </Link>

            {/* Desktop Menu */}
            <div className="hidden md:flex items-center space-x-8">
              <a href="#features" className="text-sm font-medium text-slate-600 hover:text-purple-600 transition-colors">Features</a>
              <a href="#how-it-works" className="text-sm font-medium text-slate-600 hover:text-purple-600 transition-colors">How it Works</a>
              <a href="#schools" className="text-sm font-medium text-slate-600 hover:text-purple-600 transition-colors">For Schools</a>
              <button 
                onClick={handleLogin}
                className="text-sm font-medium text-slate-600 hover:text-purple-600 transition-colors"
              >
                Log In
              </button>
              <button 
                onClick={handleLogin}
                className="bg-indigo-900 hover:bg-indigo-800 text-white text-sm font-semibold py-2.5 px-5 rounded-full shadow-md hover:shadow-lg transition-all transform hover:-translate-y-0.5"
              >
                Get Started
              </button>
            </div>

            {/* Mobile Menu Button */}
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

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden bg-white border-b border-slate-100 p-4 space-y-4 shadow-xl">
            <a href="#features" className="block text-base font-medium text-slate-600 hover:text-purple-600" onClick={() => setIsMobileMenuOpen(false)}>Features</a>
            <a href="#how-it-works" className="block text-base font-medium text-slate-600 hover:text-purple-600" onClick={() => setIsMobileMenuOpen(false)}>How it Works</a>
            <a href="#schools" className="block text-base font-medium text-slate-600 hover:text-purple-600" onClick={() => setIsMobileMenuOpen(false)}>For Schools</a>
            <div className="pt-4 border-t border-slate-100 flex flex-col space-y-3">
              <button onClick={handleLogin} className="w-full text-center py-2 text-slate-600 font-medium">Log In</button>
              <button onClick={handleLogin} className="w-full bg-indigo-900 text-white py-3 rounded-xl font-semibold">Get Started</button>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 lg:pt-40 lg:pb-32 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <div className="inline-flex items-center space-x-2 bg-purple-50 text-purple-700 px-3 py-1 rounded-full text-sm font-medium mb-6">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                </span>
                <span>New AI Voice Model V2.0</span>
              </div>
              <h1 className="text-4xl lg:text-6xl font-bold tracking-tight text-slate-900 leading-[1.15] mb-6">
                Practice Speaking. <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-indigo-600">Get Better. Faster.</span>
              </h1>
              <p className="text-lg text-slate-600 mb-8 leading-relaxed max-w-lg">
                AI-powered conversation practice that builds real language confidence. Designed for students, trusted by schools.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <button onClick={handleLogin} className="bg-purple-600 hover:bg-purple-700 text-white text-lg font-semibold py-4 px-8 rounded-full shadow-lg hover:shadow-purple-200 transition-all flex items-center justify-center">
                  Try Demo <ChevronRight size={20} className="ml-2" />
                </button>
                <button className="bg-white border-2 border-slate-200 hover:border-purple-200 text-slate-700 hover:text-purple-700 text-lg font-semibold py-4 px-8 rounded-full transition-all flex items-center justify-center">
                  For Schools
                </button>
              </div>
              <div className="mt-8 flex items-center gap-4 text-sm text-slate-500">
                <div className="flex -space-x-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className={`w-8 h-8 rounded-full border-2 border-white bg-slate-200 overflow-hidden`}>
                       <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${i+5}`} alt="User" />
                    </div>
                  ))}
                </div>
                <p>Trusted by 10,000+ students</p>
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
                
                {/* Floating UI Card 1 */}
                <motion.div 
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.8 }}
                  className="absolute bottom-8 left-8 bg-white p-4 rounded-xl shadow-xl border border-slate-100 max-w-[200px]"
                >
                  <div className="flex items-center space-x-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span className="text-xs font-semibold text-slate-500">Fluency Score</span>
                  </div>
                  <div className="text-2xl font-bold text-slate-900">92%</div>
                  <div className="text-xs text-green-600 mt-1">+14% this week</div>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Master languages naturally</h2>
            <p className="text-slate-600 text-lg">Lingual mimics real-world immersion with AI that adapts to your level and interests.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: <MessageCircle className="text-purple-600" size={32} />,
                title: "Situational Speaking",
                desc: "Practice ordering coffee, checking into a hotel, or making friends in realistic 3D scenarios."
              },
              {
                icon: <Zap className="text-amber-500" size={32} />,
                title: "Instant Feedback",
                desc: "Get immediate corrections on pronunciation, grammar, and vocabulary without the embarrassment."
              },
              {
                icon: <TrendingUp className="text-blue-500" size={32} />,
                title: "Adaptive Conversations",
                desc: "The AI remembers your conversations and adjusts difficulty as you improve over time."
              }
            ].map((feature, idx) => (
              <motion.div 
                key={idx}
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
              <h2 className="text-3xl font-bold text-slate-900 mb-8">How Lingual works</h2>
              <div className="space-y-8">
                {[
                  { title: "Choose a Scenario", desc: "Select from 500+ real-world situations or create your own." },
                  { title: "Speak Naturally", desc: "Use your voice to interact with AI characters. No typing required." },
                  { title: "Get Feedback", desc: "Review your conversation with highlighted improvements." },
                  { title: "Improve Fast", desc: "Track your progress and level up your fluency score." }
                ].map((step, idx) => (
                  <div key={idx} className="flex gap-4">
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
               {/* Abstract representation of the app interface */}
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
                For Education
              </div>
              <h2 className="text-3xl lg:text-4xl font-bold mb-6">Empower your language department</h2>
              <p className="text-indigo-200 text-lg mb-8 leading-relaxed">
                Give your students unlimited speaking practice without increasing teacher workload. 
                Track proficiency growth with automated grading and detailed analytics.
              </p>
              
              <ul className="space-y-4 mb-8">
                {[
                  "Automated speaking assessments",
                  "Common Core aligned curriculum",
                  "Teacher dashboard with real-time insights",
                  "Seamless Google Classroom integration"
                ].map((item, idx) => (
                  <li key={idx} className="flex items-center space-x-3">
                    <CheckCircle className="text-green-400 flex-shrink-0" size={20} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <button className="bg-white text-indigo-900 font-bold py-3 px-8 rounded-full hover:bg-indigo-50 transition-colors">
                Bring Lingual to Your Classroom
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
               <div className="bg-indigo-800/50 p-6 rounded-2xl backdrop-blur-sm">
                 <div className="text-3xl font-bold text-white mb-2">3x</div>
                 <div className="text-indigo-200 text-sm">More speaking time per student</div>
               </div>
               <div className="bg-indigo-800/50 p-6 rounded-2xl backdrop-blur-sm">
                 <div className="text-3xl font-bold text-white mb-2">40%</div>
                 <div className="text-indigo-200 text-sm">Reduction in grading time</div>
               </div>
               <div className="bg-indigo-800/50 p-6 rounded-2xl backdrop-blur-sm col-span-2">
                 <div className="text-3xl font-bold text-white mb-2">100%</div>
                 <div className="text-indigo-200 text-sm">Engaged students reporting higher confidence</div>
               </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900">Loved by teachers & students</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-slate-50 p-8 rounded-2xl relative">
              <div className="flex items-center space-x-4 mb-6">
                <img src={TEACHER_IMAGE} alt="Teacher" className="w-16 h-16 rounded-full object-cover border-4 border-white shadow-md" />
                <div>
                  <div className="font-bold text-slate-900">Sarah Johnson</div>
                  <div className="text-sm text-slate-500">Spanish Teacher, West High</div>
                </div>
              </div>
              <p className="text-slate-700 italic text-lg">"Finally, a tool that gets my quietest students speaking. The dashboard lets me see exactly who needs help without me having to listen to 30 recordings individually."</p>
              <div className="absolute top-8 right-8 text-purple-200">
                <Star size={40} fill="currentColor" />
              </div>
            </div>

            <div className="bg-slate-50 p-8 rounded-2xl relative">
              <div className="flex items-center space-x-4 mb-6">
                <img src={STUDENT_IMAGE} alt="Student" className="w-16 h-16 rounded-full object-cover border-4 border-white shadow-md" />
                <div>
                  <div className="font-bold text-slate-900">Michael Chen</div>
                  <div className="text-sm text-slate-500">10th Grade Student</div>
                </div>
              </div>
              <p className="text-slate-700 italic text-lg">"It's way less stressful than talking in front of the whole class. I can practice as many times as I want until I get it right. My accent has definitely improved."</p>
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
                Making language learning accessible, effective, and fun for everyone through the power of AI conversation.
              </p>
            </div>
            
            <div>
              <h4 className="text-white font-bold mb-4">Product</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:text-purple-400">Features</a></li>
                <li><a href="#" className="hover:text-purple-400">Pricing</a></li>
                <li><a href="#" className="hover:text-purple-400">For Schools</a></li>
                <li><a href="#" className="hover:text-purple-400">Case Studies</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-bold mb-4">Company</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:text-purple-400">About Us</a></li>
                <li><a href="#" className="hover:text-purple-400">Careers</a></li>
                <li><a href="#" className="hover:text-purple-400">Blog</a></li>
                <li><a href="#" className="hover:text-purple-400">Contact</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-bold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:text-purple-400">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-purple-400">Terms of Service</a></li>
                <li><a href="#" className="hover:text-purple-400">Cookie Policy</a></li>
                <li><a href="#" className="hover:text-purple-400">Security</a></li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row justify-between items-center text-sm">
            <div>&copy; 2024 Lingual Learning Inc. All rights reserved.</div>
            <div className="flex space-x-6 mt-4 md:mt-0">
               {/* Social placeholders */}
               <a href="#" className="hover:text-white">Twitter</a>
               <a href="#" className="hover:text-white">LinkedIn</a>
               <a href="#" className="hover:text-white">Instagram</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
