import { describe, expect, it } from 'vitest'
import { allowedThanks, freePostage } from '../src/shared/website'

describe('allowedThanks (the no-JS contact form redirect)', () => {
  it('accepts the website, its previews and localhost', () => {
    for (const url of [
      'https://www.krdm.si/kontakt/hvala/',
      'https://krdm.si/en/contact/thanks/',
      'https://feat-x-krdm-www.krdm.workers.dev/kontakt/hvala/',
      'https://krdm-www.krdm.workers.dev/kontakt/hvala/',
      'https://deploy-preview-19--krdm-www.netlify.app/kontakt/hvala/',
      'http://localhost:1313/kontakt/hvala/'
    ]) expect(allowedThanks(url)?.toString()).toBe(url)
  })

  it('refuses anything else', () => {
    for (const url of [
      undefined, '', 'not a url', '/kontakt/hvala/', 'javascript:alert(1)',
      'https://evil.example/', 'https://www.krdm.si.evil.example/', 'https://evilkrdm.si/',
      'http://www.krdm.si/', 'https://evil-krdm-band.krdm.workers.dev/', 'https://krdm-www.netlify.app.evil.example/'
    ]) expect(allowedThanks(url)).toBeNull()
  })
})

describe('freePostage', () => {
  const rules = { minOrderCents: 2000, freePostageFromCents: 10000 }
  it('is free by post within Slovenia from the threshold on', () => {
    expect(freePostage(rules, 'post', 10000)).toBe(true)
    expect(freePostage(rules, 'post', 9999)).toBe(false)
  })
  it('never applies to pick-up or abroad', () => {
    expect(freePostage(rules, 'pickup', 50000)).toBe(false)
    expect(freePostage(rules, 'abroad', 50000)).toBe(false)
  })
})
