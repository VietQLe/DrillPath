'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

function dayBefore(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() - 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function isBeforeToday(dateStr: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d) < today
}

export default function DeleteWorkoutButton({
  planId,
  date,
  kidId,
  isCompleted,
}: {
  planId: string
  date?: string   // YYYY-MM-DD — the specific calendar date the user came from
  kidId: string
  isCompleted?: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Always return to week view — week view is the primary entry point and avoids
  // the Router Cache serving a stale workouts list after deletion.
  const returnUrl = `/workouts?view=week&kid=${kidId}`

  function navigateBack() {
    // Hard navigation bypasses Next.js Router Cache so the workouts page always
    // re-fetches its server data after a mutation.
    window.location.href = returnUrl
  }

  if (date && isBeforeToday(date)) {
    return (
      <p className="text-center text-sm text-slate-400 py-3">
        Past sessions cannot be removed
      </p>
    )
  }

  if (isCompleted) {
    return (
      <p className="text-center text-sm text-slate-400 py-3">
        Completed sessions cannot be removed
      </p>
    )
  }

  async function handleSkipDate() {
    if (!date) return
    setDeleting(true)
    const supabase = createClient()
    await supabase.from('plan_exceptions').insert({ plan_id: planId, exception_date: date })
    navigateBack()
  }

  async function handleEndSeries() {
    setDeleting(true)
    const supabase = createClient()
    if (date) {
      await supabase
        .from('training_plans')
        .update({ end_date: dayBefore(date) })
        .eq('id', planId)
    } else {
      await supabase.from('plan_drills').delete().eq('plan_id', planId)
      await supabase.from('training_plans').delete().eq('id', planId)
    }
    navigateBack()
  }

  async function handleDeleteAll() {
    setDeleting(true)
    const supabase = createClient()
    await supabase.from('plan_drills').delete().eq('plan_id', planId)
    await supabase.from('training_plans').delete().eq('id', planId)
    navigateBack()
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="w-full py-3 text-red-500 hover:text-red-700 text-sm font-medium transition-colors"
      >
        Delete workout
      </button>
    )
  }

  if (date) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-slate-500 text-center font-medium uppercase tracking-wide mb-3">
          What would you like to remove?
        </p>

        <button
          onClick={handleSkipDate}
          disabled={deleting}
          className="w-full text-left px-4 py-3.5 rounded-xl border-2 border-slate-200 hover:border-amber-400 hover:bg-amber-50 transition-colors disabled:opacity-50"
        >
          <div className="font-semibold text-slate-900 text-sm">
            Skip {formatDate(date)} only
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            This one date is skipped — all other sessions stay
          </div>
        </button>

        <button
          onClick={handleEndSeries}
          disabled={deleting}
          className="w-full text-left px-4 py-3.5 rounded-xl border-2 border-slate-200 hover:border-orange-400 hover:bg-orange-50 transition-colors disabled:opacity-50"
        >
          <div className="font-semibold text-slate-900 text-sm">
            End series from {formatDate(date)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            This and all future occurrences are removed
          </div>
        </button>

        <button
          onClick={handleDeleteAll}
          disabled={deleting}
          className="w-full text-left px-4 py-3.5 rounded-xl border-2 border-slate-200 hover:border-red-400 hover:bg-red-50 transition-colors disabled:opacity-50"
        >
          <div className="font-semibold text-slate-900 text-sm">Delete entire workout</div>
          <div className="text-xs text-slate-500 mt-0.5">
            Removes all past and future occurrences
          </div>
        </button>

        <button
          onClick={() => setConfirming(false)}
          disabled={deleting}
          className="w-full py-3 text-slate-500 hover:text-slate-700 text-sm font-medium transition-colors"
        >
          {deleting ? 'Working...' : 'Cancel'}
        </button>
      </div>
    )
  }

  // No date — simple confirm
  return (
    <div className="flex gap-3">
      <button
        onClick={() => setConfirming(false)}
        className="flex-1 py-3 border border-slate-300 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors text-sm"
      >
        Cancel
      </button>
      <button
        onClick={handleDeleteAll}
        disabled={deleting}
        className="flex-1 py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white font-semibold rounded-xl transition-colors text-sm"
      >
        {deleting ? 'Deleting...' : 'Yes, delete'}
      </button>
    </div>
  )
}
