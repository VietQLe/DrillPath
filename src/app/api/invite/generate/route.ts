import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { kid_id } = await request.json()
  if (!kid_id) return Response.json({ error: 'kid_id required' }, { status: 400 })

  // Verify this trainer owns the kid
  const { data: kid } = await supabase
    .from('kids')
    .select('id, trainee_user_id')
    .eq('id', kid_id)
    .eq('parent_id', user.id)
    .single()

  if (!kid) return Response.json({ error: 'Kid not found' }, { status: 404 })

  const admin = createAdminClient()
  const { data: invite, error } = await admin
    .from('trainee_invites')
    .insert({ kid_id, created_by: user.id })
    .select('token')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ token: invite.token })
}
