import {
  ActionIcon, Alert, Badge, Box, Button, Card, Center, Checkbox, Chip, Divider, Drawer, Grid, Group, Loader, Modal, NumberInput,
  SegmentedControl, Select, SimpleGrid, Stack, Text, TextInput, Title, UnstyledButton
} from '@mantine/core'
import { useMediaQuery, useNetwork } from '@mantine/hooks'
import { IconGift, IconMinus, IconPhoto, IconPlus, IconRefresh, IconSettings, IconTrash } from '@tabler/icons-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { PayMethod, SaleInput } from '../../shared/types'
import { ApiError, api, imageUrl } from '../api'
import { UpnQr } from '../components/UpnQr'
import { METHOD, formatDate, pick, useEur, useLocale, useT } from '../i18n'
import { type OutboxSale, type StoredSnapshot, db, deviceId, prepareStand, recordSale, remainingStock } from '../offline'
import { useMe } from '../session'
import { euroInputProps, fromEuros, sizeColor, sizeLabel, toEuros, useToast } from '../ui'

type SnapProduct = StoredSnapshot['products'][number]

interface CartLine {
  key: string
  productId: string
  size: string
  qty: number
  tierId: string
  discountCents: number
  reason: string
}

// Selling at a stand. Works entirely from the snapshot stored on this phone, so a
// lost connection changes nothing; sales go to the outbox (offline.ts).
export function Pos () {
  const { standId = '' } = useParams()
  const t = useT()
  const eur = useEur()
  const locale = useLocale()
  const me = useMe()
  const toast = useToast()
  const { online } = useNetwork()
  const wide = useMediaQuery('(min-width: 62em)')
  const snapshot = useLiveQuery(async () => (await db.snapshots.get(standId)) ?? null, [standId])
  const sales = useLiveQuery(() => db.outbox.where('standId').equals(standId).toArray(), [standId], [] as OutboxSale[])
  const [refreshing, setRefreshing] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])
  const [picking, setPicking] = useState<SnapProduct | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [paying, setPaying] = useState(false)
  const [ownerFilter, setOwnerFilter] = useState<string>('all')
  // Cart lines whose discount fields are open (admins only).
  const [discounting, setDiscounting] = useState<Set<string>>(new Set())

  const refresh = async (quiet: boolean) => {
    setRefreshing(true)
    try {
      await prepareStand(standId)
      if (!quiet) toast.ok(t('Osveženo.', 'Refreshed.'))
    } catch (e) {
      if (!quiet) toast.error(e)
    } finally {
      setRefreshing(false)
    }
  }

  // Fresh stock and prices whenever there is a connection.
  useEffect(() => {
    if (!online) return
    void refresh(true)
    const timer = window.setInterval(() => { void refresh(true) }, 120_000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, standId])

  const left = useMemo(() => (snapshot ? remainingStock(snapshot, sales) : new Map<string, number>()), [snapshot, sales])

  if (snapshot === undefined) return <Center p="xl"><Loader /></Center>
  if (snapshot === null) {
    return (
      <Stack>
        <Alert color="yellow">{t('Ta stojnica na tem telefonu še ni pripravljena.', "This stand isn't prepared on this phone yet.")}</Alert>
        <Button onClick={() => void refresh(false)} loading={refreshing} disabled={!online}>{t('Pripravi zdaj', 'Prepare now')}</Button>
      </Stack>
    )
  }

  const product = (id: string) => snapshot.products.find((p) => p.id === id)
  const title = (p: SnapProduct | undefined) => (p ? (locale === 'en' && p.titleEn) || p.titleSl : '')
  const ownerName = (id: string) => snapshot.owners.find((o) => o.id === id)?.name ?? id
  const tierName = (id: string) => {
    const tier = snapshot.tiers.find((x) => x.id === id)
    return tier ? (locale === 'en' ? tier.nameEn : tier.nameSl) : id
  }
  const manages = (ownerId: string) => snapshot.stand.canManage || snapshot.me.adminOf.includes(ownerId)
  const tiersFor = (p: SnapProduct) => snapshot.tiers
    .filter((tier) => p.prices[tier.id] !== undefined && (manages(p.ownerId) || snapshot.me.tiers.includes(tier.id)))
    .map((tier) => tier.id)
  const unitPrice = (line: CartLine) => product(line.productId)?.prices[line.tierId] ?? 0
  const lineTotal = (line: CartLine) => Math.max(0, line.qty * unitPrice(line) - line.discountCents)
  const total = cart.reduce((sum, l) => sum + lineTotal(l), 0)
  const count = cart.reduce((sum, l) => sum + l.qty, 0)

  const add = (p: SnapProduct, size: string) => {
    setCart((c) => {
      const same = c.find((l) => l.productId === p.id && l.size === size && l.tierId === 'full' && l.discountCents === 0)
      if (same) return c.map((l) => (l === same ? { ...l, qty: l.qty + 1 } : l))
      return [...c, { key: crypto.randomUUID(), productId: p.id, size, qty: 1, tierId: 'full', discountCents: 0, reason: '' }]
    })
    setPicking(null)
  }
  const update = (key: string, patch: Partial<CartLine>) => setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)).filter((l) => l.qty > 0))

  const owners = [...new Set(snapshot.products.map((p) => p.ownerId))]
  const shown = snapshot.products.filter((p) => ownerFilter === 'all' || p.ownerId === ownerFilter)

  const cartPanel = (
    <Stack gap="sm">
      {cart.length === 0 && <Text c="dimmed" size="sm">{t('Košarica je prazna. Tapni izdelek.', 'The cart is empty. Tap a product.')}</Text>}
      {cart.map((line) => {
        const p = product(line.productId)
        const tiers = p ? tiersFor(p) : ['full']
        return (
          <Box key={line.key} pb="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <div>
                <Text fw={700} size="sm">{title(p)}{line.size ? ` · ${line.size}` : ''}</Text>
                <Text size="xs" c="dimmed">{ownerName(p?.ownerId ?? '')}</Text>
              </div>
              <Text fw={700} className="num">{eur(lineTotal(line))}</Text>
            </Group>
            <Group gap="xs" mt={6} wrap="nowrap">
              <ActionIcon variant="default" onClick={() => update(line.key, { qty: line.qty - 1 })} aria-label={t('Manj', 'Fewer')}>
                {line.qty === 1 ? <IconTrash size={14} /> : <IconMinus size={14} />}
              </ActionIcon>
              <Text w={24} ta="center" fw={700}>{line.qty}</Text>
              <ActionIcon variant="default" onClick={() => update(line.key, { qty: line.qty + 1 })} aria-label={t('Več', 'More')}><IconPlus size={14} /></ActionIcon>
              {tiers.length > 1 && (
                <Select
                  size="xs"
                  style={{ flex: 1 }}
                  data={tiers.map((id) => ({ value: id, label: `${tierName(id)} · ${eur(p?.prices[id] ?? 0)}` }))}
                  value={line.tierId}
                  onChange={(v) => v && update(line.key, { tierId: v })}
                  allowDeselect={false}
                  aria-label={t('Cena', 'Price')}
                />
              )}
            </Group>
            {p && manages(p.ownerId) && !line.discountCents && !discounting.has(line.key) && (
              <Button variant="subtle" size="compact-xs" mt={4} px={0} onClick={() => setDiscounting(new Set(discounting).add(line.key))}>
                {t('Popust ali gratis', 'Discount or free')}
              </Button>
            )}
            {p && manages(p.ownerId) && (line.discountCents > 0 || discounting.has(line.key)) && (
              <Group gap="xs" mt={6} wrap="nowrap" align="flex-end">
                <NumberInput
                  size="xs"
                  w={110}
                  {...euroInputProps}
                  label={t('Popust', 'Discount')}
                  value={toEuros(line.discountCents) || ''}
                  max={line.qty * unitPrice(line) / 100}
                  onChange={(v) => update(line.key, { discountCents: Math.min(fromEuros(v) ?? 0, line.qty * unitPrice(line)) })}
                />
                <TextInput size="xs" style={{ flex: 1 }} label={t('Razlog', 'Reason')} value={line.reason} onChange={(e) => update(line.key, { reason: e.currentTarget.value })} />
                <ActionIcon
                  variant="default"
                  size="lg"
                  onClick={() => update(line.key, { discountCents: line.qty * unitPrice(line), reason: line.reason || t('gratis', 'free') })}
                  aria-label={t('Gratis', 'Free')}
                  title={t('Gratis', 'Free')}
                >
                  <IconGift size={16} />
                </ActionIcon>
              </Group>
            )}
          </Box>
        )
      })}
      <Group justify="space-between">
        <Text fw={700}>{t('Skupaj', 'Total')}</Text>
        <Text fw={700} size="xl" className="num">{eur(total)}</Text>
      </Group>
      <Button size="lg" disabled={cart.length === 0} onClick={() => { setCartOpen(false); setPaying(true) }}>{t('Na plačilo', 'Checkout')}</Button>
    </Stack>
  )

  return (
    <>
      <Group justify="space-between" mb="sm" wrap="wrap">
        <div>
          <Title order={3}>{snapshot.stand.name}</Title>
          <Text size="xs" c="dimmed">
            {snapshot.stand.locationName} · {t('stanje', 'data')} {formatDate(snapshot.fetchedAt, locale, true)}
          </Text>
        </div>
        <Group gap="xs">
          <ActionIcon variant="default" size="lg" onClick={() => void refresh(false)} loading={refreshing} disabled={!online} aria-label={t('Osveži', 'Refresh')}>
            <IconRefresh size={18} />
          </ActionIcon>
          {snapshot.stand.canManage && (
            <ActionIcon variant="default" size="lg" component={Link} to={`/stands/${standId}`} aria-label={t('Stojnica', 'Stand')}>
              <IconSettings size={18} />
            </ActionIcon>
          )}
        </Group>
      </Group>

      {owners.length > 1 && (
        <Chip.Group value={ownerFilter} onChange={(v) => setOwnerFilter(v as string)}>
          <Group gap={6} mb="sm">
            <Chip value="all" size="sm">{t('Vse', 'All')}</Chip>
            {owners.map((o) => <Chip key={o} value={o} size="sm">{ownerName(o)}</Chip>)}
          </Group>
        </Chip.Group>
      )}

      <Grid gap="md">
        <Grid.Col span={{ base: 12, md: 8 }}>
          {snapshot.products.length === 0 && (
            <Alert color="yellow">{t('V škatli te stojnice ni izdelkov. Napolni jo na strani Zaloga.', "This stand's box is empty. Pack it on the Stock page.")}</Alert>
          )}
          <SimpleGrid cols={{ base: 2, xs: 3, lg: 4 }} spacing="xs">
            {shown.map((p) => {
              const pieces = p.sizes.reduce((sum, s) => sum + Math.max(0, left.get(`${p.id}|${s.size}`) ?? 0), 0)
              return (
                <UnstyledButton
                  key={p.id}
                  className="pos-tile"
                  data-empty={pieces === 0 || undefined}
                  onClick={() => (p.sizes.length === 1 && p.sizes[0].size === '' ? add(p, '') : setPicking(p))}
                >
                  {p.imageKey ? <img src={imageUrl(p.imageKey)} alt="" loading="lazy" /> : <div className="placeholder"><IconPhoto /></div>}
                  <Box p={8}>
                    <Text size="sm" fw={700} lineClamp={2}>{title(p)}</Text>
                    <Group justify="space-between" gap={4}>
                      <Text size="sm" className="num">{eur(p.prices.full ?? 0)}</Text>
                      <Text size="xs" c="dimmed">{t(`${pieces} kos`, `${pieces} pcs`)}</Text>
                    </Group>
                  </Box>
                </UnstyledButton>
              )
            })}
          </SimpleGrid>
        </Grid.Col>
        {wide && (
          <Grid.Col span={4}>
            <Card pos="sticky" top={72}>{cartPanel}</Card>
          </Grid.Col>
        )}
      </Grid>

      <RecentSales sales={sales} snapshot={snapshot} />

      {!wide && (
        <Box pos="fixed" bottom={0} left={0} right={0} p="sm" style={{ background: 'var(--mantine-color-body)', borderTop: '2px solid var(--mantine-color-default-border)', zIndex: 150 }}>
          <Button fullWidth size="lg" disabled={cart.length === 0} onClick={() => setCartOpen(true)}>
            {t(`Košarica (${count}) · ${eur(total)}`, `Cart (${count}) · ${eur(total)}`)}
          </Button>
        </Box>
      )}
      {!wide && <Box h={80} />}

      <Drawer opened={cartOpen} onClose={() => setCartOpen(false)} position="bottom" size="85%" title={t('Košarica', 'Cart')}>
        {cartPanel}
      </Drawer>

      <Modal opened={picking !== null} onClose={() => setPicking(null)} title={title(picking ?? undefined)} centered>
        {picking && (
          <SimpleGrid cols={3} spacing="xs">
            {picking.sizes.map((s) => {
              const n = left.get(`${picking.id}|${s.size}`) ?? 0
              return (
                <Button key={s.size} size="lg" variant={n > 0 ? 'filled' : 'default'} onClick={() => add(picking, s.size)} styles={{ label: { flexDirection: 'column' } }} h={64}
                  style={{ borderTop: `8px solid ${sizeColor(s.size) ?? 'transparent'}`, outline: sizeColor(s.size) ? '1px solid var(--mantine-color-default-border)' : undefined }}>
                  <span>{sizeLabel(s.size)}</span>
                  <Text span size="xs" fw={400}>{t(`${n} kos`, `${n} pcs`)}</Text>
                </Button>
              )
            })}
          </SimpleGrid>
        )}
      </Modal>

      <Checkout
        opened={paying}
        onClose={() => setPaying(false)}
        snapshot={snapshot}
        total={total}
        onDone={async (method, receiverId, guardianName) => {
          const sale: SaleInput = {
            id: crypto.randomUUID(),
            standId,
            method,
            receiverId,
            soldAt: new Date().toISOString(),
            deviceId: deviceId(),
            guardianName,
            items: cart.map((l) => ({
              productId: l.productId,
              size: l.size,
              qty: l.qty,
              tierId: l.tierId,
              unitPriceCents: unitPrice(l),
              discountCents: Math.min(l.discountCents, l.qty * unitPrice(l)),
              reason: l.reason.trim() || null
            }))
          }
          await recordSale(sale)
          setCart([])
          setPaying(false)
          toast.ok(t(`Prodano: ${eur(total)}`, `Sold: ${eur(total)}`))
        }}
        meId={me.id}
      />
    </>
  )
}

