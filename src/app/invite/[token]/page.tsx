import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SPORT_EMOJI } from '@/lib/utils'
import AcceptInviteButton from './AcceptInviteButton'

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect(`/auth/login?next=/invite/${token}`)

  // If already a trainee, go straight to their dashboard
  if (user.user_metadata?.role === 'trainee') redirect('/trainee')

  const admin = createAdminClient()
  const { data: invite } = await admin
    .from('trainee_invites')
    .select('*, kid:kids(id, name, sport, trainee_user_id)')
    .eq('token', token)
    .single()

  if (!invite) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <div className="text-4xl mb-4">🔗</div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Invite not found</h1>
          <p className="text-slate-500 text-sm">This invite link is invalid or has already expired.</p>
        </div>
      </div>
    )
  }

  if (invite.accepted_at) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <div className="text-4xl mb-4">✅</div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Already accepted</h1>
          <p className="text-slate-500 text-sm">This invite link has already been used.</p>
        </div>
      </div>
    )
  }

  if (new Date(invite.expires_at) < new Date()) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <div className="text-4xl mb-4">⏰</div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Invite expired</h1>
          <p className="text-slate-500 text-sm">Ask your trainer to send a new invite link.</p>
        </div>
      </div>
    )
  }

  const kid = invite.kid as { id: string; name: string; sport: string; trainee_user_id: string | null }

  // Already linked to this user — just redirect
  if (kid.trainee_user_id === user.id) redirect('/trainee')

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🏆</div>
          <h1 className="text-3xl font-bold text-slate-900">CoachHQ</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center space-y-4">
          <div className="text-5xl">
            {SPORT_EMOJI[kid.sport as keyof typeof SPORT_EMOJI] ?? '🏅'}
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">You&apos;ve been invited!</h2>
            <p className="text-slate-500 text-sm mt-1">
              Link your account to train as <strong>{kid.name}</strong>. Your completions will sync with your trainer.
            </p>
          </div>

          <AcceptInviteButton token={token} />
        </div>
      </div>
    </div>
  )
}
