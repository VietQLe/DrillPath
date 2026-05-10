import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SPORT_EMOJI, LEVEL_LABELS, LEVEL_COLORS, cn } from '@/lib/utils'
import type { Kid, SessionLog, TrainingPlan, PlanDrill, Drill } from '@/types'
import InviteTraineeButton from '@/components/dashboard/InviteTraineeButton'

async function getStreak(kidId: string, supabase: Awaited<ReturnType<typeof createClient>>): Promise<number> {
  const { data } = await supabase
    .from('session_logs')
    .select('completed_at')
    .eq('kid_id', kidId)
    .order('completed_at', { ascending: false })

  if (!data || data.length === 0) return 0

  let streak = 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const uniqueDays = [...new Set(data.map(s => {
    const d = new Date(s.completed_at)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }))].sort((a, b) => b - a)

  for (let i = 0; i < uniqueDays.length; i++) {
    const expected = today.getTime() - i * 86400000
    if (uniqueDays[i] === expected || (i === 0 && uniqueDays[i] === expected - 86400000)) {
      streak++
    } else {
      break
    }
  }

  return streak
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: kids } = await supabase
    .from('kids')
    .select('*')
    .eq('parent_id', user.id)
    .order('created_at')

  if (!kids || kids.length === 0) {
    // Could be a trainee who reached /dashboard through a middleware miss.
    // Use the admin client (bypasses RLS) to check for a linked kid — this
    // works even if the trainee RLS policies haven't been applied yet.
    const admin = createAdminClient()
    const { count } = await admin
      .from('kids')
      .select('*', { count: 'exact', head: true })
      .eq('trainee_user_id', user.id)
    if ((count ?? 0) > 0) redirect('/trainee')
    redirect('/onboarding')
  }

  const todayDay = new Date().getDay()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const kidsWithStats = await Promise.all(
    (kids as Kid[]).map(async kid => {
      const streak = await getStreak(kid.id, supabase)

      const { count: totalSessions } = await supabase
        .from('session_logs')
        .select('*', { count: 'exact', head: true })
        .eq('kid_id', kid.id)

      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)
      const { count: weekSessions } = await supabase
        .from('session_logs')
        .select('*', { count: 'exact', head: true })
        .eq('kid_id', kid.id)
        .gte('completed_at', weekAgo.toISOString())

      const { data: recentLogs } = await supabase
        .from('session_logs')
        .select('*, drill:drills(*)')
        .eq('kid_id', kid.id)
        .order('completed_at', { ascending: false })
        .limit(3)

      // Today's workout for this kid
      const { data: todayPlans } = await supabase
        .from('training_plans')
        .select('*, plan_drills(*, drill:drills(*))')
        .eq('kid_id', kid.id)
        .eq('scheduled_day', todayDay)
        .limit(1)

      const todayWorkout = todayPlans?.[0] as (TrainingPlan & { plan_drills: (PlanDrill & { drill: Drill })[] }) | null

      let todayDoneCount = 0
      if (todayWorkout) {
        const { data: todayLogs } = await supabase
          .from('session_logs')
          .select('drill_id')
          .eq('plan_id', todayWorkout.id)
          .eq('kid_id', kid.id)
          .gte('completed_at', todayStart.toISOString())
        todayDoneCount = todayLogs?.length ?? 0
      }

      return {
        kid,
        streak,
        totalSessions: totalSessions ?? 0,
        weekSessions: weekSessions ?? 0,
        recentLogs: (recentLogs ?? []) as SessionLog[],
        todayWorkout,
        todayDoneCount,
      }
    })
  )

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div className="pt-2">
        <h1 className="text-2xl font-bold text-slate-900">Welcome back!</h1>
        <p className="text-slate-500 text-sm">Here's how your athletes are doing.</p>
      </div>

      {kidsWithStats.map(({ kid, streak, totalSessions, weekSessions, recentLogs, todayWorkout, todayDoneCount }) => (
        <div key={kid.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Kid header */}
          <div className="p-5 flex items-center gap-4">
            <div className={cn('w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold', kid.avatar_color)}>
              {kid.name[0].toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900">{kid.name}</h2>
                <span className="text-lg">{SPORT_EMOJI[kid.sport as keyof typeof SPORT_EMOJI]}</span>
              </div>
              <span className={cn('inline-block text-xs px-2 py-0.5 rounded-full font-medium', LEVEL_COLORS[kid.skill_level as keyof typeof LEVEL_COLORS])}>
                {LEVEL_LABELS[kid.skill_level as keyof typeof LEVEL_LABELS]}
              </span>
            </div>
            <Link
              href={`/workouts?kid=${kid.id}`}
              className="text-sm text-blue-600 font-medium hover:underline"
            >
              Workouts →
            </Link>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100">
            <div className="p-4 text-center">
              <div className="text-2xl font-bold text-orange-500">{streak}</div>
              <div className="text-xs text-slate-500 mt-0.5">day streak</div>
            </div>
            <div className="p-4 text-center">
              <div className="text-2xl font-bold text-slate-900">{weekSessions}</div>
              <div className="text-xs text-slate-500 mt-0.5">this week</div>
            </div>
            <div className="p-4 text-center">
              <div className="text-2xl font-bold text-slate-900">{totalSessions}</div>
              <div className="text-xs text-slate-500 mt-0.5">total sessions</div>
            </div>
          </div>

          {/* Trainee link */}
          <div className="border-t border-slate-100 px-5 py-3 flex items-center justify-between">
            {kid.trainee_user_id ? (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                <span className="text-xs text-slate-500">Trainee linked</span>
              </div>
            ) : (
              <InviteTraineeButton kidId={kid.id} />
            )}
          </div>

          {/* Today's workout */}
          {todayWorkout && (
            <div className="border-t border-slate-100 p-5">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Today&apos;s Workout</h3>
              <Link
                href={`/workouts/${todayWorkout.id}?kid=${kid.id}`}
                className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl p-3 hover:border-blue-400 transition-colors"
              >
                <div className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0',
                  todayDoneCount === todayWorkout.plan_drills?.length && (todayWorkout.plan_drills?.length ?? 0) > 0
                    ? 'bg-green-500 text-white'
                    : todayDoneCount > 0
                    ? 'bg-blue-200 text-blue-800'
                    : 'bg-white text-blue-600 border-2 border-blue-300'
                )}>
                  {todayDoneCount === todayWorkout.plan_drills?.length && (todayWorkout.plan_drills?.length ?? 0) > 0
                    ? '✓'
                    : `${todayDoneCount}/${todayWorkout.plan_drills?.length ?? 0}`}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900 text-sm">{todayWorkout.name}</div>
                  {todayWorkout.focus && (
                    <div className="text-xs text-slate-500 truncate mt-0.5">{todayWorkout.focus}</div>
                  )}
                </div>
                <span className="text-blue-400 text-lg flex-shrink-0">→</span>
              </Link>
            </div>
          )}

          {/* Recent activity */}
          {recentLogs.length > 0 && (
            <div className="border-t border-slate-100 p-5">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Recent Activity</h3>
              <div className="space-y-2">
                {recentLogs.map(log => (
                  <div key={log.id} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-sm">✓</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{log.drill?.title}</div>
                      <div className="text-xs text-slate-400">
                        {new Date(log.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {log.rating && ` · ${'⭐'.repeat(log.rating)}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recentLogs.length === 0 && !todayWorkout && (
            <div className="border-t border-slate-100 p-5 text-center">
              <p className="text-slate-400 text-sm">No sessions yet.</p>
              <Link href={`/workouts/new?kid=${kid.id}`} className="text-blue-600 text-sm font-medium hover:underline">
                Create first workout →
              </Link>
            </div>
          )}
        </div>
      ))}

      <Link
        href="/onboarding"
        className="block w-full text-center py-3 border-2 border-dashed border-slate-300 rounded-2xl text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-colors text-sm font-medium"
      >
        + Add another athlete
      </Link>
    </div>
  )
}
