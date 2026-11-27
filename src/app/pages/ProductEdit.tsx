import {
  ActionIcon, Button, Card, FileButton, Group, NumberInput, Select, SimpleGrid, Stack, Switch, Table, TagsInput, Text, TextInput,
  Textarea, Title
} from '@mantine/core'
import { IconArrowLeft, IconTrash, IconUpload } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import type { Category, Product, ProductInput, StockRow } from '../../shared/types'
import { api, imageUrl } from '../api'
import { CATEGORY, pick, useEur, useLocale, useT } from '../i18n'
import { canAdmin, useMe } from '../session'
import { ErrorNote, PageHeader, euroInputProps, fromEuros, sizeLabel, toEuros, useLocations, useOwners, useTierName, useTiers, useToast } from '../ui'

const EMPTY: ProductInput = {
  id: '', ownerId: '', titleSl: '', titleEn: '', descriptionSl: '', descriptionEn: '', category: 'apparel',
  link: null, release: null, weightG: 200, sort: 0, artists: [], published: true, archived: false, sizes: ['S', 'M', 'L', 'XL'], prices: {}
}

const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)

// Photos are shrunk on the phone before uploading (longest side 2000 px, JPEG).
async function shrink (file: File): Promise<{ blob: Blob, width: number, height: number }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.85))
  return { blob, width, height }
}

