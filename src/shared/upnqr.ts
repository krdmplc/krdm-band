// UPN QR: the payment QR code Slovenian bank apps scan to fill in a transfer.
// Layout per the ZBS technical standard as implemented by
// github.com/DataLinx/php-upn-qr-generator: 19 lines joined by LF, a trailing LF,
// then the payload's length (3 digits) as the control sum. Encoded in ISO-8859-2,
// byte mode, error correction M, QR version 15 (room for 412 bytes; the payload
// is at most 411 characters).

export interface UpnPayment {
  amountCents: number
  // Namen plačila, max 42 characters.
  purpose: string
  // Recipient's IBAN: SI56 followed by 15 digits (spaces allowed).
  iban: string
  name: string
  street: string
  city: string
  // "SI99" (no reference) unless given. SI references take digits only.
  reference?: string
  // Koda namena; OTHR (other) by default.
  code?: string
}

export function normaliseIban (iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase()
}

export function isValidUpnIban (iban: string): boolean {
  return /^[A-Z]{2}\d{17}$/.test(normaliseIban(iban))
}

const cut = (value: string, max: number) => value.trim().replace(/\s+/g, ' ').slice(0, max)

export function upnPayload (p: UpnPayment): string {
  const iban = normaliseIban(p.iban)
  if (!isValidUpnIban(iban)) throw new Error('invalid_iban')
  if (!p.city.trim()) throw new Error('missing_city')
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0 || p.amountCents > 99999999999) {
    throw new Error('invalid_amount')
  }
  const fields = [
    'UPNQR',
    '', // payer IBAN
    '', // deposit
    '', // withdrawal
    '', // payer reference
    '', // payer name
    '', // payer street
    '', // payer city
    String(p.amountCents).padStart(11, '0'),
    '', // payment date
    '', // urgent
    (p.code ?? 'OTHR').toUpperCase(),
    cut(p.purpose, 42),
    '', // due date
    iban,
    p.reference?.trim() || 'SI99',
    cut(p.name, 33),
    cut(p.street, 33),
    cut(p.city, 33)
  ]
  const body = fields.join('\n') + '\n'
  return body + String(body.length).padStart(3, '0')
}

// ISO-8859-2, 0xA0–0xFF. Below that it matches ASCII.
const LATIN2_HIGH =
  ' Ą˘Ł¤ĽŚ§¨ŠŞŤŹ­ŽŻ°ą˛ł´ľśˇ¸šşťź˝žż' +
  'ŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢß' +
  'ŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙'

export function toLatin2 (text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const code = ch.charCodeAt(0)
    if (code < 0x80) out[i] = code
    else {
      const idx = LATIN2_HIGH.indexOf(ch)
      out[i] = idx >= 0 ? 0xa0 + idx : 0x3f // "?"
    }
  }
  return out
}
