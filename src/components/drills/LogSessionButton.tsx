'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { Kid } from '@/types'

export default function LogSessionButton({
  drillId,
  kids,
}: {
  drillId: string
  kids: Kid[]
}) {
  const router = useRouter()
  const [selectedKid, setSelectedKid] = useState(kids[0]?.id ?? '')
  const [rating, setRating] = useState<1 | 2 | 3>(2)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleLog() {
    setLoading(true)
    const supabase = createClient()

    const { error } = await supabase.from('session_logs').insert({
      kid_id: selectedKid,
      drill_id: drillId,
      rating,
      notes: notes || null,
    })

    setLoading(false)
    if (!error) {
      setSuccess(true)
      setTimeout(() => {
        router.push('/dashboard')
        router.refresh()
      }, 1200)
    }
  }

  if (success) {
    return (
      <div className="text-center py-4">
        <div className="text-3xl mb-2">🎉</div>
        <p className="font-semibold text-slate-900">Session logged!</p>
        <p className="text-sm text-slate-500">Heading back to dashboard...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {kids.length > 1 && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Which athlete?</label>
          <div className="flex gap-2 flex-wrap">
            {kids.map(kid => (
              <button
                key={kid.id}
                onClick={() => setSelectedKid(kid.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors',
                  selectedKid === kid.id
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                )}
              >
                {kid.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">How did it go?</label>
        <div className="flex gap-3">
          {([1, 2, 3] as const).map(r => (
            <button
              key={r}
              onClick={() => setRating(r)}
              className={cn(
                'flex-1 py-2 rounded-lg border-2 text-lg transition-all',
                rating === r ? 'border-yellow-400 bg-yellow-50' : 'border-slate-200 hover:border-slate-300'
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
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. struggled with left hand, but improved by the end"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      <button
        onClick={handleLog}
        disabled={loading || !selectedKid}
        className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-semibold rounded-xl transition-colors"
      >
        {loading ? 'Logging...' : 'Mark Complete'}
      </button>
    </div>
  )
}
