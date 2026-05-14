'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

export type CarouselItem = {
  id: string
  signedUrl?: string
  drillTitle: string
  videoUrl: string
}

export default function RecordingsCarousel({
  items,
  onDelete,
}: {
  items: CarouselItem[]
  onDelete?: (id: string, videoUrl: string) => void
}) {
  const [index, setIndex] = useState(0)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  if (items.length === 0) return null

  const clampedIndex = Math.min(index, items.length - 1)
  const current = items[clampedIndex]

  return (
    <div>
      <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
        {current.signedUrl ? (
          <video
            key={current.id}
            src={current.signedUrl}
            controls
            playsInline
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          </div>
        )}

        {/* Drill label + counter */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8 pointer-events-none">
          <p className="text-white text-xs font-semibold truncate">{current.drillTitle}</p>
          {items.length > 1 && (
            <p className="text-white/60 text-[10px]">{clampedIndex + 1} / {items.length}</p>
          )}
        </div>

        {/* Prev / Next */}
        {items.length > 1 && (
          <>
            <button
              onClick={() => setIndex(i => Math.max(0, i - 1))}
              disabled={clampedIndex === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors disabled:opacity-20"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={() => setIndex(i => Math.min(items.length - 1, i + 1))}
              disabled={clampedIndex === items.length - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors disabled:opacity-20"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}

        {/* Delete button */}
        {onDelete && pendingDeleteId !== current.id && (
          <button
            onClick={() => setPendingDeleteId(current.id)}
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
            aria-label="Delete recording"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}

        {/* Delete confirmation overlay */}
        {pendingDeleteId === current.id && (
          <div className="absolute inset-0 bg-black/75 flex flex-col items-center justify-center gap-3">
            <p className="text-white text-sm font-semibold">Delete this recording?</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPendingDeleteId(null)}
                className="px-4 py-2 rounded-lg bg-white/20 hover:bg-white/30 text-white text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { onDelete?.(current.id, current.videoUrl); setPendingDeleteId(null) }}
                className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Dot indicators */}
      {items.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-3">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              className={cn(
                'w-2 h-2 rounded-full transition-colors',
                i === clampedIndex ? 'bg-slate-700' : 'bg-slate-300 hover:bg-slate-400'
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}
