import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const client = new Anthropic()

const DRILL_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string' },
    description: { type: 'string', description: '1-2 sentences describing the drill' },
    skill_focus: {
      type: 'string',
      enum: ['speed', 'agility', 'strength', 'technique', 'endurance', 'flexibility'],
    },
    difficulty: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
    duration_minutes: { type: 'number', minimum: 3, maximum: 60 },
    equipment: { type: 'array', items: { type: 'string' } },
    instructions: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      maxItems: 4,
    },
    youtube_search_query: { type: 'string' },
  },
  required: ['title', 'description', 'skill_focus', 'difficulty', 'duration_minutes', 'equipment', 'instructions', 'youtube_search_query'],
  additionalProperties: false,
}

const WORKOUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    name: { type: 'string' },
    focus: { type: 'string', description: 'One sentence describing what this workout targets' },
    progression_note: {
      type: 'string',
      description: 'One sentence explaining how this advances from last week',
    },
    drills: { type: 'array', items: DRILL_SCHEMA, minItems: 3, maxItems: 4 },
  },
  required: ['name', 'focus', 'progression_note', 'drills'],
  additionalProperties: false,
}

const NEXT_WEEK_SCHEMA = {
  type: 'object' as const,
  properties: {
    days: {
      type: 'array',
      description: 'One entry per training day, each with a DIFFERENT focus',
      items: {
        type: 'object' as const,
        properties: {
          day_of_week: { type: 'number', description: '0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday' },
          day_label: { type: 'string', description: 'e.g. "Monday"' },
          skill_workout: WORKOUT_SCHEMA,
          strength_workout: WORKOUT_SCHEMA,
        },
        required: ['day_of_week', 'day_label', 'skill_workout', 'strength_workout'],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 5,
    },
  },
  required: ['days'],
  additionalProperties: false,
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { kidId, sport, level, ageRange, kidName, selectedDays } = body

  if (!kidId || !sport || !level || !ageRange) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const trainingDays: number[] = Array.isArray(selectedDays) && selectedDays.length > 0
    ? selectedDays
    : [1, 3, 5]

  const now = new Date()
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(now.getDate() - 7)
  sevenDaysAgo.setHours(0, 0, 0, 0)

  const [{ data: plans }, { data: logs }] = await Promise.all([
    supabase
      .from('training_plans')
      .select('id, name, focus, scheduled_day, start_date, end_date, plan_drills(display_order, drill:drills(title, skill_focus, difficulty, duration_minutes))')
      .eq('kid_id', kidId)
      .lte('start_date', toDateStr(now))
      .or(`end_date.is.null,end_date.gte.${toDateStr(sevenDaysAgo)}`),
    supabase
      .from('session_logs')
      .select('plan_id, drill_id, completed_at, rating, shot_attempts, shot_makes')
      .eq('kid_id', kidId)
      .gte('completed_at', sevenDaysAgo.toISOString())
      .lte('completed_at', now.toISOString()),
  ])

  type LogRow = { plan_id: string | null; drill_id: string; completed_at: string; rating: number | null; shot_attempts: number | null; shot_makes: number | null }
  const logRows = (logs ?? []) as LogRow[]

  // Build per-date-plan completion + shot maps
  const completedByDatePlan = new Map<string, Set<string>>()
  const ratingByDatePlan = new Map<string, number>()
  // drillKey → { attempts, makes } — use the most recent entry if multiple
  const shotsByDrill = new Map<string, { attempts: number; makes: number }>()

  for (const log of logRows) {
    if (!log.plan_id) continue
    const dateKey = log.completed_at.slice(0, 10)
    const planKey = `${dateKey}:${log.plan_id}`
    if (!completedByDatePlan.has(planKey)) completedByDatePlan.set(planKey, new Set())
    completedByDatePlan.get(planKey)!.add(log.drill_id)
    if (log.rating != null) ratingByDatePlan.set(planKey, log.rating)
    if (log.shot_attempts != null && log.shot_makes != null) {
      shotsByDrill.set(log.drill_id, { attempts: log.shot_attempts, makes: log.shot_makes })
    }
  }

  type PlanRow = {
    id: string; name: string; focus: string | null; scheduled_day: number | null
    start_date: string; end_date: string | null
    plan_drills: { display_order: number; drill: { title: string; skill_focus: string; difficulty: string; duration_minutes: number } | null }[]
  }

  const contextLines: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    d.setHours(0, 0, 0, 0)
    const dateStr = toDateStr(d)
    const dayName = DAY_NAMES[d.getDay()]

    const dayPlans = ((plans ?? []) as unknown as PlanRow[]).filter(p => {
      if (p.scheduled_day !== d.getDay()) return false
      if (p.start_date > dateStr) return false
      if (p.end_date && p.end_date < dateStr) return false
      return true
    })

    if (dayPlans.length === 0) {
      contextLines.push(`${dayName} ${dateStr}: No workout scheduled`)
      continue
    }

    for (const plan of dayPlans) {
      const planKey = `${dateStr}:${plan.id}`
      const completedDrillIds = completedByDatePlan.get(planKey) ?? new Set()
      const rating = ratingByDatePlan.get(planKey)
      const drills = [...(plan.plan_drills ?? [])].sort((a, b) => a.display_order - b.display_order)
      const doneDrills = drills.filter(pd => pd.drill && completedDrillIds.has(pd.drill.title)).length

      contextLines.push(
        `${dayName} ${dateStr}: "${plan.name}"${plan.focus ? ` (${plan.focus})` : ''} — ${doneDrills}/${drills.length} drills completed${rating != null ? `, rated ${rating}/3` : ''}`
      )
      for (const pd of drills) {
        if (!pd.drill) continue
        const completed = completedDrillIds.size > 0
        const status = completed ? '✓' : '✗'
        const shots = shotsByDrill.get(pd.drill.title)
        const shotStr = shots
          ? ` — ${shots.makes}/${shots.attempts} shots (${Math.round((shots.makes / shots.attempts) * 100)}%)`
          : ''
        contextLines.push(`  ${status} ${pd.drill.title} (${pd.drill.skill_focus}, ${pd.drill.duration_minutes}min, ${pd.drill.difficulty})${shotStr}`)
      }
    }
  }

  const lastWeekSummary = contextLines.join('\n')
  const trainingDayNames = trainingDays.map(d => DAY_NAMES[d]).join(', ')

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 10000,
    system: [
      {
        type: 'text',
        text: `You are an expert youth sports coach specializing in ${sport}.

The athlete is ${kidName ?? 'a young athlete'}, skill level: ${level}, age group: ${ageRange}.

Here is their training activity over the past 7 days:

${lastWeekSummary}

Generate workouts for next week's training days: ${trainingDayNames}

CRITICAL: Each training day must have a DIFFERENT workout focus. Spread skill development across the week so no two days target the same thing. For example in basketball:
- Day 1 might focus on ball handling & dribbling
- Day 2 might focus on shooting & finishing
- Day 3 might focus on footwork & defense

Apply the same variety principle to the sport you are coaching.

For each day generate:
1. **skill_workout** — sport-specific to THAT DAY's unique focus
2. **strength_workout** — physical conditioning that complements that day's skill theme

Progression principles:
- Low completion last week → reduce complexity, rebuild confidence
- Rated 3/3 → increase challenge significantly
- Missed entirely → reintroduce same skill level
- Never repeat exact drill titles from last week
- For basketball shooting drills: if shot percentage data is shown (e.g. "23/30 shots (77%)"), note whether to maintain, push harder, or simplify based on the percentage`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [
      {
        name: 'create_next_week',
        description: 'Create next week workouts — one unique workout per training day',
        input_schema: NEXT_WEEK_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'create_next_week' },
    messages: [
      {
        role: 'user',
        content: `Generate next week's ${sport} workouts for ${kidName ?? 'the athlete'}. Training days: ${trainingDayNames} (day numbers: ${trainingDays.join(', ')}). Each day must have a different focus.`,
      },
    ],
  })

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    return NextResponse.json({ error: 'Failed to generate workouts' }, { status: 500 })
  }

  type RawDrill = { youtube_search_query?: string; [key: string]: unknown }
  type RawWorkout = { name: string; focus: string; progression_note: string; drills: RawDrill[] }
  type RawDay = { day_of_week: number; day_label: string; skill_workout: RawWorkout; strength_workout: RawWorkout }

  const result = toolUse.input as { days?: RawDay[] }

  if (!result?.days || !Array.isArray(result.days) || result.days.length === 0) {
    console.error('generate-next-week: unexpected tool output', JSON.stringify(toolUse.input))
    return NextResponse.json({ error: 'Failed to generate workouts — please try again.' }, { status: 500 })
  }

  function processDrills(drills: RawDrill[]) {
    return drills.map(({ youtube_search_query, ...drill }) => ({
      ...drill,
      video_url: youtube_search_query
        ? `https://www.youtube.com/results?search_query=${encodeURIComponent(youtube_search_query as string)}`
        : null,
    }))
  }

  const processedDays = result.days.map((day) => ({
    ...day,
    skill_workout: { ...day.skill_workout, drills: processDrills(day.skill_workout.drills) },
    strength_workout: { ...day.strength_workout, drills: processDrills(day.strength_workout.drills) },
  }))

  return NextResponse.json({ days: processedDays })
}
