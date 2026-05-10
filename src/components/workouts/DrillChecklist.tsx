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
  initialRating = null,
  initialNotes = null,
}: {
  planId: string
  kidId: string
  drills: DrillEntry[]
  initialCompletedIds: string[]
  initialRating?: number | null
  initialNotes?: string | null
}) {
  const router = useRouter()
  const [completedIds, setCompletedIds] = useState(new Set(initialCompletedIds))
  const [loading, setLoading] = useState<string | null>(null)
  const [finished, setFinished] = useState(initialCompletedIds.length === drills.length && drills.length > 0)
  const [ratingStep, setRatingStep] = useState(false)
  const [workoutRating, setWorkoutRating] = useState<1 | 2 | 3>(2)
  const [workoutNotes, setWorkoutNotes] = useState('')
  const [ratingLoading, setRatingLoading] = useState(false)
  const [savedRating, setSavedRating] = useState<number | null>(initialRating)
  const [savedNotes, setSavedNotes] = useState<string | null>(initialNotes)

  async function toggleDrill(drillId: string) {
    if (loading) return
    setLoading(drillId)
    const supabase = createClient()
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const wasAllDone = completedIds.size === drills.length

    if (completedIds.has(drillId)) {
      await supabase
        .from('session_logs')
        .delete()
        .eq('plan_id', planId)
        .eq('kid_id', kidId)
        .eq('drill_id', drillId)
        .gte('completed_at', todayStart.toISOString())

      const next = new Set(completedIds)
      next.delete(drillId)
      setCompletedIds(next)

      if (wasAllDone) {
        await supabase
          .from('workout_sessions')
          .delete()
          .eq('plan_id', planId)
          .eq('kid_id', kidId)
          .gte('completed_at', todayStart.toISOString())
      }
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
        await supabase.from('workout_sessions').insert({
          kid_id: kidId,
          plan_id: planId,
        })
        setRatingStep(true)
      }
    }

    setLoading(null)
    router.refresh()
  }

  async function submitRating() {
    setRatingLoading(true)
    const supabase = createClient()
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    await supabase
      .from('workout_sessions')
      .update({ rating: workoutRating, notes: workoutNotes || null })
      .eq('plan_id', planId)
      .eq('kid_id', kidId)
      .gte('completed_at', todayStart.toISOString())
    setRatingLoading(false)
    setSavedRating(workoutRating)
    setSavedNotes(workoutNotes || null)
    setRatingStep(false)
    setFinished(true)
  }

  if (ratingStep) {
    return (
      <div className="bg-white rounded-2xl border border-green-200 p-6">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">✓</div>
          <h2 className="text-lg font-bold text-slate-900">All drills done!</h2>
          <p className="text-slate-500 text-sm">How did the workout go?</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Rate this workout</label>
            <div className="flex gap-3">
              {([1, 2, 3] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setWorkoutRating(r)}
                  className={cn(
                    'flex-1 py-3 rounded-xl border-2 text-lg transition-all',
                    workoutRating === r ? 'border-yellow-400 bg-yellow-50' : 'border-slate-200 hover:border-slate-300'
                  )}
                >
                  {'⭐'.repeat(r)}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-xs text-slate-400 mt-1 px-1">
              <span>Tough</span>
              <span>Good</span>
              <span>Crushed it!</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
            <textarea
              value={workoutNotes}
              onChange={e => setWorkoutNotes(e.target.value)}
              rows={2}
              placeholder="e.g. great session, worked on form..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <button
            onClick={submitRating}
            disabled={ratingLoading}
            className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-semibold rounded-xl transition-colors"
          >
            {ratingLoading ? 'Saving...' : 'Save & finish'}
          </button>
        </div>
      </div>
    )
  }

  if (finished) {
    return (
      <div className="bg-white rounded-2xl border border-green-200 overflow-hidden">
        <div className="text-center py-10 px-6">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Workout complete!</h2>
          <p className="text-slate-500 text-sm">
            Great work — all {drills.length} drill{drills.length !== 1 ? 's' : ''} done.
          </p>
        </div>
        {savedRating !== null && (
          <div className="border-t border-green-100 px-6 py-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500 font-medium">Your rating</span>
              <span className="text-base">{'⭐'.repeat(savedRating)}</span>
            </div>
            {savedNotes && (
              <p className="text-sm text-slate-600 italic">"{savedNotes}"</p>
            )}
          </div>
        )}
        <div className="border-t border-green-100 p-5">
          <Link
            href="/dashboard"
            className="block w-full text-center py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-colors"
          >
            Back to dashboard
          </Link>
        </div>
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
