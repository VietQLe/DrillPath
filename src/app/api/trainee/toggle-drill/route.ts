import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { planId, drillId, action } = await request.json()
  if (!planId || !drillId || !action) {
    return Response.json({ error: 'planId, drillId, and action required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verify the caller is the trainee linked to this plan's kid
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

  if (action === 'complete') {
    const { error } = await admin.from('session_logs').insert({
      kid_id: kid.id,
      drill_id: drillId,
      plan_id: planId,
    })
    if (error) return Response.json({ error: error.message }, { status: 500 })
  } else if (action === 'uncomplete') {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const { error } = await admin
      .from('session_logs')
      .delete()
      .eq('plan_id', planId)
      .eq('kid_id', kid.id)
      .eq('drill_id', drillId)
      .gte('completed_at', todayStart.toISOString())
    if (error) return Response.json({ error: error.message }, { status: 500 })
  } else {
    return Response.json({ error: 'action must be complete or uncomplete' }, { status: 400 })
  }

  return Response.json({ success: true })
}
