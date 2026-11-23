import { Alert, Stack, Text } from '@mantine/core'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { toLatin2, upnPayload, type UpnPayment } from '../../shared/upnqr'
import { useEur, useT } from '../i18n'

// The payment QR code a customer scans with their bank app. Needs the receiver's
// IBAN, street and city (Profile).
export function UpnQr ({ payment, size = 260 }: { payment: Partial<UpnPayment> & { amountCents: number, purpose: string }, size?: number }) {
  const t = useT()
  const eur = useEur()
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const complete = Boolean(payment.iban && payment.city && payment.name)

  useEffect(() => {
    if (!complete) return
    try {
      const text = upnPayload(payment as UpnPayment)
      QRCode.toDataURL([{ data: toLatin2(text), mode: 'byte' }], { errorCorrectionLevel: 'M', version: 15, margin: 2, width: size })
        .then((url) => { setSrc(url); setError(false) })
        .catch(() => setError(true))
    } catch {
      setError(true)
    }
  }, [complete, payment.amountCents, payment.iban, payment.name, payment.street, payment.city, payment.purpose, size])

  if (!complete || error) {
    return (
      <Alert color="yellow" variant="light">
        {t('Prejemnik še nima vpisanega IBAN-a in naslova (Profil), zato kode ni.',
          "The receiver hasn't entered an IBAN and address yet (Profile), so there is no code.")}
      </Alert>
    )
  }
  return (
    <Stack align="center" gap={4}>
      {src && <img src={src} width={size} height={size} alt={t('UPN QR koda za plačilo', 'UPN QR code for the payment')} style={{ background: '#fff' }} />}
      <Text size="sm" fw={700}>{eur(payment.amountCents)} → {payment.name}</Text>
      <Text size="xs" c="dimmed">{payment.iban} · {payment.purpose}</Text>
    </Stack>
  )
}
