import { DomainHealthWidget } from '../components/DomainHealthWidget'

export function DomainsPage() {
  return (
    <main className="flex-1 overflow-auto px-4 py-4">
      <div className="max-w-screen-2xl mx-auto">
        <DomainHealthWidget />
      </div>
    </main>
  )
}
