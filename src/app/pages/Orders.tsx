import {
  ActionIcon, Anchor, Badge, Button, Card, CopyButton, Group, Modal, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Table,
  Text, TextInput, Textarea, Title
} from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { Order, OrderStatus, PayMethod, ShippingMethod } from '../../shared/types'
import { api } from '../api'
import { UpnQr } from '../components/UpnQr'
import { METHOD, ORDER_STATUS, SHIPPING, formatDate, pick, useEur, useLocale, useT } from '../i18n'
import { useMe } from '../session'
import { ErrorNote, PageHeader, euroInputProps, fromEuros, sizeLabel, toEuros, useOwnerName, useProductTitle, useProducts, useToast, useUsers } from '../ui'

const STATUS_COLOR: Record<OrderStatus, string> = { new: 'red', awaiting_payment: 'yellow', paid: 'blue', shipped: 'gray', cancelled: 'gray' }

export function Orders () {
  const t = useT()
  const eur = useEur()
  const locale = useLocale()
  const [status, setStatus] = useState<string>('open')
  const [creating, setCreating] = useState(false)
  const orders = useQuery({ queryKey: ['orders', 'all'], queryFn: () => api.get<Order[]>('/api/orders') })
  const list = (orders.data ?? []).filter((o) => status === 'all' || (status === 'open' ? ['new', 'awaiting_payment', 'paid'].includes(o.status) : o.status === status))
  return (
    <>
      <PageHeader title={t('Naročila', 'Orders')}>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>{t('Vnesi naročilo', 'Enter an order')}</Button>
      </PageHeader>
      <SegmentedControl mb="md" value={status} onChange={setStatus} data={[
        { value: 'open', label: t('Odprta', 'Open') },
        { value: 'shipped', label: t('Poslana', 'Sent') },
        { value: 'cancelled', label: t('Preklicana', 'Cancelled') },
        { value: 'all', label: t('Vsa', 'All') }
      ]} />
      <ErrorNote error={orders.error} />
      <Table.ScrollContainer minWidth={600}>
        <Table highlightOnHover>
          <Table.Tbody>
            {list.map((o) => (
              <Table.Tr key={o.id}>
                <Table.Td><Link to={`/orders/${o.id}`}>{o.number}</Link></Table.Td>
                <Table.Td>{formatDate(o.createdAt, locale)}</Table.Td>
                <Table.Td>{o.customerName}</Table.Td>
                <Table.Td>{pick(SHIPPING[o.shippingMethod], locale)}</Table.Td>
                <Table.Td className="num">{eur(o.itemsCents + (o.shippingCents ?? 0))}</Table.Td>
                <Table.Td><Badge color={STATUS_COLOR[o.status]}>{pick(ORDER_STATUS[o.status], locale)}</Badge></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {list.length === 0 && <Text c="dimmed">{t('Ni naročil.', 'No orders.')}</Text>}
      {creating && <NewOrderModal onClose={() => setCreating(false)} />}
    </>
  )
}

interface CustomerForm { name: string, email: string, phone: string, street: string, postcode: string, city: string, country: string, note: string }
const blankCustomer: CustomerForm = { name: '', email: '', phone: '', street: '', postcode: '', city: '', country: '', note: '' }
const customerBody = (c: CustomerForm) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.trim() || null]))

function CustomerFields ({ value, onChange }: { value: CustomerForm, onChange: (c: CustomerForm) => void }) {
  const t = useT()
  const field = (key: keyof CustomerForm) => ({ value: value[key], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [key]: e.currentTarget.value }) })
  return (
    <Stack gap="xs">
      <TextInput label={t('Ime in priimek', 'Name')} required {...field('name')} />
      <SimpleGrid cols={2}>
        <TextInput label={t('E-naslov', 'Email')} type="email" {...field('email')} />
        <TextInput label={t('Telefon', 'Phone')} {...field('phone')} />
      </SimpleGrid>
      <TextInput label={t('Ulica in številka', 'Street')} {...field('street')} />
      <SimpleGrid cols={3}>
        <TextInput label={t('Pošta', 'Postcode')} {...field('postcode')} />
        <TextInput label={t('Kraj', 'City')} {...field('city')} />
        <TextInput label={t('Država', 'Country')} {...field('country')} />
      </SimpleGrid>
      <Textarea label={t('Opomba', 'Note')} autosize {...field('note')} />
    </Stack>
  )
}

