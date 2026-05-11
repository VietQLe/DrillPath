'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

const DAYS = [
  { jsDay: 1, label: 'Mon' },
  { jsDay: 2, label: 'Tue' },
  { jsDay: 3, label: 'Wed' },
  { jsDay: 4, label: 'Thu' },
  { jsDay: 5, label: 'Fri' },
  { jsDay: 6, label: 'Sat' },
  { jsDay: 0, label: 'Sun' },
]

const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function sameDayInSameWeek(originalDateStr: string, jsDay: number): string {
  const [y, m, d] = originalDateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const origDay = dt.getDay()
  const monday = new Date(dt)
  monday.setDate(dt.getDate() - (origDay === 0 ? 6 : origDay - 1))
  const offset = jsDay === 0 ? 6 : jsDay - 1
  const result = new Date(monday)
  result.setDate(monday.getDate() + offset)
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`
}

export default function RescheduleModal({
  planId,
  planName,
  currentDay,
  onClose,
  originalDate,
  kidId,
  planDrills,
}: {
  planId: string
  planName: string
  currentDay: number | null
  onClose: () => void
  originalDate?: string
  kidId?: string
  planDrills?: { drill_id: string; display_order: number }[]
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<number | null>(currentDay)
  const [scope, setScope] = useState<'all' | 'this'>('all')
  const [saving, setSaving] = useState(false)

  const canSave = selected !== null && !(scope === 'all' && selected === currentDay)

  async function handleSave() {
    if (!canSave) { onClose(); return }
    setSaving(true)
    const supabase = createClient()

    if (scope === 'all' || !originalDate) {
      await supabase.from('training_plans').update({ scheduled_day: selected }).eq('id', planId)
    } else {
      // This occurrence: add exception + one-time copy on new date
      const newDateStr = sameDayInSameWeek(originalDate, selected!)
      await supabase.from('plan_exceptions').insert({ plan_id: planId, exception_date: originalDate })
      const { data: newPlan } = await supabase.from('training_plans').insert({
        kid_id: kidId,
        name: planName,
        scheduled_day: selected,
        start_date: newDateStr,
        end_date: newDateStr,
      }).select('id').single()
      if (newPlan && planDrills?.length) {
        await supabase.from('plan_drills').insert(
          planDrills.map(pd => ({ plan_id: newPlan.id, drill_id: pd.drill_id, display_order: pd.display_order }))
        )
      }
    }

    router.refresh()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-white rounded-t-2xl p-5 pb-8 shadow-xl">
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />

        <h2 className="font-bold text-slate-900 text-base mb-0.5">Reschedule workout</h2>
        <p className="text-sm text-slate-500 mb-5 truncate">{planName}</p>

        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Move to day</p>
        <div className="grid grid-cols-7 gap-1.5 mb-4">
          {DAYS.map(({ jsDay, label }) => (
            <button
              key={jsDay}
              onClick={() => setSelected(jsDay)}
              className={cn(
                'py-2.5 rounded-xl text-xs font-semibold border-2 transition-colors',
                selected === jsDay
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 text-slate-600 hover:border-blue-300'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {originalDate && (
          <div className="mb-5">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Apply to</p>
            <div className="flex gap-2">
              <button
                onClick={() => setScope('this')}
                className={cn(
                  'flex-1 py-2.5 rounded-xl text-xs font-semibold border-2 transition-colors',
                  scope === 'this'
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-200 text-slate-600 hover:border-blue-300'
                )}
              >
                Just {new Date(originalDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </button>
              <button
                onClick={() => setScope('all')}
                className={cn(
                  'flex-1 py-2.5 rounded-xl text-xs font-semibold border-2 transition-colors',
                  scope === 'all'
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-200 text-slate-600 hover:border-blue-300'
                )}
              >
                {selected !== null ? `All ${DAYS_FULL[selected]}s` : 'All future'}
              </button>
            </div>
          </div>
        )}

        {!originalDate && (
          <p className="text-xs text-slate-400 mb-6">Affects all future occurrences of this workout.</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 border border-slate-300 text-slate-700 font-semibold rounded-xl text-sm hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !canSave}
            className="flex-[2] py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl text-sm transition-colors"
          >
            {saving ? 'Moving…' : 'Move workout'}
          </button>
        </div>
      </div>
    </div>
  )
}
