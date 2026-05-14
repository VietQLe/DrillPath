'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  SPORT_EMOJI,
  LEVEL_COLORS,
  LEVEL_LABELS,
  formatDuration,
  getAgeRange,
  cn,
} from '@/lib/utils'
import DrillForm from '@/components/drills/DrillForm'
import type { Kid, Drill, SkillFocus, SkillLevel, AgeRange } from '@/types'

const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const SKILL_FOCUS_EMOJI: Record<string, string> = {
  speed: '⚡', agility: '🔄', strength: '💪', technique: '🎯', endurance: '🏃', flexibility: '🤸',
}

type SavedPlan = {
  id: string
  name: string
  focus: string | null
  kid_id: string
  created_at: string
  plan_drills: { display_order: number; drill: Drill }[]
}

type GeneratedDrill = {
  title: string
  description: string
  skill_focus: SkillFocus
  difficulty: SkillLevel
  duration_minutes: number
  equipment: string[]
  instructions: string[]
}

type GeneratedWorkout = {
  name: string
  focus: string
  drills: GeneratedDrill[]
}

export default function WorkoutBuilder({
  kids,
  drills,
  defaultKidId,
  defaultDate,
  defaultDay,
  defaultName,
  defaultFocus,
  defaultSelectedDrills,
  userId,
}: {
  kids: Kid[]
  drills: Drill[]
  defaultKidId?: string
  defaultDate?: string
  defaultDay?: number
  defaultName?: string
  defaultFocus?: string
  defaultSelectedDrills?: Drill[]
  userId: string
}) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [creatingDrill, setCreatingDrill] = useState(false)
  const [localDrills, setLocalDrills] = useState<Drill[]>(drills)
  const [kidId, setKidId] = useState(defaultKidId ?? kids[0]?.id ?? '')
  const [name, setName] = useState(defaultName ?? '')
  const [focus, setFocus] = useState(defaultFocus ?? '')
  const [selectedDrills, setSelectedDrills] = useState<Drill[]>(defaultSelectedDrills ?? [])
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Recurrence
  const [isRecurring, setIsRecurring] = useState(false)
  const [duration, setDuration] = useState<'4w' | '8w' | '3m' | '6m' | 'ongoing'>('ongoing')
  const todayStr = new Date().toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState<string>(() => {
    if (defaultDate) return defaultDate
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (defaultDay !== undefined) {
      const daysUntil = (defaultDay - today.getDay() + 7) % 7
      const d = new Date(today)
      d.setDate(today.getDate() + daysUntil)
      return d.toISOString().slice(0, 10)
    }
    return today.toISOString().slice(0, 10)
  })
  const day = new Date(startDate + 'T12:00:00').getDay()

  // AI generation state
  const [aiMode, setAiMode] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiPreview, setAiPreview] = useState<GeneratedWorkout | null>(null)
  const [aiError, setAiError] = useState('')
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null)

  // Saved workouts picker state
  const [savedMode, setSavedMode] = useState(false)
  const [savedPlans, setSavedPlans] = useState<SavedPlan[] | null>(null)
  const [savedLoading, setSavedLoading] = useState(false)
  const [savedSearch, setSavedSearch] = useState('')

  const selectedKid = kids.find(k => k.id === kidId) ?? kids[0]

  const filteredDrills = localDrills.filter(d => {
    if (selectedKid && d.sport !== selectedKid.sport) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      d.title.toLowerCase().includes(q) ||
      d.skill_focus.includes(q) ||
      d.difficulty.includes(q)
    )
  })

  function toggleDrill(drill: Drill) {
    if (selectedDrills.find(d => d.id === drill.id)) {
      setSelectedDrills(prev => prev.filter(d => d.id !== drill.id))
    } else {
      setSelectedDrills(prev => [...prev, drill])
    }
  }

  function moveDrill(index: number, direction: -1 | 1) {
    const next = [...selectedDrills]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setSelectedDrills(next)
  }

  async function generateWorkout() {
    if (!aiPrompt.trim() || !selectedKid) return
    setAiLoading(true)
    setAiError('')
    setAiPreview(null)

    try {
      const res = await fetch('/api/generate-workout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: aiPrompt,
          sport: selectedKid.sport,
          level: selectedKid.skill_level,
          ageRange: getAgeRange(selectedKid.age),
        }),
      })

      if (!res.ok) {
        setAiError('Failed to generate workout. Please try again.')
        return
      }

      const data = await res.json()
      setAiPreview(data as GeneratedWorkout)
    } catch {
      setAiError('Something went wrong. Please try again.')
    } finally {
      setAiLoading(false)
    }
  }

  function removeAiDrill(index: number) {
    setAiPreview(prev => prev ? { ...prev, drills: prev.drills.filter((_, i) => i !== index) } : prev)
  }

  async function regenerateAiDrill(index: number) {
    if (!aiPreview || !selectedKid) return
    setRegeneratingIndex(index)
    try {
      const res = await fetch('/api/regenerate-drill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport: selectedKid.sport,
          level: selectedKid.skill_level,
          ageRange: getAgeRange(selectedKid.age),
          workoutName: aiPreview.name,
          workoutFocus: aiPreview.focus,
          drillToReplace: aiPreview.drills[index],
          otherDrills: aiPreview.drills.filter((_, i) => i !== index).map(d => d.title),
        }),
      })
      if (res.ok) {
        const newDrill = await res.json() as GeneratedDrill
        setAiPreview(prev => {
          if (!prev) return prev
          const drills = [...prev.drills]
          drills[index] = newDrill
          return { ...prev, drills }
        })
      }
    } finally {
      setRegeneratingIndex(null)
    }
  }

  function useGeneratedWorkout() {
    if (!aiPreview || !selectedKid) return

    const ageRange: AgeRange = getAgeRange(selectedKid.age)
    const ts = Date.now()
    const aiDrills: Drill[] = aiPreview.drills.map((d, i) => ({
      id: `ai-${ts}-${i}`,
      title: d.title,
      description: d.description,
      sport: selectedKid.sport,
      skill_focus: d.skill_focus,
      difficulty: d.difficulty,
      age_range: ageRange,
      duration_minutes: d.duration_minutes,
      equipment: d.equipment,
      instructions: d.instructions,
      video_url: null,
      thumbnail_url: null,
      created_by: null,
      created_at: new Date().toISOString(),
    }))

    setName(aiPreview.name)
    setFocus(aiPreview.focus)
    setLocalDrills(prev => {
      const existingIds = new Set(prev.map(d => d.id))
      return [...prev, ...aiDrills.filter(d => !existingIds.has(d.id))]
    })
    setSelectedDrills(aiDrills)
    setAiMode(false)
    setAiPreview(null)
    setAiPrompt('')
    setStep(1)
  }

  async function openSavedPicker() {
    setSavedMode(true)
    if (savedPlans !== null) return
    setSavedLoading(true)
    const supabase = createClient()
    const kidIds = kids.map(k => k.id)
    const { data } = await supabase
      .from('training_plans')
      .select('id, name, focus, kid_id, created_at, plan_drills(display_order, drill:drills(*))')
      .in('kid_id', kidIds)
      .order('created_at', { ascending: false })
    setSavedPlans((data ?? []) as unknown as SavedPlan[])
    setSavedLoading(false)
  }

  function applySavedPlan(plan: SavedPlan) {
    const planDrills = [...plan.plan_drills]
      .sort((a, b) => a.display_order - b.display_order)
      .map(pd => pd.drill)
      .filter((d): d is Drill => !!d)

    // Prefer already-loaded drill objects; fall back to what the plan returned
    const resolved = planDrills.map(d => localDrills.find(ld => ld.id === d.id) ?? d)

    setLocalDrills(prev => {
      const existingIds = new Set(prev.map(d => d.id))
      return [...prev, ...resolved.filter(d => !existingIds.has(d.id))]
    })
    setName(plan.name)
    setFocus(plan.focus ?? '')
    setSelectedDrills(resolved)
    setSavedMode(false)
  }

  function computeEndDate(): string | null {
    const [sy, sm, sd] = startDate.split('-').map(Number)
    const base = new Date(sy, sm - 1, sd)

    if (!isRecurring && day !== null) {
      // One-time: end on the first occurrence of the day on or after startDate
      const daysUntil = (day - base.getDay() + 7) % 7
      const firstOcc = new Date(base)
      firstOcc.setDate(base.getDate() + daysUntil)
      return firstOcc.toISOString().slice(0, 10)
    }

    if (duration === 'ongoing') return null

    const end = new Date(base)
    if (duration === '4w') end.setDate(end.getDate() + 28)
    else if (duration === '8w') end.setDate(end.getDate() + 56)
    else if (duration === '3m') end.setMonth(end.getMonth() + 3)
    else if (duration === '6m') end.setMonth(end.getMonth() + 6)
    return end.toISOString().slice(0, 10)
  }

  async function handleSave() {
    if (!name.trim() || selectedDrills.length === 0) return
    setSaving(true)
    setError('')
    const supabase = createClient()
    const endDate = day !== null ? computeEndDate() : null

    // Insert any AI-generated drills first to get real DB IDs
    const resolvedIds: string[] = []
    for (const drill of selectedDrills) {
      if (drill.id.startsWith('ai-')) {
        const { data, error: insertErr } = await supabase
          .from('drills')
          .insert({
            title: drill.title,
            description: drill.description,
            sport: drill.sport,
            skill_focus: drill.skill_focus,
            difficulty: drill.difficulty,
            age_range: drill.age_range,
            duration_minutes: drill.duration_minutes,
            equipment: drill.equipment,
            instructions: drill.instructions,
            created_by: userId,
          })
          .select('id')
          .single()

        if (insertErr || !data) {
          setSaving(false)
          setError('Failed to save generated drills. Please try again.')
          return
        }
        resolvedIds.push(data.id)
      } else {
        resolvedIds.push(drill.id)
      }
    }

    const { data: plan, error: planErr } = await supabase
      .from('training_plans')
      .insert({
        kid_id: kidId,
        name: name.trim(),
        focus: focus.trim() || null,
        scheduled_day: day,
        start_date: startDate,
        end_date: endDate,
      })
      .select()
      .single()

    if (planErr || !plan) {
      setSaving(false)
      setError('Failed to save workout. Please try again.')
      return
    }

    const { error: drillsErr } = await supabase.from('plan_drills').insert(
      resolvedIds.map((drillId, i) => ({
        plan_id: plan.id,
        drill_id: drillId,
        display_order: i,
      }))
    )

    if (drillsErr) {
      setSaving(false)
      setError('Workout saved but drills failed to attach. Please try again.')
      return
    }

    // Also save as a workout template so the trainer can reuse it for other athletes
    const { data: template } = await supabase
      .from('workout_templates')
      .insert({
        name: name.trim(),
        focus: focus.trim() || null,
        sport: selectedKid.sport,
        difficulty: selectedKid.skill_level,
        created_by: userId,
      })
      .select('id')
      .single()

    if (template) {
      await supabase.from('template_drills').insert(
        resolvedIds.map((drillId, i) => ({
          template_id: template.id,
          drill_id: drillId,
          display_order: i,
        }))
      )
    }

    router.push(`/workouts/${plan.id}?kid=${kidId}`)
    router.refresh()
  }

  // Saved workouts picker panel
  if (savedMode) {
    const filtered = (savedPlans ?? []).filter(p =>
      !savedSearch.trim() || p.name.toLowerCase().includes(savedSearch.toLowerCase())
    )

    return (
      <div className="space-y-4">
        <div className="pt-2 flex items-center gap-3">
          <button
            onClick={() => setSavedMode(false)}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          >←</button>
          <h1 className="text-2xl font-bold text-slate-900">My Saved Workouts</h1>
        </div>

        <input
          value={savedSearch}
          onChange={e => setSavedSearch(e.target.value)}
          placeholder="Search workouts…"
          className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {savedLoading && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-blue-600 animate-spin" />
          </div>
        )}

        {!savedLoading && filtered.length === 0 && (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-slate-500 text-sm">
              {savedSearch ? 'No workouts match your search.' : 'No saved workouts yet.'}
            </p>
          </div>
        )}

        {!savedLoading && filtered.length > 0 && (
          <div className="space-y-2">
            {filtered.map(plan => {
              const planKid = kids.find(k => k.id === plan.kid_id)
              const drillList = [...plan.plan_drills]
                .sort((a, b) => a.display_order - b.display_order)
                .map(pd => pd.drill)
                .filter(Boolean) as Drill[]

              return (
                <button
                  key={plan.id}
                  onClick={() => applySavedPlan(plan)}
                  className="w-full text-left p-4 rounded-xl border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="font-semibold text-slate-900 text-sm">{plan.name}</span>
                    <span className="text-xs text-slate-400 flex-shrink-0">
                      {drillList.length} drill{drillList.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {planKid && (
                    <div className="text-xs text-slate-500 mb-2">
                      {SPORT_EMOJI[planKid.sport]} {planKid.name}
                    </div>
                  )}
                  {drillList.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {drillList.slice(0, 4).map(d => (
                        <span
                          key={d.id}
                          className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full truncate max-w-[140px]"
                        >
                          {d.title}
                        </span>
                      ))}
                      {drillList.length > 4 && (
                        <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-400 rounded-full">
                          +{drillList.length - 4} more
                        </span>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // AI generation panel
  if (aiMode) {
    return (
      <div className="space-y-5">
        <div className="pt-2 flex items-center gap-3">
          <button
            onClick={() => { setAiMode(false); setAiPreview(null); setAiError('') }}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          >←</button>
          <h1 className="text-2xl font-bold text-slate-900">AI Workout Generator</h1>
        </div>

        {!aiPreview && !aiLoading && (
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-blue-50 to-violet-50 border border-blue-200 rounded-2xl p-5">
              <p className="text-sm text-slate-600 leading-relaxed">
                Describe what you want to work on and AI will build a complete workout with drills, instructions, and equipment for{' '}
                <span className="font-semibold text-slate-900">
                  {selectedKid ? `${SPORT_EMOJI[selectedKid.sport]} ${selectedKid.name}` : 'your athlete'}
                </span>.
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                What should this workout focus on?
              </label>
              <textarea
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                placeholder={`e.g. "ball handling and finishing at the rim with weak hand" or "footwork and agility for base stealing"`}
                rows={3}
                className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            {aiError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{aiError}</p>
            )}

            <button
              onClick={generateWorkout}
              disabled={!aiPrompt.trim()}
              className="w-full py-3.5 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl transition-colors"
            >
              ✨ Generate Workout
            </button>
          </div>
        )}

        {aiLoading && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-12 h-12 rounded-full border-4 border-violet-200 border-t-violet-600 animate-spin" />
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-700">Building your workout...</p>
              <p className="text-xs text-slate-400 mt-1">This takes about 10–20 seconds</p>
            </div>
          </div>
        )}

        {aiPreview && !aiLoading && (
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-violet-50 to-blue-50 border border-violet-200 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h2 className="text-lg font-bold text-slate-900">{aiPreview.name}</h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium flex-shrink-0">AI</span>
              </div>
              <p className="text-sm text-slate-600">{aiPreview.focus}</p>
              <p className="text-xs text-slate-400 mt-2">
                {aiPreview.drills.length} drills · {aiPreview.drills.reduce((s, d) => s + d.duration_minutes, 0)} min total
              </p>
            </div>

            <div className="space-y-2">
              {aiPreview.drills.map((drill, i) => (
                <div
                  key={i}
                  className={cn(
                    'border rounded-xl p-4 transition-colors',
                    regeneratingIndex === i ? 'border-violet-300 bg-violet-50' : 'bg-white border-slate-200'
                  )}
                >
                  {regeneratingIndex === i ? (
                    <div className="flex items-center justify-center gap-3 py-3">
                      <div className="w-5 h-5 rounded-full border-2 border-violet-200 border-t-violet-600 animate-spin flex-shrink-0" />
                      <span className="text-sm text-violet-600 font-medium">Regenerating drill…</span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-900 text-sm">{drill.title}</div>
                        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{drill.description}</p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium', LEVEL_COLORS[drill.difficulty])}>
                            {LEVEL_LABELS[drill.difficulty]}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                            {SKILL_FOCUS_EMOJI[drill.skill_focus]} {drill.skill_focus}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                            ⏱ {formatDuration(drill.duration_minutes)}
                          </span>
                        </div>
                        {drill.instructions.length > 0 && (
                          <ol className="mt-2 space-y-0.5">
                            {drill.instructions.map((step, j) => (
                              <li key={j} className="text-xs text-slate-500 flex gap-1.5">
                                <span className="text-slate-300 flex-shrink-0">{j + 1}.</span>
                                {step}
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                      <div className="flex flex-col gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => regenerateAiDrill(i)}
                          disabled={regeneratingIndex !== null}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-violet-600 hover:bg-violet-100 transition-colors disabled:opacity-40"
                          title="Regenerate this drill"
                        >
                          ↺
                        </button>
                        <button
                          onClick={() => removeAiDrill(i)}
                          disabled={regeneratingIndex !== null}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                          title="Remove this drill"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setAiPreview(null); setAiError('') }}
                className="flex-1 py-3 border border-slate-300 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors text-sm"
              >
                ↺ Regenerate
              </button>
              <button
                onClick={useGeneratedWorkout}
                disabled={aiPreview.drills.length === 0 || regeneratingIndex !== null}
                className="flex-[2] py-3 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl transition-colors text-sm"
              >
                Use this workout →
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="pt-2 flex items-center gap-3">
        <Link href="/workouts" className="text-slate-400 hover:text-slate-600 text-xl leading-none">←</Link>
        <h1 className="text-2xl font-bold text-slate-900">New Workout</h1>
      </div>

      {/* Step progress */}
      <div className="flex gap-2">
        {[1, 2].map(s => (
          <div
            key={s}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              s <= step ? 'bg-blue-600' : 'bg-slate-200'
            )}
          />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-5">
          {selectedDrills.length > 0 && (() => {
            const hasAi = selectedDrills.some(d => d.id.startsWith('ai-'))
            return (
              <div className={cn(
                'flex items-center gap-2 rounded-xl px-4 py-3 border',
                hasAi ? 'bg-violet-50 border-violet-200' : 'bg-blue-50 border-blue-200'
              )}>
                <span className="text-base">{hasAi ? '✨' : '📋'}</span>
                <p className={cn('text-sm font-medium', hasAi ? 'text-violet-700' : 'text-blue-700')}>
                  {hasAi
                    ? `${selectedDrills.length} AI-generated drill${selectedDrills.length !== 1 ? 's' : ''} ready — pick a schedule below then continue`
                    : `${selectedDrills.length} drill${selectedDrills.length !== 1 ? 's' : ''} loaded from library — pick a schedule below then continue`}
                </p>
              </div>
            )
          })()}

          {kids.length > 1 && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Athlete</label>
              <div className="flex gap-2 flex-wrap">
                {kids.map(kid => (
                  <button
                    key={kid.id}
                    onClick={() => { setKidId(kid.id); setSelectedDrills([]) }}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-colors',
                      kidId === kid.id
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    )}
                  >
                    <span>{SPORT_EMOJI[kid.sport]}</span>
                    {kid.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Workout name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Ball Handling + Finishing"
              className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Goal <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              value={focus}
              onChange={e => setFocus(e.target.value)}
              placeholder="e.g. Improve weak-hand dribbling and finishing at the rim"
              className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Start date</label>
            <input
              type="date"
              value={startDate}
              min={todayStr}
              onChange={e => setStartDate(e.target.value || todayStr)}
              className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {day !== null && (
              <p className="text-xs text-slate-500 mt-1.5">Repeats every {DAYS_FULL[day]}</p>
            )}
          </div>

          <div className="bg-slate-50 rounded-xl p-4 space-y-3">
              <label className="block text-sm font-semibold text-slate-700">Recurrence</label>

              <div className="flex gap-2">
                <button
                  onClick={() => setIsRecurring(false)}
                  className={cn(
                    'flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-colors',
                    !isRecurring
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  )}
                >
                  One time
                </button>
                <button
                  onClick={() => setIsRecurring(true)}
                  className={cn(
                    'flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-colors',
                    isRecurring
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  )}
                >
                  Recurring
                </button>
              </div>

              {isRecurring && (
                <div>
                  <p className="text-xs text-slate-500 mb-2">For how long?</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([
                      ['4w', '4 weeks'],
                      ['8w', '8 weeks'],
                      ['3m', '3 months'],
                      ['6m', '6 months'],
                      ['ongoing', 'Ongoing'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => setDuration(value)}
                        className={cn(
                          'py-2 rounded-xl text-xs font-semibold border-2 transition-colors',
                          duration === value
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-slate-200 text-slate-500 hover:border-slate-300'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {day !== null && startDate && (
                <p className="text-xs text-slate-400">
                  {!isRecurring
                    ? `Appears once on ${new Date(startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'long' })}`
                    : duration === 'ongoing'
                    ? `Repeats every ${DAYS_FULL[day]} starting ${new Date(startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                    : `Repeats every ${DAYS_FULL[day]} for ${
                        duration === '4w' ? '4 weeks' :
                        duration === '8w' ? '8 weeks' :
                        duration === '3m' ? '3 months' : '6 months'
                      } from ${new Date(startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                </p>
              )}
            </div>

          <button
            onClick={openSavedPicker}
            className="w-full py-3 border-2 border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-blue-50 font-semibold rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
          >
            📋 From saved workouts
          </button>

          <div className="flex gap-3">
            <button
              onClick={() => { setAiPrompt(focus); setAiMode(true) }}
              className="flex-1 py-3.5 border-2 border-violet-300 text-violet-700 hover:bg-violet-50 font-semibold rounded-xl transition-colors text-sm"
            >
              ✨ Generate with AI
            </button>
            <button
              onClick={() => setStep(2)}
              disabled={!name.trim()}
              className="flex-1 py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl transition-colors text-sm"
            >
              Next: Add Drills →
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-slate-50 rounded-xl p-4">
            <div className="font-semibold text-slate-900">{name}</div>
            {focus && <div className="text-sm text-slate-500 mt-0.5">{focus}</div>}
            {day !== null && (
              <div className="text-xs text-blue-600 mt-1 font-medium">{DAYS_FULL[day]}</div>
            )}
          </div>

          {/* Selected drills (ordered) */}
          {selectedDrills.length > 0 && (
            <div>
              <div className="text-sm font-semibold text-slate-700 mb-2">
                Drill order ({selectedDrills.length})
              </div>
              <div className="space-y-2">
                {selectedDrills.map((drill, i) => (
                  <div
                    key={drill.id}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border p-3',
                      drill.id.startsWith('ai-')
                        ? 'bg-violet-50 border-violet-200'
                        : 'bg-blue-50 border-blue-200'
                    )}
                  >
                    <div className="flex flex-col mr-1">
                      <button
                        onClick={() => moveDrill(i, -1)}
                        disabled={i === 0}
                        className="text-slate-400 hover:text-slate-600 disabled:opacity-30 text-xs leading-tight"
                      >▲</button>
                      <button
                        onClick={() => moveDrill(i, 1)}
                        disabled={i === selectedDrills.length - 1}
                        className="text-slate-400 hover:text-slate-600 disabled:opacity-30 text-xs leading-tight"
                      >▼</button>
                    </div>
                    <div className={cn(
                      'w-5 h-5 rounded-full text-white flex items-center justify-center text-xs font-bold flex-shrink-0',
                      drill.id.startsWith('ai-') ? 'bg-violet-600' : 'bg-blue-600'
                    )}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{drill.title}</div>
                      <div className="text-xs text-slate-500">
                        {formatDuration(drill.duration_minutes)} · {SKILL_FOCUS_EMOJI[drill.skill_focus]} {drill.skill_focus}
                        {drill.id.startsWith('ai-') && (
                          <span className="ml-1.5 text-violet-500 font-medium">AI</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => toggleDrill(drill)}
                      className="text-red-400 hover:text-red-600 text-xl flex-shrink-0 leading-none"
                    >×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inline drill creation */}
          {creatingDrill ? (
            <div>
              <div className="flex items-center gap-3 mb-5">
                <button
                  onClick={() => setCreatingDrill(false)}
                  className="text-slate-400 hover:text-slate-600 text-xl leading-none"
                >←</button>
                <h2 className="text-lg font-bold text-slate-900">Create a drill</h2>
              </div>
              <DrillForm
                userId={userId}
                onSuccess={drill => {
                  setLocalDrills(prev => [...prev, drill])
                  setSelectedDrills(prev => [...prev, drill])
                  setCreatingDrill(false)
                }}
              />
            </div>
          ) : (
            /* Drill picker */
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold text-slate-700">
                  Add drills{selectedKid && (
                    <span className="text-slate-400 font-normal">
                      {' '}— {SPORT_EMOJI[selectedKid.sport]} {selectedKid.name}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setCreatingDrill(true)}
                  className="text-xs text-blue-600 font-medium hover:underline flex-shrink-0"
                >
                  + Create drill
                </button>
              </div>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search drills..."
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {filteredDrills.length === 0 && (
                  <div className="text-center py-6">
                    <p className="text-sm text-slate-400 mb-2">No drills found</p>
                    <button
                      onClick={() => setCreatingDrill(true)}
                      className="text-sm text-blue-600 font-medium hover:underline"
                    >
                      + Create a custom drill
                    </button>
                  </div>
                )}
                {filteredDrills.map(drill => {
                  const isSelected = !!selectedDrills.find(d => d.id === drill.id)
                  return (
                    <button
                      key={drill.id}
                      onClick={() => toggleDrill(drill)}
                      className={cn(
                        'w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all',
                        isSelected
                          ? 'border-blue-400 bg-blue-50'
                          : 'border-slate-200 bg-white hover:border-blue-300'
                      )}
                    >
                      <div className={cn(
                        'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors',
                        isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300'
                      )}>
                        {isSelected && <span className="text-xs font-bold">✓</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-900">{drill.title}</div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium', LEVEL_COLORS[drill.difficulty])}>
                            {LEVEL_LABELS[drill.difficulty]}
                          </span>
                          <span className="text-xs text-slate-400">
                            {SKILL_FOCUS_EMOJI[drill.skill_focus]} {drill.skill_focus} · {formatDuration(drill.duration_minutes)}
                          </span>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {!creatingDrill && error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>
          )}

          {!creatingDrill && <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="flex-1 py-3 border border-slate-300 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={handleSave}
              disabled={selectedDrills.length === 0 || saving}
              className="flex-[2] py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl transition-colors"
            >
              {saving ? 'Saving...' : `Save Workout (${selectedDrills.length} drill${selectedDrills.length !== 1 ? 's' : ''})`}
            </button>
          </div>}
        </div>
      )}
    </div>
  )
}
