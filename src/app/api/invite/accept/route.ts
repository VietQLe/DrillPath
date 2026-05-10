import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { token } = await request.json()
  if (!token) return Response.json({ error: 'token required' }, { status: 400 })

  // Trainers (users who own kids) must not be able to accept trainee invites
  const { count: ownedKids } = await supabase
    .from('kids')
    .select('*', { count: 'exact', head: true })
    .eq('parent_id', user.id)
  if ((ownedKids ?? 0) > 0) {
    return Response.json({ error: 'Trainer accounts cannot be linked as a trainee' }, { status: 403 })
  }

  const admin = createAdminClient()

  const { data: invite } = await admin
    .from('trainee_invites')
    .select('*, kid:kids(id, name, trainee_user_id)')
    .eq('token', token)
    .single()

  if (!invite) return Response.json({ error: 'Invite not found' }, { status: 404 })
  if (invite.accepted_at) return Response.json({ error: 'Invite already used' }, { status: 400 })
  if (new Date(invite.expires_at) < new Date()) return Response.json({ error: 'Invite expired' }, { status: 400 })

  const kid = invite.kid as { id: string; name: string; trainee_user_id: string | null }
  if (kid.trainee_user_id && kid.trainee_user_id !== user.id) {
    return Response.json({ error: 'This athlete already has a linked trainee' }, { status: 400 })
  }

  // Link the trainee to the kid
  await admin.from('kids').update({ trainee_user_id: user.id }).eq('id', invite.kid_id)

  // Mark invite accepted
  await admin
    .from('trainee_invites')
    .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
    .eq('token', token)

  // Stamp the user's role in their auth metadata so middleware can route them without a DB call
  await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { role: 'trainee', kid_id: invite.kid_id },
  })

  return Response.json({ success: true, kid_id: invite.kid_id })
}