// An order that came by DM or phone. Prices start at the full price and can be changed.
function NewOrderModal ({ onClose }: { onClose: () => void }) {
  const t = useT()
  const locale = useLocale()
  const toast = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const products = useProducts()
  const title = useProductTitle()
  const [customer, setCustomer] = useState<CustomerForm>(blankCustomer)
  const [shipping, setShipping] = useState<ShippingMethod>('pickup')
  const [shippingCost, setShippingCost] = useState<number | string>('')
  const [lines, setLines] = useState<{ productId: string, size: string, qty: number, price: number | string }[]>([])
  const variants = (products.data ?? []).flatMap((p) => p.sizes.map((s) => ({
    value: `${p.id}|${s}`, label: `${title(p)} ${s}`.trim(), disabled: (p.onlineStock[s] ?? 0) <= 0
  })))
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/orders', {
      customer: customerBody(customer),
      locale,
      shippingMethod: shipping,
      shippingCents: shippingCost === '' ? undefined : fromEuros(shippingCost),
      items: lines.map((l) => ({ productId: l.productId, size: l.size, qty: l.qty, unitPriceCents: l.price === '' ? undefined : fromEuros(l.price) ?? undefined }))
    }),
    onSuccess: async (r) => { await qc.invalidateQueries({ queryKey: ['orders'] }); toast.ok(t('Naročilo je vneseno.', 'Order entered.')); navigate(`/orders/${r.id}`) }
  })
  return (
    <Modal opened onClose={onClose} title={t('Vnesi naročilo', 'Enter an order')} size="lg">
      <Stack>
        <CustomerFields value={customer} onChange={setCustomer} />
        <SegmentedControl value={shipping} onChange={(v) => setShipping(v as ShippingMethod)}
          data={(['pickup', 'post', 'abroad'] as const).map((m) => ({ value: m, label: pick(SHIPPING[m], locale) }))} />
        <NumberInput {...euroInputProps} label={t('Poštnina', 'Shipping')} description={t('Prazno: izračuna se sama (po pošti).', 'Empty: worked out by weight (post).')}
          value={shippingCost} onChange={setShippingCost} />
        <Text fw={500} size="sm">{t('Izdelki (samo z zaloge »za splet«)', 'Items (from "online" stock only)')}</Text>
        {lines.map((l, i) => (
          <Group key={`${l.productId}|${l.size}`} gap="xs" wrap="nowrap">
            <Text style={{ flex: 1 }} truncate>{title(products.data?.find((p) => p.id === l.productId))} {l.size}</Text>
            <NumberInput w={70} min={1} value={l.qty} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Number(v) || 1 } : x)))} />
            <NumberInput {...euroInputProps} w={100} placeholder={t('polna', 'full')} value={l.price} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, price: v } : x)))} />
            <ActionIcon variant="default" size="lg" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={t('Odstrani', 'Remove')}><IconTrash size={16} /></ActionIcon>
          </Group>
        ))}
        <Select placeholder={t('Dodaj izdelek', 'Add a product')} searchable value={null} data={variants}
          onChange={(v) => { if (!v) return; const [productId, size] = v.split('|'); setLines([...lines, { productId, size, qty: 1, price: '' }]) }} />
        <ErrorNote error={create.error} />
        <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!customer.name || lines.length === 0}>{t('Vnesi', 'Save')}</Button>
      </Stack>
    </Modal>
  )
}