export function ProductEdit () {
  const { productId = 'new' } = useParams()
  const isNew = productId === 'new'
  const t = useT()
  const eur = useEur()
  const locale = useLocale()
  const me = useMe()
  const toast = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const owners = useOwners()
  const tiers = useTiers()
  const tierName = useTierName()
  const locations = useLocations()
  const product = useQuery({ queryKey: ['product', productId], queryFn: () => api.get<Product>(`/api/products/${productId}`), enabled: !isNew })
  const stock = useQuery({ queryKey: ['stock', 'product', productId], queryFn: () => api.get<StockRow[]>(`/api/stock?productId=${productId}`), enabled: !isNew })
  const [form, setForm] = useState<ProductInput>(EMPTY)
  const [oneSize, setOneSize] = useState(false)
  const [idTouched, setIdTouched] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    const p = product.data
    if (!p) return
    setForm({ ...p, link: p.link, release: p.release })
    setOneSize(p.sizes.length === 1 && p.sizes[0] === '')
  }, [product.data])
  useEffect(() => {
    if (isNew && !form.ownerId) {
      const first = owners.data?.find((o) => canAdmin(me, o.id) && !o.archived)
      if (first) setForm((f) => ({ ...f, ownerId: first.id }))
    }
  }, [isNew, owners.data, me, form.ownerId])

  const set = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) => setForm((f) => ({ ...f, [key]: value }))

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, sizes: oneSize ? [''] : form.sizes, link: form.link || null, release: form.release || null }
      return isNew ? api.post<{ id: string }>('/api/products', body) : api.put<{ id: string }>(`/api/products/${productId}`, body)
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['products'] })
      await qc.invalidateQueries({ queryKey: ['product', res.id] })
      toast.ok(t('Shranjeno.', 'Saved.'))
      if (isNew) navigate(`/products/${res.id}`, { replace: true })
    }
  })

  const images = product.data?.images ?? []
  const setImageOrder = useMutation({
    mutationFn: (order: string[]) => api.put(`/api/products/${productId}/images`, { order }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product', productId] }),
    onError: toast.error
  })
  const upload = async (files: File[]) => {
    setUploading(true)
    try {
      for (const file of files) {
        const { blob, width, height } = await shrink(file)
        const fd = new FormData()
        fd.append('file', new File([blob], 'photo.jpg', { type: 'image/jpeg' }))
        fd.append('width', String(width))
        fd.append('height', String(height))
        await api.upload(`/api/products/${productId}/images`, fd)
      }
      await qc.invalidateQueries({ queryKey: ['product', productId] })
    } catch (e) {
      toast.error(e)
    } finally {
      setUploading(false)
    }
  }

  const locationName = (id: string) => locations.data?.find((l) => l.id === id)?.name ?? id

  return (
    <>
      <PageHeader title={isNew ? t('Nov izdelek', 'New product') : form.titleSl}>
        <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={() => navigate('/products')}>{t('Nazaj', 'Back')}</Button>
      </PageHeader>
      <ErrorNote error={product.error ?? save.error} />
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card>
          <Stack>
            <Select label={t('Bend', 'Band')} required allowDeselect={false} value={form.ownerId} onChange={(v) => v && set('ownerId', v)}
              data={(owners.data ?? []).filter((o) => canAdmin(me, o.id)).map((o) => ({ value: o.id, label: o.name }))} />
            <TextInput label={t('Ime (slovensko)', 'Title (Slovenian)')} required value={form.titleSl}
              onChange={(e) => {
                const v = e.currentTarget.value
                setForm((f) => ({ ...f, titleSl: v, id: isNew && !idTouched ? slugify(`${f.ownerId}-${v}`) : f.id }))
              }} />
            <TextInput label={t('Ime (angleško)', 'Title (English)')} value={form.titleEn} onChange={(e) => set('titleEn', e.currentTarget.value)} />
            <TextInput label={t('Oznaka (naslov na spletni strani)', 'Id (the website address)')} required disabled={!isNew}
              description={`krdm.si/merch/${form.id || '…'}/`} value={form.id}
              onChange={(e) => { setIdTouched(true); set('id', slugify(e.currentTarget.value)) }} />
            <Select label={t('Vrsta', 'Category')} allowDeselect={false} value={form.category} onChange={(v) => v && set('category', v as Category)}
              data={Object.keys(CATEGORY).map((c) => ({ value: c, label: pick(CATEGORY[c], locale) }))} />
            <Textarea label={t('Opis (slovensko)', 'Description (Slovenian)')} autosize minRows={3} value={form.descriptionSl} onChange={(e) => set('descriptionSl', e.currentTarget.value)} />
            <Textarea label={t('Opis (angleško)', 'Description (English)')} autosize minRows={3} value={form.descriptionEn} onChange={(e) => set('descriptionEn', e.currentTarget.value)} />
            <TextInput label={t('Povezava (Bandcamp)', 'Link (Bandcamp)')} type="url" value={form.link ?? ''} onChange={(e) => set('link', e.currentTarget.value || null)} />
            <TextInput label={t('Izdaja (ime datoteke na spletni strani)', 'Release (its file name on the website)')} value={form.release ?? ''} onChange={(e) => set('release', e.currentTarget.value || null)} />
            <TagsInput label={t('Bendi na spletni strani', 'Bands on the website')}
              description={t('Samo če jih je več kot lastnik (npr. majica KRDM z vsemi bendi): oznake bendov na krdm.si (ime mape, npr. gmb). Izdelek je potem na strani vsakega od njih.',
                'Only if more than the owner (e.g. the KRDM shirt with every band): the bands\' ids on krdm.si (folder name, e.g. gmb). The item then shows on each of their pages.')}
              value={form.artists} onChange={(v) => set('artists', v.map((a) => a.trim().toLowerCase()).filter(Boolean))} />
          </Stack>
        </Card>
        <Stack>
          <Card>
            <Stack>
              <Title order={4}>{t('Cene', 'Prices')}</Title>
              <SimpleGrid cols={{ base: 1, xs: 3 }}>
                {(tiers.data ?? []).map((tier) => (
                  <NumberInput key={tier.id} {...euroInputProps} label={tierName(tier.id)} required={tier.id === 'full'}
                    value={toEuros(form.prices[tier.id])}
                    onChange={(v) => {
                      const cents = fromEuros(v)
                      const prices = { ...form.prices }
                      if (cents === null) delete prices[tier.id]
                      else prices[tier.id] = cents
                      set('prices', prices)
                    }} />
                ))}
              </SimpleGrid>
              {product.data?.avgCostCents != null && (
                <Text size="sm" c="dimmed">{t('Povprečna nabavna cena', 'Average purchase cost')}: {eur(product.data.avgCostCents)}</Text>
              )}
              <Switch label={t('Brez velikosti (CD, plošča …)', 'No sizes (CD, record …)')} checked={oneSize} onChange={(e) => setOneSize(e.currentTarget.checked)} />
              {!oneSize && (
                <TagsInput label={t('Velikosti', 'Sizes')} description={t('V vrstnem redu, Enter za novo.', 'In order, Enter for a new one.')}
                  value={form.sizes.filter((s) => s !== '')} onChange={(v) => set('sizes', v)} />
              )}
              <NumberInput label={t('Teža brez embalaže', 'Weight without packaging')} suffix=" g" min={0} value={form.weightG}
                description={t('Za izračun poštnine.', 'For the shipping cost.')} onChange={(v) => set('weightG', Number(v) || 0)} />
              <Switch label={t('Objavljeno na spletni strani', 'Published on the website')} checked={form.published} onChange={(e) => set('published', e.currentTarget.checked)} />
              <NumberInput label={t('Vrstni red na spletni strani', 'Order on the website')} min={0} step={10} value={form.sort}
                description={t('Najlepši izdelki naprej: manjša številka je višje, v korakih po 10. 0 = brez mesta (za razvrščenimi, najnovejši prvi).',
                  'Best-looking first: a lower number comes earlier, in steps of 10. 0 = unranked (after the ranked ones, newest first).')}
                onChange={(v) => set('sort', Number(v) || 0)} />
              {!isNew && <Switch label={t('Arhivirano (ne prodajamo več)', 'Archived (no longer sold)')} checked={form.archived ?? false} onChange={(e) => set('archived', e.currentTarget.checked)} />}
              <Group>
                <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!form.titleSl || !form.id || form.prices.full === undefined}>
                  {t('Shrani', 'Save')}
                </Button>
              </Group>
            </Stack>
          </Card>

          {!isNew && (
            <Card>
              <Group justify="space-between" mb="xs">
                <Title order={4}>{t('Fotografije', 'Photos')}</Title>
                <FileButton onChange={(files) => void upload(files)} accept="image/jpeg,image/png,image/webp" multiple>
                  {(props) => <Button {...props} variant="default" size="xs" loading={uploading} leftSection={<IconUpload size={14} />}>{t('Naloži', 'Upload')}</Button>}
                </FileButton>
              </Group>
              <Text size="xs" c="dimmed" mb="xs">{t('Prva je glavna.', 'The first one is the main photo.')}</Text>
              <SimpleGrid cols={3} spacing="xs">
                {images.map((img, i) => (
                  <div key={img.id} style={{ position: 'relative' }}>
                    <img src={imageUrl(img.key)} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                    <Group gap={4} pos="absolute" top={4} right={4}>
                      {i > 0 && (
                        <ActionIcon size="sm" variant="filled" onClick={() => setImageOrder.mutate([img.id, ...images.filter((x) => x.id !== img.id).map((x) => x.id)])} aria-label={t('Naj bo glavna', 'Make main')}>1</ActionIcon>
                      )}
                      <ActionIcon size="sm" variant="filled" color="red" onClick={() => { if (window.confirm(t('Odstranim fotografijo?', 'Remove this photo?'))) setImageOrder.mutate(images.filter((x) => x.id !== img.id).map((x) => x.id)) }} aria-label={t('Odstrani', 'Remove')}>
                        <IconTrash size={12} />
                      </ActionIcon>
                    </Group>
                  </div>
                ))}
              </SimpleGrid>
            </Card>
          )}

          {!isNew && (
            <Card>
              <Title order={4} mb="xs">{t('Zaloga po lokacijah', 'Stock by location')}</Title>
              <Table>
                <Table.Tbody>
                  {(stock.data ?? []).map((r) => (
                    <Table.Tr key={`${r.locationId}|${r.size}`}>
                      <Table.Td>{locationName(r.locationId)}</Table.Td>
                      <Table.Td>{sizeLabel(r.size)}</Table.Td>
                      <Table.Td className="num" c={r.qty < 0 ? 'red' : undefined}>{r.qty}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              {stock.data?.length === 0 && <Text c="dimmed" size="sm">{t('Ni zaloge. Dodaj jo na strani Zaloga (Prejem).', 'No stock. Add it on the Stock page (Receive).')}</Text>}
            </Card>
          )}
        </Stack>
      </SimpleGrid>
    </>
  )
}
