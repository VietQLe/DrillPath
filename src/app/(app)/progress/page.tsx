import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { SPORT_EMOJI, LEVEL_LABELS, LEVEL_COLORS, cn } from '@/lib/utils'
import type { Kid, SessionLog } from '@/types'

const SKILL_FOCUS_EMOJI: Record<string, string> = {
  speed: '⚡', agility: '🔄', strength: '💪', technique: '🎯', endurance: '🏃', flexibility: '🤸'
}

const MILESTONES = [
  { count: 1, label: 'First Drill!', emoji: '🌱' },
  { count: 5, label: '5 Sessions', emoji: '🔥' },
  { count: 10, label: '10 Sessions', emoji: '⭐' },
  { count: 25, label: '25 Sessions', emoji: '🏅' },
  { count: 50, label: '50 Sessions', emoji: '🏆' },
]

function getLast7Days(): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return d.toISOString().split('T')[0]
  })
}

export default async function ProgressPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: kids } = await supabase
    .from('kids')
    .select('*')
    .eq('parent_id', user.id)
    .order('created_at')
    
  if (!kids || kids.length === 0) redirect('/onboarding')

  const kidsProgress = await Promise.all(
    (kids as Kid[]).map(async kid => {
      const [{ data: logs }, { count: totalSessions }, { data: workoutSessionRows }] = await Promise.all([
        supabase.from('session_logs').select('*, drill:drills(*)')
          .eq('kid_id', kid.id).order('completed_at', { ascending: false }),
        supabase.from('workout_sessions').select('*', { count: 'exact', head: true }).eq('kid_id', kid.id),
        supabase.from('workout_sessions').select('completed_at').eq('kid_id', kid.id),
      ])

      const sessions = (logs ?? []) as SessionLog[]

      // Skill coverage breakdown (from individual drill logs)
      const skillCounts: Record<string, number> = {}
      sessions.forEach(s => {
        const focus = s.drill?.skill_focus
        if (focus) skillCounts[focus] = (skillCounts[focus] ?? 0) + 1
      })

      // Last 7 days activity (from workout sessions)
      const last7 = getLast7Days()
      const activeDays = new Set(
        (workoutSessionRows ?? []).map(s => new Date(s.completed_at).toISOString().split('T')[0])
      )
      const weekActivity = last7.map(day => ({
        day,
        label: new Date(day).toLocaleDateString('en-US', { weekday: 'short' }),
        active: activeDays.has(day),
      }))

      return { kid, sessions, totalSessions: totalSessions ?? 0, skillCounts, weekActivity }
    })
  )

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div className="pt-2">
        <h1 className="text-2xl font-bold text-slate-900">Progress</h1>
        <p className="text-slate-500 text-sm">Track your athletes' growth over time.</p>
      </div>

      {kidsProgress.map(({ kid, sessions, totalSessions, skillCounts, weekActivity }) => (
        <div key={kid.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Kid header */}
          <div className="p-5 flex items-center gap-3 border-b border-slate-100">
            <Link href={`/kids/${kid.id}`} className="flex-shrink-0">
              {kid.avatar_url ? (
                <img src={kid.avatar_url} alt={kid.name} className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <div className={cn('w-10 h-10 rounded-full flex items-center justify-center text-white font-bold', kid.avatar_color)}>
                  {kid.name[0]}
                </div>
              )}
            </Link>
            <div>
              <h2 className="font-bold text-slate-900">{kid.name} {SPORT_EMOJI[kid.sport as keyof typeof SPORT_EMOJI]}</h2>
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', LEVEL_COLORS[kid.skill_level as keyof typeof LEVEL_COLORS])}>
                {LEVEL_LABELS[kid.skill_level as keyof typeof LEVEL_LABELS]}
              </span>
            </div>
          </div>

          {/* Last 7 days */}
          <div className="p-5 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Last 7 Days</h3>
            <div className="flex gap-2">
              {weekActivity.map(({ day, label, active }) => (
                <div key={day} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className={cn(
                    'w-full aspect-square rounded-lg flex items-center justify-center',
                    active ? 'bg-green-500' : 'bg-slate-100'
                  )}>
                    {active && <span className="text-white text-sm">✓</span>}
                  </div>
                  <span className="text-xs text-slate-400">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Milestones */}
          <div className="p-5 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Milestones</h3>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {MILESTONES.map(m => {
                const earned = totalSessions >= m.count
                return (
                  <div key={m.count} className={cn(
                    'flex-shrink-0 flex flex-col items-center p-3 rounded-xl border-2 min-w-[70px]',
                    earned ? 'border-yellow-400 bg-yellow-50' : 'border-slate-100 opacity-40'
                  )}>
                    <span className="text-2xl">{m.emoji}</span>
                    <span className="text-xs font-medium text-slate-700 mt-1 text-center leading-tight">{m.label}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Skill coverage */}
          {Object.keys(skillCounts).length > 0 && (
            <div className="p-5 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Skills Trained</h3>
              <div className="space-y-2">
                {Object.entries(skillCounts)
                  .sort(([, a], [, b]) => b - a)
                  .map(([skill, count]) => {
                    const pct = Math.min(100, Math.round((count / totalSessions) * 100))
                    return (
                      <div key={skill}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-slate-700 capitalize">
                            {SKILL_FOCUS_EMOJI[skill]} {skill}
                          </span>
                          <span className="text-slate-400">{count} sessions</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}

          {/* Recent sessions */}
          {sessions.length > 0 ? (
            <div className="p-5">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                All Sessions ({totalSessions})
              </h3>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {sessions.map(log => (
                  <div key={log.id} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                      ✓
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-slate-900 truncate">{log.drill?.title}</div>
                      <div className="text-xs text-slate-400 flex items-center gap-2">
                        <span>{new Date(log.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                        {log.rating && <span>{'⭐'.repeat(log.rating)}</span>}
                      </div>
                      {log.notes && <p className="text-xs text-slate-500 mt-0.5 italic">"{log.notes}"</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-5 text-center text-slate-400 text-sm">
              No sessions logged yet. Go try a drill!
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