export function OrderDetail () {
  const { orderId = '' } = useParams()
  const t = useT()
  const eur = useEur()
  const locale = useLocale()
  const me = useMe()
  const toast = useToast()
  const qc = useQueryClient()
  const users = useUsers()
  const ownerName = useOwnerName()
  const order = useQuery({ queryKey: ['order', orderId], queryFn: () => api.get<Order>(`/api/orders/${orderId}`) })
  const [dialog, setDialog] = useState<'edit' | 'pay' | 'ship' | null>(null)
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['order', orderId] })
    await qc.invalidateQueries({ queryKey: ['orders'] })
  }
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string, body?: unknown }) => api.post(`/api/orders/${orderId}/${path}`, body),
    onSuccess: async () => { await refresh(); setDialog(null); toast.ok(t('Shranjeno.', 'Saved.')) },
    onError: toast.error
  })
  const o = order.data
  if (!o) return <ErrorNote error={order.error} />
  const total = o.itemsCents + (o.shippingCents ?? 0)
  const userName = (id: string | null) => users.data?.find((u) => u.id === id)?.name ?? ''
  const payText = o.shippingCents === null
    ? ''
    : t(`Naročilo ${o.number}: skupaj ${eur(total)} (izdelki ${eur(o.itemsCents)}, poštnina ${eur(o.shippingCents)}). Plačilo na ${me.iban ?? '[IBAN]'}, ${me.name}, namen »Naročilo ${o.number}«.`,
      `Order ${o.number}: total ${eur(total)} (items ${eur(o.itemsCents)}, shipping ${eur(o.shippingCents)}). Payment to ${me.iban ?? '[IBAN]'}, ${me.name}, reference "Order ${o.number}".`)

  return (
    <>
      <PageHeader title={o.number} sub={`${formatDate(o.createdAt, locale, true)} · ${o.source === 'web' ? t('splet', 'website') : t('vneseno ročno', 'entered by hand')}`}>
        <Badge size="lg" color={STATUS_COLOR[o.status]}>{pick(ORDER_STATUS[o.status], locale)}</Badge>
      </PageHeader>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card>
          <Group justify="space-between" mb="xs">
            <Title order={4}>{t('Kupec', 'Customer')}</Title>
            {o.status !== 'cancelled' && o.status !== 'shipped' && <Button size="xs" variant="default" onClick={() => setDialog('edit')}>{t('Uredi', 'Edit')}</Button>}
          </Group>
          <Text fw={700}>{o.customerName}</Text>
          {o.email && <Anchor href={`mailto:${o.email}?subject=${encodeURIComponent(o.number)}`}>{o.email}</Anchor>}
          {o.phone && <Text>{o.phone}</Text>}
          {o.street && <Text>{o.street}, {o.postcode} {o.city}{o.country ? `, ${o.country}` : ''}</Text>}
          {o.note && <Text mt="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>{o.note}</Text>}
          <Text mt="xs" size="sm">{pick(SHIPPING[o.shippingMethod], locale)}{o.handlerId ? ` · ${t('ureja', 'handled by')} ${userName(o.handlerId)}` : ''}</Text>
        </Card>
        <Card>
          <Title order={4} mb="xs">{t('Izdelki', 'Items')}</Title>
          <Table verticalSpacing={2}>
            <Table.Tbody>
              {o.items.map((i) => (
                <Table.Tr key={`${i.productId}|${i.size}`}>
                  <Table.Td>{i.qty}× {i.title} {sizeLabel(i.size) !== '–' ? i.size : ''}<Text span c="dimmed" size="sm"> · {ownerName(i.ownerId)}</Text></Table.Td>
                  <Table.Td className="num">{eur(i.qty * i.unitPriceCents)}</Table.Td>
                </Table.Tr>
              ))}
              <Table.Tr><Table.Td>{t('Poštnina', 'Shipping')}</Table.Td><Table.Td className="num">{o.shippingCents === null ? t('še ni določena', 'not set yet') : eur(o.shippingCents)}</Table.Td></Table.Tr>
              <Table.Tr><Table.Td fw={700}>{t('Skupaj', 'Total')}</Table.Td><Table.Td className="num" fw={700}>{eur(total)}</Table.Td></Table.Tr>
            </Table.Tbody>
          </Table>
          {o.paidAt && <Text size="sm" mt="xs">{t('Plačano', 'Paid')} {formatDate(o.paidAt, locale)} · {pick(METHOD[o.paymentMethod ?? ''], locale)} → {userName(o.paymentReceiverId)}</Text>}
          {o.shippedAt && <Text size="sm">{t('Poslano', 'Sent')} {formatDate(o.shippedAt, locale)}{o.postageCents !== null ? ` · ${t('poštnina', 'postage')} ${eur(o.postageCents)}` : ''}</Text>}
        </Card>
      </SimpleGrid>

      {(o.status === 'new' || o.status === 'awaiting_payment') && o.shippingCents !== null && (
        <Card mt="md">
          <Title order={4} mb="xs">{t('Navodila za plačilo', 'Payment instructions')}</Title>
          <Text size="sm" c="dimmed" mb="xs">{t('Pošlji jih kupcu (dokler aplikacija ne pošilja e-pošte sama).', "Send these to the customer (until the app sends email itself).")}</Text>
          <Group align="flex-start" wrap="wrap">
            <Stack style={{ flex: 1, minWidth: 240 }}>
              <Text style={{ whiteSpace: 'pre-wrap' }}>{payText}</Text>
              <CopyButton value={payText}>{({ copied, copy }) => <Button variant="default" onClick={copy}>{copied ? t('Kopirano', 'Copied') : t('Kopiraj besedilo', 'Copy text')}</Button>}</CopyButton>
            </Stack>
            <UpnQr size={200} payment={{ amountCents: total, purpose: `Naročilo ${o.number}`, iban: me.iban ?? undefined, name: me.name, street: me.street ?? '', city: me.city ?? undefined }} />
          </Group>
        </Card>
      )}

      <Group mt="md">
        {o.status === 'new' && (
          <Button variant="default" disabled={o.shippingCents === null} onClick={() => action.mutate({ path: 'confirm' })}>{t('Navodila so poslana kupcu', 'Instructions sent to the customer')}</Button>
        )}
        {(o.status === 'new' || o.status === 'awaiting_payment') && <Button disabled={o.shippingCents === null} onClick={() => setDialog('pay')}>{t('Plačano', 'Paid')}</Button>}
        {o.status === 'paid' && <Button onClick={() => setDialog('ship')}>{o.shippingMethod === 'pickup' ? t('Prevzeto', 'Picked up') : t('Poslano', 'Sent')}</Button>}
        {o.status !== 'cancelled' && o.status !== 'shipped' && (
          <Button variant="subtle" color="red" onClick={() => { if (window.confirm(t('Prekličem naročilo? Izdelki se vrnejo na zalogo.', 'Cancel the order? The items go back into stock.'))) action.mutate({ path: 'cancel' }) }}>
            {t('Prekliči naročilo', 'Cancel order')}
          </Button>
        )}
      </Group>
      {o.shippingCents === null && o.status === 'new' && <Text size="sm" c="dimmed" mt="xs">{t('Najprej vpiši poštnino (Uredi).', 'Enter the shipping cost first (Edit).')}</Text>}

      {o.log && o.log.length > 0 && (
        <Card mt="md">
          <Title order={5} mb="xs">{t('Zgodovina', 'History')}</Title>
          {o.log.map((l, i) => <Text key={i} size="sm" c="dimmed">{formatDate(l.createdAt, locale, true)} · {l.event}{l.detail ? ` (${l.detail})` : ''}{l.userName ? ` · ${l.userName}` : ''}</Text>)}
        </Card>
      )}

      {dialog === 'edit' && <EditOrderModal order={o} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog === 'pay' && <PayModal onClose={() => setDialog(null)} onPay={(method, receiverId) => action.mutate({ path: 'pay', body: { method, receiverId } })} loading={action.isPending} />}
      {dialog === 'ship' && (
        <ShipModal order={o} onClose={() => setDialog(null)} loading={action.isPending}
          onShip={(postageCents, postagePaidBy) => action.mutate({ path: 'ship', body: { postageCents, postagePaidBy } })} />
      )}
    </>
  )
}

