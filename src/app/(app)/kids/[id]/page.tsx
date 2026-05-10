import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import KidProfileClient from '@/components/kids/KidProfileClient'
import type { Kid } from '@/types'

export default async function KidProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: kid } = await supabase
    .from('kids')
    .select('*')
    .eq('id', id)
    .eq('parent_id', user.id)
    .single()

  if (!kid) notFound()

  return <KidProfileClient kid={kid as Kid} role="trainer" />
}
