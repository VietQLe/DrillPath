'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

export type CarouselItem = {
  id: string
  signedUrl?: string
  drillTitle: string
  videoUrl: string
  drillDescription?: string
  drillInstructions?: string[]
  sport?: string
  skillLevel?: string
}

async function extractFrames(videoSrc: string): Promise<string[]> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'auto'

    let settled = false
    const done = (frames: string[]) => { if (!settled) { settled = true; resolve(frames) } }
    const timeout = setTimeout(() => done([]), 15000)

    video.addEventListener('error', () => { clearTimeout(timeout); done([]) })

    video.addEventListener('loadedmetadata', () => {
      const duration = video.duration
      if (!isFinite(duration) || duration <= 0) { clearTimeout(timeout); done([]); return }

      // Preserve aspect ratio, cap the longer side at 480px
      const MAX = 480
      const vw = video.videoWidth || 640
      const vh = video.videoHeight || 360
      const scale = Math.min(MAX / vw, MAX / vh, 1)
      const cw = Math.round(vw * scale)
      const ch = Math.round(vh * scale)

      const canvas = document.createElement('canvas')
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext('2d')
      if (!ctx) { clearTimeout(timeout); done([]); return }

      // Scale frame count with duration: ~1 frame per 5s, min 2, max 6
      const count = Math.min(6, Math.max(2, Math.round(duration / 5)))
      const timestamps = Array.from({ length: count }, (_, i) =>
        (duration * (i + 1)) / (count + 1)
      )
      const frames: string[] = []
      let idx = 0

      video.addEventListener('seeked', function onSeeked() {
        try {
          ctx.fillStyle = '#000'
          ctx.fillRect(0, 0, cw, ch)
          ctx.drawImage(video, 0, 0, cw, ch)
          frames.push(canvas.toDataURL('image/jpeg', 0.65).split(',')[1])
        } catch {
          // Canvas tainted — skip this frame
        }
        idx++
        if (idx < timestamps.length) {
          video.currentTime = timestamps[idx]
        } else {
          video.removeEventListener('seeked', onSeeked)
          clearTimeout(timeout)
          done(frames)
        }
      })

      video.currentTime = timestamps[0]
    })

    video.src = videoSrc
    video.load()
  })
}

type CoachInsights = {
  overall: string
  strengths: string[]
  improvements: string[]
  keyFocus: string
}

function InsightsPanel({ insights, onDismiss }: { insights: CoachInsights; onDismiss: () => void }) {
  return (
    <div className="mt-3 rounded-xl bg-violet-50 border border-violet-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🧠</span>
          <span className="font-semibold text-violet-800 text-sm">Coach Insights</span>
        </div>
        <button
          onClick={onDismiss}
          className="text-violet-400 hover:text-violet-600 text-lg leading-none transition-colors"
          aria-label="Dismiss insights"
        >
          ×
        </button>
      </div>

      <p className="text-sm text-violet-800 leading-relaxed">{insights.overall}</p>

      {insights.strengths.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide mb-1">Doing well</p>
          <ul className="space-y-1">
            {insights.strengths.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-violet-700">
                <span className="text-green-500 flex-shrink-0">✓</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {insights.improvements.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide mb-1">Work on</p>
          <ul className="space-y-1">
            {insights.improvements.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-violet-700">
                <span className="text-amber-500 flex-shrink-0">→</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg bg-violet-100 border border-violet-200 px-3 py-2">
        <p className="text-xs font-semibold text-violet-600 mb-0.5">Focus next time</p>
        <p className="text-sm text-violet-800">{insights.keyFocus}</p>
      </div>
    </div>
  )
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
  const [insights, setInsights] = useState<Record<string, CoachInsights>>({})
  const [insightsLoading, setInsightsLoading] = useState<Record<string, boolean>>({})
  const [insightsError, setInsightsError] = useState<Record<string, string>>({})

  if (items.length === 0) return null

  const clampedIndex = Math.min(index, items.length - 1)
  const current = items[clampedIndex]
  const hasInsights = !!insights[current.id]
  const isLoadingInsights = !!insightsLoading[current.id]

  async function getInsights() {
    if (!current.signedUrl || isLoadingInsights || hasInsights) return
    setInsightsLoading(prev => ({ ...prev, [current.id]: true }))
    setInsightsError(prev => { const n = { ...prev }; delete n[current.id]; return n })

    try {
      const frames = await extractFrames(current.signedUrl)
      const res = await fetch('/api/coach-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames,
          drillTitle: current.drillTitle,
          drillDescription: current.drillDescription,
          drillInstructions: current.drillInstructions,
          sport: current.sport,
          level: current.skillLevel,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as CoachInsights
      setInsights(prev => ({ ...prev, [current.id]: data }))
    } catch {
      setInsightsError(prev => ({ ...prev, [current.id]: 'Could not generate insights. Please try again.' }))
    } finally {
      setInsightsLoading(prev => { const n = { ...prev }; delete n[current.id]; return n })
    }
  }

  function dismissInsights() {
    setInsights(prev => { const n = { ...prev }; delete n[current.id]; return n })
  }

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

      {/* Coach Insights button */}
      {!hasInsights && (
        <button
          onClick={getInsights}
          disabled={isLoadingInsights || !current.signedUrl}
          className={cn(
            'mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 text-sm font-semibold transition-colors',
            isLoadingInsights
              ? 'border-violet-200 bg-violet-50 text-violet-400 cursor-wait'
              : 'border-violet-300 text-violet-700 hover:bg-violet-50 disabled:border-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed'
          )}
        >
          {isLoadingInsights ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-violet-300 border-t-violet-600 animate-spin" />
              Analyzing performance…
            </>
          ) : (
            <>
              <span>🧠</span>
              Get Coach Insights
            </>
          )}
        </button>
      )}

      {insightsError[current.id] && (
        <p className="mt-2 text-xs text-red-500 text-center">{insightsError[current.id]}</p>
      )}

      {hasInsights && <InsightsPanel insights={insights[current.id]} onDismiss={dismissInsights} />}
    </div>
  )
}
