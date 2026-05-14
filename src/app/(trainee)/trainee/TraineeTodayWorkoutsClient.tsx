'use client'

// Rendered client-only (via dynamic import with ssr:false in page.tsx)
// so new Date().getDay() always reflects browser local timezone.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { TrainingPlan, PlanDrill, Drill } from '@/types'

const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type WorkoutWithDrills = TrainingPlan & { plan_drills: (PlanDrill & { drill: Drill })[] }
type LogRow = { plan_id: string; drill_id: string; completed_at: string }

export default function TraineeTodayWorkoutsClient({
  plans,
  logs,
}: {
  plans: WorkoutWithDrills[]
  logs: LogRow[]
}) {
  const now = new Date()
  const todayDay = now.getDay()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayStartISO = todayStart.toISOString()

  const [exceptions, setExceptions] = useState<Set<string> | null>(null)

  useEffect(() => {
    const planIds = plans.map(p => p.id)
    let cancelled = false
    const supabase = createClient()
    const query = planIds.length > 0
      ? supabase.from('plan_exceptions').select('plan_id').in('plan_id', planIds).eq('exception_date', todayStr)
      : Promise.resolve({ data: [] as { plan_id: string }[] })

    query.then(({ data }) => {
      if (!cancelled) setExceptions(new Set((data ?? []).map(e => e.plan_id)))
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayStr])

  const activeWorkouts = exceptions === null ? null : plans.filter(w => {
    if (exceptions.has(w.id)) return false
    if (w.start_date > todayStr) return false
    if (w.end_date && w.end_date < todayStr) return false
    if (w.start_date !== w.end_date && w.scheduled_day !== todayDay) return false
    return true
  })

  const completedSet = new Set(
    logs
      .filter(l => l.plan_id && l.completed_at >= todayStartISO)
      .map(l => `${l.plan_id}:${l.drill_id}`)
  )

  if (activeWorkouts === null) return null

  return (
    <>
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
    </>
  )
}
