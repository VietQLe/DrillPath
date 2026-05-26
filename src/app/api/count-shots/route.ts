import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const client = new Anthropic()

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { frames, drillTitle } = body

  if (!frames || !Array.isArray(frames) || frames.length === 0) {
    return NextResponse.json({ error: 'No frames provided' }, { status: 400 })
  }

  const imageBlocks = (frames as string[]).map((f) => ({
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: f },
  }))

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        ...imageBlocks,
        {
          type: 'text',
          text: `These are sequential frames from a basketball${drillTitle ? ` "${drillTitle}"` : ''} shooting drill recording.

Analyze the frames to count basketball shot attempts:
1. Identify whether a basketball rim/hoop is visible
2. Track the basketball across frames to detect shots
3. Count makes (ball goes through hoop) and misses (shot attempted but missed)

Respond with ONLY a JSON object (no markdown, no explanation):
{"rim_detected":boolean,"makes":number,"misses":number,"confidence":"high"|"medium"|"low","note":"brief summary"}

If the rim is not visible or you cannot confidently detect shots, return makes:0, misses:0, rim_detected:false.`,
        },
      ],
    }],
  })

  const text = response.content.find(b => b.type === 'text')?.text ?? ''

  try {
    const jsonMatch = text.match(/\{[\s\S]*?\}/)
    if (!jsonMatch) throw new Error('No JSON')
    const data = JSON.parse(jsonMatch[0])
    const makes = Math.max(0, data.makes ?? 0)
    const misses = Math.max(0, data.misses ?? 0)
    return NextResponse.json({
      makes,
      misses,
      total: makes + misses,
      rim_detected: data.rim_detected ?? false,
      confidence: data.confidence ?? 'low',
      note: data.note ?? '',
    })
  } catch {
    return NextResponse.json({ makes: 0, misses: 0, total: 0, rim_detected: false, confidence: 'low', note: '' })
  }
}
