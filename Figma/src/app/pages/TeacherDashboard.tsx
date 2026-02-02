import React from 'react';
import { 
  BarChart as BarChartIcon, 
  Users, 
  Clock, 
  Calendar, 
  Download, 
  Filter,
  Plus,
  MoreHorizontal
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend
} from 'recharts';

const PROGRESS_DATA = [
  { day: 'Mon', minutes: 120, students: 45 },
  { day: 'Tue', minutes: 180, students: 52 },
  { day: 'Wed', minutes: 150, students: 48 },
  { day: 'Thu', minutes: 240, students: 60 },
  { day: 'Fri', minutes: 200, students: 55 },
  { day: 'Sat', minutes: 90, students: 25 },
  { day: 'Sun', minutes: 60, students: 15 },
];

const SKILL_DATA = [
  { name: 'Pronunciation', score: 85 },
  { name: 'Vocabulary', score: 72 },
  { name: 'Grammar', score: 68 },
  { name: 'Fluency', score: 78 },
  { name: 'Confidence', score: 90 },
];

const STUDENTS = [
  { id: 1, name: "Alice Freeman", grade: "A", time: "4h 20m", status: "Active" },
  { id: 2, name: "Bob Smith", grade: "B+", time: "3h 15m", status: "Active" },
  { id: 3, name: "Charlie Davis", grade: "A-", time: "3h 50m", status: "Active" },
  { id: 4, name: "Diana Evans", grade: "C", time: "1h 10m", status: "At Risk" },
  { id: 5, name: "Ethan Hunt", grade: "B", time: "2h 45m", status: "Inactive" },
];

export function TeacherDashboard() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Spanish 101 - Period 3</h1>
          <p className="text-slate-500 mt-1">Class Overview • 28 Students</p>
        </div>
        <div className="flex space-x-3">
          <button className="flex items-center space-x-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 font-medium">
            <Download size={18} />
            <span>Export Report</span>
          </button>
          <button className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium shadow-sm">
            <Plus size={18} />
            <span>New Assignment</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: "Avg. Fluency Score", value: "82%", change: "+4%", icon: BarChartIcon, color: "bg-blue-50 text-blue-600" },
          { label: "Active Students", value: "24/28", change: "-1", icon: Users, color: "bg-purple-50 text-purple-600" },
          { label: "Total Speaking Time", value: "142h", change: "+12h", icon: Clock, color: "bg-green-50 text-green-600" },
          { label: "Assignments Due", value: "3", change: "Next: Fri", icon: Calendar, color: "bg-amber-50 text-amber-600" },
        ].map((stat, idx) => (
          <div key={idx} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <div className="flex items-start justify-between mb-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${stat.color}`}>
                <stat.icon size={24} />
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded-full ${stat.change.startsWith('+') ? 'bg-green-100 text-green-700' : stat.change.startsWith('-') ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                {stat.change}
              </span>
            </div>
            <div className="text-3xl font-bold text-slate-900">{stat.value}</div>
            <div className="text-sm text-slate-500 font-medium mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Charts Section */}
      <div className="grid lg:grid-cols-3 gap-8">
        
        {/* Activity Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-slate-900">Class Speaking Activity</h3>
            <select className="bg-slate-50 border-none text-sm text-slate-600 font-medium py-1 px-3 rounded-lg cursor-pointer hover:bg-slate-100">
              <option>Last 7 Days</option>
              <option>Last 30 Days</option>
            </select>
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={PROGRESS_DATA}>
                <defs>
                  <linearGradient id="colorMinutes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Area type="monotone" dataKey="minutes" stroke="#8b5cf6" strokeWidth={3} fillOpacity={1} fill="url(#colorMinutes)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Skills Breakdown */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Skill Breakdown</h3>
          <div className="h-[300px]">
             <ResponsiveContainer width="100%" height="100%">
               <BarChart data={SKILL_DATA} layout="vertical" barSize={20}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={100} axisLine={false} tickLine={false} tick={{fill: '#475569', fontSize: 13, fontWeight: 500}} />
                  <Tooltip cursor={{fill: 'transparent'}} contentStyle={{ borderRadius: '8px' }} />
                  <Bar dataKey="score" fill="#6366f1" radius={[0, 4, 4, 0]} background={{ fill: '#f1f5f9', radius: [0, 4, 4, 0] }} />
               </BarChart>
             </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Student List */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Student Progress</h3>
          <div className="flex space-x-2">
            <button className="p-2 text-slate-500 hover:bg-slate-50 rounded-lg">
              <Filter size={18} />
            </button>
            <input type="text" placeholder="Search student..." className="bg-slate-50 border-none rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-purple-200 w-64" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
              <tr>
                <th className="px-6 py-4">Student Name</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Avg. Grade</th>
                <th className="px-6 py-4">Practice Time</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {STUDENTS.map((student) => (
                <tr key={student.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600 mr-3">
                        {student.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <span className="font-medium text-slate-900">{student.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      student.status === 'Active' ? 'bg-green-100 text-green-800' : 
                      student.status === 'At Risk' ? 'bg-red-100 text-red-800' : 
                      'bg-slate-100 text-slate-800'
                    }`}>
                      {student.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-semibold text-slate-700">{student.grade}</td>
                  <td className="px-6 py-4 text-slate-500">{student.time}</td>
                  <td className="px-6 py-4 text-right">
                    <button className="text-slate-400 hover:text-purple-600 p-2 hover:bg-purple-50 rounded-lg transition-colors">
                      <MoreHorizontal size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-slate-100 text-center">
           <button className="text-sm font-medium text-purple-600 hover:text-purple-700">View All Students</button>
        </div>
      </div>
    </div>
  );
}
