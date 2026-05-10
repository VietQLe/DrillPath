import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import MonthlyCalendar from '@/components/workouts/MonthlyCalendar'
import { SPORT_EMOJI, cn } from '@/lib/utils'
import type { Kid, TrainingPlan, PlanDrill, Drill } from '@/types'

const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type WorkoutWithDrills = TrainingPlan & { plan_drills: (PlanDrill & { drill: Drill })[] }

export default async function WorkoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ kid?: string; view?: string; month?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: kids } = await supabase
    .from('kids')
    .select('*')
    .eq('parent_id', user.id)
    .order('created_at')

  if (!kids || kids.length === 0) redirect('/onboarding')

  const kidList = kids as Kid[]
  const selectedKid = kidList.find(k => k.id === params.kid) ?? kidList[0]

  const { data: plans } = await supabase
    .from('training_plans')
    .select('*, plan_drills(*, drill:drills(*))')
    .eq('kid_id', selectedKid.id)
    .order('created_at')

  const workouts = (plans ?? []) as WorkoutWithDrills[]

  const view = params.view === 'month' ? 'month' : 'week'

  // Parse month param (YYYY-MM), default to current month
  const now = new Date()
  let calYear = now.getFullYear()
  let calMonth = now.getMonth() // 0-indexed

  if (params.month) {
    const [y, m] = params.month.split('-').map(Number)
    if (!isNaN(y) && !isNaN(m) && m >= 1 && m <= 12) {
      calYear = y
      calMonth = m - 1
    }
  }

  const monthStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`
  const kidParam = `kid=${selectedKid.id}`

  // Prev/next month URLs
  const prevDate = new Date(calYear, calMonth - 1, 1)
  const nextDate = new Date(calYear, calMonth + 1, 1)
  const prevMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`
  const nextMonthStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`
  const prevUrl = `/workouts?${kidParam}&view=month&month=${prevMonthStr}`
  const nextUrl = `/workouts?${kidParam}&view=month&month=${nextMonthStr}`

  // Fetch session logs
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  let sessionLogs: { plan_id: string | null; drill_id: string; completed_at: string }[] = []
  let exceptions = new Set<string>() // "plan_id:YYYY-MM-DD"

  if (view === 'week') {
    const { data } = await supabase
      .from('session_logs')
      .select('plan_id, drill_id, completed_at')
      .eq('kid_id', selectedKid.id)
      .not('plan_id', 'is', null)
      .gte('completed_at', todayStart.toISOString())
    sessionLogs = data ?? []
  } else {
    const monthStart = new Date(calYear, calMonth, 1)
    const monthEnd = new Date(calYear, calMonth + 1, 0, 23, 59, 59, 999)
    const planIds = workouts.map(w => w.id)

    const [{ data: logs }, { data: exRows }] = await Promise.all([
      supabase
        .from('session_logs')
        .select('plan_id, drill_id, completed_at')
        .eq('kid_id', selectedKid.id)
        .not('plan_id', 'is', null)
        .gte('completed_at', monthStart.toISOString())
        .lte('completed_at', monthEnd.toISOString()),
      planIds.length > 0
        ? supabase
            .from('plan_exceptions')
            .select('plan_id, exception_date')
            .in('plan_id', planIds)
        : Promise.resolve({ data: [] }),
    ])

    sessionLogs = logs ?? []
    exceptions = new Set((exRows ?? []).map(e => `${e.plan_id}:${e.exception_date}`))
  }

  const completedToday = new Set(
    sessionLogs.map(c => `${c.plan_id}:${c.drill_id}`)
  )

  const todayDay = now.getDay()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  // Only show workouts active within the current week (started and not yet ended)
  const activeWorkouts = workouts.filter(w => {
    if (w.start_date > todayStr) {
      // Allow upcoming workouts that start within the next 6 days (this week)
      const startD = new Date(w.start_date)
      const diffMs = startD.getTime() - now.getTime()
      if (diffMs > 6 * 24 * 60 * 60 * 1000) return false
    }
    if (w.end_date && w.end_date < todayStr) return false
    return true
  })

  const byDay: Record<number, WorkoutWithDrills[]> = {}
  activeWorkouts.forEach(w => {
    if (w.scheduled_day !== null && w.scheduled_day !== undefined) {
      if (!byDay[w.scheduled_day]) byDay[w.scheduled_day] = []
      byDay[w.scheduled_day].push(w)
    }
  })
  const unscheduled = activeWorkouts.filter(
    w => w.scheduled_day === null || w.scheduled_day === undefined
  )

  // Workouts from other days that were fully completed today
  const completedOtherDay = activeWorkouts.filter(w => {
    if (w.scheduled_day === todayDay || w.scheduled_day === null || w.scheduled_day === undefined) return false
    const drills = w.plan_drills ?? []
    if (drills.length === 0) return false
    return drills.every(pd => completedToday.has(`${w.id}:${pd.drill_id}`))
  })

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-5">
      <div className="pt-2 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Workouts</h1>
          <p className="text-slate-500 text-sm">
            {view === 'week' ? 'Weekly training plan' : 'Monthly overview'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href={`/workouts/library?${kidParam}`}
            className="px-3 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            📚 Library
          </Link>
          <Link
            href={`/workouts/new?${kidParam}`}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            + New
          </Link>
        </div>
      </div>

      {/* View toggle + kid selector row */}
      <div className="flex items-center justify-between gap-3">
        {/* View toggle */}
        <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
          <Link
            href={`/workouts?${kidParam}&view=week`}
            className={cn(
              'px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors',
              view === 'week'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            )}
          >
            Week
          </Link>
          <Link
            href={`/workouts?${kidParam}&view=month&month=${monthStr}`}
            className={cn(
              'px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors',
              view === 'month'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            )}
          >
            Month
          </Link>
        </div>

        {/* Kid selector */}
        {kidList.length > 1 && (
          <div className="flex gap-2 overflow-x-auto">
            {kidList.map(kid => (
              <Link
                key={kid.id}
                href={`/workouts?kid=${kid.id}&view=${view}${view === 'month' ? `&month=${monthStr}` : ''}`}
                className={cn(
                  'flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors border',
                  selectedKid.id === kid.id
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                )}
              >
                <span>{SPORT_EMOJI[kid.sport]}</span>
                {kid.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {workouts.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📋</div>
          <h2 className="text-lg font-bold text-slate-900 mb-1">No workouts yet</h2>
          <p className="text-slate-500 text-sm mb-6">
            Build {selectedKid.name}&apos;s first training plan
          </p>
          <Link
            href={`/workouts/new?${kidParam}`}
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
          >
            Create first workout
          </Link>
        </div>
      ) : view === 'month' ? (
        <MonthlyCalendar
          year={calYear}
          month={calMonth}
          workouts={workouts}
          sessionLogs={sessionLogs}
          selectedKid={selectedKid}
          exceptions={exceptions}
          prevUrl={prevUrl}
          nextUrl={nextUrl}
        />
      ) : (
        <>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5, 6, 0].map(day => {
              const dayWorkouts = byDay[day] ?? []
              const isToday = day === todayDay

              return (
                <div
                  key={day}
                  className={cn(
                    'rounded-2xl border overflow-hidden',
                    isToday ? 'border-blue-300 shadow-sm' : 'border-slate-200'
                  )}
                >
                  <div
                    className={cn(
                      'px-4 py-2.5 flex items-center gap-2',
                      isToday ? 'bg-blue-50' : 'bg-slate-50'
                    )}
                  >
                    <span
                      className={cn(
                        'text-sm font-semibold',
                        isToday ? 'text-blue-700' : 'text-slate-600'
                      )}
                    >
                      {DAYS_FULL[day]}
                    </span>
                    {isToday && (
                      <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">
                        Today
                      </span>
                    )}
                  </div>

                  <div className="bg-white divide-y divide-slate-100">
                    {dayWorkouts.map(workout => {
                      const drills = [...(workout.plan_drills ?? [])].sort(
                        (a, b) => a.display_order - b.display_order
                      )
                      const doneCount = drills.filter(pd =>
                        completedToday.has(`${workout.id}:${pd.drill_id}`)
                      ).length
                      const total = drills.length
                      const allDone = total > 0 && doneCount === total

                      return (
                        <Link
                          key={workout.id}
                          href={`/workouts/${workout.id}?${kidParam}`}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
                        >
                          <div
                            className={cn(
                              'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold',
                              allDone
                                ? 'bg-green-500 text-white'
                                : doneCount > 0
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-slate-100 text-slate-500'
                            )}
                          >
                            {allDone ? '✓' : total > 0 ? `${doneCount}/${total}` : '—'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-slate-900 text-sm">{workout.name}</div>
                            {workout.focus && (
                              <div className="text-xs text-slate-500 truncate mt-0.5">
                                {workout.focus}
                              </div>
                            )}
                            <div className="text-xs text-slate-400 mt-0.5">
                              {total} drill{total !== 1 ? 's' : ''}
                            </div>
                          </div>
                          <span className="text-slate-300 text-xl flex-shrink-0">→</span>
                        </Link>
                      )
                    })}
                    {isToday && completedOtherDay.map(workout => {
                      const total = workout.plan_drills?.length ?? 0
                      return (
                        <Link
                          key={`other-${workout.id}`}
                          href={`/workouts/${workout.id}?${kidParam}`}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
                        >
                          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold bg-green-500 text-white">
                            ✓
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-slate-900 text-sm">{workout.name}</div>
                            <div className="text-xs text-green-600 mt-0.5">
                              Completed · from {DAYS_FULL[workout.scheduled_day!]}
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              {total} drill{total !== 1 ? 's' : ''}
                            </div>
                          </div>
                          <span className="text-slate-300 text-xl flex-shrink-0">→</span>
                        </Link>
                      )
                    })}
                    <Link
                      href={`/workouts/new?${kidParam}&day=${day}`}
                      className="flex items-center gap-2 px-4 py-3 text-sm text-slate-400 hover:text-blue-600 hover:bg-slate-50 transition-colors"
                    >
                      <span className="text-base leading-none">+</span>
                      Add workout
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>

          {unscheduled.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Unscheduled
              </h2>
              <div className="space-y-2">
                {unscheduled.map(workout => {
                  const total = workout.plan_drills?.length ?? 0
                  return (
                    <Link
                      key={workout.id}
                      href={`/workouts/${workout.id}?${kidParam}`}
                      className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 hover:border-blue-300 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-900 text-sm">{workout.name}</div>
                        {workout.focus && (
                          <div className="text-xs text-slate-500 mt-0.5">{workout.focus}</div>
                        )}
                        <div className="text-xs text-slate-400 mt-0.5">
                          {total} drill{total !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <span className="text-slate-300 text-xl flex-shrink-0">→</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
