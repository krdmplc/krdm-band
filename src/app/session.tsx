// The signed-in person. Kept in localStorage too, so the app opens offline at a
// venue; the server stays the judge (a 401 signs out).

import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { Me } from '../shared/types'
import { ApiError, api } from './api'

const KEY = 'merch.me'

interface Session {
  me: Me | null
  loading: boolean
  setMe: (me: Me | null) => void
  signOut: () => Promise<void>
}

const SessionContext = createContext<Session>({ me: null, loading: true, setMe: () => {}, signOut: async () => {} })

function cached (): Me | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) as Me : null
  } catch {
    return null
  }
}

export function SessionProvider ({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(cached)
  const [loading, setLoading] = useState(true)

  const setMe = useCallback((next: Me | null) => {
    setMeState(next)
    try {
      if (next) localStorage.setItem(KEY, JSON.stringify(next))
      else localStorage.removeItem(KEY)
    } catch { /* private mode */ }
  }, [])

  useEffect(() => {
    api.get<Me>('/api/auth/me')
      .then(setMe)
      .catch((e: unknown) => {
        // Offline: keep the cached person. Anything else: signed out.
        if (!(e instanceof ApiError && e.code === 'offline')) setMe(null)
      })
      .finally(() => setLoading(false))
    const onSignedOut = () => setMe(null)
    window.addEventListener('merch:signed-out', onSignedOut)
    return () => window.removeEventListener('merch:signed-out', onSignedOut)
  }, [setMe])

  const signOut = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => {})
    setMe(null)
  }, [setMe])

  return <SessionContext.Provider value={{ me, loading, setMe, signOut }}>{children}</SessionContext.Provider>
}

export function useSession (): Session {
  return useContext(SessionContext)
}

// For pages behind sign-in, where `me` is always set.
export function useMe (): Me {
  const { me } = useSession()
  if (!me) throw new Error('useMe outside a signed-in page')
  return me
}

export const canAdmin = (me: Me, ownerId: string) => me.isLabelAdmin || me.adminOf.includes(ownerId)
export const isAnyAdmin = (me: Me) => me.isLabelAdmin || me.adminOf.length > 0
