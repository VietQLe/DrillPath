'use client'

const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function DragScopeModal({
  workoutName,
  fromDateStr,
  toDateStr,
  onConfirm,
  onCancel,
}: {
  workoutName: string
  fromDateStr: string
  toDateStr: string
  onConfirm: (scope: 'this' | 'all') => void
  onCancel: () => void
}) {
  const fromLabel = new Date(fromDateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const toDayLabel = DAYS_FULL[new Date(toDateStr + 'T12:00:00').getDay()]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative w-full max-w-lg bg-white rounded-t-2xl p-5 pb-8 shadow-xl">
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />
        <h2 className="font-bold text-slate-900 text-base mb-0.5">Move workout</h2>
        <p className="text-sm text-slate-500 mb-5 truncate">{workoutName}</p>

        <div className="space-y-2 mb-6">
          <button
            onClick={() => onConfirm('this')}
            className="w-full text-left px-4 py-3.5 rounded-xl border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-colors"
          >
            <div className="font-semibold text-slate-900 text-sm">Just {fromLabel}</div>
            <div className="text-xs text-slate-500 mt-0.5">Only move this occurrence</div>
          </button>
          <button
            onClick={() => onConfirm('all')}
            className="w-full text-left px-4 py-3.5 rounded-xl border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-colors"
          >
            <div className="font-semibold text-slate-900 text-sm">Every {toDayLabel}</div>
            <div className="text-xs text-slate-500 mt-0.5">Change the recurring schedule</div>
          </button>
        </div>

        <button
          onClick={onCancel}
          className="w-full py-3 border border-slate-300 text-slate-700 font-semibold rounded-xl text-sm hover:bg-slate-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
