'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { TrainingPlan, PlanDrill, Drill } from '@/types'

type WorkoutWithDrills = TrainingPlan & { plan_drills: (PlanDrill & { drill: Drill })[] }

// Rendered client-only (via dynamic import with ssr:false in dashboard/page.tsx)
// so new Date().getDay() always reflects browser local timezone.
export default function TodayWorkout({ plans, kidId }: { plans: WorkoutWithDrills[]; kidId: string }) {
  const now = new Date()
  const todayDay = now.getDay()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const todayWorkout = plans.find(p =>
    p.scheduled_day === todayDay &&
    p.start_date <= todayStr &&
    (p.end_date === null || p.end_date >= todayStr)
  ) ?? null

  const [doneCount, setDoneCount] = useState(0)
  const todayWorkoutId = todayWorkout?.id

  useEffect(() => {
    if (!todayWorkoutId) return

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const supabase = createClient()
    supabase
      .from('session_logs')
      .select('drill_id')
      .eq('plan_id', todayWorkoutId)
      .eq('kid_id', kidId)
      .gte('completed_at', todayStart.toISOString())
      .then(({ data }) => setDoneCount(data?.length ?? 0))
  }, [todayWorkoutId, kidId])

  const total = todayWorkout?.plan_drills?.length ?? 0
  const allDone = total > 0 && doneCount === total

  if (!todayWorkout || allDone) return null

  return (
    <div className="border-t border-slate-100 p-5">
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Today&apos;s Workout</h3>
      <Link
        href={`/workouts/${todayWorkout.id}?kid=${kidId}`}
        className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl p-3 hover:border-blue-400 transition-colors"
      >
        <div className={cn(
          'w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0',
          allDone
            ? 'bg-green-500 text-white'
            : doneCount > 0
            ? 'bg-blue-200 text-blue-800'
            : 'bg-white text-blue-600 border-2 border-blue-300'
        )}>
          {allDone ? '✓' : `${doneCount}/${total}`}
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
  )
}
