import { Badge, Button, Group, Select, Table, Text, TextInput } from '@mantine/core'
import { IconPhoto, IconPlus } from '@tabler/icons-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { imageUrl } from '../api'
import { CATEGORY, pick, useEur, useLocale, useT } from '../i18n'
import { canAdmin, useMe } from '../session'
import { ErrorNote, PageHeader, useOwnerName, useOwners, useProductTitle, useProducts } from '../ui'

export function Products () {
  const t = useT()
  const eur = useEur()
  const locale = useLocale()
  const me = useMe()
  const products = useProducts()
  const owners = useOwners()
  const ownerName = useOwnerName()
  const title = useProductTitle()
  const [owner, setOwner] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const list = (products.data ?? []).filter((p) =>
    (!owner || p.ownerId === owner) &&
    (!query || `${p.titleSl} ${p.titleEn} ${p.id}`.toLowerCase().includes(query.toLowerCase())))
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0)

  return (
    <>
      <PageHeader title={t('Izdelki', 'Products')} sub={t('Spletna stran prikaže objavljene izdelke s polno ceno.', 'The website shows published products at their full price.')}>
        <Button component={Link} to="/products/new" leftSection={<IconPlus size={16} />}>{t('Nov izdelek', 'New product')}</Button>
      </PageHeader>
      <Group mb="md" gap="xs">
        <TextInput placeholder={t('Išči', 'Search')} value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
        <Select placeholder={t('Vsi bendi', 'All bands')} clearable value={owner} onChange={setOwner}
          data={(owners.data ?? []).map((o) => ({ value: o.id, label: o.name }))} />
      </Group>
      <ErrorNote error={products.error} />
      <Table.ScrollContainer minWidth={640}>
        <Table highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={56} />
              <Table.Th>{t('Izdelek', 'Product')}</Table.Th>
              <Table.Th>{t('Bend', 'Band')}</Table.Th>
              <Table.Th className="num">{t('Cena', 'Price')}</Table.Th>
              <Table.Th className="num">{t('Zaloga', 'Stock')}</Table.Th>
              <Table.Th className="num">{t('Za splet', 'Online')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {list.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>
                  {p.images[0]
                    ? <img src={imageUrl(p.images[0].key)} alt="" width={40} height={40} style={{ objectFit: 'cover', display: 'block' }} />
                    : <IconPhoto size={24} opacity={0.4} />}
                </Table.Td>
                <Table.Td>
                  {canAdmin(me, p.ownerId) ? <Link to={`/products/${p.id}`}>{title(p)}</Link> : title(p)}
                  <Text size="xs" c="dimmed">{pick(CATEGORY[p.category], locale)}{p.sizes[0] ? ` · ${p.sizes.join(' ')}` : ''}</Text>
                </Table.Td>
                <Table.Td>{ownerName(p.ownerId)}</Table.Td>
                <Table.Td className="num">{p.prices.full !== undefined ? eur(p.prices.full) : '–'}</Table.Td>
                <Table.Td className="num">{sum(p.stock)}</Table.Td>
                <Table.Td className="num">{sum(p.onlineStock)}</Table.Td>
                <Table.Td>
                  {!p.published && <Badge color="gray" variant="light">{t('ni objavljeno', 'unpublished')}</Badge>}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </>
  )
}
