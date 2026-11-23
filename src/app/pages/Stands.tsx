import {
  ActionIcon, Alert, Badge, Button, Card, Group, MultiSelect, NumberInput, Select, SimpleGrid, Stack, Table, Text, TextInput, Title
} from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { Sale, StandDetail, StandPrice, StandSummary } from '../../shared/types'
import { api } from '../api'
import { FLAG, METHOD, formatDate, pick, useEur, useLocale, useT } from '../i18n'
import { isAnyAdmin, useMe } from '../session'
import {
  ErrorNote, PageHeader, euroInputProps, fromEuros, toEuros, useLocations, useOwnerName, useProductTitle, useProducts, useTierName,
  useTiers, useToast, useUsers
} from '../ui'

export function Stands () {
  const t = useT()
  const locale = useLocale()
  const me = useMe()
  const stands = useQuery({ queryKey: ['stands'], queryFn: () => api.get<StandSummary[]>('/api/stands') })
  return (
    <>
      <PageHeader title={t('Stojnice', 'Stands')} sub={t('Vsaka prodaja na dogodku: kje, kdo prodaja in iz katere škatle.', 'Each event you sell at: where, who sells, and from which box.')}>
        {isAnyAdmin(me) && <Button component={Link} to="/stands/new" leftSection={<IconPlus size={16} />}>{t('Nova stojnica', 'New stand')}</Button>}
      </PageHeader>
      <ErrorNote error={stands.error} />
      <Table.ScrollContainer minWidth={500}>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('Dogodek', 'Event')}</Table.Th>
              <Table.Th>{t('Datum', 'Date')}</Table.Th>
              <Table.Th>{t('Škatla', 'Box')}</Table.Th>
              <Table.Th>{t('Stanje', 'Status')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(stands.data ?? []).map((s) => (
              <Table.Tr key={s.id}>
                <Table.Td><Link to={`/stands/${s.id}`}>{s.name}</Link>{s.place ? <Text span c="dimmed" size="sm"> · {s.place}</Text> : null}</Table.Td>
                <Table.Td>{formatDate(s.date, locale)}</Table.Td>
                <Table.Td>{s.locationName}</Table.Td>
                <Table.Td><Badge color={s.status === 'open' ? 'flyer' : 'gray'}>{s.status === 'open' ? t('odprta', 'open') : t('zaprta', 'closed')}</Badge></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </>
  )
}

interface SellerForm { userId: string, floatCents: number, tiers: string[] }

export function StandEdit () {
  const { standId = 'new' } = useParams()
  const isNew = standId === 'new'
  const t = useT()
  const eur = useEur()
  const me = useMe()
  const toast = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const users = useUsers()
  const locations = useLocations()
  const tiers = useTiers()
  const products = useProducts()
  const tierName = useTierName()
  const productTitle = useProductTitle()
  const ownerName = useOwnerName()
  const detail = useQuery({ queryKey: ['stand', standId], queryFn: () => api.get<StandDetail>(`/api/stands/${standId}`), enabled: !isNew })

  const [name, setName] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [place, setPlace] = useState('')
  const [locationId, setLocationId] = useState<string | null>(null)
  const [sellers, setSellers] = useState<SellerForm[]>([{ userId: me.id, floatCents: 0, tiers: ['full'] }])
  const [prices, setPrices] = useState<StandPrice[]>([])
  useEffect(() => {
    const d = detail.data
    if (!d) return
    setName(d.name); setDate(d.date); setPlace(d.place ?? ''); setLocationId(d.locationId)
    setSellers(d.sellers.map((s) => ({ userId: s.userId, floatCents: s.floatCents, tiers: s.tiers })))
    setPrices(d.prices)
  }, [detail.data])

  const payload = (status?: 'open' | 'closed') => ({ name, date, place: place || null, locationId, sellers, prices, status })
  const save = useMutation({
    mutationFn: async (status?: 'open' | 'closed'): Promise<{ id?: string }> => (isNew
      ? await api.post<{ id: string }>('/api/stands', payload())
      : await api.put<{ id?: string }>(`/api/stands/${standId}`, payload(status))),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['stands'] })
      await qc.invalidateQueries({ queryKey: ['stand', standId] })
      toast.ok(t('Shranjeno.', 'Saved.'))
      if (isNew && res.id) navigate(`/stands/${res.id}`, { replace: true })
    }
  })
  const editable = isNew || detail.data?.canManage

  const userOptions = (users.data ?? []).map((u) => ({ value: u.id, label: u.name }))
  const userName = (id: string) => users.data?.find((u) => u.id === id)?.name ?? id

  return (
    <>
      <PageHeader title={isNew ? t('Nova stojnica', 'New stand') : name} sub={detail.data && `${detail.data.locationName}`}>
        {!isNew && detail.data && <Button component={Link} to={`/sell/${standId}`}>{t('Prodaja', 'Sell')}</Button>}
        {!isNew && detail.data?.canManage && (
          detail.data.status === 'open'
            ? <Button variant="default" onClick={() => save.mutate('closed')}>{t('Zapri stojnico', 'Close stand')}</Button>
            : <Button variant="default" onClick={() => save.mutate('open')}>{t('Znova odpri', 'Reopen')}</Button>
        )}
      </PageHeader>
      <ErrorNote error={detail.error ?? save.error} />

      {!isNew && detail.data && <StandSummaryCards detail={detail.data} />}

      <Card mt="md">
        <Title order={4} mb="sm">{t('Podatki', 'Details')}</Title>
        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput label={t('Dogodek', 'Event')} required value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Plc fest 2027" />
              <TextInput label={t('Datum', 'Date')} type="date" required value={date} onChange={(e) => setDate(e.currentTarget.value)} />
              <TextInput label={t('Kraj', 'Place')} value={place} onChange={(e) => setPlace(e.currentTarget.value)} />
            </SimpleGrid>
            <Select
              label={t('Škatla (lokacija, iz katere prodajaš)', 'Box (the location you sell from)')}
              description={<>{t('Škatlo napolniš na strani ', 'Pack the box on the ')}<Link to="/stock">{t('Zaloga', 'Stock')}</Link>{t('.', ' page.')}</>}
              data={(locations.data ?? []).filter((l) => !l.archived).map((l) => ({ value: l.id, label: l.name }))}
              value={locationId}
              onChange={setLocationId}
              required
            />
            <div>
              <Text fw={500} size="sm" mb={4}>{t('Prodajalci', 'Sellers')}</Text>
              <Text size="xs" c="dimmed" mb="xs">
                {t('Drobiž: koliko gotovine za vračilo prinese. Cene: katere cene sme uporabiti (skrbniki bendov smejo vse in dajejo popuste).',
                  'Float: the change they bring. Prices: which prices they may use (band admins may use any and give discounts).')}
              </Text>
              <Stack gap="xs">
                {sellers.map((s, i) => (
                  <Group key={s.userId} wrap="wrap" align="flex-end" gap="xs">
                    <Text w={140} fw={700} truncate>{userName(s.userId)}</Text>
                    <NumberInput {...euroInputProps} w={110} label={t('Drobiž', 'Float')} value={toEuros(s.floatCents)}
                      onChange={(v) => setSellers(sellers.map((x, j) => (j === i ? { ...x, floatCents: fromEuros(v) ?? 0 } : x)))} />
                    <MultiSelect style={{ flex: 1, minWidth: 200 }} label={t('Cene', 'Prices')}
                      data={(tiers.data ?? []).map((tier) => ({ value: tier.id, label: tierName(tier.id), disabled: tier.id === 'full' }))}
                      value={s.tiers} onChange={(v) => setSellers(sellers.map((x, j) => (j === i ? { ...x, tiers: [...new Set(['full', ...v])] } : x)))} />
                    <ActionIcon variant="default" size="lg" onClick={() => setSellers(sellers.filter((_, j) => j !== i))} aria-label={t('Odstrani', 'Remove')}><IconTrash size={16} /></ActionIcon>
                  </Group>
                ))}
                <Select
                  placeholder={t('Dodaj prodajalca', 'Add a seller')}
                  data={userOptions.filter((u) => !sellers.some((s) => s.userId === u.value))}
                  value={null}
                  searchable
                  onChange={(v) => v && setSellers([...sellers, { userId: v, floatCents: 0, tiers: ['full'] }])}
                />
              </Stack>
            </div>
            <div>
              <Text fw={500} size="sm" mb={4}>{t('Cene samo za ta dogodek', 'Prices for this event only')}</Text>
              <Stack gap="xs">
                {prices.map((p, i) => (
                  <Group key={`${p.productId}|${p.tierId}`} gap="xs" wrap="nowrap">
                    <Text style={{ flex: 1 }} truncate>{productTitle(products.data?.find((x) => x.id === p.productId))} · {tierName(p.tierId)}</Text>
                    <NumberInput {...euroInputProps} w={110} value={toEuros(p.priceCents)}
                      onChange={(v) => setPrices(prices.map((x, j) => (j === i ? { ...x, priceCents: fromEuros(v) ?? 0 } : x)))} />
                    <ActionIcon variant="default" size="lg" onClick={() => setPrices(prices.filter((_, j) => j !== i))} aria-label={t('Odstrani', 'Remove')}><IconTrash size={16} /></ActionIcon>
                  </Group>
                ))}
                <AddPrice onAdd={(p) => setPrices([...prices.filter((x) => !(x.productId === p.productId && x.tierId === p.tierId)), p])} />
              </Stack>
            </div>
            {editable && (
              <Group>
                <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!name || !locationId || sellers.length === 0}>
                  {isNew ? t('Ustvari stojnico', 'Create stand') : t('Shrani', 'Save')}
                </Button>
              </Group>
            )}
          </Stack>
        </fieldset>
      </Card>

      {!isNew && detail.data && <StandSales standId={standId} canVoid={detail.data.canManage} ownerName={ownerName} eur={eur} />}
    </>
  )
}

