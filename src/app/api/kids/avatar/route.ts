import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { kid_id, avatar_url } = await request.json()
  if (!kid_id || !avatar_url) return Response.json({ error: 'kid_id and avatar_url required' }, { status: 400 })

  const admin = createAdminClient()

  // Verify caller is the parent or the linked trainee
  const { data: kid } = await admin
    .from('kids')
    .select('id, parent_id, trainee_user_id')
    .eq('id', kid_id)
    .single()

  if (!kid) return Response.json({ error: 'Not found' }, { status: 404 })

  const isParent = kid.parent_id === user.id
  const isTrainee = kid.trainee_user_id === user.id
  if (!isParent && !isTrainee) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await admin
    .from('kids')
    .update({ avatar_url })
    .eq('id', kid_id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
