import { StatsPanel } from '../components/StatsPanel'
import { DomainHealthWidget } from '../components/DomainHealthWidget'

export function StatsPage() {
  return (
    <main className="flex-1 overflow-auto px-4 py-4">
      <div className="max-w-screen-2xl mx-auto">
        <div className="grid grid-cols-2 gap-3">
          <StatsPanel />
          <DomainHealthWidget />
        </div>
      </div>
    </main>
  )
}
