import { ActionIcon, Button, Card, Group, NumberInput, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { ShippingSettings } from '../../../shared/shipping'
import { postQuote } from '../../../shared/shipping'
import type { Tier } from '../../../shared/types'
import { api } from '../../api'
import { useEur, useT } from '../../i18n'
import { ErrorNote, PageHeader, euroInputProps, fromEuros, toEuros, useTiers, useToast } from '../../ui'

export function Settings () {
  const t = useT()
  return (
    <>
      <PageHeader title={t('Nastavitve', 'Settings')} />
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <TiersCard />
        <ShippingCard />
      </SimpleGrid>
    </>
  )
}

function TiersCard () {
  const t = useT()
  const toast = useToast()
  const qc = useQueryClient()
  const tiers = useTiers()
  const [list, setList] = useState<Tier[]>([])
  useEffect(() => { if (tiers.data) setList(tiers.data) }, [tiers.data])
  const save = useMutation({
    mutationFn: () => api.put('/api/tiers', { tiers: list }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['tiers'] }); toast.ok(t('Shranjeno.', 'Saved.')) }
  })
  return (
    <Card>
      <Title order={4} mb="xs">{t('Cene', 'Price tiers')}</Title>
      <Text size="sm" c="dimmed" mb="sm">{t('Polna cena je oglaševana; ostale lahko na stojnici uporabijo skrbniki in prodajalci, ki jim jih dovoliš. Odstranjena cena izgine iz vseh izdelkov.',
        'The full price is the advertised one; admins, and sellers you allow, can use the others at a stand. A removed tier disappears from every product.')}</Text>
      <Stack gap="xs">
        {list.map((tier, i) => (
          <Group key={i} gap="xs" wrap="nowrap">
            <TextInput w={100} value={tier.id} disabled={tier.id === 'full' || tiers.data?.some((x) => x.id === tier.id)}
              onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, id: e.currentTarget.value.toLowerCase().replace(/[^a-z0-9-]/g, '') } : x)))} aria-label={t('Oznaka', 'Id')} />
            <TextInput style={{ flex: 1 }} value={tier.nameSl} placeholder="SL" onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, nameSl: e.currentTarget.value } : x)))} aria-label="SL" />
            <TextInput style={{ flex: 1 }} value={tier.nameEn} placeholder="EN" onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, nameEn: e.currentTarget.value } : x)))} aria-label="EN" />
            <ActionIcon variant="default" size="lg" disabled={tier.id === 'full'} onClick={() => setList(list.filter((_, j) => j !== i))} aria-label={t('Odstrani', 'Remove')}><IconTrash size={16} /></ActionIcon>
          </Group>
        ))}
        <Group>
          <Button variant="default" onClick={() => setList([...list, { id: '', nameSl: '', nameEn: '' }])}>{t('Dodaj ceno', 'Add a tier')}</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={list.some((x) => !x.id || !x.nameSl || !x.nameEn)}>{t('Shrani', 'Save')}</Button>
        </Group>
        <ErrorNote error={save.error} />
      </Stack>
    </Card>
  )
}

function ShippingCard () {
  const t = useT()
  const eur = useEur()
  const toast = useToast()
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ['shipping'], queryFn: () => api.get<ShippingSettings>('/api/settings/shipping') })
  const [s, setS] = useState<ShippingSettings | null>(null)
  useEffect(() => { if (settings.data) setS(settings.data) }, [settings.data])
  const save = useMutation({
    mutationFn: () => api.put('/api/settings/shipping', s),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['shipping'] }); toast.ok(t('Shranjeno.', 'Saved.')) }
  })
  if (!s) return <Card><ErrorNote error={settings.error} /></Card>
  const setBracket = (i: number, patch: Partial<ShippingSettings['brackets'][number]>) =>
    setS({ ...s, brackets: s.brackets.map((b, j) => (j === i ? { ...b, ...patch } : b)) })
  const examples = [200, 450, 700, 1500]
  return (
    <Card>
      <Title order={4} mb="xs">{t('Poštnina (Pošta Slovenije)', 'Shipping (Pošta Slovenije)')}</Title>
      <Text size="sm" c="dimmed" mb="sm">{t('Cena razreda za težo pošiljke + embalaža, zaokroženo navzgor. Cene iz cenika, veljavnega od 1. 8. 2026.',
        'The price class for the parcel weight + packaging, rounded up. Prices from the list valid from 1 Aug 2026.')}</Text>
      <SimpleGrid cols={3} mb="sm">
        <NumberInput label={t('Teža embalaže', 'Packaging weight')} suffix=" g" min={0} value={s.packagingGrams} onChange={(v) => setS({ ...s, packagingGrams: Number(v) || 0 })} />
        <NumberInput {...euroInputProps} label={t('Cena embalaže', 'Packaging cost')} value={toEuros(s.packagingCents)} onChange={(v) => setS({ ...s, packagingCents: fromEuros(v) ?? 0 })} />
        <NumberInput {...euroInputProps} label={t('Zaokroži na', 'Round up to')} value={toEuros(s.roundToCents)} onChange={(v) => setS({ ...s, roundToCents: Math.max(1, fromEuros(v) ?? 1) })} />
      </SimpleGrid>
      <Table verticalSpacing={2}>
        <Table.Thead>
          <Table.Tr><Table.Th>{t('Do', 'Up to')}</Table.Th><Table.Th>{t('Storitev', 'Service')}</Table.Th><Table.Th>{t('Cena', 'Price')}</Table.Th><Table.Th /></Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {s.brackets.map((b, i) => (
            <Table.Tr key={i}>
              <Table.Td><NumberInput size="xs" suffix=" g" min={1} value={b.maxGrams} onChange={(v) => setBracket(i, { maxGrams: Number(v) || 1 })} /></Table.Td>
              <Table.Td><TextInput size="xs" value={b.service} onChange={(e) => setBracket(i, { service: e.currentTarget.value })} /></Table.Td>
              <Table.Td><NumberInput size="xs" {...euroInputProps} value={toEuros(b.cents)} onChange={(v) => setBracket(i, { cents: fromEuros(v) ?? 0 })} /></Table.Td>
              <Table.Td><ActionIcon variant="default" onClick={() => setS({ ...s, brackets: s.brackets.filter((_, j) => j !== i) })} aria-label={t('Odstrani', 'Remove')}><IconTrash size={14} /></ActionIcon></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed" mt="xs">
        {t('Primeri:', 'Examples:')} {examples.map((g) => { const q = postQuote(s, g); return `${g} g → ${q ? eur(q.cents) : '–'}` }).join(' · ')}
      </Text>
      <Group mt="sm">
        <Button variant="default" onClick={() => setS({ ...s, brackets: [...s.brackets, { maxGrams: 20000, cents: 0, service: 'Paket' }] })}>{t('Dodaj razred', 'Add a class')}</Button>
        <Button onClick={() => save.mutate()} loading={save.isPending}>{t('Shrani', 'Save')}</Button>
      </Group>
      <ErrorNote error={save.error} />
    </Card>
  )
}
