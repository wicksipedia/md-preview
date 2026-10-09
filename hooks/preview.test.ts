import { expect, test } from 'claude-code/testing'

import { fromHref, previewHtml, resolvePath, toHref } from './register'

const page = (md: string, path = '/docs/a.md') => previewHtml(path, md, 'file:///plugin/assets')

test('embeds the markdown so it cannot close the script tag', () => {
  const html = page('x </script><script>alert(1)</script>')
  expect(html).not.toContain('</script><script>alert(1)')
  expect(html).toContain('"x \\u003c/script>\\u003cscript>alert(1)\\u003c/script>"')
})

test('escapes the title and bases relative links on the file folder', () => {
  const html = page('', '/my docs/<b>.md')
  expect(html).toContain('<title>&lt;b>.md</title>')
  expect(html).toContain('<base href="file:///my%20docs/">')
})

test('loads mermaid only when the markdown has a mermaid block', () => {
  expect(page('```mermaid\ngraph TD\n```')).toContain('/mermaid.min.js')
  expect(page('```js\nx\n```')).not.toContain('/mermaid.min.js')
})

test('links every bundled asset from the assets folder', () => {
  const html = page('```mermaid\n```')
  for (const f of ['github-markdown.min.css', 'github.min.css', 'github-dark.min.css', 'marked.min.js', 'highlight.min.js', 'mermaid.min.js']) {
    expect(html).toContain(`file:///plugin/assets/${f}`)
  }
})

test('resolves paths and keeps them inside the root', () => {
  expect(resolvePath('../../../x.md', '/a')).toBe('/x.md')
  expect(resolvePath('/abs/./b.md', '/ignored')).toBe('/abs/b.md')
  expect(fromHref(toHref('/a b/ü#.md'))).toBe('/a b/ü#.md')
})
