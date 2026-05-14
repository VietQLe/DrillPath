import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { SPORT_EMOJI, SPORT_LABELS, LEVEL_COLORS, LEVEL_LABELS, AGE_RANGE_LABELS, formatDuration, cn } from '@/lib/utils'
import type { Drill, DrillRecording } from '@/types'
import DrillRecorder from '@/components/drills/DrillRecorder'

const SKILL_FOCUS_EMOJI: Record<string, string> = {
  speed: '⚡', agility: '🔄', strength: '💪', technique: '🎯', endurance: '🏃', flexibility: '🤸'
}

export default async function DrillDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const { id } = await params
  const { from } = await searchParams
  const backUrl = from && decodeURIComponent(from).startsWith('/workouts/') ? decodeURIComponent(from) : null
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: drill } = await supabase.from('drills').select('*').eq('id', id).single()

  if (!drill) notFound()

  const d = drill as Drill
  const isOwned = d.created_by === user.id

  // Extract workout context from backUrl (/workouts/{planId}?kid={kidId})
  let planId: string | null = null
  let kidId: string | null = null
  if (backUrl) {
    const match = backUrl.match(/\/workouts\/([a-f0-9-]+)/i)
    if (match) planId = match[1]
    try {
      kidId = new URL(backUrl, 'http://x').searchParams.get('kid')
    } catch { /* ignore */ }
  }

  // Fetch all recordings for this drill visible to the current user (RLS scopes to their kids)
  const { data: recordingData } = await supabase
    .from('drill_recordings')
    .select('*')
    .eq('drill_id', id)
    .order('recorded_at', { ascending: false })
  const recordings = (recordingData ?? []) as DrillRecording[]

  return (
    <div className={`max-w-2xl mx-auto p-4 ${backUrl ? 'pb-24' : 'pb-8'}`}>
      {backUrl && (
        <Link
          href={backUrl}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"
        >
          ← Back to workout
        </Link>
      )}

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">{SPORT_LABELS[d.sport]}</span>
            {isOwned && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">Custom</span>
            )}
          </div>
          {isOwned && (
            <Link
              href={`/drills/${d.id}/edit`}
              className="text-sm text-blue-600 font-medium hover:underline"
            >
              Edit
            </Link>
          )}
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-3 flex items-center gap-2">
          <span>{SPORT_EMOJI[d.sport]}</span>
          {d.title}
        </h1>
        <p className="text-slate-600 leading-relaxed">{d.description}</p>

        <div className="flex flex-wrap gap-2 mt-4">
          <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium', LEVEL_COLORS[d.difficulty])}>
            {LEVEL_LABELS[d.difficulty]}
          </span>
          <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
            {AGE_RANGE_LABELS[d.age_range]}
          </span>
          <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
            {SKILL_FOCUS_EMOJI[d.skill_focus]} {d.skill_focus}
          </span>
          <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
            ⏱ {formatDuration(d.duration_minutes)}
          </span>
        </div>
      </div>

      {/* Equipment */}
      {d.equipment && d.equipment.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
          <h2 className="font-semibold text-slate-900 mb-3">Equipment needed</h2>
          <ul className="space-y-1.5">
            {d.equipment.map((item, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-slate-700">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold flex-shrink-0">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Instructions */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
        <h2 className="font-semibold text-slate-900 mb-4">How to do it</h2>
        <ol className="space-y-4">
          {d.instructions.map((step, i) => (
            <li key={i} className="flex gap-4">
              <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">
                {i + 1}
              </div>
              <p className="text-slate-700 leading-relaxed text-sm">{step}</p>
            </li>
          ))}
        </ol>
      </div>

      {/* Tutorial video link */}
      {d.video_url && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
          <h2 className="font-semibold text-slate-900 mb-3">Tutorial video</h2>
          <a
            href={d.video_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3 rounded-xl bg-red-50 border border-red-200 hover:bg-red-100 transition-colors group"
          >
            <div className="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-700">Watch on YouTube</p>
              <p className="text-xs text-red-500 mt-0.5">Search results for this drill</p>
            </div>
            <svg className="w-4 h-4 text-red-400 group-hover:translate-x-0.5 transition-transform flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>
      )}

      {(recordings.length > 0 || (planId && kidId)) && (
        <DrillRecorder
          drillId={d.id}
          planId={planId}
          kidId={kidId}
          initialRecordings={recordings}
        />
      )}

      {backUrl && (
        <Link
          href={backUrl}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-full shadow-lg transition-colors"
        >
          ← Back to workout
        </Link>
      )}
    </div>
  )
}