function AddPrice ({ onAdd }: { onAdd: (p: StandPrice) => void }) {
  const t = useT()
  const products = useProducts()
  const tiers = useTiers()
  const tierName = useTierName()
  const title = useProductTitle()
  const [productId, setProductId] = useState<string | null>(null)
  const [tierId, setTierId] = useState<string | null>('full')
  const [price, setPrice] = useState<number | string>('')
  return (
    <Group gap="xs" align="flex-end" wrap="wrap">
      <Select style={{ flex: 2, minWidth: 180 }} placeholder={t('Izdelek', 'Product')} searchable value={productId} onChange={setProductId}
        data={(products.data ?? []).map((p) => ({ value: p.id, label: title(p) }))} />
      <Select w={150} value={tierId} onChange={setTierId} data={(tiers.data ?? []).map((tier) => ({ value: tier.id, label: tierName(tier.id) }))} />
      <NumberInput {...euroInputProps} w={110} value={price} onChange={setPrice} />
      <Button variant="default" disabled={!productId || !tierId || price === ''} onClick={() => {
        onAdd({ productId: productId!, tierId: tierId!, priceCents: fromEuros(price) ?? 0 })
        setProductId(null); setPrice('')
      }}>{t('Dodaj', 'Add')}</Button>
    </Group>
  )
}

