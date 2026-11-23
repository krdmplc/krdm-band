import { describe, expect, it } from 'vitest'
import { postQuote, type ShippingSettings } from '../src/shared/shipping'
import { isValidUpnIban, toLatin2, upnPayload } from '../src/shared/upnqr'

// The defaults from migrations/0001_init.sql (Pošta Slovenije, 1. 8. 2026).
const settings: ShippingSettings = {
  packagingGrams: 50,
  packagingCents: 50,
  roundToCents: 100,
  brackets: [
    { maxGrams: 350, cents: 305, service: 'Pismo s sledenjem' },
    { maxGrams: 1000, cents: 410, service: 'Pismo s sledenjem' },
    { maxGrams: 2000, cents: 594, service: 'Paket' },
    { maxGrams: 5000, cents: 687, service: 'Paket' },
    { maxGrams: 10000, cents: 834, service: 'Paket' }
  ]
}

describe('postQuote', () => {
  it('adds packaging and rounds up to whole euros', () => {
    // A shirt: 200 + 50 g → up to 350 g, 3.05 + 0.50 → 4 €.
    expect(postQuote(settings, 200)).toEqual({ cents: 400, grams: 250, service: 'Pismo s sledenjem' })
    // A hoodie: 700 + 50 g → up to 1 kg, 4.10 + 0.50 → 5 €.
    expect(postQuote(settings, 700)?.cents).toBe(500)
    // Two hoodies and a CD: 1520 + 50 g → Paket up to 2 kg, 5.94 + 0.50 → 7 €.
    expect(postQuote(settings, 1520)).toMatchObject({ cents: 700, service: 'Paket' })
  })

  it('counts the packaging towards the weight class', () => {
    expect(postQuote(settings, 300)?.service).toBe('Pismo s sledenjem')
    expect(postQuote(settings, 300)?.cents).toBe(400) // 300 + 50 = 350 g: still up to 350 g
    expect(postQuote(settings, 301)?.cents).toBe(500) // 351 g: up to 1 kg
  })

  it('has no price above the heaviest class', () => {
    expect(postQuote(settings, 10_000)).toBeNull()
  })
})

describe('upnPayload', () => {
  const payment = {
    amountCents: 2550,
    purpose: 'Naročilo KRDM-2611-ABCD',
    iban: 'SI56 0110 0100 0000 123',
    name: 'Ime Priimek',
    street: 'Ulica 1',
    city: '4000 Kranj'
  }

  it('lays out 19 lines, a trailing LF and the length as a 3-digit control sum', () => {
    const text = upnPayload(payment)
    const body = text.slice(0, -3)
    const lines = body.split('\n')
    expect(lines).toHaveLength(20) // 19 fields + the empty string after the trailing LF
    expect(lines[0]).toBe('UPNQR')
    expect(lines[8]).toBe('00000002550')
    expect(lines[11]).toBe('OTHR')
    expect(lines[14]).toBe('SI56011001000000123')
    expect(lines[15]).toBe('SI99')
    expect(text.slice(-3)).toBe(String(body.length).padStart(3, '0'))
  })

  it('encodes Slovenian letters in ISO-8859-2', () => {
    expect([...toLatin2('čšž ČŠŽ')]).toEqual([0xe8, 0xb9, 0xbe, 0x20, 0xc8, 0xa9, 0xae])
  })

  it('refuses an IBAN it cannot use', () => {
    expect(isValidUpnIban('SI56 0110 0100 0000 123')).toBe(true)
    expect(isValidUpnIban('DE89 3704 0044 0532 0130 00')).toBe(false)
    expect(() => upnPayload({ ...payment, iban: 'nope' })).toThrow('invalid_iban')
  })
})
