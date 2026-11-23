import type { Notification } from '../../shared/types'
import { FLAG, pick, useEur, useLocale, useT } from '../i18n'
import { useOwnerName } from '../ui'

// Notifications are stored as topic + params and worded here, in the reader's language.
export function useNotificationText () {
  const t = useT()
  const eur = useEur()
  const locale = useLocale()
  const ownerName = useOwnerName()
  return (n: Notification): string => {
    const p = n.params
    switch (n.topic) {
      case 'order.new':
        return t(`Novo naročilo ${p.number}: ${p.customer}, ${eur(Number(p.cents))}`, `New order ${p.number}: ${p.customer}, ${eur(Number(p.cents))}`)
      case 'stock.negative':
        return t(`Zaloga pod ničlo: ${p.product} ${p.size} v lokaciji ${p.location} (${p.qty}). Preštej jo.`,
          `Stock below zero: ${p.product} ${p.size} at ${p.location} (${p.qty}). Count it.`)
      case 'sale.flagged': {
        const flags = String(p.flags).split(', ').map((f) => pick(FLAG[f], locale, f)).join(', ')
        return t(`Prodaja na stojnici ${p.stand} (${p.seller}): ${flags}`, `Sale at ${p.stand} (${p.seller}): ${flags}`)
      }
      case 'transfer.pending':
        return t(`${p.from} ti predaja ${eur(Number(p.amountCents))} (${ownerName(String(p.owner))}). Potrdi, ko ga dobiš.`,
          `${p.from} is handing you ${eur(Number(p.amountCents))} (${ownerName(String(p.owner))}). Confirm once you have it.`)
      case 'transfer.decided':
        return p.outcome === 'done'
          ? t(`Predaja ${eur(Number(p.amountCents))} je potrjena (${p.by}).`, `Handover of ${eur(Number(p.amountCents))} confirmed (${p.by}).`)
          : t(`Predaja ${eur(Number(p.amountCents))} je zavrnjena (${p.by}).`, `Handover of ${eur(Number(p.amountCents))} rejected (${p.by}).`)
      default:
        return n.topic
    }
  }
}
