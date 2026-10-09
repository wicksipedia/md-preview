import { expect, test } from 'claude-code/testing'

import { fromHref, linkify, resolvePath } from './register'

const all = () => true

test('links bare, inline-code and relative markdown paths', () => {
  const { text, hrefs } = linkify(
    'See docs/plan.md, `notes.md` and [spec](../spec.md#top).',
    '/repo/src',
    all,
  )
  expect(text).toBe(
    'See [docs/plan.md](file:///repo/src/docs/plan.md), ' +
      '[`notes.md`](file:///repo/src/notes.md) and [spec](file:///repo/spec.md).',
  )
  expect(hrefs.length).toBe(3)
})

test('leaves fences, urls, non-md and rejected paths alone', () => {
  const src = '```\na.md\n```\nhttps://x.com/b.md [c](d.txt) e.md'
  expect(linkify(src, '/r', () => false).text).toBe(src)
})

test('round-trips paths with spaces', () => {
  const { hrefs } = linkify('`my notes.md`', '/r', all)
  expect(hrefs.length).toBe(0)
  expect(fromHref(linkify('[x](file:///a%20b/c.md)', '/r', all).hrefs[0] ?? '')).toBe('/a b/c.md')
  expect(resolvePath('./a/../b.md', '/r')).toBe('/r/b.md')
})
