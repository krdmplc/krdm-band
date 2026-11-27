import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './app.css'

import { Center, Loader, MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { ApiError } from './api'
import { Layout } from './components/Layout'
import { LocaleContext } from './i18n'
import { startBackgroundSync } from './offline'
import { Owners } from './pages/admin/Owners'
import { People } from './pages/admin/People'
import { Settings } from './pages/admin/Settings'
import { Home } from './pages/Home'
import { Invite, Login } from './pages/Login'
import { Money } from './pages/Money'
import { Messages } from './pages/Messages'
import { OrderDetail, Orders } from './pages/Orders'
import { Pos } from './pages/Pos'
import { ProductEdit } from './pages/ProductEdit'
import { Products } from './pages/Products'
import { Profile } from './pages/Profile'
import { Reports } from './pages/Reports'
import { Sell } from './pages/Sell'
import { StandEdit, Stands } from './pages/Stands'
import { Stock } from './pages/Stock'
import { cssVariablesResolver, theme } from './theme'
import { SessionProvider, useSession } from './session'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't retry what the server refused; do retry a flaky connection.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      staleTime: 10_000
    }
  }
})

const browserLocale = navigator.language.startsWith('sl') ? 'sl' : 'en'

function App () {
  const { me, loading } = useSession()
  const signedIn = me !== null
  useEffect(() => (signedIn ? startBackgroundSync() : undefined), [signedIn])

  if (!me && loading) return <Center h="100vh"><Loader /></Center>
  return (
    <LocaleContext.Provider value={me?.locale ?? browserLocale}>
      <BrowserRouter>
        {me
          ? (
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="sell" element={<Sell />} />
                <Route path="sell/:standId" element={<Pos />} />
                <Route path="stands" element={<Stands />} />
                <Route path="stands/:standId" element={<StandEdit />} />
                <Route path="products" element={<Products />} />
                <Route path="products/:productId" element={<ProductEdit />} />
                <Route path="stock" element={<Stock />} />
                <Route path="orders" element={<Orders />} />
                <Route path="orders/:orderId" element={<OrderDetail />} />
                <Route path="messages" element={<Messages />} />
                <Route path="money" element={<Money />} />
                <Route path="reports" element={<Reports />} />
                <Route path="profile" element={<Profile />} />
                <Route path="admin/people" element={<People />} />
                <Route path="admin/owners" element={<Owners />} />
                <Route path="admin/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
            )
          : (
            <Routes>
              <Route path="invite/:token" element={<Invite />} />
              <Route path="*" element={<Login />} />
            </Routes>
            )}
      </BrowserRouter>
    </LocaleContext.Provider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
      <Notifications position="top-center" />
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <App />
        </SessionProvider>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js')
}
