import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SPORT_EMOJI, LEVEL_LABELS, LEVEL_COLORS, cn } from '@/lib/utils'
import type { Kid, TrainingPlan, PlanDrill, Drill } from '@/types'

const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default async function TraineeDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Verify trainee identity — admin client so this works before RLS policies are applied
  const admin = createAdminClient()
  const { data: kid } = await admin
    .from('kids')
    .select('*')
    .eq('trainee_user_id', user.id)
    .single()

  if (!kid) redirect('/auth/login')

  const today = new Date()
  const todayDay = today.getDay()
  const todayStart = new Date(today)
  todayStart.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().slice(0, 10)

  // Fetch plans and session logs via admin client — bypasses RLS so trainee
  // data is always visible even if the trainee policies haven't been applied yet
  const [{ data: plans }, { data: logs }] = await Promise.all([
    admin
      .from('training_plans')
      .select('*, plan_drills(*, drill:drills(*))')
      .eq('kid_id', kid.id)
      .eq('scheduled_day', todayDay)
      .order('created_at'),
    admin
      .from('session_logs')
      .select('plan_id, drill_id')
      .eq('kid_id', kid.id)
      .gte('completed_at', todayStart.toISOString()),
  ])

  const activeWorkouts = ((plans ?? []) as (TrainingPlan & { plan_drills: (PlanDrill & { drill: Drill })[] })[]).filter(w => {
    if (w.start_date > todayStr) return false
    if (w.end_date && w.end_date < todayStr) return false
    return true
  })

  const completedSet = new Set((logs ?? []).map(l => `${l.plan_id}:${l.drill_id}`))
  const typedKid = kid as Kid

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-5">
      <div className="pt-2 flex items-center gap-4">
        <div className={cn(
          'w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold flex-shrink-0',
          typedKid.avatar_color
        )}>
          {typedKid.name[0].toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Hey, {typedKid.name}!</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-slate-500 text-sm">{SPORT_EMOJI[typedKid.sport]}</span>
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', LEVEL_COLORS[typedKid.skill_level])}>
              {LEVEL_LABELS[typedKid.skill_level]}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3">
        <p className="text-sm font-semibold text-blue-700">{DAYS_FULL[todayDay]}&apos;s Workouts</p>
      </div>

      {activeWorkouts.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🏖️</div>
          <h2 className="text-lg font-bold text-slate-900 mb-1">Rest day!</h2>
          <p className="text-slate-500 text-sm">No workouts scheduled for today. Come back tomorrow.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeWorkouts.map(plan => {
            const drills = [...(plan.plan_drills ?? [])].sort((a, b) => a.display_order - b.display_order)
            const doneCount = drills.filter(pd => completedSet.has(`${plan.id}:${pd.drill_id}`)).length
            const total = drills.length
            const allDone = total > 0 && doneCount === total

            return (
              <Link
                key={plan.id}
                href={`/trainee/workouts/${plan.id}`}
                className="block bg-white rounded-2xl border border-slate-200 p-4 hover:border-blue-300 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0',
                    allDone
                      ? 'bg-green-500 text-white'
                      : doneCount > 0
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-slate-100 text-slate-500'
                  )}>
                    {allDone ? '✓' : `${doneCount}/${total}`}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900">{plan.name}</div>
                    {plan.focus && (
                      <div className="text-xs text-slate-500 truncate mt-0.5">{plan.focus}</div>
                    )}
                    <div className="text-xs text-slate-400 mt-0.5">
                      {total} drill{total !== 1 ? 's' : ''}
                      {allDone && <span className="text-green-600 ml-2 font-medium">Complete!</span>}
                    </div>
                  </div>
                  <span className="text-slate-300 text-xl flex-shrink-0">→</span>
                </div>

                {total > 0 && (
                  <div className="mt-3">
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all duration-500"
                        style={{ width: `${(doneCount / total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
