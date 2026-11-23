import { Alert, Badge, Button, Card, Group, Stack, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { StandSummary } from '../../shared/types'
import { api } from '../api'
import { formatDate, useLocale, useT } from '../i18n'
import { db, prepareStand } from '../offline'
import { isAnyAdmin, useMe } from '../session'
import { PageHeader, useToast } from '../ui'

// Pick a stand to sell at. "Prepare" stores it on this phone for selling offline.
export function Sell () {
  const t = useT()
  const locale = useLocale()
  const me = useMe()
  const toast = useToast()
  const navigate = useNavigate()
  const [preparing, setPreparing] = useState<string | null>(null)
  const stands = useQuery({ queryKey: ['stands'], queryFn: () => api.get<StandSummary[]>('/api/stands') })
  const stored = useLiveQuery(() => db.snapshots.toArray(), [], [])

  // Offline, the stands this phone has prepared are all there is.
  const online = (stands.data ?? []).filter((s) => s.status === 'open' && (s.sellerIds.includes(me.id) || s.canManage))
  const list: StandSummary[] = stands.data ? online : stored.map((s) => s.stand)

  const prepare = async (id: string, go: boolean) => {
    setPreparing(id)
    try {
      await prepareStand(id)
      toast.ok(t('Stojnica je pripravljena za prodajo brez povezave.', 'The stand is ready to sell offline.'))
      if (go) navigate(`/sell/${id}`)
    } catch (e) {
      toast.error(e)
    } finally {
      setPreparing(null)
    }
  }

  return (
    <>
      <PageHeader title={t('Prodaja', 'Sell')} sub={t('Pred koncertom stojnico pripravi, ko imaš še signal.', 'Prepare the stand before the gig, while you still have signal.')}>
        {isAnyAdmin(me) && <Button component={Link} to="/stands/new" variant="default">{t('Nova stojnica', 'New stand')}</Button>}
      </PageHeader>
      {!stands.data && (stands.isError || stands.fetchStatus === 'paused') && <Alert color="gray" mb="md">{t('Ni povezave: prikazujem stojnice, pripravljene na tem telefonu.', 'Offline: showing the stands prepared on this phone.')}</Alert>}
      {list.length === 0 && <Text c="dimmed">{t('Ni odprtih stojnic zate.', 'No open stands for you.')}</Text>}
      <Stack>
        {list.map((s) => {
          const snap = stored.find((x) => x.standId === s.id)
          return (
            <Card key={s.id}>
              <Group justify="space-between" wrap="wrap">
                <div>
                  <Text fw={700} size="lg">{s.name}</Text>
                  <Text size="sm" c="dimmed">{formatDate(s.date, locale)}{s.place ? ` · ${s.place}` : ''} · {s.locationName}</Text>
                  {snap
                    ? <Badge mt={6} variant="light">{t(`Pripravljeno ${formatDate(snap.fetchedAt, locale, true)}`, `Prepared ${formatDate(snap.fetchedAt, locale, true)}`)}</Badge>
                    : <Badge mt={6} color="gray" variant="light">{t('Ni pripravljeno', 'Not prepared')}</Badge>}
                </div>
                <Group gap="xs">
                  {stands.data && (
                    <Button variant="default" loading={preparing === s.id} onClick={() => void prepare(s.id, false)}>
                      {snap ? t('Osveži', 'Refresh') : t('Pripravi', 'Prepare')}
                    </Button>
                  )}
                  {snap
                    ? <Button component={Link} to={`/sell/${s.id}`}>{t('Prodajaj', 'Sell')}</Button>
                    : <Button loading={preparing === s.id} disabled={!stands.data} onClick={() => void prepare(s.id, true)}>{t('Prodajaj', 'Sell')}</Button>}
                </Group>
              </Group>
            </Card>
          )
        })}
      </Stack>
    </>
  )
}
