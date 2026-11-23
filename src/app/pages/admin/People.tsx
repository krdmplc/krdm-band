import { Badge, Button, Checkbox, CopyButton, Group, Menu, Modal, Stack, Table, Text, TextInput } from '@mantine/core'
import { IconDots, IconPlus } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { UserAdmin } from '../../../shared/types'
import { api } from '../../api'
import { useT } from '../../i18n'
import { useMe } from '../../session'
import { ErrorNote, PageHeader, useOwnerName, useToast } from '../../ui'

// Accounts. Until the app sends email, an invite is a link you pass on yourself.
export function People () {
  const t = useT()
  const me = useMe()
  const toast = useToast()
  const qc = useQueryClient()
  const ownerName = useOwnerName()
  const people = useQuery({ queryKey: ['users', 'admin'], queryFn: () => api.get<UserAdmin[]>('/api/users'), enabled: me.isLabelAdmin })
  const [adding, setAdding] = useState(false)
  const [link, setLink] = useState<{ name: string, url: string } | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] })
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string, body: object }) => api.patch(`/api/users/${id}`, body),
    onSuccess: async () => { await refresh(); toast.ok(t('Shranjeno.', 'Saved.')) },
    onError: toast.error
  })
  const reinvite = useMutation({
    mutationFn: (u: UserAdmin) => api.post<{ inviteUrl: string }>(`/api/users/${u.id}/invite`).then((r) => ({ name: u.name, url: r.inviteUrl })),
    onSuccess: setLink,
    onError: toast.error
  })

  return (
    <>
      <PageHeader title={t('Ljudje', 'People')} sub={t('Kdo lahko uporablja aplikacijo. Pravice za bende urediš pri bendih.', 'Who can use the app. Band rights are set on the bands page.')}>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>{t('Dodaj osebo', 'Add a person')}</Button>
      </PageHeader>
      <ErrorNote error={people.error} />
      <Table.ScrollContainer minWidth={600}>
        <Table highlightOnHover>
          <Table.Tbody>
            {(people.data ?? []).map((u) => (
              <Table.Tr key={u.id} opacity={u.disabled ? 0.5 : 1}>
                <Table.Td fw={700}>{u.name}</Table.Td>
                <Table.Td>{u.email}</Table.Td>
                <Table.Td>
                  {u.isLabelAdmin && <Badge mr={4}>{t('skrbnik založbe', 'label admin')}</Badge>}
                  {u.adminOf.map((o) => <Badge key={o} mr={4} variant="light">{ownerName(o)}</Badge>)}
                  {!u.hasPassword && <Badge color="yellow" variant="light">{t('ni še gesla', 'no password yet')}</Badge>}
                  {u.disabled && <Badge color="gray">{t('onemogočen', 'disabled')}</Badge>}
                </Table.Td>
                <Table.Td w={40}>
                  <Menu position="bottom-end">
                    <Menu.Target><Button variant="subtle" size="xs" aria-label={t('Možnosti', 'Options')}><IconDots size={16} /></Button></Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => reinvite.mutate(u)}>{t('Nova povezava za geslo', 'New password link')}</Menu.Item>
                      {u.id !== me.id && (
                        <>
                          <Menu.Item onClick={() => patch.mutate({ id: u.id, body: { isLabelAdmin: !u.isLabelAdmin } })}>
                            {u.isLabelAdmin ? t('Odvzemi skrbništvo založbe', 'Remove label admin') : t('Naj bo skrbnik založbe', 'Make label admin')}
                          </Menu.Item>
                          <Menu.Item color={u.disabled ? undefined : 'red'} onClick={() => patch.mutate({ id: u.id, body: { disabled: !u.disabled } })}>
                            {u.disabled ? t('Omogoči', 'Enable') : t('Onemogoči', 'Disable')}
                          </Menu.Item>
                        </>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {adding && <AddPerson onClose={() => setAdding(false)} onAdded={async (name, url) => { await refresh(); setAdding(false); setLink({ name, url }) }} />}
      <Modal opened={link !== null} onClose={() => setLink(null)} title={t('Povezava za geslo', 'Password link')}>
        {link && (
          <Stack>
            <Text>{t(`Pošlji to povezavo osebi ${link.name}. Velja 14 dni in samo enkrat.`, `Send this link to ${link.name}. It works once, for 14 days.`)}</Text>
            <TextInput value={link.url} readOnly onFocus={(e) => e.currentTarget.select()} />
            <CopyButton value={link.url}>{({ copied, copy }) => <Button onClick={copy}>{copied ? t('Kopirano', 'Copied') : t('Kopiraj', 'Copy')}</Button>}</CopyButton>
          </Stack>
        )}
      </Modal>
    </>
  )
}

function AddPerson ({ onClose, onAdded }: { onClose: () => void, onAdded: (name: string, url: string) => Promise<void> }) {
  const t = useT()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [labelAdmin, setLabelAdmin] = useState(false)
  const add = useMutation({
    mutationFn: () => api.post<{ inviteUrl: string }>('/api/users', { name, email, isLabelAdmin: labelAdmin }),
    onSuccess: (r) => onAdded(name, r.inviteUrl)
  })
  return (
    <Modal opened onClose={onClose} title={t('Dodaj osebo', 'Add a person')}>
      <Stack>
        <TextInput label={t('Ime', 'Name')} required value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <TextInput label={t('E-naslov', 'Email')} type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <Checkbox label={t('Skrbnik založbe (vidi in ureja vse)', 'Label admin (sees and edits everything)')} checked={labelAdmin} onChange={(e) => setLabelAdmin(e.currentTarget.checked)} />
        <ErrorNote error={add.error} />
        <Group><Button onClick={() => add.mutate()} loading={add.isPending} disabled={!name || !email}>{t('Dodaj', 'Add')}</Button></Group>
      </Stack>
    </Modal>
  )
}
