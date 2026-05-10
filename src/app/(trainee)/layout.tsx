import TraineeNavBar from '@/components/layout/TraineeNavBar'

export default function TraineeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TraineeNavBar />
      <main className="pt-14 pb-8 min-h-screen">
        {children}
      </main>
    </>
  )
}
