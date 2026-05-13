import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const errorParam = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')
  const next = searchParams.get('next') ?? '/dashboard'

  // Supabase itself returned an error (e.g. provider misconfiguration)
  if (errorParam) {
    const msg = encodeURIComponent(errorDescription ?? 'OAuth sign-in failed. Please try again.')
    return NextResponse.redirect(`${origin}/auth/login?error=${msg}`)
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    const msg = encodeURIComponent(error.message)
    return NextResponse.redirect(`${origin}/auth/login?error=${msg}`)
  }

  return NextResponse.redirect(`${origin}/auth/login?error=${encodeURIComponent('OAuth sign-in failed. Please try again.')}`)
}
