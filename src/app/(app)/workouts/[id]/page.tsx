import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import DrillChecklist from '@/components/workouts/DrillChecklist'
import DeleteWorkoutButton from '@/components/workouts/DeleteWorkoutButton'
import { SPORT_EMOJI, formatDuration, cn } from '@/lib/utils'
import type { PlanDrill, Drill } from '@/types'

const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default async function WorkoutDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ kid?: string; date?: string }>
}) {
  const { id } = await params
  const { kid: kidParam, date: dateParam } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: plan } = await supabase
    .from('training_plans')
    .select('*, plan_drills(*, drill:drills(*))')
    .eq('id', id)
    .single()

  if (!plan) notFound()

  const { data: kid } = await supabase
    .from('kids')
    .select('*')
    .eq('id', kidParam ?? plan.kid_id)
    .eq('parent_id', user.id)
    .single()

  if (!kid) notFound()

  let dayStart: Date
  let dayEnd: Date
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const [y, m, d] = dateParam.split('-').map(Number)
    dayStart = new Date(y, m - 1, d, 0, 0, 0, 0)
    dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999)
  } else {
    dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    dayEnd = new Date()
    dayEnd.setHours(23, 59, 59, 999)
  }

  const [{ data: todayLogs }, { data: sessionRow }] = await Promise.all([
    supabase.from('session_logs').select('drill_id')
      .eq('plan_id', id).eq('kid_id', kid.id)
      .gte('completed_at', dayStart.toISOString()).lte('completed_at', dayEnd.toISOString()),
    supabase.from('workout_sessions').select('rating, notes')
      .eq('plan_id', id).eq('kid_id', kid.id)
      .gte('completed_at', dayStart.toISOString()).lte('completed_at', dayEnd.toISOString())
      .maybeSingle(),
  ])

  const completedDrillIds = new Set((todayLogs ?? []).map(c => c.drill_id))

  const drills = ([...(plan.plan_drills ?? [])] as (PlanDrill & { drill: Drill })[])
    .sort((a, b) => a.display_order - b.display_order)

  const totalDuration = drills.reduce((sum, pd) => sum + (pd.drill?.duration_minutes ?? 0), 0)
  const doneCount = drills.filter(pd => completedDrillIds.has(pd.drill_id)).length
  const allDone = drills.length > 0 && doneCount === drills.length

  return (
    <div className="max-w-2xl mx-auto p-4 pb-8">
      <Link
        href="/workouts"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"
      >
        ← Back to workouts
      </Link>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1">
            {plan.scheduled_day !== null && plan.scheduled_day !== undefined && (
              <div className="text-xs text-blue-600 font-semibold uppercase tracking-wide mb-1">
                {DAYS_FULL[plan.scheduled_day]}
              </div>
            )}
            <h1 className="text-xl font-bold text-slate-900">{plan.name}</h1>
            {plan.focus && (
              <p className="text-slate-500 text-sm mt-1">{plan.focus}</p>
            )}
          </div>
          <div className={cn(
            'w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0',
            allDone
              ? 'bg-green-500 text-white text-xl'
              : doneCount > 0
              ? 'bg-blue-100 text-blue-700'
              : 'bg-slate-100 text-slate-500'
          )}>
            {allDone ? '🎉' : `${doneCount}/${drills.length}`}
          </div>
        </div>

        <div className="flex gap-3 text-xs text-slate-500 flex-wrap">
          <span>{SPORT_EMOJI[kid.sport as keyof typeof SPORT_EMOJI]} {kid.name}</span>
          <span>·</span>
          <span>{drills.length} drill{drills.length !== 1 ? 's' : ''}</span>
          <span>·</span>
          <span>~{formatDuration(totalDuration)}</span>
        </div>

        {drills.length > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-slate-500 mb-1.5">
              <span>{doneCount} of {drills.length} done</span>
              <span>{Math.round((doneCount / drills.length) * 100)}%</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-500"
                style={{ width: `${(doneCount / drills.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {drills.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-slate-200">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-slate-500 text-sm">No drills in this workout yet.</p>
        </div>
      ) : (
        <DrillChecklist
          planId={id}
          kidId={kid.id}
          drills={drills}
          initialCompletedIds={[...completedDrillIds]}
          initialRating={sessionRow?.rating ?? null}
          initialNotes={sessionRow?.notes ?? null}
          date={dateParam}
        />
      )}

      <div className="mt-6">
        <DeleteWorkoutButton planId={id} date={dateParam} kidId={kid.id} />
      </div>
    </div>
  )
}