function EditOrderModal ({ order, onClose, onSaved }: { order: Order, onClose: () => void, onSaved: () => Promise<void> }) {
  const t = useT()
  const users = useUsers()
  const [customer, setCustomer] = useState<CustomerForm>({
    name: order.customerName, email: order.email ?? '', phone: order.phone ?? '', street: order.street ?? '',
    postcode: order.postcode ?? '', city: order.city ?? '', country: order.country ?? '', note: order.note ?? ''
  })
  const [shipping, setShipping] = useState<number | string>(toEuros(order.shippingCents))
  const [handlerId, setHandlerId] = useState<string | null>(order.handlerId)
  const save = useMutation({
    mutationFn: () => api.put(`/api/orders/${order.id}`, { customer: customerBody(customer), shippingCents: fromEuros(shipping), handlerId }),
    onSuccess: async () => { await onSaved(); onClose() }
  })
  return (
    <Modal opened onClose={onClose} title={t('Uredi naročilo', 'Edit order')} size="lg">
      <Stack>
        <CustomerFields value={customer} onChange={setCustomer} />
        <SimpleGrid cols={2}>
          <NumberInput {...euroInputProps} label={t('Poštnina za kupca', 'Shipping charged')} value={shipping} onChange={setShipping} />
          <Select label={t('Ureja', 'Handled by')} clearable value={handlerId} onChange={setHandlerId} data={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))} />
        </SimpleGrid>
        <ErrorNote error={save.error} />
        <Button onClick={() => save.mutate()} loading={save.isPending}>{t('Shrani', 'Save')}</Button>
      </Stack>
    </Modal>
  )
}

