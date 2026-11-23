import { Badge, Button, Card, Group, Modal, NumberInput, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Pot, Transfer } from '../../shared/types'
import { api } from '../api'
import { TRANSFER_KIND, formatDate, pick, useEur, useLocale, useT } from '../i18n'
import { canAdmin, useMe } from '../session'
import { ErrorNote, PageHeader, euroInputProps, fromEuros, toEuros, useOwnerName, useOwners, useToast, useUsers } from '../ui'

interface Stash { id: string, ownerId: string, name: string, keeperId: string | null, keeperName: string | null }

const potLabel = (p: Pot) => (p.kind === 'stash' ? p.name ?? '' : p.holderName ?? '')

export function Money () {
  const t = useT()
  const eur = useEur()
  const locale = useLocale()
  const me = useMe()
  const toast = useToast()
  const qc = useQueryClient()
  const ownerName = useOwnerName()
  const owners = useOwners()
  const pots = useQuery({ queryKey: ['pots'], queryFn: () => api.get<Pot[]>('/api/money/pots') })
  const transfers = useQuery({ queryKey: ['transfers'], queryFn: () => api.get<Transfer[]>('/api/money/transfers') })
  const [handover, setHandover] = useState<Pot | null>(null)
  const [record, setRecord] = useState<{ ownerId: string, kind: 'expense' | 'payout' | 'correction' } | null>(null)
  const [stashFor, setStashFor] = useState<string | null>(null)

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['pots'] })
    await qc.invalidateQueries({ queryKey: ['transfers'] })
  }
  const decide = useMutation({
    mutationFn: ({ id, ok }: { id: string, ok: boolean }) => api.post(`/api/money/transfers/${id}/${ok ? 'confirm' : 'reject'}`),
    onSuccess: async () => { await refresh(); toast.ok(t('Shranjeno.', 'Saved.')) },
    onError: toast.error
  })

  const mine = (pots.data ?? []).filter((p) => p.kind === 'person' && p.userId === me.id)
  const myStashes = (pots.data ?? []).filter((p) => p.kind === 'stash' && p.keeperId === me.id)
  const toDecide = (transfers.data ?? []).filter((tr) => tr.canDecide)
  const managed = (owners.data ?? []).filter((o) => canAdmin(me, o.id) && !o.archived)

  return (
    <>
      <PageHeader title={t('Denar', 'Money')} sub={t('Denar vedno pripada bendu, čigar izdelek je bil prodan. Kdor ga drži, ga preda v blagajno benda.',
        "Money always belongs to the band whose item was sold. Whoever holds it hands it over to the band's stash.")} />
      <ErrorNote error={pots.error} />

      {toDecide.length > 0 && (
        <Card mb="md" style={{ borderColor: 'var(--mantine-color-flyer-4)', borderWidth: 2 }}>
          <Title order={4} mb="xs">{t('Čaka tvojo potrditev', 'Waiting for you to confirm')}</Title>
          <Stack gap="xs">
            {toDecide.map((tr) => (
              <Group key={tr.id} justify="space-between" wrap="wrap">
                <Text>{tr.fromLabel} → {tr.toLabel}: <b>{eur(tr.amountCents)}</b> ({ownerName(tr.ownerId)}){tr.note ? ` · ${tr.note}` : ''}</Text>
                <Group gap="xs">
                  <Button size="xs" onClick={() => decide.mutate({ id: tr.id, ok: true })}>{t('Prejeto', 'Received')}</Button>
                  <Button size="xs" variant="default" onClick={() => decide.mutate({ id: tr.id, ok: false })}>{t('Zavrni', 'Reject')}</Button>
                </Group>
              </Group>
            ))}
          </Stack>
        </Card>
      )}

      <Title order={3} mb="xs">{t('Ti držiš', 'You hold')}</Title>
      <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} mb="lg">
        {[...mine, ...myStashes].map((p) => (
          <Card key={p.id}>
            <Text c="dimmed" size="sm">{ownerName(p.ownerId)}{p.kind === 'stash' ? ` · ${p.name}` : ''}</Text>
            <Text size="xl" fw={700} className="num" ta="left" c={p.balanceCents < 0 ? 'red' : undefined}>{eur(p.balanceCents)}</Text>
            {p.pendingOutCents > 0 && <Text size="xs" c="dimmed">{t(`${eur(p.pendingOutCents)} predanega čaka potrditev`, `${eur(p.pendingOutCents)} handed over, not confirmed yet`)}</Text>}
            {p.balanceCents < 0 && <Text size="xs" c="dimmed">{t('Bend ti dolguje.', 'The band owes you.')}</Text>}
            {p.balanceCents > 0 && <Button mt="xs" size="xs" variant="default" onClick={() => setHandover(p)}>{t('Predaj', 'Hand over')}</Button>}
          </Card>
        ))}
        {mine.length + myStashes.length === 0 && <Text c="dimmed">{t('Ne držiš denarja nobenega benda.', "You aren't holding any band's money.")}</Text>}
      </SimpleGrid>

      {managed.map((o) => {
        const ownerPots = (pots.data ?? []).filter((p) => p.ownerId === o.id)
        const sum = ownerPots.reduce((s, p) => s + p.balanceCents, 0)
        return (
          <Card key={o.id} mb="md">
            <Group justify="space-between" mb="xs" wrap="wrap">
              <Title order={4}>{o.name} · {eur(sum)}</Title>
              <Group gap="xs">
                <Button size="xs" variant="default" onClick={() => setStashFor(o.id)}>{t('Nova blagajna', 'New stash')}</Button>
                <Button size="xs" variant="default" onClick={() => setRecord({ ownerId: o.id, kind: 'expense' })}>{t('Strošek', 'Expense')}</Button>
                <Button size="xs" variant="default" onClick={() => setRecord({ ownerId: o.id, kind: 'payout' })}>{t('Izplačilo', 'Payout')}</Button>
                <Button size="xs" variant="default" onClick={() => setRecord({ ownerId: o.id, kind: 'correction' })}>{t('Popravek', 'Correction')}</Button>
              </Group>
            </Group>
            <Table verticalSpacing={2}>
              <Table.Tbody>
                {ownerPots.map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td>{potLabel(p)}{p.kind === 'stash' && <Badge ml={6} size="xs" variant="light">{t('blagajna', 'stash')}{p.holderName ? ` · ${p.holderName}` : ''}</Badge>}</Table.Td>
                    <Table.Td className="num" c={p.balanceCents < 0 ? 'red' : undefined}>{eur(p.balanceCents)}</Table.Td>
                    <Table.Td className="num" c="dimmed">{p.pendingInCents ? `+${eur(p.pendingInCents)} ${t('čaka', 'pending')}` : ''}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {ownerPots.length === 0 && <Text c="dimmed" size="sm">{t('Še nobenega denarja.', 'No money yet.')}</Text>}
          </Card>
        )
      })}

      <Title order={3} mt="lg" mb="xs">{t('Zgodovina', 'History')}</Title>
      <Table.ScrollContainer minWidth={640}>
        <Table verticalSpacing={4}>
          <Table.Tbody>
            {(transfers.data ?? []).map((tr) => (
              <Table.Tr key={tr.id} opacity={tr.status === 'rejected' ? 0.5 : 1}>
                <Table.Td>{formatDate(tr.createdAt, locale)}</Table.Td>
                <Table.Td><Badge variant="light" color="gray">{pick(TRANSFER_KIND[tr.kind], locale)}</Badge></Table.Td>
                <Table.Td>{ownerName(tr.ownerId)}</Table.Td>
                <Table.Td>{label(tr.fromLabel, t)} → {label(tr.toLabel, t)}{tr.note ? <Text span c="dimmed"> · {tr.note}</Text> : null}</Table.Td>
                <Table.Td className="num">{eur(tr.amountCents)}</Table.Td>
                <Table.Td>{tr.status === 'pending' && <Badge color="yellow">{t('čaka', 'pending')}</Badge>}{tr.status === 'rejected' && <Badge color="gray">{t('zavrnjeno', 'rejected')}</Badge>}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {handover && <HandoverModal pot={handover} onClose={() => setHandover(null)} onDone={refresh} />}
      {record && <RecordModal ownerId={record.ownerId} kind={record.kind} pots={(pots.data ?? []).filter((p) => p.ownerId === record.ownerId)} onClose={() => setRecord(null)} onDone={refresh} />}
      {stashFor && <StashModal ownerId={stashFor} onClose={() => setStashFor(null)} onDone={refresh} />}
    </>
  )
}

// External pots have fixed ids; give them words.
function label (value: string, t: (sl: string, en: string) => string) {
  if (value === 'customers') return t('kupci', 'customers')
  if (value === 'suppliers') return t('dobavitelji', 'suppliers')
  if (value === 'payouts') return t('izplačila', 'payouts')
  return value
}

function HandoverModal ({ pot, onClose, onDone }: { pot: Pot, onClose: () => void, onDone: () => Promise<void> }) {
  const t = useT()
  const eur = useEur()
  const me = useMe()
  const toast = useToast()
  const users = useUsers()
  const ownerName = useOwnerName()
  const stashes = useQuery({ queryKey: ['stashes'], queryFn: () => api.get<Stash[]>('/api/money/stashes') })
  const [to, setTo] = useState<string | null>(null)
  const [amount, setAmount] = useState<number | string>(toEuros(pot.balanceCents))
  const [note, setNote] = useState('')
  const options = [
    ...(stashes.data ?? []).filter((s) => s.ownerId === pot.ownerId && s.id !== pot.id)
      .map((s) => ({ value: s.id, label: `${s.name}${s.keeperName ? ` (${s.keeperName})` : ''}` })),
    ...(users.data ?? []).filter((u) => u.id !== me.id).map((u) => ({ value: `person:${u.id}`, label: u.name }))
  ]
  const save = useMutation({
    mutationFn: () => api.post<{ status: string }>('/api/money/transfers', {
      ownerId: pot.ownerId, fromPot: pot.id, toPot: to, amountCents: fromEuros(amount), kind: 'handover', note: note || null
    }),
    onSuccess: async (r) => {
      await onDone()
      toast.ok(r.status === 'pending' ? t('Predano. Prejemnik mora potrditi.', 'Handed over. The receiver has to confirm.') : t('Predano.', 'Handed over.'))
      onClose()
    }
  })
  return (
    <Modal opened onClose={onClose} title={t(`Predaj denar: ${ownerName(pot.ownerId)}`, `Hand over money: ${ownerName(pot.ownerId)}`)}>
      <Stack>
        <Text size="sm">{t('Imaš', 'You have')} {eur(pot.balanceCents)}</Text>
        <Select label={t('Komu', 'To')} data={options} value={to} onChange={setTo} searchable />
        <NumberInput {...euroInputProps} label={t('Znesek', 'Amount')} value={amount} onChange={setAmount} />
        <TextInput label={t('Opomba', 'Note')} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <ErrorNote error={save.error} />
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!to || !fromEuros(amount)}>{t('Predaj', 'Hand over')}</Button>
      </Stack>
    </Modal>
  )
}

function RecordModal ({ ownerId, kind, pots, onClose, onDone }: { ownerId: string, kind: 'expense' | 'payout' | 'correction', pots: Pot[], onClose: () => void, onDone: () => Promise<void> }) {
  const t = useT()
  const locale = useLocale()
  const toast = useToast()
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(kind === 'expense' ? 'suppliers' : kind === 'payout' ? 'payouts' : null)
  const [amount, setAmount] = useState<number | string>('')
  const [note, setNote] = useState('')
  const potOptions = pots.map((p) => ({ value: p.id, label: potLabel(p) }))
  const external = [
    { value: 'customers', label: t('kupci', 'customers') },
    { value: 'suppliers', label: t('dobavitelji', 'suppliers') },
    { value: 'payouts', label: t('izplačila', 'payouts') }
  ]
  const save = useMutation({
    mutationFn: () => api.post('/api/money/transfers', { ownerId, fromPot: from, toPot: to, amountCents: fromEuros(amount), kind, note: note || null }),
    onSuccess: async () => { await onDone(); toast.ok(t('Zapisano.', 'Recorded.')); onClose() }
  })
  return (
    <Modal opened onClose={onClose} title={pick(TRANSFER_KIND[kind], locale)}>
      <Stack>
        {kind === 'correction' && <Text size="sm" c="dimmed">{t('Popravek premakne denar med katerimakoli blagajnami, tudi od »kupcev«, ko kaj ni bilo zapisano.', 'A correction moves money between any pots, also from "customers" when something was not recorded.')}</Text>}
        <Select label={t('Iz', 'From')} data={kind === 'correction' ? [...potOptions, ...external] : potOptions} value={from} onChange={setFrom} />
        {kind === 'correction' && <Select label={t('V', 'To')} data={[...potOptions, ...external]} value={to} onChange={setTo} />}
        <NumberInput {...euroInputProps} label={t('Znesek', 'Amount')} value={amount} onChange={setAmount} />
        <TextInput label={t('Za kaj', 'What for')} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <ErrorNote error={save.error} />
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!from || !to || !fromEuros(amount)}>{t('Zapiši', 'Record')}</Button>
      </Stack>
    </Modal>
  )
}

function StashModal ({ ownerId, onClose, onDone }: { ownerId: string, onClose: () => void, onDone: () => Promise<void> }) {
  const t = useT()
  const users = useUsers()
  const [name, setName] = useState('')
  const [keeperId, setKeeperId] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => api.post('/api/money/pots', { ownerId, name, keeperId }),
    onSuccess: async () => { await onDone(); onClose() }
  })
  return (
    <Modal opened onClose={onClose} title={t('Nova blagajna', 'New stash')}>
      <Stack>
        <TextInput label={t('Ime', 'Name')} placeholder={t('npr. Blagajna, Bančni račun', 'e.g. Cash box, Bank account')} value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Select label={t('Kdo jo hrani', 'Who keeps it')} clearable value={keeperId} onChange={setKeeperId} data={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))} />
        <ErrorNote error={save.error} />
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name}>{t('Ustvari', 'Create')}</Button>
      </Stack>
    </Modal>
  )
}
