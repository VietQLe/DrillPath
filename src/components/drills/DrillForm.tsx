'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SPORT_EMOJI, SPORT_LABELS, LEVEL_COLORS, LEVEL_LABELS, cn } from '@/lib/utils'
import type { Drill, Sport, SkillLevel, SkillFocus, AgeRange } from '@/types'

const SPORTS: Sport[] = ['basketball', 'baseball', 'gymnastics', 'volleyball', 'jiujitsu']
const LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced']
const SKILL_FOCUSES: SkillFocus[] = ['speed', 'agility', 'strength', 'technique', 'endurance', 'flexibility']
const SKILL_FOCUS_EMOJI: Record<SkillFocus, string> = {
  speed: '⚡', agility: '🔄', strength: '💪', technique: '🎯', endurance: '🏃', flexibility: '🤸',
}
const AGE_RANGES: AgeRange[] = ['5-8', '9-12', '13+']
const AGE_RANGE_LABELS: Record<AgeRange, string> = {
  '5-8': 'Ages 5–8', '9-12': 'Ages 9–12', '13+': 'Ages 13+',
}

type DrillFormData = {
  title: string
  description: string
  sport: Sport
  skill_focus: SkillFocus
  difficulty: SkillLevel
  age_range: AgeRange
  duration_minutes: number
  equipment: string[]
  instructions: string[]
}

function blankForm(): DrillFormData {
  return {
    title: '',
    description: '',
    sport: 'basketball',
    skill_focus: 'technique',
    difficulty: 'beginner',
    age_range: '9-12',
    duration_minutes: 10,
    equipment: [''],
    instructions: [''],
  }
}

function drillToForm(drill: Drill): DrillFormData {
  return {
    title: drill.title,
    description: drill.description,
    sport: drill.sport,
    skill_focus: drill.skill_focus,
    difficulty: drill.difficulty,
    age_range: drill.age_range,
    duration_minutes: drill.duration_minutes,
    equipment: drill.equipment.length > 0 ? drill.equipment : [''],
    instructions: drill.instructions.length > 0 ? drill.instructions : [''],
  }
}

