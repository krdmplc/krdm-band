// Two languages, chosen per account (Profile). Strings are written as Slovenian +
// English pairs where they are used — t('Shrani', 'Save') — so neither language
// can fall behind. Slovenian: informal "ti", never gendered for the reader.

import { createContext, useContext } from 'react'
import { type Locale, eur } from '../shared/money'

export const LocaleContext = createContext<Locale>('sl')

export function useLocale (): Locale {
  return useContext(LocaleContext)
}

export function useT () {
  const locale = useLocale()
  return (sl: string, en: string) => (locale === 'en' ? en : sl)
}

export function useEur () {
  const locale = useLocale()
  return (cents: number) => eur(cents, locale)
}

export function formatDate (iso: string, locale: Locale, withTime = false): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  return d.toLocaleString(locale === 'en' ? 'en-GB' : 'sl-SI', withTime
    ? { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'numeric', year: 'numeric' })
}

// API error codes (see src/worker) as sentences.
const ERRORS: Record<string, [string, string]> = {
  bad_login: ['Napačen e-naslov ali geslo.', 'Wrong email or password.'],
  signed_out: ['Odjavljen si. Prijavi se znova.', 'You are signed out. Sign in again.'],
  forbidden: ['Za to nimaš pravic.', "You don't have the rights for this."],
  not_found: ['Tega ni (več).', "This doesn't exist (any more)."],
  invite_invalid: ['Povezava ne velja več. Prosi za novo.', 'This link is no longer valid. Ask for a new one.'],
  invalid: ['Nekaj v obrazcu ni prav.', 'Something in the form is not right.'],
  invalid_iban: ['IBAN ni pravilen (SI56 in 15 števk).', 'The IBAN is not valid (SI56 and 15 digits).'],
  bad_password: ['Trenutno geslo ni pravo.', 'The current password is wrong.'],
  email_taken: ['Ta e-naslov že ima račun.', 'This email already has an account.'],
  id_taken: ['Ta oznaka je že zasedena.', 'This id is taken.'],
  full_price_required: ['Polna cena je obvezna.', 'The full price is required.'],
  full_tier_required: ['Polne cene ne moreš odstraniti.', "The full price can't be removed."],
  invalid_sizes: ['Velikosti se ne smejo ponavljati.', 'Sizes must not repeat.'],
  size_has_stock: ['Te velikosti ne moreš odstraniti, ker je še na zalogi.', "You can't remove a size that is still in stock."],
  invalid_image: ['Naloži JPG, PNG ali WebP.', 'Upload a JPG, PNG or WebP.'],
  image_too_large: ['Slika je prevelika.', 'The image is too large.'],
  location_not_found: ['Lokacije ni.', 'Location not found.'],
  same_location: ['Izberi drugo lokacijo.', 'Pick a different location.'],
  nothing_to_move: ['Ni česa premakniti.', 'Nothing to move.'],
  negative_count: ['Štetje ne more biti negativno.', "A count can't be negative."],
  cannot_spend_from_pot: ['Iz tega denarja ne moreš plačevati.', "You can't pay from this money."],
  invalid_pots: ['Tak prenos ni mogoč.', 'That transfer is not possible.'],
  pot_of_other_owner: ['Denar mora biti istega benda.', 'The money must belong to the same band.'],
  pot_not_empty: ['Blagajna ni prazna.', 'The stash is not empty.'],
  wrong_status: ['Naročilo je že v drugem stanju. Osveži stran.', 'The order has moved on. Reload the page.'],
  shipping_unknown: ['Najprej vpiši poštnino.', 'Enter the shipping cost first.'],
  out_of_stock: ['Nekaj ni več na zalogi.', 'Something is out of stock.'],
  empty_order: ['Naročilo je prazno.', 'The order is empty.'],
  unknown_receiver: ['Prejemnika ni.', 'Unknown receiver.'],
  not_a_seller: ['Na tej stojnici ne prodajaš.', "You don't sell at this stand."],
  cannot_demote_self: ['Sebi tega ne moreš narediti.', "You can't do that to yourself."],
  offline: ['Ni povezave. Poskusi, ko boš spet na spletu.', 'No connection. Try again once you are online.'],
  server_error: ['Napaka na strežniku. Poskusi znova.', 'Server error. Try again.']
}

export function errorText (code: string, locale: Locale): string {
  const pair = ERRORS[code] ?? ERRORS.server_error
  return locale === 'en' ? pair[1] : pair[0]
}

export const CATEGORY: Record<string, [string, string]> = {
  apparel: ['Oblačila', 'Apparel'],
  music: ['Glasba', 'Music'],
  other: ['Drugo', 'Other']
}

export const METHOD: Record<string, [string, string]> = {
  cash: ['Gotovina', 'Cash'],
  bank: ['Nakazilo', 'Bank transfer'],
  flik: ['Flik', 'Flik']
}

export const ORDER_STATUS: Record<string, [string, string]> = {
  new: ['Novo', 'New'],
  awaiting_payment: ['Čaka plačilo', 'Awaiting payment'],
  paid: ['Plačano', 'Paid'],
  shipped: ['Poslano / prevzeto', 'Sent / picked up'],
  cancelled: ['Preklicano', 'Cancelled']
}

export const SHIPPING: Record<string, [string, string]> = {
  pickup: ['Osebni prevzem', 'Pickup'],
  post: ['Pošta Slovenije', 'Post (Slovenia)'],
  abroad: ['Tujina', 'Abroad']
}

export const STOCK_TYPE: Record<string, [string, string]> = {
  received: ['Prejeto', 'Received'],
  moved: ['Premik', 'Moved'],
  sold: ['Prodano', 'Sold'],
  reserved: ['Rezervirano', 'Reserved'],
  released: ['Sproščeno', 'Released'],
  counted: ['Štetje', 'Count'],
  returned: ['Vrnjeno', 'Returned']
}

export const TRANSFER_KIND: Record<string, [string, string]> = {
  sale: ['Prodaja', 'Sale'],
  order: ['Naročilo', 'Order'],
  handover: ['Predaja', 'Handover'],
  expense: ['Strošek', 'Expense'],
  payout: ['Izplačilo', 'Payout'],
  refund: ['Vračilo', 'Refund'],
  correction: ['Popravek', 'Correction']
}

export const FLAG: Record<string, [string, string]> = {
  tier_not_allowed: ['cena, ki je prodajalec ne sme uporabiti', 'a price the seller may not use'],
  discount_not_allowed: ['popust brez pravice do popusta', 'a discount without the right to give one'],
  cash_to_someone_else: ['gotovina zapisana drugemu', 'cash recorded for someone else'],
  stand_closed: ['prodaja po zaprtju stojnice', 'sold after the stand closed']
}

export function pick (pair: [string, string] | undefined, locale: Locale, fallback = ''): string {
  return pair ? pair[locale === 'en' ? 1 : 0] : fallback
}
