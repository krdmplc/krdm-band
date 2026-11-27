import { Button, Card, Checkbox, PasswordInput, SegmentedControl, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { Me } from '../../shared/types'
import { api } from '../api'
import { useT } from '../i18n'
import { canAdmin, useMe, useSession } from '../session'
import { ErrorNote, PageHeader, useOwners, useToast } from '../ui'

const TOPICS = ['order.new', 'stock.negative', 'sale.flagged', 'contact.new'] as const

export function Profile () {
  const t = useT()
  const me = useMe()
  const { setMe } = useSession()
  const toast = useToast()
  const [form, setForm] = useState({ name: me.name, locale: me.locale, iban: me.iban ?? '', street: me.street ?? '', city: me.city ?? '', flikPhone: me.flikPhone ?? '' })
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' })
  const save = useMutation({
    mutationFn: () => api.patch<Me>('/api/auth/me', {
      ...form, iban: form.iban || null, street: form.street || null, city: form.city || null, flikPhone: form.flikPhone || null
    }),
    onSuccess: (next) => { setMe(next); toast.ok(next.locale === 'en' ? 'Saved.' : 'Shranjeno.') }
  })
  const changePw = useMutation({
    mutationFn: () => api.patch<Me>('/api/auth/me', pw),
    onSuccess: () => { setPw({ currentPassword: '', newPassword: '' }); toast.ok(t('Geslo je spremenjeno.', 'Password changed.')) }
  })
  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.currentTarget.value }) })

  return (
    <>
      <PageHeader title={t('Profil', 'Profile')} />
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card>
          <Stack>
            <TextInput label={t('Ime', 'Name')} {...field('name')} />
            <Text size="sm" fw={500}>{t('Jezik', 'Language')}</Text>
            <SegmentedControl value={form.locale} onChange={(v) => setForm({ ...form, locale: v as 'sl' | 'en' })} data={[{ value: 'sl', label: 'Slovenščina' }, { value: 'en', label: 'English' }]} />
            <Title order={5} mt="sm">{t('Za plačila na stojnici', 'For payments at a stand')}</Title>
            <Text size="xs" c="dimmed">{t('Kupci ti plačajo na tvoj račun (UPN QR koda) ali s Flikom. Vidijo jih le prodajalci na stojnici.', 'Customers pay into your account (UPN QR code) or by Flik. Only sellers at the stand see these.')}</Text>
            <TextInput label="IBAN" placeholder="SI56 …" {...field('iban')} />
            <SimpleGrid cols={2}>
              <TextInput label={t('Ulica in številka', 'Street')} {...field('street')} />
              <TextInput label={t('Pošta in kraj', 'Postcode and city')} placeholder="4000 Kranj" {...field('city')} />
            </SimpleGrid>
            <TextInput label={t('Telefon za Flik', 'Phone for Flik')} {...field('flikPhone')} />
            <ErrorNote error={save.error} />
            <Button onClick={() => save.mutate()} loading={save.isPending}>{t('Shrani', 'Save')}</Button>
          </Stack>
        </Card>
        <Stack>
          <Card>
            <Stack>
              <Title order={4}>{t('Geslo', 'Password')}</Title>
              <PasswordInput label={t('Trenutno geslo', 'Current password')} autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.currentTarget.value })} />
              <PasswordInput label={t('Novo geslo', 'New password')} description={t('Vsaj 8 znakov.', 'At least 8 characters.')} autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.currentTarget.value })} />
              <ErrorNote error={changePw.error} />
              <Button variant="default" onClick={() => changePw.mutate()} loading={changePw.isPending} disabled={pw.newPassword.length < 8}>{t('Spremeni geslo', 'Change password')}</Button>
            </Stack>
          </Card>
          {(me.isLabelAdmin || me.adminOf.length > 0) && <Subscriptions />}
        </Stack>
      </SimpleGrid>
    </>
  )
}

function Subscriptions () {
  const t = useT()
  const me = useMe()
  const toast = useToast()
  const qc = useQueryClient()
  const owners = useOwners()
  const subs = useQuery({ queryKey: ['subscriptions'], queryFn: () => api.get<{ topic: string, ownerId: string }[]>('/api/notifications/subscriptions') })
  const [set, setSet] = useState<Set<string>>(new Set())
  useEffect(() => { if (subs.data) setSet(new Set(subs.data.map((s) => `${s.topic}|${s.ownerId}`))) }, [subs.data])
  const save = useMutation({
    mutationFn: () => api.put('/api/notifications/subscriptions', { items: [...set].map((k) => { const [topic, ownerId] = k.split('|'); return { topic, ownerId } }) }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['subscriptions'] }); toast.ok(t('Shranjeno.', 'Saved.')) }
  })
  const names: Record<string, string> = {
    'order.new': t('Novo naročilo', 'New order'),
    'stock.negative': t('Zaloga pod ničlo', 'Stock below zero'),
    'sale.flagged': t('Prodaja z opozorilom', 'Flagged sale'),
    'contact.new': t('Sporočilo s spletne strani', 'Website message')
  }
  const rows = [{ id: '*', name: t('Vsi bendi', 'All bands') }, ...(owners.data ?? []).filter((o) => canAdmin(me, o.id))]
  const toggle = (key: string) => setSet((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  return (
    <Card>
      <Title order={4} mb="xs">{t('Obvestila', 'Notifications')}</Title>
      <Text size="xs" c="dimmed" mb="xs">{t(
        'V aplikaciji. Nova naročila in sporočila s spletne strani pridejo tudi po e-pošti, na naslov, s katerim se prijaviš, ko je ta potrjen v Cloudflaru (enkrat dobiš povezavo za potrditev).',
        'In the app. New orders and website messages also come by email, to the address you sign in with, once it is verified in Cloudflare (you get a one-time link to confirm it).'
      )}</Text>
      <Table>
        <Table.Thead>
          <Table.Tr><Table.Th />{TOPICS.map((topic) => <Table.Th key={topic}><Text size="xs">{names[topic]}</Text></Table.Th>)}</Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((o) => (
            <Table.Tr key={o.id}>
              <Table.Td>{o.name}</Table.Td>
              {TOPICS.map((topic) => (
                <Table.Td key={topic}>
                  {/* Website messages aren't a band's: one switch, for label admins. */}
                  {(topic !== 'contact.new' || (o.id === '*' && me.isLabelAdmin)) &&
                    <Checkbox checked={set.has(`${topic}|${o.id}`)} onChange={() => toggle(`${topic}|${o.id}`)} aria-label={`${o.name}: ${names[topic]}`} />}
                </Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Button mt="sm" variant="default" onClick={() => save.mutate()} loading={save.isPending}>{t('Shrani', 'Save')}</Button>
    </Card>
  )
}
