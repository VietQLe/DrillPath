'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { LEVEL_COLORS, LEVEL_LABELS, formatDuration, cn } from '@/lib/utils'
import DrillRecorder from '@/components/drills/DrillRecorder'
import RecordingsCarousel from '@/components/workouts/RecordingsCarousel'
import type { CarouselItem } from '@/components/workouts/RecordingsCarousel'
import type { PlanDrill, Drill, DrillRecording } from '@/types'

type DrillGroup = {
  drillId: string
  title: string
  recs: { id: string; video_url: string }[]
}

const SKILL_FOCUS_EMOJI: Record<string, string> = {
  speed: '⚡', agility: '🔄', strength: '💪', technique: '🎯', endurance: '🏃', flexibility: '🤸',
}

type DrillEntry = PlanDrill & { drill: Drill }

export default function TraineeDrillChecklist({
  planId,
  kidId,
  drills,
  initialCompletedIds,
  initialRating = null,
  initialNotes = null,
  initialRecordings = [],
}: {
  planId: string
  kidId: string
  drills: DrillEntry[]
  initialCompletedIds: string[]
  initialRating?: number | null
  initialNotes?: string | null
  initialRecordings?: DrillRecording[]
}) {
  const router = useRouter()
  const [completedIds, setCompletedIds] = useState(new Set(initialCompletedIds))
  const [loading, setLoading] = useState<string | null>(null)
  const [expandedDrillId, setExpandedDrillId] = useState<string | null>(null)
  const [finished, setFinished] = useState(initialCompletedIds.length === drills.length && drills.length > 0)
  const [ratingStep, setRatingStep] = useState(false)
  const [workoutRating, setWorkoutRating] = useState<1 | 2 | 3>(2)
  const [workoutNotes, setWorkoutNotes] = useState('')
  const [ratingLoading, setRatingLoading] = useState(false)
  const [savedRating, setSavedRating] = useState<number | null>(initialRating)
  const [savedNotes, setSavedNotes] = useState<string | null>(initialNotes)
  const [drillGroups, setDrillGroups] = useState<DrillGroup[]>([])
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})

  // Re-fetch completed drill IDs from DB on any session_logs change (trainer or trainee)
  useEffect(() => {
    const supabase = createClient()
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    async function refetchCompleted() {
      const { data } = await supabase
        .from('session_logs')
        .select('drill_id')
        .eq('plan_id', planId)
        .eq('kid_id', kidId)
        .gte('completed_at', todayStart.toISOString())
      setCompletedIds(new Set((data ?? []).map(r => r.drill_id)))
    }

    const channel = supabase
      .channel(`trainee_checklist:${planId}:${kidId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'session_logs',
        filter: `plan_id=eq.${planId}`,
      }, refetchCompleted)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [planId, kidId])

  // When Realtime sync makes all drills complete (trainer marked last drill), show rating step
  useEffect(() => {
    if (completedIds.size === drills.length && drills.length > 0 && !finished && !ratingStep) {
      setRatingStep(true)
    }
  }, [completedIds.size, drills.length, finished, ratingStep])

  // Load recordings when workout is finished
  useEffect(() => {
    if (!finished) return
    let cancelled = false
    async function loadRecordings() {
      const supabase = createClient()
      const { data } = await supabase
        .from('drill_recordings')
        .select('id, video_url, drill_id, drill:drills(title)')
        .eq('plan_id', planId)
        .eq('kid_id', kidId)
        .order('recorded_at', { ascending: false })

      if (cancelled || !data || data.length === 0) return

      const drillOrder = drills.map(pd => pd.drill_id)
      const grouped = new Map<string, DrillGroup>()
      for (const rec of data) {
        const title = (rec.drill as unknown as { title: string } | null)?.title ?? 'Unknown drill'
        if (!grouped.has(rec.drill_id)) grouped.set(rec.drill_id, { drillId: rec.drill_id, title, recs: [] })
        grouped.get(rec.drill_id)!.recs.push({ id: rec.id, video_url: rec.video_url })
      }
      const sorted = drillOrder.filter(id => grouped.has(id)).map(id => grouped.get(id)!)
      if (!cancelled) setDrillGroups(sorted)

      const urlEntries = await Promise.all(
        data.map(async rec => {
          const { data: signed } = await supabase.storage.from('drill-recordings').createSignedUrl(rec.video_url, 3600)
          return signed ? ([rec.id, signed.signedUrl] as const) : null
        })
      )
      if (!cancelled) {
        const urls: Record<string, string> = {}
        for (const e of urlEntries) { if (e) urls[e[0]] = e[1] }
        setSignedUrls(urls)
      }
    }
    loadRecordings()
    return () => { cancelled = true }
  }, [finished]) // eslint-disable-line react-hooks/exhaustive-deps

  async function deleteRecording(id: string, videoUrl: string) {
    setDrillGroups(prev =>
      prev.map(g => ({ ...g, recs: g.recs.filter(r => r.id !== id) })).filter(g => g.recs.length > 0)
    )
    setSignedUrls(prev => { const next = { ...prev }; delete next[id]; return next })
    const supabase = createClient()
    await Promise.all([
      supabase.storage.from('drill-recordings').remove([videoUrl]),
      supabase.from('drill_recordings').delete().eq('id', id),
    ])
  }

  async function toggleDrill(drillId: string) {
    if (loading) return
    setLoading(drillId)

    const isCompleted = completedIds.has(drillId)
    const res = await fetch('/api/trainee/toggle-drill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        drillId,
        action: isCompleted ? 'uncomplete' : 'complete',
      }),
    })

    if (res.ok) {
      if (isCompleted) {
        setCompletedIds(prev => {
          const next = new Set(prev)
          next.delete(drillId)
          return next
        })
      } else {
        const next = new Set(completedIds)
        next.add(drillId)
        setCompletedIds(next)
        if (next.size === drills.length) setRatingStep(true)
      }
      router.refresh()
    }

    setLoading(null)
  }

  async function submitRating() {
    setRatingLoading(true)
    await fetch('/api/trainee/rate-workout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId, rating: workoutRating, notes: workoutNotes || null }),
    })
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
        {drillGroups.length > 0 && (() => {
          const drillMap = new Map(drills.map(pd => [pd.drill_id, pd.drill]))
          const items: CarouselItem[] = drillGroups.flatMap(g => {
            const d = drillMap.get(g.drillId)
            return g.recs.map(r => ({
              id: r.id,
              signedUrl: signedUrls[r.id],
              drillTitle: g.title,
              videoUrl: r.video_url,
              drillDescription: d?.description,
              drillInstructions: d?.instructions,
              sport: d?.sport,
              skillLevel: d?.difficulty,
            }))
          })
          return (
            <div className="border-t border-green-100 px-5 py-4">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">
                Recordings{items.length > 1 ? ` (${items.length})` : ''}
              </p>
              <RecordingsCarousel items={items} onDelete={deleteRecording} />
            </div>
          )
        })()}
        <div className="border-t border-green-100 p-5">
          <Link
            href="/trainee"
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
        const isExpanded = expandedDrillId === pd.drill_id
        const drillRecordings = initialRecordings.filter(r => r.drill_id === pd.drill_id)

        return (
          <div key={pd.id} className="space-y-2">
            <div
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

                <button
                  onClick={() => setExpandedDrillId(isExpanded ? null : pd.drill_id)}
                  className={cn(
                    'relative flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors mt-0.5',
                    isExpanded
                      ? 'bg-blue-100 text-blue-600'
                      : drillRecordings.length > 0
                      ? 'bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-600'
                      : 'text-slate-300 hover:text-blue-500 hover:bg-blue-50'
                  )}
                  title={isExpanded ? 'Hide recorder' : 'Record this drill'}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                  </svg>
                  {drillRecordings.length > 0 && !isExpanded && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-blue-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {drillRecordings.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {isExpanded && (
              <DrillRecorder
                drillId={pd.drill_id}
                planId={planId}
                kidId={kidId}
                initialRecordings={drillRecordings}
              />
            )}
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
