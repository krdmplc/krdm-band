import {
  Badge, Button, Group, Modal, NumberInput, Select, SimpleGrid, Stack, Switch, Table, Tabs, Text, TextInput
} from '@mantine/core'
import { IconArrowsExchange, IconListCheck, IconPackageImport, IconPlus } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { Location, Pot, Product, StockEntry, StockRow } from '../../shared/types'
import { api } from '../api'
import { STOCK_TYPE, formatDate, pick, useEur, useLocale, useT } from '../i18n'
import { canAdmin, isAnyAdmin, useMe } from '../session'
import {
  ErrorNote, PageHeader, euroInputProps, fromEuros, sizeLabel, useLocations, useOwnerName, useProductTitle, useProducts, useToast, useUsers
} from '../ui'

export function Stock () {
  const t = useT()
  const me = useMe()
  const [params, setParams] = useSearchParams()
  const locations = useLocations()
  const active = (locations.data ?? []).filter((l) => !l.archived)
  const locationId = params.get('location') ?? active[0]?.id ?? null
  const [modal, setModal] = useState<'receive' | 'move' | 'count' | null>(null)
  const admin = isAnyAdmin(me)

  return (
    <>
      <PageHeader title={t('Zaloga', 'Stock')} sub={t('Kje je kaj. Vsaka sprememba je zapisana v zgodovini.', 'What is where. Every change is kept in the history.')} />
      <Tabs defaultValue="stock" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="stock">{t('Zaloga', 'Stock')}</Tabs.Tab>
          <Tabs.Tab value="history">{t('Zgodovina', 'History')}</Tabs.Tab>
          <Tabs.Tab value="locations">{t('Lokacije', 'Locations')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="stock">
          <Group mb="md" justify="space-between" wrap="wrap">
            <Select value={locationId} onChange={(v) => v && setParams({ location: v })} allowDeselect={false} w={260}
              data={active.map((l) => ({ value: l.id, label: l.name }))} aria-label={t('Lokacija', 'Location')} />
            <Group gap="xs">
              {admin && <Button leftSection={<IconPackageImport size={16} />} onClick={() => setModal('receive')}>{t('Prejem', 'Receive')}</Button>}
              <Button variant="default" leftSection={<IconArrowsExchange size={16} />} onClick={() => setModal('move')} disabled={!locationId}>{t('Premakni', 'Move')}</Button>
              <Button variant="default" leftSection={<IconListCheck size={16} />} onClick={() => setModal('count')} disabled={!locationId}>{t('Preštej', 'Count')}</Button>
            </Group>
          </Group>
          {locationId && <LocationStock locationId={locationId} />}
        </Tabs.Panel>
        <Tabs.Panel value="history">{locationId && <History locationId={locationId} />}</Tabs.Panel>
        <Tabs.Panel value="locations"><Locations /></Tabs.Panel>
      </Tabs>
      {modal === 'receive' && <ReceiveModal locationId={locationId} onClose={() => setModal(null)} />}
      {modal === 'move' && locationId && <MoveModal fromId={locationId} onClose={() => setModal(null)} />}
      {modal === 'count' && locationId && <CountModal locationId={locationId} onClose={() => setModal(null)} />}
    </>
  )
}

const useStockAt = (locationId: string) =>
  useQuery({ queryKey: ['stock', 'location', locationId], queryFn: () => api.get<StockRow[]>(`/api/stock?locationId=${locationId}`) })

function useInvalidateStock () {
  const qc = useQueryClient()
  return async () => {
    await qc.invalidateQueries({ queryKey: ['stock'] })
    await qc.invalidateQueries({ queryKey: ['products'] })
    await qc.invalidateQueries({ queryKey: ['locations'] })
    await qc.invalidateQueries({ queryKey: ['entries'] })
  }
}

function LocationStock ({ locationId }: { locationId: string }) {
  const t = useT()
  const stock = useStockAt(locationId)
  const products = useProducts()
  const title = useProductTitle()
  const ownerName = useOwnerName()
  const rows = (stock.data ?? []).map((r) => ({ ...r, product: products.data?.find((p) => p.id === r.productId) }))
    .sort((a, b) => (a.product?.ownerId ?? '').localeCompare(b.product?.ownerId ?? '') || title(a.product).localeCompare(title(b.product)))
  return (
    <>
      <ErrorNote error={stock.error} />
      {stock.data?.length === 0 && <Text c="dimmed">{t('Tukaj ni ničesar.', 'Nothing here.')}</Text>}
      <Table.ScrollContainer minWidth={400}>
        <Table verticalSpacing={4}>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={`${r.productId}|${r.size}`}>
                <Table.Td>{title(r.product)}</Table.Td>
                <Table.Td c="dimmed">{ownerName(r.product?.ownerId)}</Table.Td>
                <Table.Td>{sizeLabel(r.size)}</Table.Td>
                <Table.Td className="num" fw={700} c={r.qty < 0 ? 'red' : undefined}>{r.qty}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </>
  )
}

function History ({ locationId }: { locationId: string }) {
  const t = useT()
  const eur = useEur()
  const locale = useLocale()
  const products = useProducts()
  const title = useProductTitle()
  const entries = useQuery({ queryKey: ['entries', locationId], queryFn: () => api.get<StockEntry[]>(`/api/stock/entries?locationId=${locationId}`) })
  return (
    <Table.ScrollContainer minWidth={600}>
      <Table verticalSpacing={4}>
        <Table.Tbody>
          {(entries.data ?? []).map((e) => (
            <Table.Tr key={e.id}>
              <Table.Td>{formatDate(e.createdAt, locale, true)}</Table.Td>
              <Table.Td><Badge variant="light" color="gray">{pick(STOCK_TYPE[e.type], locale, e.type)}</Badge></Table.Td>
              <Table.Td>{title(products.data?.find((p) => p.id === e.productId))} {e.size}</Table.Td>
              <Table.Td className="num" c={e.qty < 0 ? 'red' : undefined}>{e.qty > 0 ? `+${e.qty}` : e.qty}</Table.Td>
              <Table.Td c="dimmed">{e.unitCostCents !== null ? t(`à ${eur(e.unitCostCents)}`, `at ${eur(e.unitCostCents)}`) : ''} {e.note}</Table.Td>
              <Table.Td c="dimmed">{e.createdByName}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

// A print run arriving: quantities per size, the cost per piece, and who paid.
function ReceiveModal ({ locationId, onClose }: { locationId: string | null, onClose: () => void }) {
  const t = useT()
  const me = useMe()
  const toast = useToast()
  const invalidate = useInvalidateStock()
  const products = useProducts()
  const locations = useLocations()
  const title = useProductTitle()
  const pots = useQuery({ queryKey: ['pots'], queryFn: () => api.get<Pot[]>('/api/money/pots') })
  const [productId, setProductId] = useState<string | null>(null)
  const [locId, setLocId] = useState<string | null>(locationId)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [cost, setCost] = useState<number | string>('')
  const [potId, setPotId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const product = products.data?.find((p) => p.id === productId)
  const ownerPots = (pots.data ?? []).filter((p) => p.ownerId === product?.ownerId)
  const total = Object.values(qty).reduce((a, b) => a + b, 0)
  const receive = useMutation({
    mutationFn: () => api.post('/api/stock/receive', {
      productId, locationId: locId, unitCostCents: fromEuros(cost), paidFromPot: potId, note: note || null,
      items: Object.entries(qty).filter(([, n]) => n > 0).map(([size, n]) => ({ size, qty: n }))
    }),
    onSuccess: async () => { await invalidate(); toast.ok(t('Zapisano.', 'Recorded.')); onClose() }
  })
  return (
    <Modal opened onClose={onClose} title={t('Prejem (nov tisk, dobava)', 'Receive (a new print run, a delivery)')} size="lg">
      <Stack>
        <Select label={t('Izdelek', 'Product')} searchable value={productId} onChange={(v) => { setProductId(v); setQty({}); setPotId(null) }}
          data={(products.data ?? []).filter((p) => canAdmin(me, p.ownerId)).map((p) => ({ value: p.id, label: title(p) }))} />
        <Select label={t('Kam', 'Where to')} value={locId} onChange={setLocId} allowDeselect={false}
          data={(locations.data ?? []).filter((l) => !l.archived).map((l) => ({ value: l.id, label: l.name }))} />
        {product && (
          <SimpleGrid cols={{ base: 3, sm: 6 }}>
            {product.sizes.map((s) => (
              <NumberInput key={s} label={sizeLabel(s)} min={0} value={qty[s] ?? ''} onChange={(v) => setQty({ ...qty, [s]: Number(v) || 0 })} />
            ))}
          </SimpleGrid>
        )}
        <SimpleGrid cols={2}>
          <NumberInput {...euroInputProps} label={t('Cena na kos', 'Cost per piece')} value={cost} onChange={setCost} />
          <Select label={t('Plačano iz', 'Paid from')} clearable placeholder={t('ni zapisano', 'not recorded')} value={potId} onChange={setPotId}
            data={ownerPots.map((p) => ({ value: p.id, label: p.kind === 'stash' ? p.name ?? '' : p.holderName ?? '' }))} />
        </SimpleGrid>
        <TextInput label={t('Opomba', 'Note')} value={note} onChange={(e) => setNote(e.currentTarget.value)} placeholder={t('npr. tiskarna, 2. tisk', 'e.g. printer, 2nd run')} />
        <ErrorNote error={receive.error} />
        <Button onClick={() => receive.mutate()} loading={receive.isPending} disabled={!productId || !locId || total === 0}>
          {t(`Zapiši ${total} kos`, `Record ${total} pcs`)}
        </Button>
      </Stack>
    </Modal>
  )
}

function variantKey (productId: string, size: string) { return `${productId}|${size}` }

// Packing a box, unpacking it, or handing stock to someone else's location.
function MoveModal ({ fromId, onClose }: { fromId: string, onClose: () => void }) {
  const t = useT()
  const toast = useToast()
  const invalidate = useInvalidateStock()
  const locations = useLocations()
  const products = useProducts()
  const title = useProductTitle()
  const stock = useStockAt(fromId)
  const [toId, setToId] = useState<string | null>(null)
  const [qty, setQty] = useState<Record<string, number>>({})
  const rows = (stock.data ?? []).filter((r) => r.qty > 0)
  const move = useMutation({
    mutationFn: () => api.post('/api/stock/move', {
      fromId, toId,
      items: rows.filter((r) => (qty[variantKey(r.productId, r.size)] ?? 0) > 0)
        .map((r) => ({ productId: r.productId, size: r.size, qty: qty[variantKey(r.productId, r.size)] }))
    }),
    onSuccess: async () => { await invalidate(); toast.ok(t('Premaknjeno.', 'Moved.')); onClose() }
  })
  const from = locations.data?.find((l) => l.id === fromId)
  return (
    <Modal opened onClose={onClose} title={t(`Premakni iz: ${from?.name ?? ''}`, `Move from: ${from?.name ?? ''}`)} size="lg">
      <Stack>
        <Select label={t('Kam', 'Where to')} value={toId} onChange={setToId}
          data={(locations.data ?? []).filter((l) => !l.archived && l.id !== fromId).map((l) => ({ value: l.id, label: l.name }))} />
        <Group gap="xs">
          <Button size="xs" variant="default" onClick={() => setQty(Object.fromEntries(rows.map((r) => [variantKey(r.productId, r.size), r.qty])))}>{t('Vse', 'All')}</Button>
          <Button size="xs" variant="default" onClick={() => setQty({})}>{t('Nič', 'None')}</Button>
        </Group>
        <Table verticalSpacing={2}>
          <Table.Tbody>
            {rows.map((r) => {
              const key = variantKey(r.productId, r.size)
              return (
                <Table.Tr key={key}>
                  <Table.Td>{title(products.data?.find((p) => p.id === r.productId))} {r.size}</Table.Td>
                  <Table.Td c="dimmed" className="num">/ {r.qty}</Table.Td>
                  <Table.Td w={100}><NumberInput size="xs" min={0} max={r.qty} value={qty[key] ?? ''} onChange={(v) => setQty({ ...qty, [key]: Number(v) || 0 })} /></Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
        <ErrorNote error={move.error} />
        <Button onClick={() => move.mutate()} loading={move.isPending} disabled={!toId || Object.values(qty).every((n) => !n)}>{t('Premakni', 'Move')}</Button>
      </Stack>
    </Modal>
  )
}

// What is really there. Prefilled with what the app thinks; only differences are recorded.
function CountModal ({ locationId, onClose }: { locationId: string, onClose: () => void }) {
  const t = useT()
  const toast = useToast()
  const invalidate = useInvalidateStock()
  const products = useProducts()
  const title = useProductTitle()
  const stock = useStockAt(locationId)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [extra, setExtra] = useState<string[]>([])
  useEffect(() => {
    if (stock.data) setCounts(Object.fromEntries(stock.data.map((r) => [variantKey(r.productId, r.size), r.qty])))
  }, [stock.data])
  const keys = useMemo(() => [...new Set([...(stock.data ?? []).map((r) => variantKey(r.productId, r.size)), ...extra])], [stock.data, extra])
  const variants = (products.data ?? []).flatMap((p: Product) => p.sizes.map((s) => ({ value: variantKey(p.id, s), label: `${title(p)} ${s}` })))
  const count = useMutation({
    mutationFn: () => api.post<{ changed: number }>('/api/stock/count', {
      locationId,
      items: keys.map((k) => { const [productId, size] = k.split('|'); return { productId, size, qty: Math.max(0, counts[k] ?? 0) } })
    }),
    onSuccess: async (r) => { await invalidate(); toast.ok(t(`Shranjeno (${r.changed} sprememb).`, `Saved (${r.changed} changes).`)); onClose() }
  })
  return (
    <Modal opened onClose={onClose} title={t('Štetje', 'Count')} size="lg">
      <Stack>
        <Table verticalSpacing={2}>
          <Table.Tbody>
            {keys.map((k) => {
              const [productId, size] = k.split('|')
              return (
                <Table.Tr key={k}>
                  <Table.Td>{title(products.data?.find((p) => p.id === productId))} {size}</Table.Td>
                  <Table.Td w={100}><NumberInput size="xs" min={0} value={counts[k] ?? 0} onChange={(v) => setCounts({ ...counts, [k]: Number(v) || 0 })} /></Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
        <Select placeholder={t('Dodaj izdelek, ki ga app tu ne pozna', "Add a product the app doesn't know is here")} searchable value={null}
          data={variants.filter((v) => !keys.includes(v.value))} onChange={(v) => v && setExtra([...extra, v])} />
        <ErrorNote error={count.error} />
        <Button onClick={() => count.mutate()} loading={count.isPending}>{t('Shrani štetje', 'Save the count')}</Button>
      </Stack>
    </Modal>
  )
}

function Locations () {
  const t = useT()
  const me = useMe()
  const locations = useLocations()
  const [editing, setEditing] = useState<Location | 'new' | null>(null)
  return (
    <>
      <Group justify="space-between" mb="sm">
        <Text c="dimmed" size="sm">{t('Domača zaloga, skladišče, škatle za koncerte. Zaloga lokacij »za splet« se prodaja na spletni strani.',
          'Home stock, storage, gig boxes. Stock in "online" locations is sold on the website.')}</Text>
        {isAnyAdmin(me) && <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>{t('Nova lokacija', 'New location')}</Button>}
      </Group>
      <Table highlightOnHover>
        <Table.Tbody>
          {(locations.data ?? []).map((l) => (
            <Table.Tr key={l.id} opacity={l.archived ? 0.5 : 1} onClick={() => (me.isLabelAdmin || l.keeperId === me.id) && setEditing(l)} style={{ cursor: 'pointer' }}>
              <Table.Td fw={700}>{l.name}</Table.Td>
              <Table.Td>{l.keeperName ?? '–'}</Table.Td>
              <Table.Td>{l.online && <Badge variant="light">{t('za splet', 'online')}</Badge>}</Table.Td>
              <Table.Td className="num">{t(`${l.pieces} kos`, `${l.pieces} pcs`)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {editing && <LocationModal location={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function LocationModal ({ location, onClose }: { location: Location | null, onClose: () => void }) {
  const t = useT()
  const toast = useToast()
  const qc = useQueryClient()
  const users = useUsers()
  const [name, setName] = useState(location?.name ?? '')
  const [keeperId, setKeeperId] = useState<string | null>(location?.keeperId ?? null)
  const [online, setOnline] = useState(location?.online ?? false)
  const [archived, setArchived] = useState(location?.archived ?? false)
  const save = useMutation({
    mutationFn: () => {
      const body = { name, keeperId, online, archived }
      return location ? api.put(`/api/locations/${location.id}`, body) : api.post('/api/locations', body)
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['locations'] }); toast.ok(t('Shranjeno.', 'Saved.')); onClose() }
  })
  return (
    <Modal opened onClose={onClose} title={location ? location.name : t('Nova lokacija', 'New location')}>
      <Stack>
        <TextInput label={t('Ime', 'Name')} required value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder={t('npr. Doma pri Klemnu, Škatla A', "e.g. Klemen's place, Box A")} />
        <Select label={t('Kdo jo ima', 'Who keeps it')} clearable value={keeperId} onChange={setKeeperId}
          data={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))} />
        <Switch label={t('Za splet: to zalogo prodajamo na spletni strani', 'Online: this stock is sold on the website')} checked={online} onChange={(e) => setOnline(e.currentTarget.checked)} />
        {location && <Switch label={t('Arhivirano', 'Archived')} checked={archived} onChange={(e) => setArchived(e.currentTarget.checked)} />}
        <ErrorNote error={save.error} />
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name}>{t('Shrani', 'Save')}</Button>
      </Stack>
    </Modal>
  )
}