function Checkout ({ opened, onClose, snapshot, total, onDone, meId }: {
  opened: boolean
  onClose: () => void
  snapshot: StoredSnapshot
  total: number
  onDone: (method: PayMethod, receiverId: string, guardianName: string | null) => Promise<void>
  meId: string
}) {
  const t = useT()
  const eur = useEur()
  const locale = useLocale()
  const narrow = useMediaQuery('(max-width: 48em)')
  const [method, setMethod] = useState<PayMethod>('cash')
  const [receiverId, setReceiverId] = useState(meId)
  const [given, setGiven] = useState<number | string>('')
  const [saving, setSaving] = useState(false)
  // A sale a guardian made while the band played, entered from the tally sheet.
  const [byGuardian, setByGuardian] = useState(false)
  const [guardian, setGuardian] = useState('')
  useEffect(() => { if (opened) { setGiven(''); setReceiverId(meId); setByGuardian(false) } }, [opened, meId])

  const receiver = snapshot.sellers.find((s) => s.id === (method === 'cash' ? meId : receiverId))
  const givenCents = fromEuros(given)
  const change = givenCents !== null ? givenCents - total : null

  return (
    <Modal opened={opened} onClose={onClose} title={t('Plačilo', 'Payment')} fullScreen={narrow} centered>
      <Stack>
        <Text ta="center" size="2.4rem" fw={700} className="num">{eur(total)}</Text>
        <SegmentedControl
          fullWidth
          value={method}
          onChange={(v) => setMethod(v as PayMethod)}
          data={(['cash', 'flik', 'bank'] as const).map((m) => ({ value: m, label: pick(METHOD[m], locale) }))}
        />
        {method !== 'cash' && snapshot.sellers.length > 1 && (
          <Select
            label={t('Kdo dobi denar', 'Who gets the money')}
            data={snapshot.sellers.map((s) => ({ value: s.id, label: s.name }))}
            value={receiverId}
            onChange={(v) => v && setReceiverId(v)}
            allowDeselect={false}
          />
        )}
        {method === 'cash' && (
          <>
            <NumberInput {...euroInputProps} label={t('Kupec je dal', 'Customer gave')} value={given} onChange={setGiven} size="lg" />
            {change !== null && change >= 0 && <Text size="xl" fw={700}>{t('Vrni', 'Change')}: {eur(change)}</Text>}
            {change !== null && change < 0 && <Text c="red">{t(`Manjka še ${eur(-change)}`, `${eur(-change)} short`)}</Text>}
          </>
        )}
        {method === 'flik' && (
          receiver?.flikPhone
            ? <Card ta="center"><Text c="dimmed" size="sm">{t('Flik na številko', 'Flik to')}</Text><Text size="2rem" fw={700}>{receiver.flikPhone}</Text><Text>{receiver.name}</Text></Card>
            : <Alert color="yellow">{t('Prejemnik nima vpisane številke za Flik (Profil).', "The receiver hasn't entered a Flik number (Profile).")}</Alert>
        )}
        {method === 'bank' && receiver && total > 0 && (
          <UpnQr payment={{
            amountCents: total,
            purpose: `KRDM merch ${snapshot.stand.name}`.slice(0, 42),
            iban: receiver.iban ?? undefined,
            name: receiver.name,
            street: receiver.street ?? '',
            city: receiver.city ?? undefined
          }} />
        )}
        <Checkbox label={t('Prodaja varuha stojnice (vpis s seznama)', "A stand guardian's sale (from the tally sheet)")} checked={byGuardian} onChange={(e) => setByGuardian(e.currentTarget.checked)} />
        {byGuardian && <TextInput label={t('Ime varuha', "Guardian's name")} value={guardian} onChange={(e) => setGuardian(e.currentTarget.value)} />}
        <Divider />
        <Button size="lg" loading={saving} onClick={async () => {
          setSaving(true)
          try { await onDone(method, method === 'cash' ? meId : receiverId, byGuardian ? guardian.trim() || null : null) } finally { setSaving(false) }
        }}>
          {t('Plačano', 'Paid')}
        </Button>
      </Stack>
    </Modal>
  )
}

