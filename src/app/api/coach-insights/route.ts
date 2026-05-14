import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const client = new Anthropic()

const INSIGHTS_SCHEMA = {
  type: 'object' as const,
  properties: {
    overall: {
      type: 'string',
      description: '2-3 sentence overall assessment, encouraging and specific to what was observed',
    },
    strengths: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 3,
      description: 'What the athlete did well — specific observations tied to the drill steps',
    },
    improvements: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 3,
      description: 'Actionable improvement points — constructive and technique-focused',
    },
    keyFocus: {
      type: 'string',
      description: 'The single most important thing to focus on in the next attempt',
    },
  },
  required: ['overall', 'strengths', 'improvements', 'keyFocus'],
  additionalProperties: false,
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { frames, drillTitle, drillDescription, drillInstructions, sport, level } = await req.json()

  if (!drillTitle) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const hasFrames = Array.isArray(frames) && frames.length > 0

  const imageContent = hasFrames
    ? (frames as string[]).map((data) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data },
      }))
    : []

  const textContent = {
    type: 'text' as const,
    text: `You are an expert youth ${sport ?? 'sports'} coach reviewing a ${level ?? 'youth'} athlete's performance of the "${drillTitle}" drill.

${drillDescription ? `Drill: ${drillDescription}\n` : ''}${
  Array.isArray(drillInstructions) && drillInstructions.length > 0
    ? `Key steps:\n${(drillInstructions as string[]).map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`
    : ''
}
${hasFrames
  ? 'The images above are frames from their video recording. Analyze form, body position, technique, and execution based on what you observe.'
  : 'Provide coaching guidance based on the drill requirements and what an athlete at this level typically needs to focus on.'}

Give specific, constructive, age-appropriate feedback. Be encouraging and honest.`,
  }

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 1000,
    tools: [{
      name: 'provide_coaching_insights',
      description: 'Provide structured coaching feedback on a drill performance',
      input_schema: INSIGHTS_SCHEMA,
    }],
    tool_choice: { type: 'tool', name: 'provide_coaching_insights' },
    messages: [{
      role: 'user',
      content: hasFrames ? [...imageContent, textContent] : [textContent],
    }],
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    return NextResponse.json({ error: 'Failed to generate insights' }, { status: 500 })
  }

  return NextResponse.json(toolUse.input)
}
