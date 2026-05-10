import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const client = new Anthropic()

const WORKOUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    name: {
      type: 'string',
      description: 'Short, descriptive workout name (e.g. "Ball Handling & Finishing")',
    },
    focus: {
      type: 'string',
      description: 'One sentence describing the workout goal',
    },
    drills: {
      type: 'array',
      items: {
        type: 'object',
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
        },
        required: [
          'title',
          'description',
          'skill_focus',
          'difficulty',
          'duration_minutes',
          'equipment',
          'instructions',
        ],
        additionalProperties: false,
      },
      minItems: 3,
      maxItems: 8,
    },
  },
  required: ['name', 'focus', 'drills'],
  additionalProperties: false,
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { prompt, sport, level, ageRange } = body

  if (!prompt?.trim() || !sport) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4000,
    system: [
      {
        type: 'text',
        text: `You are an expert youth sports coach specializing in ${sport}. Design structured, safe, age-appropriate training workouts. The athlete is at ${level} skill level, age group ${ageRange}. Create practical drills with clear step-by-step instructions suited for a young athlete. Order drills from warm-up/easier to more intensive. Match difficulty to the athlete's level.`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [
      {
        name: 'create_workout',
        description: 'Create a structured workout plan with ordered drills',
        input_schema: WORKOUT_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'create_workout' },
    messages: [
      {
        role: 'user',
        content: `Create a ${sport} workout focused on: ${prompt.trim()}`,
      },
    ],
  })

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    return NextResponse.json({ error: 'Failed to generate workout' }, { status: 500 })
  }

  return NextResponse.json(toolUse.input)
}
