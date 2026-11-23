// Shapes of the JSON the API sends and receives, shared by the Worker and the app.
// Money is in cents, timestamps are ISO strings, one-size products have size ''.

import type { Locale } from './money'

export type Category = 'apparel' | 'music' | 'other'
export type PayMethod = 'cash' | 'bank' | 'flik'
export type OrderStatus = 'new' | 'awaiting_payment' | 'paid' | 'shipped' | 'cancelled'
export type ShippingMethod = 'pickup' | 'post' | 'abroad'
export type TransferKind = 'sale' | 'order' | 'handover' | 'expense' | 'payout' | 'refund' | 'correction'

export interface Me {
  id: string
  name: string
  email: string
  locale: Locale
  isLabelAdmin: boolean
  // Owners this person can manage (all of them for a label admin).
  adminOf: string[]
  iban: string | null
  street: string | null
  city: string | null
  flikPhone: string | null
}

export interface UserSummary {
  id: string
  name: string
}

export interface UserAdmin extends UserSummary {
  email: string
  isLabelAdmin: boolean
  adminOf: string[]
  disabled: boolean
  hasPassword: boolean
}

export interface Owner {
  id: string
  name: string
  kind: 'band' | 'label'
  archived: boolean
  admins: UserSummary[]
}

export interface Tier {
  id: string
  nameSl: string
  nameEn: string
}

export interface ProductImage {
  id: string
  key: string
  width: number | null
  height: number | null
}

export interface Product {
  id: string
  ownerId: string
  titleSl: string
  titleEn: string
  descriptionSl: string
  descriptionEn: string
  category: Category
  link: string | null
  release: string | null
  weightG: number
  published: boolean
  archived: boolean
  sizes: string[]
  prices: Record<string, number>
  images: ProductImage[]
  // Stock per size summed over all locations, and over online locations only.
  stock: Record<string, number>
  onlineStock: Record<string, number>
  // Moving average purchase cost; only for people who manage the owner.
  avgCostCents?: number | null
  updatedAt: string
}

export interface ProductInput {
  id: string
  ownerId: string
  titleSl: string
  titleEn: string
  descriptionSl: string
  descriptionEn: string
  category: Category
  link: string | null
  release: string | null
  weightG: number
  published: boolean
  archived?: boolean
  sizes: string[]
  prices: Record<string, number>
}

export interface Location {
  id: string
  name: string
  keeperId: string | null
  keeperName: string | null
  online: boolean
  archived: boolean
  pieces: number
}

export interface StockRow {
  productId: string
  size: string
  locationId: string
  qty: number
}

export interface StockEntry {
  id: string
  productId: string
  size: string
  locationId: string
  qty: number
  type: string
  unitCostCents: number | null
  note: string | null
  createdByName: string | null
  createdAt: string
}

export interface StandSeller {
  userId: string
  name: string
  floatCents: number
  tiers: string[]
  countedCashCents: number | null
  // Float + cash this seller received at the stand.
  expectedCashCents: number
}

export interface StandSummary {
  id: string
  name: string
  date: string
  place: string | null
  locationId: string
  locationName: string
  status: 'open' | 'closed'
  sellerIds: string[]
  canManage: boolean
}

export interface StandPrice {
  productId: string
  tierId: string
  priceCents: number
}

export interface StandDetail extends StandSummary {
  sellers: StandSeller[]
  prices: StandPrice[]
  totals: { ownerId: string, cents: number }[]
  byMethod: { method: PayMethod, cents: number }[]
}

// Everything a phone needs to sell at a stand without a connection.
export interface StandSnapshot {
  fetchedAt: string
  stand: StandSummary
  me: { id: string, tiers: string[], adminOf: string[] }
  sellers: { id: string, name: string, iban: string | null, street: string | null, city: string | null, flikPhone: string | null }[]
  tiers: Tier[]
  owners: { id: string, name: string }[]
  products: {
    id: string
    ownerId: string
    titleSl: string
    titleEn: string
    category: Category
    imageKey: string | null
    sizes: { size: string, stock: number }[]
    prices: Record<string, number>
  }[]
}

export interface SaleItemInput {
  productId: string
  size: string
  qty: number
  tierId: string
  unitPriceCents: number
  discountCents: number
  reason?: string | null
}

export interface SaleInput {
  id: string
  standId: string
  method: PayMethod
  receiverId: string
  soldAt: string
  deviceId: string
  // Set when a guardian made the sale (entered later from the tally sheet).
  guardianName?: string | null
  items: SaleItemInput[]
}

export interface SyncResult {
  id: string
  status: 'saved' | 'duplicate' | 'rejected'
  error?: string
  flags?: string[]
}

export interface Sale {
  id: string
  standId: string | null
  sellerId: string
  sellerName: string
  receiverId: string
  receiverName: string
  method: PayMethod
  totalCents: number
  soldAt: string
  guardianName: string | null
  flags: string[]
  voided: boolean
  items: (SaleItemInput & { ownerId: string, title: string })[]
}

export interface OrderItem {
  productId: string
  size: string
  ownerId: string
  qty: number
  unitPriceCents: number
  title: string
}

export interface Order {
  id: string
  number: string
  status: OrderStatus
  source: 'web' | 'manual'
  locale: Locale
  customerName: string
  email: string | null
  phone: string | null
  street: string | null
  postcode: string | null
  city: string | null
  country: string | null
  note: string | null
  shippingMethod: ShippingMethod
  itemsCents: number
  shippingCents: number | null
  postageCents: number | null
  postagePaidBy: string | null
  handlerId: string | null
  paymentMethod: PayMethod | null
  paymentReceiverId: string | null
  paidAt: string | null
  shippedAt: string | null
  createdAt: string
  items: OrderItem[]
  log?: { event: string, detail: string | null, userName: string | null, createdAt: string }[]
}

export interface Pot {
  id: string
  kind: 'person' | 'stash' | 'external'
  ownerId: string | null
  userId: string | null
  name: string | null
  keeperId: string | null
  // The person holding it: the person for a person pot, the keeper for a stash.
  holderName: string | null
  balanceCents: number
  pendingInCents: number
  pendingOutCents: number
}

export interface Transfer {
  id: string
  ownerId: string
  fromPot: string
  toPot: string
  fromLabel: string
  toLabel: string
  amountCents: number
  kind: TransferKind
  status: 'pending' | 'done' | 'rejected'
  note: string | null
  createdByName: string | null
  createdAt: string
  // The person signed in may confirm or reject it.
  canDecide: boolean
}

export interface Notification {
  id: number
  topic: string
  params: Record<string, string | number>
  link: string | null
  read: boolean
  createdAt: string
}

export interface ReportRow {
  key: string
  label: string
  qty: number
  revenueCents: number
  costCents: number | null
}

// Public API (the website).
export interface CatalogItem {
  id: string
  owner: { id: string, name: string }
  title: string
  description: string
  category: Category
  link: string | null
  release: string | null
  priceCents: number
  weightG: number
  images: { url: string, width: number | null, height: number | null }[]
  sizes: { size: string, available: boolean }[]
  available: boolean
  updatedAt: string
}

export interface CartLineInput {
  productId: string
  size: string
  qty: number
}

export interface QuoteResult {
  lines: (CartLineInput & { title: string, unitPriceCents: number, available: boolean })[]
  itemsCents: number
  shippingCents: number | null
  totalCents: number | null
  postService: string | null
}
