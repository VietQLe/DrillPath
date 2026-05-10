'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { LEVEL_COLORS, LEVEL_LABELS, formatDuration, cn } from '@/lib/utils'
import type { PlanDrill, Drill } from '@/types'

const SKILL_FOCUS_EMOJI: Record<string, string> = {
  speed: '⚡', agility: '🔄', strength: '💪', technique: '🎯', endurance: '🏃', flexibility: '🤸',
}

type DrillEntry = PlanDrill & { drill: Drill }

export default function DrillChecklist({
  planId,
  kidId,
  drills,
  initialCompletedIds,
}: {
  planId: string
  kidId: string
  drills: DrillEntry[]
  initialCompletedIds: string[]
}) {
  const router = useRouter()
  const [completedIds, setCompletedIds] = useState(new Set(initialCompletedIds))
  const [loading, setLoading] = useState<string | null>(null)
  const [finished, setFinished] = useState(initialCompletedIds.length === drills.length && drills.length > 0)

  async function toggleDrill(drillId: string) {
    if (loading) return
    setLoading(drillId)
    const supabase = createClient()
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    if (completedIds.has(drillId)) {
      await supabase
        .from('session_logs')
        .delete()
        .eq('plan_id', planId)
        .eq('kid_id', kidId)
        .eq('drill_id', drillId)
        .gte('completed_at', todayStart.toISOString())

      setCompletedIds(prev => {
        const next = new Set(prev)
        next.delete(drillId)
        return next
      })
    } else {
      await supabase.from('session_logs').insert({
        kid_id: kidId,
        drill_id: drillId,
        plan_id: planId,
      })

      const next = new Set(completedIds)
      next.add(drillId)
      setCompletedIds(next)

      if (next.size === drills.length) {
        setFinished(true)
      }
    }

    setLoading(null)
    router.refresh()
  }

  if (finished) {
    return (
      <div className="text-center py-12 bg-white rounded-2xl border border-green-200">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">Workout complete!</h2>
        <p className="text-slate-500 text-sm mb-6">
          Great work — all {drills.length} drill{drills.length !== 1 ? 's' : ''} done.
        </p>
        <Link
          href="/dashboard"
          className="inline-block px-6 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-colors"
        >
          Back to dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {drills.map((pd, index) => {
        const drill = pd.drill
        const done = completedIds.has(pd.drill_id)
        const isLoading = loading === pd.drill_id

        return (
          <div
            key={pd.id}
            className={cn(
              'rounded-2xl border transition-all',
              done ? 'border-green-200 bg-green-50' : 'border-slate-200 bg-white'
            )}
          >
            <div className="flex items-start gap-3 p-4">
              <button
                onClick={() => toggleDrill(pd.drill_id)}
                disabled={!!loading}
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 font-bold text-sm transition-all border-2',
                  done
                    ? 'bg-green-500 border-green-500 text-white'
                    : 'border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600',
                  isLoading && 'opacity-50 cursor-wait'
                )}
              >
                {done ? '✓' : index + 1}
              </button>

              <div className="flex-1 min-w-0">
                <div className={cn(
                  'font-semibold text-sm',
                  done ? 'line-through text-slate-400' : 'text-slate-900'
                )}>
                  {drill.title}
                </div>
                <p className={cn(
                  'text-xs mt-0.5 line-clamp-2',
                  done ? 'text-slate-400' : 'text-slate-500'
                )}>
                  {drill.description}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-medium',
                    done ? 'bg-slate-100 text-slate-400' : LEVEL_COLORS[drill.difficulty]
                  )}>
                    {LEVEL_LABELS[drill.difficulty]}
                  </span>
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full',
                    done ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-slate-600'
                  )}>
                    {SKILL_FOCUS_EMOJI[drill.skill_focus]} {drill.skill_focus}
                  </span>
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full',
                    done ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-slate-600'
                  )}>
                    ⏱ {formatDuration(drill.duration_minutes)}
                  </span>
                </div>
              </div>

              <Link
                href={`/drills/${drill.id}`}
                className="text-slate-300 hover:text-blue-400 flex-shrink-0 mt-1 transition-colors text-lg leading-none"
                title="View drill details"
              >
                ℹ
              </Link>
            </div>
          </div>
        )
      })}

      {drills.length > 0 && completedIds.size < drills.length && (
        <p className="text-center text-sm text-slate-400 pt-1">
          {drills.length - completedIds.size} drill{drills.length - completedIds.size !== 1 ? 's' : ''} remaining
        </p>
      )}
    </div>
  )
}
