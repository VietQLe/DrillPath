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

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  if (action === 'complete') {
    // Use the user's own client (not admin) so the INSERT carries the trainee's auth.uid()
    // into the WAL event — Supabase Realtime needs a real uid to pass subscriber RLS checks
    // and deliver the event to the trainer's subscription.
    const { error } = await supabase.from('session_logs').insert({
      kid_id: kid.id,
      drill_id: drillId,
      plan_id: planId,
    })
    if (error) return Response.json({ error: error.message }, { status: 500 })

    // Log a workout session when all drills are now complete
    const [{ count: planDrillCount }, { count: completedCount }] = await Promise.all([
      admin.from('plan_drills').select('*', { count: 'exact', head: true }).eq('plan_id', planId),
      admin.from('session_logs').select('*', { count: 'exact', head: true })
        .eq('plan_id', planId).eq('kid_id', kid.id).gte('completed_at', todayStart.toISOString()),
    ])
    if (planDrillCount && completedCount && completedCount >= planDrillCount) {
      await admin.from('workout_sessions').insert({ kid_id: kid.id, plan_id: planId })
    }
  } else if (action === 'uncomplete') {
    // Check if the workout was fully complete before this uncomplete
    const [{ count: planDrillCount }, { count: completedBefore }] = await Promise.all([
      admin.from('plan_drills').select('*', { count: 'exact', head: true }).eq('plan_id', planId),
      admin.from('session_logs').select('*', { count: 'exact', head: true })
        .eq('plan_id', planId).eq('kid_id', kid.id).gte('completed_at', todayStart.toISOString()),
    ])

    // Same reason as above — use user client so DELETE also fires Realtime for subscribers
    const { error } = await supabase
      .from('session_logs')
      .delete()
      .eq('plan_id', planId)
      .eq('kid_id', kid.id)
      .eq('drill_id', drillId)
      .gte('completed_at', todayStart.toISOString())
    if (error) return Response.json({ error: error.message }, { status: 500 })

    if (planDrillCount && completedBefore && completedBefore >= planDrillCount) {
      await admin.from('workout_sessions').delete()
        .eq('plan_id', planId).eq('kid_id', kid.id).gte('completed_at', todayStart.toISOString())
    }
  } else {
    return Response.json({ error: 'action must be complete or uncomplete' }, { status: 400 })
  }

  return Response.json({ success: true })
}