function PayModal ({ onClose, onPay, loading }: { onClose: () => void, onPay: (m: PayMethod, receiverId: string) => void, loading: boolean }) {
  const t = useT()
  const locale = useLocale()
  const me = useMe()
  const users = useUsers()
  const [method, setMethod] = useState<PayMethod>('bank')
  const [receiverId, setReceiverId] = useState<string | null>(me.id)
  return (
    <Modal opened onClose={onClose} title={t('Plačano', 'Paid')}>
      <Stack>
        <SegmentedControl value={method} onChange={(v) => setMethod(v as PayMethod)}
          data={(['bank', 'flik', 'cash'] as const).map((m) => ({ value: m, label: pick(METHOD[m], locale) }))} />
        <Select label={t('Kdo je dobil denar', 'Who got the money')} value={receiverId} onChange={setReceiverId} allowDeselect={false}
          data={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))} />
        <Text size="sm" c="dimmed">{t('Denar za izdelke se zapiše pri tej osebi, ločeno po bendih.', 'The money for the items is recorded with this person, per band.')}</Text>
        <Button onClick={() => receiverId && onPay(method, receiverId)} loading={loading}>{t('Potrdi plačilo', 'Confirm payment')}</Button>
      </Stack>
    </Modal>
  )
}

function ShipModal ({ order, onClose, onShip, loading }: { order: Order, onClose: () => void, onShip: (postage: number | null, by: string | null) => void, loading: boolean }) {
  const t = useT()
  const me = useMe()
  const users = useUsers()
  const [postage, setPostage] = useState<number | string>('')
  const [by, setBy] = useState<string | null>(me.id)
  const pickup = order.shippingMethod === 'pickup'
  return (
    <Modal opened onClose={onClose} title={pickup ? t('Prevzeto', 'Picked up') : t('Poslano', 'Sent')}>
      <Stack>
        {!pickup && (
          <>
            <NumberInput {...euroInputProps} label={t('Koliko je stala poštnina', 'What the postage cost')} value={postage} onChange={setPostage} />
            <Select label={t('Kdo jo je plačal', 'Who paid it')} value={by} onChange={setBy} data={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))} />
          </>
        )}
        <Button onClick={() => onShip(pickup ? null : fromEuros(postage), pickup ? null : by)} loading={loading}>{t('Potrdi', 'Confirm')}</Button>
      </Stack>
    </Modal>
  )
}
