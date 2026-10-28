import { PageTitle } from '../components/ui'
import { PushCard } from '../components/PushCard'

export function RemindersPage() {
  return (
    <div>
      <PageTitle emoji="🔔" title="Reminders" subtitle="Keep your streak going." />
      <PushCard />
    </div>
  )
}
