// Small shared pieces: data hooks for the lists every page needs, and a few
// components that keep pages consistent.

import { Alert, Group, Stack, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Location, Owner, Product, Tier, UserSummary } from '../shared/types'
import { ApiError, api } from './api'
import { errorText, useLocale } from './i18n'

export const useOwners = () => useQuery({ queryKey: ['owners'], queryFn: () => api.get<Owner[]>('/api/owners') })
export const useTiers = () => useQuery({ queryKey: ['tiers'], queryFn: () => api.get<Tier[]>('/api/tiers') })
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => api.get<UserSummary[]>('/api/users') })
export const useLocations = () => useQuery({ queryKey: ['locations'], queryFn: () => api.get<Location[]>('/api/locations') })
export const useProducts = () => useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/api/products') })

export function useOwnerName () {
  const { data } = useOwners()
  return (id: string | null | undefined) => (id ? data?.find((o) => o.id === id)?.name ?? id : '')
}

export function useProductTitle () {
  const locale = useLocale()
  return (p: { titleSl: string, titleEn: string } | undefined) => (p ? (locale === 'en' && p.titleEn) || p.titleSl : '')
}

export function useTierName () {
  const locale = useLocale()
  const { data } = useTiers()
  return (id: string) => {
    const t = data?.find((x) => x.id === id)
    return t ? (locale === 'en' ? t.nameEn : t.nameSl) : id
  }
}

export function PageHeader ({ title, children, sub }: { title: string, sub?: ReactNode, children?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-end" mb="md" wrap="wrap" gap="sm">
      <Stack gap={2}>
        <Title order={2}>{title}</Title>
        {sub && <Text c="dimmed" size="sm">{sub}</Text>}
      </Stack>
      {children && <Group gap="xs">{children}</Group>}
    </Group>
  )
}

export function ErrorNote ({ error }: { error: unknown }) {
  const locale = useLocale()
  if (!error) return null
  const code = error instanceof ApiError ? error.code : 'server_error'
  return <Alert color="red" variant="light" my="sm">{errorText(code, locale)}</Alert>
}

export function useToast () {
  const locale = useLocale()
  return {
    ok: (message: string) => notifications.show({ message, color: 'flyer' }),
    error: (e: unknown) => notifications.show({
      color: 'red',
      message: errorText(e instanceof ApiError ? e.code : 'server_error', locale)
    })
  }
}

// Sizes as shown: one-size products have no size.
export const sizeLabel = (size: string) => size || '–'

// The size colours of the gig box (docs/merch-gig-box.md): the same on the
// dividers, the stickers and the size buttons. Women's cuts (WS, WM …) share them.
const SIZE_COLORS: Record<string, string> = {
  XS: '#ffffff', S: '#f2d01e', M: '#2f9e44', L: '#1c7ed6', XL: '#e03131', XXL: '#0c0c0b', '3XL': '#868e96'
}
export const sizeColor = (size: string): string | null => SIZE_COLORS[size.replace(/^W(?=[XSML3])/, '').toUpperCase()] ?? null

export const euroInputProps = { decimalScale: 2, fixedDecimalScale: false, decimalSeparator: ',', min: 0, suffix: ' €', allowNegative: false } as const

export const toEuros = (cents: number | null | undefined) => (cents === null || cents === undefined ? '' : cents / 100)
export const fromEuros = (value: string | number) => (value === '' ? null : Math.round(Number(value) * 100))
