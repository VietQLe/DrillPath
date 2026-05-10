import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { planId, rating, notes } = await request.json()
  if (!planId || !rating) {
    return Response.json({ error: 'planId and rating required' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: plan } = await admin
    .from('training_plans')
    .select('kid_id')
    .eq('id', planId)
    .single()

  if (!plan) return Response.json({ error: 'Plan not found' }, { status: 404 })

  const { data: kid } = await admin
    .from('kids')
    .select('id')
    .eq('id', plan.kid_id)
    .eq('trainee_user_id', user.id)
    .single()

  if (!kid) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  await admin
    .from('workout_sessions')
    .update({ rating, notes: notes ?? null })
    .eq('plan_id', planId)
    .eq('kid_id', kid.id)
    .gte('completed_at', todayStart.toISOString())

  return Response.json({ success: true })
}
