import React, { useState, useEffect, useRef } from 'react';
import { 
  CheckCircle2, 
  Lock, 
  Play, 
  Mic, 
  RefreshCcw, 
  ThumbsUp, 
  Award, 
  ChevronRight,
  MessageSquare,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx } from 'clsx';
import { toast } from 'sonner';

// --- Mock Data ---

const UNITS = [
  { id: 1, title: "Intro to Greetings", completed: true, locked: false, score: 98 },
  { id: 2, title: "Ordering Food", completed: true, locked: false, score: 92 },
  { id: 3, title: "Travel Essentials", completed: false, locked: false, current: true, progress: 60 },
  { id: 4, title: "Asking Directions", completed: false, locked: true },
  { id: 5, title: "Hotel Check-in", completed: false, locked: true },
  { id: 6, title: "Making Friends", completed: false, locked: true },
];

const SCENARIO = {
  title: "At the Café",
  goal: "Order a coffee and a croissant",
  characters: [
    { id: 'ai', name: 'Barista', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Barista' },
    { id: 'user', name: 'You', avatar: 'https://images.unsplash.com/photo-1574888121821-1dc5d49eeba1?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzbWlsaW5nJTIwdGVlbiUyMHN0dWRlbnQlMjBwb3J0cmFpdHxlbnwxfHx8fDE3Njk5ODU5Nzl8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral' }
  ],
  initialMessages: [
    { id: 1, sender: 'ai', text: "¡Hola! Buenos días. ¿Qué le gustaría tomar hoy?" }
  ]
};

// --- Components ---

function UnitItem({ unit }: { unit: typeof UNITS[0] }) {
  return (
    <div className={clsx(
      "relative flex items-center p-4 rounded-xl border transition-all mb-4",
      unit.current ? "bg-white border-purple-200 shadow-lg ring-2 ring-purple-100" : 
      unit.locked ? "bg-slate-50 border-slate-100 opacity-75" : 
      "bg-white border-slate-100 hover:border-purple-200"
    )}>
      {/* Connector Line */}
      <div className="absolute left-8 -bottom-6 w-0.5 h-6 bg-slate-200 last:hidden"></div>

      <div className={clsx(
        "w-10 h-10 rounded-full flex items-center justify-center mr-4 z-10",
        unit.completed ? "bg-green-100 text-green-600" :
        unit.current ? "bg-purple-600 text-white shadow-lg shadow-purple-200" :
        "bg-slate-200 text-slate-400"
      )}>
        {unit.completed ? <CheckCircle2 size={20} /> : 
         unit.locked ? <Lock size={18} /> : 
         <Play size={18} fill="currentColor" />}
      </div>

      <div className="flex-1">
        <h4 className={clsx("font-bold text-sm", unit.locked ? "text-slate-500" : "text-slate-900")}>
          {unit.title}
        </h4>
        <div className="flex items-center mt-1">
          {unit.completed && (
            <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
              Score: {unit.score}%
            </span>
          )}
          {unit.current && (
            <div className="w-full max-w-[100px] bg-slate-100 h-1.5 rounded-full overflow-hidden">
              <div className="bg-purple-600 h-full" style={{ width: `${unit.progress}%` }}></div>
            </div>
          )}
        </div>
      </div>
      
      {unit.current && (
        <div className="absolute right-4">
           <span className="flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-500"></span>
          </span>
        </div>
      )}
    </div>
  );
}

export function LearningPage() {
  const [messages, setMessages] = useState(SCENARIO.initialMessages);
  const [isRecording, setIsRecording] = useState(false);
  const [feedback, setFeedback] = useState<null | { score: number, tips: string[] }>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  const handleRecordToggle = () => {
    if (isRecording) {
      // Stop recording simulation
      setIsRecording(false);
      
      // Simulate processing
      setTimeout(() => {
        const userMsg = { id: Date.now(), sender: 'user', text: "Me gustaría un café con leche, por favor." };
        setMessages(prev => [...prev, userMsg]);
        
        // Simulate AI response
        setTimeout(() => {
          const aiMsg = { id: Date.now() + 1, sender: 'ai', text: "Perfecto. ¿Algo para comer?" };
          setMessages(prev => [...prev, aiMsg]);
          
          // Show feedback for the turn
          setFeedback({
            score: 85,
            tips: ["Great pronunciation of 'café'!", "Try 'Quisiera' instead of 'Me gustaría' for more native flow."]
          });
        }, 1500);
      }, 800);
    } else {
      setIsRecording(true);
      setFeedback(null);
    }
  };

  return (
    <div className="grid lg:grid-cols-12 gap-8 h-[calc(100vh-8rem)]">
      
      {/* Left Panel: Path */}
      <div className="lg:col-span-4 flex flex-col h-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50">
          <h2 className="text-xl font-bold text-slate-900">Your Path</h2>
          <p className="text-sm text-slate-500 mt-1">Level A1 • Spanish Basics</p>
        </div>
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-slate-200">
          {UNITS.map(unit => (
            <UnitItem key={unit.id} unit={unit} />
          ))}
          <div className="p-8 text-center opacity-50">
             <div className="w-16 h-16 bg-slate-100 rounded-full mx-auto mb-4 flex items-center justify-center">
               <Award size={32} className="text-slate-400" />
             </div>
             <p className="text-sm font-semibold">Finish these units to unlock the next level!</p>
          </div>
        </div>
      </div>

      {/* Right Panel: Workspace */}
      <div className="lg:col-span-8 flex flex-col h-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-white z-10 shadow-sm">
          <div>
            <div className="flex items-center space-x-2 text-sm text-purple-600 font-medium mb-0.5">
              <MessageSquare size={16} />
              <span>Scenario Practice</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900">{SCENARIO.title}</h2>
          </div>
          <div className="flex items-center space-x-4">
             <div className="hidden sm:flex items-center space-x-2 bg-slate-100 px-3 py-1.5 rounded-lg text-sm">
               <span className="text-slate-500">Goal:</span>
               <span className="font-semibold text-slate-800">{SCENARIO.goal}</span>
             </div>
             <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg">
               <RefreshCcw size={20} />
             </button>
          </div>
        </div>

        {/* Conversation Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 relative">
           <div className="space-y-6 max-w-3xl mx-auto pb-32">
             {messages.map((msg) => {
               const isUser = msg.sender === 'user';
               const char = SCENARIO.characters.find(c => c.id === msg.sender);
               return (
                 <motion.div 
                   key={msg.id}
                   initial={{ opacity: 0, y: 10 }}
                   animate={{ opacity: 1, y: 0 }}
                   className={clsx("flex gap-4", isUser ? "flex-row-reverse" : "flex-row")}
                 >
                   <img src={char?.avatar} alt={char?.name} className="w-10 h-10 rounded-full bg-white border border-slate-200 shadow-sm" />
                   <div className={clsx(
                     "max-w-[80%] p-4 rounded-2xl shadow-sm text-lg leading-relaxed",
                     isUser ? "bg-purple-600 text-white rounded-tr-none" : "bg-white text-slate-800 border border-slate-100 rounded-tl-none"
                   )}>
                     {msg.text}
                   </div>
                 </motion.div>
               );
             })}
             <div ref={messagesEndRef} />
           </div>

           {/* Feedback Pop-up */}
           <AnimatePresence>
             {feedback && (
               <motion.div 
                 initial={{ opacity: 0, y: 20 }}
                 animate={{ opacity: 1, y: 0 }}
                 exit={{ opacity: 0, y: 10 }}
                 className="absolute bottom-24 right-6 left-6 md:left-auto md:w-80 bg-white p-4 rounded-xl shadow-xl border border-purple-100 z-20"
               >
                 <div className="flex items-start justify-between mb-2">
                   <div className="flex items-center space-x-2 text-green-600 font-bold">
                     <Sparkles size={18} />
                     <span>Good job!</span>
                   </div>
                   <div className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-sm font-bold">
                     {feedback.score}%
                   </div>
                 </div>
                 <ul className="space-y-2">
                   {feedback.tips.map((tip, idx) => (
                     <li key={idx} className="text-sm text-slate-600 flex items-start">
                       <span className="mr-2 mt-1 w-1.5 h-1.5 bg-purple-400 rounded-full flex-shrink-0"></span>
                       {tip}
                     </li>
                   ))}
                 </ul>
               </motion.div>
             )}
           </AnimatePresence>
        </div>

        {/* Recording Bar */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-white border-t border-slate-100 shadow-lg z-30">
          <div className="max-w-2xl mx-auto flex items-center justify-center space-x-6">
             <div className="flex-1 text-center text-slate-400 text-sm font-medium">
               {isRecording ? "Listening..." : "Tap microphone to speak"}
             </div>
             
             <button 
               onClick={handleRecordToggle}
               className={clsx(
                 "w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all transform hover:scale-105 active:scale-95",
                 isRecording ? "bg-red-500 ring-4 ring-red-100 animate-pulse" : "bg-purple-600 ring-4 ring-purple-100 hover:bg-purple-700"
               )}
             >
               <Mic size={32} className="text-white" />
             </button>

             <div className="flex-1 flex justify-end">
               <button className="text-slate-400 hover:text-purple-600 transition-colors text-sm font-medium flex items-center gap-2">
                  <span>Skip</span>
                  <ChevronRight size={16} />
               </button>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
