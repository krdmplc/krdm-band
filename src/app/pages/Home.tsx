import { Badge, Button, Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import type { Order, Pot, StandSummary, Transfer } from '../../shared/types'
import { api } from '../api'
import { formatDate, useEur, useLocale, useT } from '../i18n'
import { isAnyAdmin, useMe } from '../session'
import { PageHeader, useOwnerName } from '../ui'

export function Home () {
  const t = useT()
  const eur = useEur()
  const locale = useLocale()
  const me = useMe()
  const ownerName = useOwnerName()
  const admin = isAnyAdmin(me)
  const stands = useQuery({ queryKey: ['stands'], queryFn: () => api.get<StandSummary[]>('/api/stands') })
  const pots = useQuery({ queryKey: ['pots'], queryFn: () => api.get<Pot[]>('/api/money/pots') })
  const pending = useQuery({ queryKey: ['transfers', 'pending'], queryFn: () => api.get<Transfer[]>('/api/money/transfers?status=pending') })
  const orders = useQuery({ queryKey: ['orders', 'new'], queryFn: () => api.get<Order[]>('/api/orders?status=new'), enabled: admin })

  const myStands = (stands.data ?? []).filter((s) => s.status === 'open' && s.sellerIds.includes(me.id))
  const myPots = (pots.data ?? []).filter((p) => p.kind === 'person' && p.userId === me.id && p.balanceCents !== 0)
  const toConfirm = (pending.data ?? []).filter((tr) => tr.canDecide)

  return (
    <>
      <PageHeader title={t(`Živjo, ${me.name.split(' ')[0]}`, `Hi, ${me.name.split(' ')[0]}`)} />
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Card>
          <Title order={4} mb="xs">{t('Prodajaš na', 'You sell at')}</Title>
          {myStands.length === 0 && <Text c="dimmed" size="sm">{t('Nobena stojnica ni odprta zate.', 'No open stand for you.')}</Text>}
          <Stack gap="xs">
            {myStands.map((s) => (
              <Group key={s.id} justify="space-between" wrap="nowrap">
                <div>
                  <Text fw={700}>{s.name}</Text>
                  <Text size="sm" c="dimmed">{formatDate(s.date, locale)} · {s.locationName}</Text>
                </div>
                <Button component={Link} to={`/sell/${s.id}`}>{t('Prodaja', 'Sell')}</Button>
              </Group>
            ))}
          </Stack>
        </Card>

        <Card>
          <Title order={4} mb="xs">{t('Tvoj denar', 'Your money')}</Title>
          {myPots.length === 0 && <Text c="dimmed" size="sm">{t('Ne držiš denarja nobenega benda.', "You aren't holding any band's money.")}</Text>}
          <Stack gap={4}>
            {myPots.map((p) => (
              <Group key={p.id} justify="space-between">
                <Text>{ownerName(p.ownerId)}</Text>
                <Text fw={700} className="num" c={p.balanceCents < 0 ? 'red' : undefined}>{eur(p.balanceCents)}</Text>
              </Group>
            ))}
          </Stack>
          {myPots.length > 0 && <Button component={Link} to="/money" variant="default" mt="sm" size="xs">{t('Predaj denar', 'Hand money over')}</Button>}
        </Card>

        {toConfirm.length > 0 && (
          <Card>
            <Title order={4} mb="xs">{t('Čaka tvojo potrditev', 'Waiting for you to confirm')}</Title>
            <Stack gap={4}>
              {toConfirm.map((tr) => (
                <Text key={tr.id} size="sm">{tr.fromLabel}: <b>{eur(tr.amountCents)}</b> ({ownerName(tr.ownerId)})</Text>
              ))}
            </Stack>
            <Button component={Link} to="/money" mt="sm" size="xs">{t('Odpri', 'Open')}</Button>
          </Card>
        )}

        {admin && (
          <Card>
            <Group justify="space-between" mb="xs">
              <Title order={4}>{t('Nova naročila', 'New orders')}</Title>
              <Badge color={orders.data?.length ? 'red' : 'gray'}>{orders.data?.length ?? 0}</Badge>
            </Group>
            <Stack gap={4}>
              {(orders.data ?? []).slice(0, 5).map((o) => (
                <Text key={o.id} size="sm" component={Link} to={`/orders/${o.id}`} c="inherit">
                  {o.number} · {o.customerName} · {eur(o.itemsCents)}
                </Text>
              ))}
            </Stack>
            <Button component={Link} to="/orders" variant="default" mt="sm" size="xs">{t('Vsa naročila', 'All orders')}</Button>
          </Card>
        )}
      </SimpleGrid>
    </>
  )
}
