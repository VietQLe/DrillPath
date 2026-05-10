import NavBar from '@/components/layout/NavBar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NavBar />
      <main className="pt-14 pb-20 min-h-screen">
        {children}
      </main>
    </>
  )
}
