import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import KidProfileClient from '@/components/kids/KidProfileClient'
import type { Kid } from '@/types'

export default async function TraineeProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const admin = createAdminClient()
  const { data: kid } = await admin
    .from('kids')
    .select('*')
    .eq('trainee_user_id', user.id)
    .single()

  if (!kid) redirect('/auth/login')

  return <KidProfileClient kid={kid as Kid} role="trainee" />
}