export default function DrillForm({
  drill,
  userId,
  onSuccess,
}: {
  drill?: Drill
  userId: string
  onSuccess?: (drill: Drill) => void
}) {
  const router = useRouter()
  const isEditing = !!drill
  const [form, setForm] = useState<DrillFormData>(drill ? drillToForm(drill) : blankForm())
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  function setField<K extends keyof DrillFormData>(key: K, value: DrillFormData[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function setListItem(key: 'equipment' | 'instructions', index: number, value: string) {
    setForm(prev => {
      const next = [...prev[key]]
      next[index] = value
      return { ...prev, [key]: next }
    })
  }

  function addListItem(key: 'equipment' | 'instructions') {
    setForm(prev => ({ ...prev, [key]: [...prev[key], ''] }))
  }

  function removeListItem(key: 'equipment' | 'instructions', index: number) {
    setForm(prev => {
      const next = prev[key].filter((_, i) => i !== index)
      return { ...prev, [key]: next.length > 0 ? next : [''] }
    })
  }

  function moveListItem(key: 'equipment' | 'instructions', index: number, direction: -1 | 1) {
    setForm(prev => {
      const next = [...prev[key]]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...prev, [key]: next }
    })
  }

  async function handleSave() {
    if (!form.title.trim() || !form.description.trim()) return
    setSaving(true)
    setError('')
    const supabase = createClient()

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      sport: form.sport,
      skill_focus: form.skill_focus,
      difficulty: form.difficulty,
      age_range: form.age_range,
      duration_minutes: form.duration_minutes,
      equipment: form.equipment.map(e => e.trim()).filter(Boolean),
      instructions: form.instructions.map(s => s.trim()).filter(Boolean),
      created_by: userId,
    }

    if (isEditing) {
      const { error: err } = await supabase
        .from('drills')
        .update(payload)
        .eq('id', drill.id)
      if (err) { setError('Failed to save changes.'); setSaving(false); return }
      router.push(`/drills/${drill.id}`)
    } else {
      const { data, error: err } = await supabase
        .from('drills')
        .insert(payload)
        .select()
        .single()
      if (err || !data) { setError('Failed to create drill.'); setSaving(false); return }
      if (onSuccess) {
        onSuccess(data as Drill)
        return
      }
      router.push(`/drills/${data.id}`)
    }
    router.refresh()
  }

  async function handleDelete() {
    if (!drill) return
    setDeleting(true)
    const supabase = createClient()
    await supabase.from('drills').delete().eq('id', drill.id)
    router.push('/drills')
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Drill name</label>
        <input
          value={form.title}
          onChange={e => setField('title', e.target.value)}
          placeholder="e.g. Weak Hand Wall Dribbles"
          className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Description</label>
        <textarea
          value={form.description}
          onChange={e => setField('description', e.target.value)}
          placeholder="Brief overview of the drill and what it develops"
          rows={3}
          className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      {/* Sport */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-2">Sport</label>
        <div className="flex gap-2">
          {SPORTS.map(s => (
            <button
              key={s}
              onClick={() => setField('sport', s)}
              className={cn(
                'flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-colors',
                form.sport === s
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300'
              )}
            >
              {SPORT_EMOJI[s]}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-1.5 text-center">{SPORT_LABELS[form.sport]}</p>
      </div>

      {/* Difficulty + Age range row */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Level</label>
          <div className="flex flex-col gap-1.5">
            {LEVELS.map(l => (
              <button
                key={l}
                onClick={() => setField('difficulty', l)}
                className={cn(
                  'px-3 py-2 rounded-xl text-xs font-semibold border-2 transition-colors text-left',
                  form.difficulty === l
                    ? `border-current ${LEVEL_COLORS[l]}`
                    : 'border-slate-200 text-slate-500 hover:border-slate-300'
                )}
              >
                {LEVEL_LABELS[l]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Age range</label>
          <div className="flex flex-col gap-1.5">
            {AGE_RANGES.map(r => (
              <button
                key={r}
                onClick={() => setField('age_range', r)}
                className={cn(
                  'px-3 py-2 rounded-xl text-xs font-semibold border-2 transition-colors text-left',
                  form.age_range === r
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300'
                )}
              >
                {AGE_RANGE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Skill focus */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-2">Skill focus</label>
        <div className="grid grid-cols-3 gap-2">
          {SKILL_FOCUSES.map(f => (
            <button
              key={f}
              onClick={() => setField('skill_focus', f)}
              className={cn(
                'py-2.5 rounded-xl text-xs font-semibold border-2 transition-colors capitalize',
                form.skill_focus === f
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300'
              )}
            >
              {SKILL_FOCUS_EMOJI[f]} {f}
            </button>
          ))}
        </div>
      </div>

      {/* Duration */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
          Duration: <span className="text-blue-600">{form.duration_minutes} min</span>
        </label>
        <input
          type="range"
          min={3}
          max={60}
          step={1}
          value={form.duration_minutes}
          onChange={e => setField('duration_minutes', parseInt(e.target.value))}
          className="w-full accent-blue-600"
        />
        <div className="flex justify-between text-xs text-slate-400 mt-1">
          <span>3 min</span>
          <span>60 min</span>
        </div>
      </div>

      {/* Equipment */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-2">
          Equipment <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <div className="space-y-2">
          {form.equipment.map((item, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                value={item}
                onChange={e => setListItem('equipment', i, e.target.value)}
                placeholder={`e.g. basketball`}
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() => removeListItem('equipment', i)}
                disabled={form.equipment.length === 1}
                className="text-slate-300 hover:text-red-400 disabled:opacity-30 text-xl leading-none flex-shrink-0"
              >×</button>
            </div>
          ))}
          <button
            onClick={() => addListItem('equipment')}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            + Add equipment
          </button>
        </div>
      </div>

      {/* Instructions */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-2">Steps</label>
        <div className="space-y-2">
          {form.instructions.map((step, i) => (
            <div key={i} className="flex gap-2 items-start">
              <div className="flex flex-col mt-2 mr-1">
                <button onClick={() => moveListItem('instructions', i, -1)} disabled={i === 0} className="text-slate-300 hover:text-slate-500 disabled:opacity-30 text-xs leading-tight">▲</button>
                <button onClick={() => moveListItem('instructions', i, 1)} disabled={i === form.instructions.length - 1} className="text-slate-300 hover:text-slate-500 disabled:opacity-30 text-xs leading-tight">▼</button>
              </div>
              <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-2">
                {i + 1}
              </div>
              <textarea
                value={step}
                onChange={e => setListItem('instructions', i, e.target.value)}
                placeholder={`Step ${i + 1}`}
                rows={2}
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <button
                onClick={() => removeListItem('instructions', i)}
                disabled={form.instructions.length === 1}
                className="text-slate-300 hover:text-red-400 disabled:opacity-30 text-xl leading-none flex-shrink-0 mt-2"
              >×</button>
            </div>
          ))}
          <button
            onClick={() => addListItem('instructions')}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            + Add step
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>
      )}

      <button
        onClick={handleSave}
        disabled={!form.title.trim() || !form.description.trim() || saving}
        className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl transition-colors"
      >
        {saving ? 'Saving...' : isEditing ? 'Save changes' : 'Create drill'}
      </button>

      {isEditing && (
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="w-full py-3 text-red-500 hover:text-red-700 text-sm font-medium transition-colors"
        >
          {deleting ? 'Deleting...' : 'Delete this drill'}
        </button>
      )}
    </div>
  )
}
