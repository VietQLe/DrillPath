import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const client = new Anthropic()

const DRILL_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string' },
    description: {
      type: 'string',
      description: '1-2 sentences describing the drill and what it develops',
    },
    skill_focus: {
      type: 'string',
      enum: ['speed', 'agility', 'strength', 'technique', 'endurance', 'flexibility'],
    },
    difficulty: {
      type: 'string',
      enum: ['beginner', 'intermediate', 'advanced'],
    },
    duration_minutes: { type: 'number', minimum: 3, maximum: 60 },
    equipment: {
      type: 'array',
      items: { type: 'string' },
      description: 'Required equipment (empty array if none needed)',
    },
    instructions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Clear step-by-step instructions, each as a complete sentence',
      minItems: 2,
      maxItems: 8,
    },
    youtube_search_query: {
      type: 'string',
      description: 'A focused 4-6 word YouTube search query to find a tutorial video for this drill',
    },
  },
  required: ['title', 'description', 'skill_focus', 'difficulty', 'duration_minutes', 'equipment', 'instructions', 'youtube_search_query'],
  additionalProperties: false,
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sport, level, ageRange, workoutName, workoutFocus, drillToReplace, otherDrills } = await req.json()

  if (!sport || !level || !drillToReplace) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 2000,
    system: [
      {
        type: 'text',
        text: `You are an expert youth sports coach specializing in ${sport}. The athlete is at ${level} skill level, age group ${ageRange}. Create practical drills with clear step-by-step instructions suited for a young athlete.`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [
      {
        name: 'create_drill',
        description: 'Create a single replacement drill for a workout',
        input_schema: DRILL_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'create_drill' },
    messages: [
      {
        role: 'user',
        content: `I have a ${sport} workout called "${workoutName}" focused on: ${workoutFocus}.

The drill at this position is "${drillToReplace.title}" (${drillToReplace.skill_focus}, ${drillToReplace.duration_minutes} min). Please replace it with a different drill that fits the workout theme.

Other drills already in this workout (do not duplicate): ${(otherDrills as string[]).length > 0 ? (otherDrills as string[]).join(', ') : 'none'}.

Create a replacement drill that is meaningfully different from "${drillToReplace.title}" and fits within a ${workoutFocus} workout.`,
      },
    ],
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    return NextResponse.json({ error: 'Failed to generate drill' }, { status: 500 })
  }

  const { youtube_search_query, ...drill } = toolUse.input as { youtube_search_query?: string; [key: string]: unknown }
  return NextResponse.json({
    ...drill,
    video_url: youtube_search_query
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(youtube_search_query)}`
      : null,
  })
}
