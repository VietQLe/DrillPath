'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { LEVEL_COLORS, LEVEL_LABELS, formatDuration, cn } from '@/lib/utils'
import RecordingsCarousel from '@/components/workouts/RecordingsCarousel'
import type { CarouselItem } from '@/components/workouts/RecordingsCarousel'
import type { PlanDrill, Drill } from '@/types'

type DrillGroup = {
  drillId: string
  title: string
  recs: { id: string; video_url: string }[]
}

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
  initialShotStats = null,
  date,
}: {
  planId: string
  kidId: string
  drills: DrillEntry[]
  initialCompletedIds: string[]
  initialRating?: number | null
  initialNotes?: string | null
  initialShotStats?: Record<string, { attempts: number; makes: number }> | null
  date?: string
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
  const [drillGroups, setDrillGroups] = useState<DrillGroup[]>([])
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  // Shot tracking: drillId → { attempts, makes }
  const [pendingShotDrill, setPendingShotDrill] = useState<string | null>(null)
  const [shotAttempts, setShotAttempts] = useState<Record<string, number>>({})
  const [shotMakes, setShotMakes] = useState<Record<string, number>>({})
  // Shot stats for already-completed drills (loaded from DB)
  const [savedShots, setSavedShots] = useState<Record<string, { attempts: number; makes: number }>>(initialShotStats ?? {})

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
      router.refresh()
    }

    const channel = supabase
      .channel(`drill_checklist:${planId}:${kidId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'session_logs',
        filter: `plan_id=eq.${planId}`,
      }, refetchCompleted)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [planId, kidId, router])

  // When Realtime sync makes all drills complete (trainee marked last drill), show finished
  useEffect(() => {
    if (completedIds.size === drills.length && drills.length > 0 && !finished && !ratingStep) {
      setFinished(true)
      router.refresh()
    }
  }, [completedIds.size, drills.length, finished, ratingStep, router])

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

      // Group by drill, preserving workout order
      const drillOrder = drills.map((pd) => pd.drill_id)
      const grouped = new Map<string, DrillGroup>()
      for (const rec of data) {
        const drillData = rec.drill as unknown as { title: string } | null
        const title = drillData?.title ?? 'Unknown drill'
        if (!grouped.has(rec.drill_id)) {
          grouped.set(rec.drill_id, { drillId: rec.drill_id, title, recs: [] })
        }
        grouped.get(rec.drill_id)!.recs.push({ id: rec.id, video_url: rec.video_url })
      }
      const sorted = drillOrder.filter((id) => grouped.has(id)).map((id) => grouped.get(id)!)
      if (!cancelled) setDrillGroups(sorted)

      // Generate signed URLs in parallel
      const urlEntries = await Promise.all(
        data.map(async (rec) => {
          const { data: signed } = await supabase.storage
            .from('drill-recordings')
            .createSignedUrl(rec.video_url, 3600)
          return signed ? ([rec.id, signed.signedUrl] as const) : null
        })
      )
      if (!cancelled) {
        const urls: Record<string, string> = {}
        for (const entry of urlEntries) { if (entry) urls[entry[0]] = entry[1] }
        setSignedUrls(urls)
      }
    }
    loadRecordings()
    return () => { cancelled = true }
  }, [finished])

  function handleDrillTap(drillId: string, drill: { sport: string }) {
    if (loading) return
    if (completedIds.has(drillId)) {
      // Unchecking: always immediate, no shot tracker
      toggleDrill(drillId)
    } else if (drill.sport === 'basketball') {
      // Basketball completion: open shot tracker first
      setPendingShotDrill(drillId)
    } else {
      toggleDrill(drillId)
    }
  }

  async function toggleDrill(drillId: string, shots?: { attempts: number; makes: number }) {
    if (loading) return
    setLoading(drillId)
    setPendingShotDrill(null)
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
      setSavedShots(prev => { const n = { ...prev }; delete n[drillId]; return n })

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
        shot_attempts: shots?.attempts ?? null,
        shot_makes: shots?.makes ?? null,
      })

      if (shots) {
        setSavedShots(prev => ({ ...prev, [drillId]: shots }))
      }

      const next = new Set(completedIds)
      next.add(drillId)
      setCompletedIds(next)

      if (next.size === drills.length) {
        const { count } = await supabase
          .from('workout_sessions')
          .select('*', { count: 'exact', head: true })
          .eq('plan_id', planId)
          .eq('kid_id', kidId)
          .gte('completed_at', todayStart.toISOString())
        if (!count) {
          await supabase.from('workout_sessions').insert({ kid_id: kidId, plan_id: planId })
        }
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

  async function deleteRecording(id: string, videoUrl: string) {
    setDrillGroups((prev) =>
      prev
        .map((g) => ({ ...g, recs: g.recs.filter((r) => r.id !== id) }))
        .filter((g) => g.recs.length > 0)
    )
    setSignedUrls((prev) => { const next = { ...prev }; delete next[id]; return next })
    const supabase = createClient()
    await Promise.all([
      supabase.storage.from('drill-recordings').remove([videoUrl]),
      supabase.from('drill_recordings').delete().eq('id', id),
    ])
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
        const isPending = pendingShotDrill === pd.drill_id
        const isBasketball = drill.sport === 'basketball'
        const shots = savedShots[pd.drill_id]
        const pendingAttempts = shotAttempts[pd.drill_id] ?? 0
        const pendingMakes = shotMakes[pd.drill_id] ?? 0
        const pendingMisses = Math.max(0, pendingAttempts - pendingMakes)
        const pendingPct = pendingAttempts > 0 ? Math.round((pendingMakes / pendingAttempts) * 100) : null

        return (
          <div
            key={pd.id}
            className={cn(
              'rounded-2xl border transition-all',
              isPending ? 'border-orange-300 bg-orange-50' : done ? 'border-green-200 bg-green-50' : 'border-slate-200 bg-white'
            )}
          >
            <div className="flex items-start gap-3 p-4">
              <button
                onClick={() => handleDrillTap(pd.drill_id, drill)}
                disabled={!!loading}
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 font-bold text-sm transition-all border-2',
                  done
                    ? 'bg-green-500 border-green-500 text-white'
                    : isPending
                    ? 'border-orange-400 bg-orange-100 text-orange-600'
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
                  {/* Shot stats badge on completed basketball drills */}
                  {done && shots && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">
                      🏀 {shots.makes}/{shots.attempts} ({Math.round((shots.makes / shots.attempts) * 100)}%)
                    </span>
                  )}
                </div>
              </div>

              <Link
                href={`/drills/${drill.id}?from=${encodeURIComponent(`/workouts/${planId}?kid=${kidId}${date ? `&date=${date}` : ''}`)}`}
                className="text-slate-300 hover:text-blue-400 flex-shrink-0 mt-1 transition-colors text-lg leading-none"
                title="View drill details"
              >
                ℹ
              </Link>
            </div>

            {/* Inline shot tracker — basketball drills only, shown before completing */}
            {isPending && isBasketball && (
              <div className="px-4 pb-4 border-t border-orange-200">
                <p className="text-xs font-semibold text-orange-700 mt-3 mb-3">🏀 Track your shots (optional)</p>
                <div className="flex items-center gap-4 mb-3">
                  <ShotCounter
                    label="Attempts"
                    value={pendingAttempts}
                    onChange={v => setShotAttempts(prev => ({ ...prev, [pd.drill_id]: Math.max(0, v) }))}
                  />
                  <ShotCounter
                    label="Makes"
                    value={pendingMakes}
                    max={pendingAttempts}
                    onChange={v => setShotMakes(prev => ({ ...prev, [pd.drill_id]: Math.max(0, Math.min(v, pendingAttempts)) }))}
                  />
                  {pendingAttempts > 0 && (
                    <div className="text-xs text-slate-500 leading-tight">
                      <div className="font-semibold text-slate-700">{pendingPct}%</div>
                      <div>{pendingMisses} miss{pendingMisses !== 1 ? 'es' : ''}</div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleDrill(pd.drill_id)}
                    className="flex-1 py-2 text-sm text-slate-500 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => toggleDrill(
                      pd.drill_id,
                      pendingAttempts > 0 ? { attempts: pendingAttempts, makes: pendingMakes } : undefined
                    )}
                    className="flex-[2] py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-colors"
                  >
                    {pendingAttempts > 0 ? `Done — ${pendingMakes}/${pendingAttempts}` : 'Mark complete'}
                  </button>
                </div>
              </div>
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

function ShotCounter({
  label,
  value,
  max,
  onChange,
}: {
  label: string
  value: number
  max?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs text-slate-500 font-medium">{label}</span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onChange(value - 1)}
          disabled={value <= 0}
          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-30 text-slate-700 font-bold text-base leading-none transition-colors"
        >−</button>
        <span className="w-8 text-center text-base font-bold text-slate-900">{value}</span>
        <button
          onClick={() => onChange(value + 1)}
          disabled={max !== undefined && value >= max}
          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-30 text-slate-700 font-bold text-base leading-none transition-colors"
        >+</button>
      </div>
    </div>
  )
}
