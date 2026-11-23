import {
  ActionIcon, AppShell, Badge, Burger, Container, Divider, Group, Indicator, NavLink, Popover, ScrollArea, Stack, Text,
  Tooltip, UnstyledButton, useComputedColorScheme, useMantineColorScheme
} from '@mantine/core'
import { useDisclosure, useNetwork } from '@mantine/hooks'
import {
  IconBell, IconBoxSeam, IconBuildingStore, IconCash, IconChartBar, IconCloudOff, IconCloudUpload, IconCoin, IconHome,
  IconLogout, IconMicrophone2, IconMoon, IconSettings, IconShirt, IconSun, IconTruckDelivery, IconUser, IconUsers
} from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import type { Notification } from '../../shared/types'
import { api } from '../api'
import { formatDate, useLocale, useT } from '../i18n'
import mark from '../mark-white.png'
import { db } from '../offline'
import { isAnyAdmin, useMe, useSession } from '../session'
import { useNotificationText } from './notificationText'

export function Layout () {
  const [opened, { toggle, close }] = useDisclosure()
  const me = useMe()
  const { signOut } = useSession()
  const t = useT()
  const location = useLocation()
  const scheme = useComputedColorScheme('light')
  const { setColorScheme } = useMantineColorScheme()
  useEffect(close, [location.pathname, close])

  const admin = isAnyAdmin(me)
  const links = [
    { to: '/', label: t('Domov', 'Home'), icon: IconHome, show: true },
    { to: '/sell', label: t('Prodaja', 'Sell'), icon: IconCash, show: true },
    { to: '/stands', label: t('Stojnice', 'Stands'), icon: IconBuildingStore, show: admin },
    { to: '/orders', label: t('Naročila', 'Orders'), icon: IconTruckDelivery, show: admin },
    { to: '/products', label: t('Izdelki', 'Products'), icon: IconShirt, show: admin },
    { to: '/stock', label: t('Zaloga', 'Stock'), icon: IconBoxSeam, show: true },
    { to: '/money', label: t('Denar', 'Money'), icon: IconCoin, show: true },
    { to: '/reports', label: t('Poročila', 'Reports'), icon: IconChartBar, show: admin }
  ]
  const adminLinks = [
    { to: '/admin/people', label: t('Ljudje', 'People'), icon: IconUsers },
    { to: '/admin/owners', label: t('Bendi in založba', 'Bands and label'), icon: IconMicrophone2 },
    { to: '/admin/settings', label: t('Nastavitve', 'Settings'), icon: IconSettings }
  ]
  const active = (to: string) => (to === '/' ? location.pathname === '/' : location.pathname.startsWith(to))

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 230, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label={t('Meni', 'Menu')} />
            <UnstyledButton component={Link} to="/">
              <Group gap={8} wrap="nowrap">
                <img src={mark} alt="KRDM" height={30} style={{ filter: scheme === 'light' ? 'invert(1)' : 'none' }} />
                <Text ff="heading" size="xl">band</Text>
              </Group>
            </UnstyledButton>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <SyncStatus />
            <NotificationBell />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <AppShell.Section grow component={ScrollArea}>
          {links.filter((l) => l.show).map((l) => (
            <NavLink key={l.to} component={Link} to={l.to} label={l.label} leftSection={<l.icon size={18} />} active={active(l.to)} />
          ))}
          {me.isLabelAdmin && (
            <>
              <Divider my="xs" label={t('Skrbništvo', 'Admin')} labelPosition="left" />
              {adminLinks.map((l) => (
                <NavLink key={l.to} component={Link} to={l.to} label={l.label} leftSection={<l.icon size={18} />} active={active(l.to)} />
              ))}
            </>
          )}
        </AppShell.Section>
        <AppShell.Section>
          <Divider my="xs" />
          <NavLink component={Link} to="/profile" label={me.name} leftSection={<IconUser size={18} />} active={active('/profile')} />
          <Group gap="xs" px="sm" py={4}>
            <Tooltip label={scheme === 'dark' ? t('Svetla tema', 'Light theme') : t('Temna tema', 'Dark theme')}>
              <ActionIcon variant="default" onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')} aria-label={t('Tema', 'Theme')}>
                {scheme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t('Odjava', 'Sign out')}>
              <ActionIcon variant="default" onClick={() => void signOut()} aria-label={t('Odjava', 'Sign out')}>
                <IconLogout size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Container size="lg" px={0}>
          <Outlet />
        </Container>
      </AppShell.Main>
    </AppShell>
  )
}

// Offline, and sales waiting to be uploaded.
function SyncStatus () {
  const t = useT()
  const { online } = useNetwork()
  const pending = useLiveQuery(() => db.outbox.where('status').equals('pending').count(), [], 0)
  if (!online) {
    return <Badge color="gray" variant="filled" leftSection={<IconCloudOff size={14} />}>{t('Brez povezave', 'Offline')}{pending ? ` · ${pending}` : ''}</Badge>
  }
  if (pending) {
    return <Badge color="yellow" variant="filled" leftSection={<IconCloudUpload size={14} />}>{t(`Za oddajo: ${pending}`, `To upload: ${pending}`)}</Badge>
  }
  return null
}

function NotificationBell () {
  const t = useT()
  const locale = useLocale()
  const text = useNotificationText()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<Notification[]>('/api/notifications'),
    refetchInterval: 60_000
  })
  const markRead = useMutation({
    mutationFn: () => api.post('/api/notifications/read'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] })
  })
  const unread = data.filter((n) => !n.read).length

  return (
    <Popover width={320} position="bottom-end" shadow="md" onClose={() => { if (unread) markRead.mutate() }}>
      <Popover.Target>
        <Indicator label={unread} size={16} disabled={!unread} color="red" offset={4}>
          <ActionIcon variant="default" size="lg" aria-label={t('Obvestila', 'Notifications')}>
            <IconBell size={18} />
          </ActionIcon>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <ScrollArea.Autosize mah={400}>
          {data.length === 0 && <Text p="md" c="dimmed" size="sm">{t('Ni obvestil.', 'No notifications.')}</Text>}
          <Stack gap={0}>
            {data.map((n) => (
              <UnstyledButton
                key={n.id}
                p="sm"
                onClick={() => { if (n.link) navigate(n.link) }}
                style={{ borderBottom: '1px solid var(--mantine-color-default-border)', fontWeight: n.read ? 400 : 700 }}
              >
                <Text size="sm" fw="inherit">{text(n)}</Text>
                <Text size="xs" c="dimmed">{formatDate(n.createdAt, locale, true)}</Text>
              </UnstyledButton>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  )
}
