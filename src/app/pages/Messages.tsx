import { Anchor, Badge, Button, Card, Group, SegmentedControl, Stack, Text } from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { ContactMessage } from '../../shared/types'
import { api } from '../api'
import { formatDate, useLocale, useT } from '../i18n'
import { ErrorNote, PageHeader } from '../ui'

// Messages from the website's contact form, for label admins. Answer by email
// (the address is a mailto link), then mark the message answered.
export function Messages () {
  const t = useT()
  const locale = useLocale()
  const qc = useQueryClient()
  const [show, setShow] = useState('open')
  const messages = useQuery({ queryKey: ['messages'], queryFn: () => api.get<ContactMessage[]>('/api/messages') })
  const mark = useMutation({
    mutationFn: ({ id, handled }: { id: string, handled: boolean }) => api.post(`/api/messages/${id}/handled`, { handled }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['messages'] }) }
  })
  const list = (messages.data ?? []).filter((m) => show === 'all' || !m.handledAt)
  return (
    <>
      <PageHeader title={t('Sporočila', 'Messages')} sub={t('S kontaktnega obrazca na krdm.si.', 'From the contact form on krdm.si.')} />
      <SegmentedControl mb="md" value={show} onChange={setShow} data={[
        { value: 'open', label: t('Neodgovorjena', 'Unanswered') },
        { value: 'all', label: t('Vsa', 'All') }
      ]} />
      <ErrorNote error={messages.error ?? mark.error} />
      <Stack>
        {list.map((m) => (
          <Card key={m.id} id={m.id}>
            <Group justify="space-between" mb="xs" wrap="wrap">
              <div>
                <Text fw={700}>{m.name}</Text>
                <Anchor href={`mailto:${m.email}`} size="sm">{m.email}</Anchor>
              </div>
              <Group gap="xs">
                <Badge variant="default">{m.locale.toUpperCase()}</Badge>
                <Text size="sm" c="dimmed">{formatDate(m.createdAt, locale, true)}</Text>
              </Group>
            </Group>
            <Text style={{ whiteSpace: 'pre-wrap' }}>{m.message}</Text>
            <Group mt="sm" gap="xs">
              {m.handledAt
                ? (
                  <>
                    <Text size="sm" c="dimmed">{t('Odgovorjeno', 'Answered')}{m.handledBy ? ` (${m.handledBy})` : ''}, {formatDate(m.handledAt, locale)}</Text>
                    <Button size="xs" variant="subtle" onClick={() => mark.mutate({ id: m.id, handled: false })}>{t('Ni še odgovorjeno', 'Not answered yet')}</Button>
                  </>
                  )
                : <Button size="xs" variant="default" onClick={() => mark.mutate({ id: m.id, handled: true })}>{t('Odgovorjeno', 'Answered')}</Button>}
            </Group>
          </Card>
        ))}
      </Stack>
      {messages.data && list.length === 0 && <Text c="dimmed">{t('Ni sporočil.', 'No messages.')}</Text>}
    </>
  )
}
