import { Badge, Button, Modal, MultiSelect, SegmentedControl, Stack, Switch, Table, TextInput } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Owner } from '../../../shared/types'
import { api } from '../../api'
import { useT } from '../../i18n'
import { ErrorNote, PageHeader, useOwners, useToast, useUsers } from '../../ui'

// Bands and the label: who gets the money, and who manages each.
export function Owners () {
  const t = useT()
  const owners = useOwners()
  const [editing, setEditing] = useState<Owner | 'new' | null>(null)
  return (
    <>
      <PageHeader title={t('Bendi in založba', 'Bands and label')} sub={t('Skrbniki benda urejajo njegove izdelke, zalogo, naročila in denar.', "A band's admins manage its products, stock, orders and money.")}>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>{t('Dodaj', 'Add')}</Button>
      </PageHeader>
      <ErrorNote error={owners.error} />
      <Table highlightOnHover>
        <Table.Tbody>
          {(owners.data ?? []).map((o) => (
            <Table.Tr key={o.id} onClick={() => setEditing(o)} style={{ cursor: 'pointer' }} opacity={o.archived ? 0.5 : 1}>
              <Table.Td fw={700}>{o.name}</Table.Td>
              <Table.Td>{o.kind === 'label' ? <Badge>{t('založba', 'label')}</Badge> : <Badge variant="light" color="gray">{t('bend', 'band')}</Badge>}</Table.Td>
              <Table.Td>{o.admins.map((a) => a.name).join(', ')}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {editing && <OwnerModal owner={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function OwnerModal ({ owner, onClose }: { owner: Owner | null, onClose: () => void }) {
  const t = useT()
  const toast = useToast()
  const qc = useQueryClient()
  const users = useUsers()
  const [id, setId] = useState(owner?.id ?? '')
  const [name, setName] = useState(owner?.name ?? '')
  const [kind, setKind] = useState<'band' | 'label'>(owner?.kind ?? 'band')
  const [adminIds, setAdminIds] = useState<string[]>(owner?.admins.map((a) => a.id) ?? [])
  const [archived, setArchived] = useState(owner?.archived ?? false)
  const save = useMutation({
    mutationFn: () => (owner
      ? api.patch(`/api/owners/${owner.id}`, { name, adminIds, archived })
      : api.post('/api/owners', { id, name, kind, adminIds })),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['owners'] }); toast.ok(t('Shranjeno.', 'Saved.')); onClose() }
  })
  return (
    <Modal opened onClose={onClose} title={owner ? owner.name : t('Dodaj bend', 'Add a band')}>
      <Stack>
        <TextInput label={t('Ime', 'Name')} required value={name} onChange={(e) => setName(e.currentTarget.value)} />
        {!owner && (
          <>
            <TextInput label={t('Oznaka', 'Id')} description={t('Enaka kot ref ustvarjalca na spletni strani (npr. gmb).', "Same as the artist's ref on the website (e.g. gmb).")}
              required value={id} onChange={(e) => setId(e.currentTarget.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
            <SegmentedControl value={kind} onChange={(v) => setKind(v as 'band' | 'label')} data={[{ value: 'band', label: t('Bend', 'Band') }, { value: 'label', label: t('Založba', 'Label') }]} />
          </>
        )}
        <MultiSelect label={t('Skrbniki', 'Admins')} searchable value={adminIds} onChange={setAdminIds} data={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))} />
        {owner && <Switch label={t('Arhivirano', 'Archived')} checked={archived} onChange={(e) => setArchived(e.currentTarget.checked)} />}
        <ErrorNote error={save.error} />
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name || (!owner && !id)}>{t('Shrani', 'Save')}</Button>
      </Stack>
    </Modal>
  )
}
