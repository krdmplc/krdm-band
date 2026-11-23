import { Group, SegmentedControl, Table, Text, TextInput } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReportRow } from '../../shared/types'
import { api } from '../api'
import { useEur, useT } from '../i18n'
import { ErrorNote, PageHeader } from '../ui'

type GroupBy = 'stand' | 'product' | 'owner' | 'month'

export function Reports () {
  const t = useT()
  const eur = useEur()
  const year = new Date().getFullYear()
  const [from, setFrom] = useState(`${year}-01-01`)
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [group, setGroup] = useState<GroupBy>('stand')
  const report = useQuery({
    queryKey: ['report', from, to, group],
    queryFn: () => api.get<ReportRow[]>(`/api/reports/sales?from=${from}&to=${to}&group=${group}`),
    enabled: Boolean(from && to)
  })
  const rows = report.data ?? []
  const total = rows.reduce((a, r) => ({ qty: a.qty + r.qty, rev: a.rev + r.revenueCents, cost: r.costCents === null || a.cost === null ? null : a.cost + r.costCents }), { qty: 0, rev: 0, cost: 0 as number | null })
  return (
    <>
      <PageHeader title={t('Poročila', 'Reports')} sub={t('Prodaja na stojnicah in plačana spletna naročila, za bende, ki jih urejaš.', 'Stand sales and paid web orders, for the bands you manage.')} />
      <Group mb="md" align="flex-end" wrap="wrap">
        <TextInput type="date" label={t('Od', 'From')} value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
        <TextInput type="date" label={t('Do', 'To')} value={to} onChange={(e) => setTo(e.currentTarget.value)} />
        <SegmentedControl value={group} onChange={(v) => setGroup(v as GroupBy)} data={[
          { value: 'stand', label: t('Po dogodkih', 'By event') },
          { value: 'product', label: t('Po izdelkih', 'By product') },
          { value: 'owner', label: t('Po bendih', 'By band') },
          { value: 'month', label: t('Po mesecih', 'By month') }
        ]} />
      </Group>
      <ErrorNote error={report.error} />
      <Table.ScrollContainer minWidth={480}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th />
              <Table.Th className="num">{t('Kosov', 'Pieces')}</Table.Th>
              <Table.Th className="num">{t('Prihodek', 'Revenue')}</Table.Th>
              <Table.Th className="num">{t('Nabavna vrednost', 'Cost')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.key}>
                <Table.Td>{r.key === 'web' ? t('Spletna naročila', 'Web orders') : r.label}</Table.Td>
                <Table.Td className="num">{r.qty}</Table.Td>
                <Table.Td className="num">{eur(r.revenueCents)}</Table.Td>
                <Table.Td className="num">{r.costCents === null ? '–' : eur(r.costCents)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr fw={700}>
              <Table.Td>{t('Skupaj', 'Total')}</Table.Td>
              <Table.Td className="num">{total.qty}</Table.Td>
              <Table.Td className="num">{eur(total.rev)}</Table.Td>
              <Table.Td className="num">{total.cost === null ? '–' : eur(total.cost)}</Table.Td>
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      </Table.ScrollContainer>
      <Text size="xs" c="dimmed" mt="xs">{t('Nabavna vrednost je povprečna cena vseh tiskov; »–« pomeni, da cena kakšnega izdelka ni vpisana.', 'Cost uses the average price of all print runs; "–" means a product has no cost recorded.')}</Text>
    </>
  )
}