// This phone's sales at this stand, newest first, with their upload state.
function RecentSales ({ sales, snapshot }: { sales: OutboxSale[], snapshot: StoredSnapshot }) {
  const t = useT()
  const eur = useEur()
  const locale = useLocale()
  const toast = useToast()
  const { online } = useNetwork()
  const sorted = [...sales].sort((a, b) => b.soldAt.localeCompare(a.soldAt)).slice(0, 30)
  if (sorted.length === 0) return null
  const name = (id: string) => {
    const p = snapshot.products.find((x) => x.id === id)
    return p ? (locale === 'en' && p.titleEn) || p.titleSl : id
  }
  const undo = async (s: OutboxSale) => {
    if (!window.confirm(t('Razveljavim to prodajo?', 'Undo this sale?'))) return
    try {
      if (s.status === 'pending') await db.outbox.delete(s.id)
      else {
        await api.post(`/api/sales/${s.id}/void`)
        await db.outbox.update(s.id, { voided: true })
      }
      toast.ok(t('Razveljavljeno.', 'Undone.'))
    } catch (e) {
      toast.error(e instanceof ApiError ? e : new ApiError('server_error', 500))
    }
  }
  return (
    <Card mt="lg">
      <Title order={4} mb="xs">{t('Prodaje s tega telefona', 'Sales from this phone')}</Title>
      <Stack gap={6}>
        {sorted.map((s) => {
          const total = s.items.reduce((sum, i) => sum + i.qty * i.unitPriceCents - i.discountCents, 0)
          return (
            <Group key={s.id} justify="space-between" wrap="nowrap" opacity={s.voided ? 0.5 : 1}>
              <div style={{ minWidth: 0 }}>
                <Text size="sm" truncate>
                  {formatDate(s.soldAt, locale, true).split(' ').pop()} · {s.items.map((i) => `${i.qty}× ${name(i.productId)}${i.size ? ` ${i.size}` : ''}`).join(', ')}
                </Text>
                <Group gap={4}>
                  <Badge size="xs" variant="light" color="gray">{pick(METHOD[s.method], locale)}</Badge>
                  {s.voided && <Badge size="xs" color="gray">{t('razveljavljeno', 'undone')}</Badge>}
                  {!s.voided && s.status === 'pending' && <Badge size="xs" color="yellow">{t('čaka na oddajo', 'not uploaded')}</Badge>}
                  {!s.voided && s.status === 'rejected' && <Badge size="xs" color="red">{t('zavrnjeno', 'rejected')}</Badge>}
                  {s.flags?.length ? <Badge size="xs" color="orange">{t('opozorilo', 'flagged')}</Badge> : null}
                </Group>
              </div>
              <Group gap={6} wrap="nowrap">
                <Text size="sm" fw={700} className="num">{eur(total)}</Text>
                {!s.voided && (s.status === 'pending' || online) && (
                  <ActionIcon variant="subtle" color="gray" onClick={() => void undo(s)} aria-label={t('Razveljavi', 'Undo')}><IconTrash size={14} /></ActionIcon>
                )}
              </Group>
            </Group>
          )
        })}
      </Stack>
    </Card>
  )
}
