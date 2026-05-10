import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import FavoriteButton from '@/components/workouts/FavoriteButton'
import { SPORT_EMOJI, SPORT_LABELS, LEVEL_COLORS, LEVEL_LABELS, formatDuration, cn } from '@/lib/utils'
import type { Kid, WorkoutTemplate, TemplateDrill, Drill, Sport } from '@/types'

const SPORTS: Sport[] = ['basketball', 'baseball', 'gymnastics', 'volleyball', 'jiujitsu']

const SKILL_FOCUS_EMOJI: Record<string, string> = {
  speed: '⚡', agility: '🔄', strength: '💪', technique: '🎯', endurance: '🏃', flexibility: '🤸',
}

type TemplateWithDrills = WorkoutTemplate & {
  template_drills: (TemplateDrill & { drill: Drill })[]
}

export default async function WorkoutLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ kid?: string; sport?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const [{ data: kids }, { data: rawTemplates }, { data: favs }] = await Promise.all([
    supabase.from('kids').select('*').eq('parent_id', user.id).order('created_at'),
    supabase
      .from('workout_templates')
      .select('*, template_drills(*, drill:drills(*))')
      .order('created_by', { nullsFirst: true })
      .order('sport')
      .order('difficulty')
      .order('name'),
    supabase.from('workout_favorites').select('template_id').eq('user_id', user.id),
  ])

  if (!kids || kids.length === 0) redirect('/onboarding')

  const kidList = kids as Kid[]
  const selectedKid = kidList.find(k => k.id === params.kid) ?? kidList[0]
  const favoriteIds = new Set((favs ?? []).map(f => f.template_id))

  let templates = (rawTemplates ?? []) as TemplateWithDrills[]
  if (params.sport && SPORTS.includes(params.sport as Sport)) {
    templates = templates.filter(t => t.sport === params.sport)
  }

  const favorites = templates.filter(t => favoriteIds.has(t.id))
  const rest = templates.filter(t => !favoriteIds.has(t.id))
  const kidParam = `kid=${selectedKid.id}`

  return (
    <div className="max-w-2xl mx-auto p-4 pb-8">
      {/* Header */}
      <div className="pt-2 mb-5">
        <div className="flex items-center gap-3 mb-1">
          <Link href={`/workouts?${kidParam}`} className="text-slate-400 hover:text-slate-600 text-xl leading-none">←</Link>
          <h1 className="text-2xl font-bold text-slate-900">Workout Library</h1>
        </div>
        <p className="text-slate-500 text-sm ml-8">Pre-built workouts ready to use</p>
      </div>

      {/* Kid selector */}
      {kidList.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
          {kidList.map(kid => (
            <Link
              key={kid.id}
              href={`/workouts/library?kid=${kid.id}${params.sport ? `&sport=${params.sport}` : ''}`}
              className={cn(
                'flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors border',
                selectedKid.id === kid.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              )}
            >
              <span>{SPORT_EMOJI[kid.sport]}</span>
              {kid.name}
            </Link>
          ))}
        </div>
      )}

      {/* Sport filter */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-6">
        <Link
          href={`/workouts/library?${kidParam}`}
          className={cn(
            'flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors',
            !params.sport ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          )}
        >
          All Sports
        </Link>
        {SPORTS.map(s => (
          <Link
            key={s}
            href={`/workouts/library?${kidParam}&sport=${s}`}
            className={cn(
              'flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors',
              params.sport === s ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            )}
          >
            {SPORT_EMOJI[s]} {SPORT_LABELS[s]}
          </Link>
        ))}
      </div>

      {/* Favorites */}
      {favorites.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
            ❤️ Favorites
          </h2>
          <div className="space-y-3">
            {favorites.map(t => (
              <TemplateCard
                key={t.id}
                template={t}
                isFavorited
                kidId={selectedKid.id}
                userId={user.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* All templates */}
      {rest.length > 0 && (
        <div>
          {favorites.length > 0 && (
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
              All Workouts
            </h2>
          )}
          <div className="space-y-3">
            {rest.map(t => (
              <TemplateCard
                key={t.id}
                template={t}
                isFavorited={false}
                kidId={selectedKid.id}
                userId={user.id}
              />
            ))}
          </div>
        </div>
      )}

      {templates.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📚</div>
          <p className="text-slate-500">No workouts found for this filter.</p>
          <Link href={`/workouts/library?${kidParam}`} className="text-sm text-blue-600 mt-2 hover:underline inline-block">
            Clear filter
          </Link>
        </div>
      )}
    </div>
  )
}

function TemplateCard({
  template,
  isFavorited,
  kidId,
  userId,
}: {
  template: TemplateWithDrills
  isFavorited: boolean
  kidId: string
  userId: string
}) {
  const drills = [...(template.template_drills ?? [])]
    .sort((a, b) => a.display_order - b.display_order)
    .map(td => td.drill)
    .filter(Boolean) as Drill[]

  const totalDuration = drills.reduce((s, d) => s + d.duration_minutes, 0)
  const isOwned = template.created_by === userId

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-base">{SPORT_EMOJI[template.sport]}</span>
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', LEVEL_COLORS[template.difficulty])}>
              {LEVEL_LABELS[template.difficulty]}
            </span>
            {isOwned && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">
                Custom
              </span>
            )}
          </div>
          <h3 className="font-bold text-slate-900 text-base">{template.name}</h3>
          {template.focus && (
            <p className="text-sm text-slate-500 mt-0.5 leading-relaxed">{template.focus}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
            <span>{drills.length} drill{drills.length !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>~{formatDuration(totalDuration)}</span>
          </div>
        </div>
        <FavoriteButton templateId={template.id} initialFavorited={isFavorited} />
      </div>

      {/* Drill list */}
      {drills.length > 0 && (
        <div className="space-y-1.5 mb-4">
          {drills.map((drill, i) => (
            <div key={drill.id} className="flex items-center gap-2 text-sm text-slate-600">
              <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold flex-shrink-0">
                {i + 1}
              </span>
              <span className="flex-1 truncate">{drill.title}</span>
              <span className="text-xs text-slate-400 flex-shrink-0">
                {drill.skill_focus in { speed: 1, agility: 1, strength: 1, technique: 1, endurance: 1, flexibility: 1 }
                  ? `${({ speed: '⚡', agility: '🔄', strength: '💪', technique: '🎯', endurance: '🏃', flexibility: '🤸' } as Record<string, string>)[drill.skill_focus]} `
                  : ''}
                {formatDuration(drill.duration_minutes)}
              </span>
            </div>
          ))}
        </div>
      )}

      <Link
        href={`/workouts/new?template=${template.id}&kid=${kidId}`}
        className="block w-full text-center py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
      >
        Use this workout →
      </Link>
    </div>
  )
}
