import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { SPORT_EMOJI, SPORT_LABELS, LEVEL_COLORS, LEVEL_LABELS, AGE_RANGE_LABELS, formatDuration, cn } from '@/lib/utils'
import type { Drill, Sport, SkillLevel, AgeRange } from '@/types'

const SPORTS = ['basketball', 'baseball', 'gymnastics'] as const
const LEVELS = ['beginner', 'intermediate', 'advanced'] as const
const SKILL_FOCUS_EMOJI: Record<string, string> = {
  speed: '⚡', agility: '🔄', strength: '💪', technique: '🎯', endurance: '🏃', flexibility: '🤸',
}

export default async function DrillsPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string; level?: string; age?: string; focus?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  let query = supabase.from('drills').select('*').order('created_by', { nullsFirst: true }).order('difficulty').order('title')

  if (params.sport && SPORTS.includes(params.sport as Sport)) {
    query = query.eq('sport', params.sport)
  }
  if (params.level && LEVELS.includes(params.level as SkillLevel)) {
    query = query.eq('difficulty', params.level)
  }
  if (params.age) {
    query = query.eq('age_range', params.age)
  }
  if (params.focus) {
    query = query.eq('skill_focus', params.focus)
  }

  const { data: drills } = await query

  const activeSport = params.sport || null
  const activeLevel = params.level || null

  function buildUrl(newParams: Record<string, string | null>) {
    const merged = { ...params, ...newParams }
    const q = Object.entries(merged)
      .filter(([, v]) => v !== null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join('&')
    return `/drills${q ? '?' + q : ''}`
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="pt-2 mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Drill Library</h1>
          <p className="text-slate-500 text-sm">{drills?.length ?? 0} drills found</p>
        </div>
        <Link
          href="/drills/new"
          className="flex-shrink-0 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
        >
          + Create
        </Link>
      </div>

      {/* Sport filter */}
      <div className="mb-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <Link
            href={buildUrl({ sport: null })}
            className={cn('flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors',
              !activeSport ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            )}
          >
            All Sports
          </Link>
          {SPORTS.map(s => (
            <Link
              key={s}
              href={buildUrl({ sport: s })}
              className={cn('flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5',
                activeSport === s ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
            >
              {SPORT_EMOJI[s]} {SPORT_LABELS[s]}
            </Link>
          ))}
        </div>
      </div>

      {/* Level filter */}
      <div className="mb-6">
        <div className="flex gap-2">
          <Link
            href={buildUrl({ level: null })}
            className={cn('flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              !activeLevel ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            )}
          >
            All Levels
          </Link>
          {LEVELS.map(l => (
            <Link
              key={l}
              href={buildUrl({ level: l })}
              className={cn('flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                activeLevel === l ? 'bg-slate-700 text-white' : LEVEL_COLORS[l]
              )}
            >
              {LEVEL_LABELS[l]}
            </Link>
          ))}
        </div>
      </div>

      {/* Drill cards */}
      <div className="space-y-3">
        {drills && drills.length > 0 ? (
          (drills as Drill[]).map(drill => {
            const isOwned = drill.created_by === user.id
            return (
              <div key={drill.id} className="relative">
                <Link
                  href={`/drills/${drill.id}`}
                  className="block bg-white rounded-xl border border-slate-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-base">{SPORT_EMOJI[drill.sport]}</span>
                        <h3 className="font-semibold text-slate-900 truncate">{drill.title}</h3>
                        {isOwned && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium flex-shrink-0">
                            Custom
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500 line-clamp-2">{drill.description}</p>

                      <div className="flex flex-wrap gap-2 mt-3">
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', LEVEL_COLORS[drill.difficulty])}>
                          {LEVEL_LABELS[drill.difficulty]}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          {AGE_RANGE_LABELS[drill.age_range]}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          {SKILL_FOCUS_EMOJI[drill.skill_focus]} {drill.skill_focus}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          {formatDuration(drill.duration_minutes)}
                        </span>
                      </div>
                    </div>
                    <span className="text-slate-300 text-xl flex-shrink-0">→</span>
                  </div>
                </Link>
                {isOwned && (
                  <Link
                    href={`/drills/${drill.id}/edit`}
                    className="absolute top-3.5 right-9 text-xs text-slate-400 hover:text-blue-600 font-medium px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors z-10"
                  >
                    Edit
                  </Link>
                )}
              </div>
            )
          })
        ) : (
          <div className="text-center py-12 text-slate-400">
            <div className="text-4xl mb-3">🔍</div>
            <p className="font-medium">No drills match these filters</p>
            <Link href="/drills" className="text-blue-600 text-sm mt-1 hover:underline">Clear filters</Link>
          </div>
        )}
      </div>
    </div>
  )
}
