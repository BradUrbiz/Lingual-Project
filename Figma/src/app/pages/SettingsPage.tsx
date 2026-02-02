import React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { User, Bell, Shield, Lock, Smartphone, LogOut } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';

export function SettingsPage() {
  const handleSave = () => {
    toast.success("Settings saved successfully!");
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-slate-900 mb-8">Settings</h1>

      <Tabs.Root defaultValue="account" className="flex flex-col md:flex-row gap-8">
        
        {/* Sidebar Tabs */}
        <Tabs.List className="flex flex-col space-y-2 md:w-64 flex-shrink-0">
          {[
            { value: 'account', icon: User, label: 'Account' },
            { value: 'password', icon: Lock, label: 'Password & Security' },
            { value: 'notifications', icon: Bell, label: 'Notifications' },
            { value: 'privacy', icon: Shield, label: 'Privacy & Data' },
            { value: 'devices', icon: Smartphone, label: 'Devices' },
          ].map((tab) => (
            <Tabs.Trigger 
              key={tab.value}
              value={tab.value}
              className="group flex items-center space-x-3 px-4 py-3 rounded-xl text-left transition-all data-[state=active]:bg-purple-600 data-[state=active]:text-white text-slate-600 hover:bg-slate-100 data-[state=active]:shadow-md"
            >
              <tab.icon size={18} className="opacity-70 group-data-[state=active]:opacity-100" />
              <span className="font-medium">{tab.label}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Content Area */}
        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-8 min-h-[500px]">
          
          <Tabs.Content value="account" className="space-y-8 outline-none animate-in fade-in slide-in-from-right-4 duration-300">
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">Account Information</h2>
              <p className="text-slate-500 text-sm">Update your personal details here.</p>
            </div>
            
            <div className="grid gap-6">
              <div className="grid sm:grid-cols-2 gap-4">
                 <div className="space-y-2">
                   <label className="text-sm font-semibold text-slate-700">First Name</label>
                   <input type="text" defaultValue="Michael" className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none transition-all" />
                 </div>
                 <div className="space-y-2">
                   <label className="text-sm font-semibold text-slate-700">Last Name</label>
                   <input type="text" defaultValue="Chen" className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none transition-all" />
                 </div>
              </div>

              <div className="space-y-2">
                 <label className="text-sm font-semibold text-slate-700">Email Address</label>
                 <input type="email" defaultValue="michael.c@example.com" className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none transition-all" />
              </div>

              <div className="pt-4 flex justify-end">
                <button onClick={handleSave} className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-6 rounded-lg shadow-sm transition-colors">
                  Save Changes
                </button>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="notifications" className="space-y-8 outline-none animate-in fade-in slide-in-from-right-4 duration-300">
             <div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">Notification Preferences</h2>
              <p className="text-slate-500 text-sm">Manage how we contact you.</p>
            </div>

            <div className="space-y-4">
              {[
                { label: "Email Alerts", desc: "Get daily summaries of your progress", default: true },
                { label: "Study Reminders", desc: "Nudge me if I haven't practiced by 8 PM", default: true },
                { label: "Teacher Messages", desc: "When my teacher leaves feedback", default: true },
                { label: "Product Updates", desc: "New features and improvements", default: false },
              ].map((setting, idx) => (
                <div key={idx} className="flex items-center justify-between p-4 border border-slate-100 rounded-xl hover:bg-slate-50 transition-colors">
                  <div>
                    <div className="font-semibold text-slate-900">{setting.label}</div>
                    <div className="text-sm text-slate-500">{setting.desc}</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" defaultChecked={setting.default} className="sr-only peer" />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                  </label>
                </div>
              ))}
            </div>
          </Tabs.Content>

          <Tabs.Content value="privacy" className="space-y-8 outline-none animate-in fade-in slide-in-from-right-4 duration-300">
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">Privacy & Data</h2>
              <p className="text-slate-500 text-sm">Control your data and visibility.</p>
            </div>
             
             <div className="space-y-6">
                <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl text-amber-800 text-sm">
                   Your audio recordings are stored securely and only accessible by you and your authorized teachers.
                </div>

                <div className="space-y-4">
                   <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">Allow Audio Analysis</span>
                      <input type="checkbox" checked readOnly className="h-5 w-5 text-purple-600 rounded border-slate-300 focus:ring-purple-500" />
                   </div>
                   <p className="text-sm text-slate-500 ml-0">Required for AI feedback functionality.</p>
                </div>

                <div className="pt-8 border-t border-slate-100">
                  <h3 className="font-bold text-slate-900 mb-4">Danger Zone</h3>
                  <button className="text-red-600 font-semibold border border-red-200 bg-red-50 hover:bg-red-100 px-4 py-2 rounded-lg transition-colors">
                     Delete Account
                  </button>
                </div>
             </div>
          </Tabs.Content>
          
          {/* Placeholders for other tabs */}
          <Tabs.Content value="password" className="outline-none animate-in fade-in slide-in-from-right-4 duration-300">
             <div className="flex flex-col items-center justify-center h-64 text-slate-400">
               <Lock size={48} className="mb-4 opacity-50" />
               <p>Security settings placeholder</p>
             </div>
          </Tabs.Content>
          <Tabs.Content value="devices" className="outline-none animate-in fade-in slide-in-from-right-4 duration-300">
             <div className="flex flex-col items-center justify-center h-64 text-slate-400">
               <Smartphone size={48} className="mb-4 opacity-50" />
               <p>Device management placeholder</p>
             </div>
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </div>
  );
}
