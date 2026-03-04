import React from 'react';
import { 
  Camera, 
  MapPin, 
  Mail, 
  School, 
  GraduationCap, 
  Globe, 
  Github, 
  Twitter 
} from 'lucide-react';

const USER_AVATAR = "https://images.unsplash.com/photo-1574888121821-1dc5d49eeba1?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzbWlsaW5nJTIwdGVlbiUyMHN0dWRlbnQlMjBwb3J0cmFpdHxlbnwxfHx8fDE3Njk5ODU5Nzl8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral";

export function ProfilePage() {
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-slate-900 mb-8">My Profile</h1>
      
      <div className="grid md:grid-cols-3 gap-8">
        
        {/* Left Col: Identity */}
        <div className="md:col-span-1 space-y-6">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 text-center">
            <div className="relative inline-block mb-4">
              <img src={USER_AVATAR} alt="Profile" className="w-32 h-32 rounded-full object-cover border-4 border-slate-50" />
              <button className="absolute bottom-0 right-0 p-2 bg-purple-600 text-white rounded-full hover:bg-purple-700 shadow-md border-2 border-white transition-colors">
                <Camera size={18} />
              </button>
            </div>
            <h2 className="text-xl font-bold text-slate-900">Michael Chen</h2>
            <p className="text-slate-500 mb-4">Student • 10th Grade</p>
            
            <div className="flex items-center justify-center space-x-2 text-sm text-slate-600 mb-2">
              <MapPin size={16} />
              <span>San Francisco, CA</span>
            </div>
            <div className="flex items-center justify-center space-x-2 text-sm text-slate-600">
              <School size={16} />
              <span>West High School</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
             <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
               <Globe size={18} className="text-purple-600" />
               Languages
             </h3>
             <div className="space-y-4">
               <div>
                 <div className="flex justify-between text-sm mb-1">
                   <span className="font-medium text-slate-700">Spanish</span>
                   <span className="text-slate-500">Level A2</span>
                 </div>
                 <div className="w-full bg-slate-100 rounded-full h-2">
                   <div className="bg-purple-600 h-2 rounded-full" style={{ width: '65%' }}></div>
                 </div>
               </div>
               <div>
                 <div className="flex justify-between text-sm mb-1">
                   <span className="font-medium text-slate-700">French</span>
                   <span className="text-slate-500">Level A1</span>
                 </div>
                 <div className="w-full bg-slate-100 rounded-full h-2">
                   <div className="bg-blue-500 h-2 rounded-full" style={{ width: '20%' }}></div>
                 </div>
               </div>
             </div>
          </div>
        </div>

        {/* Right Col: Details */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
            <h3 className="text-xl font-bold text-slate-900 mb-6 border-b border-slate-100 pb-4">Personal Information</h3>
            
            <div className="grid sm:grid-cols-2 gap-6">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Full Name</label>
                <div className="p-3 bg-slate-50 rounded-lg text-slate-900 font-medium">Michael Chen</div>
              </div>
              
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Email Address</label>
                <div className="p-3 bg-slate-50 rounded-lg text-slate-900 font-medium flex items-center justify-between">
                  <span>michael.c@example.com</span>
                  <Mail size={16} className="text-slate-400" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Grade Level</label>
                <div className="p-3 bg-slate-50 rounded-lg text-slate-900 font-medium flex items-center justify-between">
                  <span>10th Grade</span>
                  <GraduationCap size={16} className="text-slate-400" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Native Language</label>
                <div className="p-3 bg-slate-50 rounded-lg text-slate-900 font-medium">English (US)</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
            <h3 className="text-xl font-bold text-slate-900 mb-6 border-b border-slate-100 pb-4">Connected Accounts</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border border-slate-100 rounded-xl hover:bg-slate-50 transition-colors">
                 <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                      <img src="https://upload.wikimedia.org/wikipedia/commons/5/53/Google_%22G%22_Logo.svg" alt="Google" className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">Google Classroom</div>
                      <div className="text-sm text-slate-500">Connected as michael.c@school.edu</div>
                    </div>
                 </div>
                 <button className="text-sm font-semibold text-slate-400 hover:text-red-500">Disconnect</button>
              </div>

              <div className="flex items-center justify-between p-4 border border-slate-100 rounded-xl hover:bg-slate-50 transition-colors">
                 <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-black rounded-full flex items-center justify-center text-white">
                      <Github size={20} />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">GitHub</div>
                      <div className="text-sm text-slate-500">Not connected</div>
                    </div>
                 </div>
                 <button className="text-sm font-semibold text-purple-600 hover:text-purple-700">Connect</button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
