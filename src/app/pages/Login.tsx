import { Button, Center, Paper, PasswordInput, Stack, Text, TextInput, Title, useComputedColorScheme } from '@mantine/core'
import { useMutation, useQuery } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import type { Me } from '../../shared/types'
import { api } from '../api'
import { useT } from '../i18n'
import mark from '../mark-white.png'
import { useSession } from '../session'
import { ErrorNote } from '../ui'

function Frame ({ title, children }: { title: string, children: React.ReactNode }) {
  const scheme = useComputedColorScheme('light')
  return (
    <Center mih="100vh" p="md">
      <Paper p="xl" w="100%" maw={380}>
        <Stack>
          <Center>
            <img src={mark} alt="KRDM" height={64} style={{ filter: scheme === 'light' ? 'invert(1)' : 'none' }} />
          </Center>
          <Title order={2} ta="center">{title}</Title>
          {children}
        </Stack>
      </Paper>
    </Center>
  )
}

export function Login () {
  const t = useT()
  const { setMe } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const login = useMutation({
    mutationFn: () => api.post<Me>('/api/auth/login', { email, password }),
    onSuccess: setMe
  })
  const submit = (e: FormEvent) => { e.preventDefault(); login.mutate() }
  return (
    <Frame title="KRDM band">
      <form onSubmit={submit}>
        <Stack>
          <TextInput label={t('E-naslov', 'Email')} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          <PasswordInput label={t('Geslo', 'Password')} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          <ErrorNote error={login.error} />
          <Button type="submit" loading={login.isPending}>{t('Prijava', 'Sign in')}</Button>
          <Text size="xs" c="dimmed">
            {t('Pozabljeno geslo? Skrbnik ti lahko pošlje novo povezavo.', 'Forgot your password? An admin can send you a new link.')}
          </Text>
        </Stack>
      </form>
    </Frame>
  )
}

// Setting a password from an invite (or reset) link.
export function Invite () {
  const t = useT()
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { setMe } = useSession()
  const [password, setPassword] = useState('')
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => api.get<{ name: string, email: string }>(`/api/auth/invite/${token}`) })
  const accept = useMutation({
    mutationFn: () => api.post<Me>(`/api/auth/invite/${token}`, { password }),
    onSuccess: (me) => { setMe(me); navigate('/', { replace: true }) }
  })
  const submit = (e: FormEvent) => { e.preventDefault(); accept.mutate() }
  return (
    <Frame title={t('Nastavi geslo', 'Set your password')}>
      {invite.isError && <ErrorNote error={invite.error} />}
      {invite.data && (
        <form onSubmit={submit}>
          <Stack>
            <Text>{t(`Živjo, ${invite.data.name}!`, `Hi, ${invite.data.name}!`)}</Text>
            <TextInput label={t('E-naslov', 'Email')} value={invite.data.email} readOnly autoComplete="username" />
            <PasswordInput
              label={t('Novo geslo', 'New password')}
              description={t('Vsaj 8 znakov.', 'At least 8 characters.')}
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            <ErrorNote error={accept.error} />
            <Button type="submit" loading={accept.isPending}>{t('Shrani in se prijavi', 'Save and sign in')}</Button>
          </Stack>
        </form>
      )}
    </Frame>
  )
}
