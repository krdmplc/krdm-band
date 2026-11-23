export type Locale = 'sl' | 'en'

const formatters: Record<Locale, Intl.NumberFormat> = {
  sl: new Intl.NumberFormat('sl-SI', { style: 'currency', currency: 'EUR' }),
  en: new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })
}

export function eur (cents: number, locale: Locale = 'sl'): string {
  return formatters[locale].format(cents / 100)
}

export function toCents (euros: number): number {
  return Math.round(euros * 100)
}

export function lineTotal (line: { qty: number, unitPriceCents: number, discountCents: number }): number {
  return line.qty * line.unitPriceCents - line.discountCents
}
