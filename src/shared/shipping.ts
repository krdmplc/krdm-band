// Shipping within Slovenia by Pošta Slovenije: the price class for the parcel's
// weight (items + packaging), plus the packaging's cost, rounded up (to whole
// euros by default). Abroad is quoted by hand.

export interface ShippingBracket {
  maxGrams: number
  cents: number
  service: string
}

export interface ShippingSettings {
  packagingGrams: number
  packagingCents: number
  roundToCents: number
  brackets: ShippingBracket[]
}

export interface PostQuote {
  cents: number
  grams: number
  service: string
}

export function postQuote (settings: ShippingSettings, itemGrams: number): PostQuote | null {
  const grams = itemGrams + settings.packagingGrams
  const bracket = [...settings.brackets]
    .sort((a, b) => a.maxGrams - b.maxGrams)
    .find((b) => grams <= b.maxGrams)
  if (!bracket) return null
  const step = Math.max(1, settings.roundToCents)
  const cents = Math.ceil((bracket.cents + settings.packagingCents) / step) * step
  return { cents, grams, service: bracket.service }
}