function StandSummaryCards ({ detail }: { detail: StandDetail }) {
  const t = useT()
  const eur = useEur()
  const locale = useLocale()
  const me = useMe()
  const toast = useToast()
  const qc = useQueryClient()
  const ownerName = useOwnerName()
  const mine = detail.sellers.find((s) => s.userId === me.id)
  const [counted, setCounted] = useState<number | string>('')
  const count = useMutation({
    mutationFn: () => api.post(`/api/stands/${detail.id}/cash`, { countedCashCents: fromEuros(counted) ?? 0 }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['stand', detail.id] }); toast.ok(t('Shranjeno.', 'Saved.')) },
    onError: toast.error
  })
  const total = detail.totals.reduce((s, x) => s + x.cents, 0)
  return (
    <SimpleGrid cols={{ base: 1, md: 3 }}>
      <Card>
        <Title order={4} mb="xs">{t('Prodano', 'Sold')} · {eur(total)}</Title>
        {detail.totals.map((x) => (
          <Group key={x.ownerId} justify="space-between"><Text>{ownerName(x.ownerId)}</Text><Text className="num">{eur(x.cents)}</Text></Group>
        ))}
        {detail.totals.length === 0 && <Text c="dimmed" size="sm">{t('Še nič.', 'Nothing yet.')}</Text>}
      </Card>
      <Card>
        <Title order={4} mb="xs">{t('Po načinu plačila', 'By payment method')}</Title>
        {detail.byMethod.map((x) => (
          <Group key={x.method} justify="space-between"><Text>{pick(METHOD[x.method], locale)}</Text><Text className="num">{eur(x.cents)}</Text></Group>
        ))}
      </Card>
      <Card>
        <Title order={4} mb="xs">{t('Gotovina ob zaprtju', 'Cash at closing')}</Title>
        <Text size="xs" c="dimmed" mb="xs">{t('Pričakovano = drobiž + prodaja za gotovino.', 'Expected = float + cash sales.')}</Text>
        {detail.sellers.map((s) => {
          const diff = s.countedCashCents === null ? null : s.countedCashCents - s.expectedCashCents
          return (
            <Group key={s.userId} justify="space-between" wrap="nowrap">
              <Text size="sm" truncate>{s.name}</Text>
              <Text size="sm" className="num">
                {eur(s.expectedCashCents)}
                {diff !== null && <Text span c={diff === 0 ? 'flyer.8' : 'red'}> · {t('prešteto', 'counted')} {eur(s.countedCashCents!)}</Text>}
              </Text>
            </Group>
          )
        })}
        {mine && (
          <Group mt="sm" gap="xs" align="flex-end" wrap="nowrap">
            <NumberInput {...euroInputProps} style={{ flex: 1 }} label={t('Moja gotovina', 'My cash')} value={counted} onChange={setCounted} />
            <Button variant="default" onClick={() => count.mutate()} disabled={counted === ''} loading={count.isPending}>{t('Vpiši', 'Save')}</Button>
          </Group>
        )}
        <Button component={Link} to={`/stock?location=${detail.locationId}`} variant="subtle" size="xs" mt="xs" px={0}>
          {t('Preštej škatlo →', 'Count the box →')}
        </Button>
      </Card>
    </SimpleGrid>
  )
}

