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

  const bannedTopics = [
    'politics',
    'election',
    'bitcoin',
    'porn',
    'sex',
    'violence',
    'bomb',
    'hack',
    'code',
  ]

  const lowerPrompt = prompt.toLowerCase()

  const isBlocked = bannedTopics.some(topic =>
    lowerPrompt.includes(topic)
  )

  if (isBlocked) {
    return NextResponse.json(
      { error: 'Request outside supported training topics' },
      { status: 400 }
    )
  }

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4000,
    system: [
      {
        type: 'text',
       text: `You are an expert youth sports coach specializing in ${sport}.

Your primary responsibility is creating structured, safe, age-appropriate athletic workouts and drills.

The athlete is at ${level} skill level, age group ${ageRange}.

You should:
- Create practical drills with clear step-by-step instructions
- Prioritize safety and proper progression
- Order drills from warm-up/easier to more intensive
- Match difficulty to the athlete's level
- Focus on athletic development, conditioning, skill-building, recovery, and mobility

You should NOT:
- Answer unrelated general knowledge questions
- Provide coding or technical support
- Discuss politics, religion, or controversial topics
- Generate unsafe medical advice
- Recommend PEDs, steroids, dangerous supplements, or rapid weight cutting
- Create inappropriate, explicit, or non-sports-related content
- Ignore athlete age appropriateness or safety considerations

If the user's request is unrelated to sports training, fitness, recovery, nutrition, mobility, or athlete development:
- politely refuse
- redirect the user back toward workout-related requests

Only generate responses that fit the create_workout tool schema.`,
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
