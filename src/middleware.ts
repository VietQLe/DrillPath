import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  const publicPaths = ['/auth/login', '/auth/signup']
  const isPublic = publicPaths.some(p => pathname.startsWith(p))

  if (!user && !isPublic) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (user) {
    // Use the DB as source of truth. Run both checks in parallel — metadata
    // alone is unreliable (it may be missing if the accept API failed mid-way).
    const [{ count: trainerKidCount }, { count: traineeKidCount }] = await Promise.all([
      supabase.from('kids').select('*', { count: 'exact', head: true }).eq('parent_id', user.id),
      supabase.from('kids').select('*', { count: 'exact', head: true }).eq('trainee_user_id', user.id),
    ])

    // Trainer status wins: a user who owns kid profiles is always a trainer,
    // even if they accidentally ended up with trainee metadata.
    const isTrainer = (trainerKidCount ?? 0) > 0
    const isTrainee = !isTrainer && (traineeKidCount ?? 0) > 0

    if (isPublic) {
      return NextResponse.redirect(new URL(isTrainee ? '/trainee' : '/dashboard', request.url))
    }

    // Trainees may only access /trainee and /invite routes
    if (isTrainee && !pathname.startsWith('/trainee') && !pathname.startsWith('/invite')) {
      return NextResponse.redirect(new URL('/trainee', request.url))
    }
    // Trainers (and new users without kids yet) may not access /trainee routes
    if (!isTrainee && pathname.startsWith('/trainee')) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