function StandSales ({ standId, canVoid, ownerName, eur }: { standId: string, canVoid: boolean, ownerName: (id: string) => string, eur: (c: number) => string }) {
  const t = useT()
  const locale = useLocale()
  const toast = useToast()
  const qc = useQueryClient()
  const sales = useQuery({ queryKey: ['sales', standId], queryFn: () => api.get<Sale[]>(`/api/sales?standId=${standId}`) })
  const voidSale = useMutation({
    mutationFn: (id: string) => api.post(`/api/sales/${id}/void`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['sales', standId] })
      await qc.invalidateQueries({ queryKey: ['stand', standId] })
      toast.ok(t('Razveljavljeno.', 'Undone.'))
    },
    onError: toast.error
  })
  return (
    <Card mt="md">
      <Title order={4} mb="xs">{t('Vse prodaje', 'All sales')}</Title>
      {sales.data?.length === 0 && <Text c="dimmed" size="sm">{t('Še ni oddanih prodaj.', 'No uploaded sales yet.')}</Text>}
      {(sales.data ?? []).some((s) => s.flags.length && !s.voided) && (
        <Alert color="orange" mb="sm">{t('Nekatere prodaje imajo opozorilo. Preveri jih.', 'Some sales are flagged. Check them.')}</Alert>
      )}
      <Table.ScrollContainer minWidth={600}>
        <Table>
          <Table.Tbody>
            {(sales.data ?? []).map((s) => (
              <Table.Tr key={s.id} opacity={s.voided ? 0.5 : 1}>
                <Table.Td>{formatDate(s.soldAt, locale, true)}</Table.Td>
                <Table.Td>
                  {s.items.map((i) => (
                    <Text key={`${i.productId}${i.size}${i.tierId}`} size="sm">
                      {i.qty}× {i.title}{i.size ? ` ${i.size}` : ''} <Text span c="dimmed">({ownerName(i.ownerId)}{i.discountCents ? `, −${eur(i.discountCents)} ${i.reason ?? ''}` : ''})</Text>
                    </Text>
                  ))}
                  {s.flags.map((f) => <Badge key={f} color="orange" size="xs" mr={4}>{pick(FLAG[f], locale, f)}</Badge>)}
                </Table.Td>
                <Table.Td>{s.guardianName ? `${s.guardianName} (${t('varuh', 'guardian')}), ` : ''}{s.sellerName}{s.receiverId !== s.sellerId ? ` → ${s.receiverName}` : ''}</Table.Td>
                <Table.Td>{pick(METHOD[s.method], locale)}</Table.Td>
                <Table.Td className="num">{eur(s.totalCents)}</Table.Td>
                <Table.Td>
                  {canVoid && !s.voided && (
                    <ActionIcon variant="subtle" color="gray" onClick={() => { if (window.confirm(t('Razveljavim to prodajo?', 'Undo this sale?'))) voidSale.mutate(s.id) }} aria-label={t('Razveljavi', 'Undo')}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  )
}
