import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RecentPaths } from '../types'

const PANE = 'md-preview'
const current = atom({ plugin: 'md-preview', key: 'path' } as const, '')
const rev = atom({ plugin: 'md-preview', key: 'rev' } as const, 0)
const recent = atom({ plugin: 'md-preview', key: 'recent' } as const, [] as RecentPaths)

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit'])
const MD_PATH = /^(?:\.{1,2}\/|\/)?(?:[\w.@-]+\/)*[\w.@-]+\.md$/
// Fenced block | [text](href) | `code` | bare path. Order matters: earlier
// alternatives swallow paths that must stay untouched.
const TOKENS =
  /(```[\s\S]*?(?:```|$))|\[([^\]\n]*)\]\(([^)\s]+)\)|`([^`\n]+)`|(?<![\w/.@:-])((?:\.{1,2}\/|\/)?(?:[\w.@-]+\/)*[\w.@-]+\.md)(?![\w/])/g

export function resolvePath(p: string, base: string): string {
  const parts = (p.startsWith('/') ? p : `${base}/${p}`).split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else if (part && part !== '.') out.push(part)
  }
  return `/${out.join('/')}`
}

export const toHref = (abs: string) => `file://${encodeURI(abs)}`
export const fromHref = (href: string) => decodeURI(href.replace(/^file:\/\//, ''))

/**
 * Turn every markdown file reference in `text` into a `file://` link.
 * Bare paths and inline-code paths link only when `keep` accepts them.
 */
export function linkify(text: string, base: string, keep: (abs: string) => boolean) {
  const hrefs = new Set<string>()
  const link = (label: string, abs: string) => {
    const href = toHref(abs)
    hrefs.add(href)
    return `[${label}](${href})`
  }
  const out = text.replace(TOKENS, (m, fence, label, href, code, bare) => {
    if (fence) return m
    if (href !== undefined) {
      const target = href.replace(/#.*$/, '')
      if (/^https?:/.test(target) || !target.endsWith('.md')) return m
      const abs = target.startsWith('file://') ? fromHref(target) : resolvePath(target, base)
      return link(label, abs)
    }
    const path = code ?? bare
    if (!MD_PATH.test(path)) return m
    const abs = resolvePath(path, base)
    return keep(abs) ? link(code ? `\`${code}\`` : bare, abs) : m
  })
  return { text: out, hrefs: [...hrefs] }
}

type Linked = ReturnType<typeof linkify>
// Redraws (scrolls included) re-run the hook, so memoize per text and base.
const linked = new Map<string, Promise<Linked>>()

function linkifyExisting($: EngineInterface, text: string, base: string) {
  const id = `${base}\0${text}`
  let hit = linked.get(id)
  if (!hit) {
    if (linked.size > 500) linked.clear()
    hit = linkifyUncached($, text, base)
    linked.set(id, hit)
  }
  return hit
}

async function linkifyUncached($: EngineInterface, text: string, base: string) {
  const seen = new Set<string>()
  linkify(text, base, abs => (seen.add(abs), false))
  const found = new Set<string>()
  await Promise.all([...seen].map(async abs => (await $.fs.exists(abs)) && found.add(abs)))
  return linkify(text, base, abs => found.has(abs))
}

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)

const HTML_DIR = '/tmp/md-preview'
const htmlPath = (path: string) => `${HTML_DIR}/${path.replace(/[^\w.-]+/g, '_')}.html`
let lastMtime = 0
let inBrowser = false

/** A self-contained page that renders `md` with GitHub styles, highlighting and mermaid. */
export function previewHtml(path: string, md: string, assets: string) {
  const dir = path.slice(0, path.lastIndexOf('/') + 1)
  const hasMermaid = /^```mermaid/m.test(md)
  const data = JSON.stringify(md).replace(/</g, '\\u003c')

  return `<!doctype html><html><head><meta charset="utf-8">
<title>${basename(path).replace(/</g, '&lt;')}</title>
<base href="${toHref(dir)}">
<link rel="stylesheet" href="${assets}/github-markdown.min.css">
<link rel="stylesheet" media="(prefers-color-scheme: light)" href="${assets}/github.min.css">
<link rel="stylesheet" media="(prefers-color-scheme: dark)" href="${assets}/github-dark.min.css">
<style>
:root { --bg: #fff } @media (prefers-color-scheme: dark) { :root { --bg: #0d1117 } }
body { background: var(--bg); margin: 0 }
.markdown-body { box-sizing: border-box; max-width: 900px; margin: 0 auto; padding: 32px 24px }
</style></head><body><article class="markdown-body" id="doc"></article>
<script src="${assets}/marked.min.js"></script>
<script src="${assets}/highlight.min.js"></script>
${hasMermaid ? `<script src="${assets}/mermaid.min.js"></script>` : ''}
<script>
const key = 'scroll:' + location.pathname
const doc = document.getElementById('doc')
doc.innerHTML = marked.parse(${data}, { gfm: true })
doc.querySelectorAll('pre code.language-mermaid').forEach(c => {
  const d = document.createElement('div'); d.className = 'mermaid'; d.textContent = c.textContent
  c.parentElement.replaceWith(d)
})
hljs.registerAliases(['zsh', 'sh', 'shell'], { languageName: 'bash' })
doc.querySelectorAll('pre code').forEach(c => hljs.highlightElement(c))
const restore = () => scrollTo(0, +sessionStorage.getItem(key) || 0)
if (window.mermaid) {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default' })
  mermaid.run().finally(restore)
} else restore()
addEventListener('scroll', () => sessionStorage.setItem(key, scrollY))
</script></body></html>`
}

async function writeHtml($: EngineInterface, path: string) {
  const md = await $.fs.read(path).then(t => t as string, () => `_Cannot read ${path}_`)
  await $.fs.write(htmlPath(path), previewHtml(path, md, toHref(`${$.plugin.root}/assets`)))
}

async function btty($: EngineInterface, ...args: string[]) {
  return $.process.run(['btty', 'browser', ...args]).then(r => r.exitCode === 0, () => false)
}

async function preview($: EngineInterface, path: string) {
  $.ui.status(`Opening ${basename(path)}…`)
  const [mtime] = await Promise.all([
    $.fs.stat(path).then(s => s.mtimeMs, () => -1),
    update($, current, () => path),
    writeHtml($, path),
  ])
  lastMtime = mtime
  inBrowser = await btty($, 'open', toHref(htmlPath(path)))
  $.ui.status(undefined)
  if (inBrowser) return
  await update($, rev, n => n + 1)
  await $.ui.open({ id: PANE, title: basename(path) })
}

let cwd: Promise<string> | undefined

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    $.ui.status(undefined)
    await $.command.register({
      name: 'md',
      description: 'Preview a markdown file rendered',
      argumentHint: '<path>',
    })
    // ponytail: 1s mtime poll — swap for a file watch if the API grows one
    $.clock.every(1000, async () => {
      const { value: path } = await $.state.get({ plugin: 'md-preview', key: 'path' })
      if (!path) return
      const mtime = await $.fs.stat(path).then(s => s.mtimeMs, () => -1)
      if (mtime === lastMtime) return
      lastMtime = mtime
      if (!inBrowser) return void (await update($, rev, n => n + 1))
      await writeHtml($, path)
      inBrowser = await btty($, 'reload')
    })

    return next(e)
  })

  on('command.run', { command: 'md' }, async ($, e) => {
    const path = e.args.trim()
    if (!path) return { text: 'Usage: /md <path>' }
    await preview($, resolvePath(path, await $.session.cwd()))

    return { text: `Previewing ${path}` }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const path = 'file_path' in e ? e.file_path : undefined
    if (FILE_TOOLS.has(e.tool) && typeof path === 'string' && path.endsWith('.md')) {
      await update($, recent, list => [path, ...list.filter(p => p !== path)].slice(0, 5)).catch(
        () => {},
      )
    }

    return ran
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const { text, hrefs } = await linkifyExisting($, e.props.text, await (cwd ??= $.session.cwd()))
    if (hrefs.length === 0) return next(e)
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const body = (
      <Markdown
        key={`md-preview-${e.requestId}`}
        text={text}
        pressableLinks={hrefs}
        onLinkPress={link => void preview($, fromHref(link.href))}
      />
    )
    if (e.surface !== 'terminal') return body

    return (
      <Box flexDirection="row">
        <Box width={2} flexShrink={0}>
          <Text>{e.props.isFirstOfReply ? '●' : ' '}</Text>
        </Box>
        <Box flexGrow={1}>{body}</Box>
      </Box>
    )
  })

  // ponytail: tool-row paths go in a band, not a redrawn tool row — the
  // engine's own row stays intact and folded groups still work.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, recent)
    if (list.length === 0) return next(e)
    const { Markdown } = $.ui.resolve(e)
    const hrefs = list.map(toHref)
    const text = `md: ${list.map((p, i) => `[${basename(p)}](${hrefs[i]})`).join(' · ')}`

    return (
      <Markdown
        key="md-preview-recent"
        text={text}
        dimColor
        pressableLinks={hrefs}
        onLinkPress={link => void preview($, fromHref(link.href))}
      />
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Text, Markdown } = $.ui.resolve(e)
    const path = await read($, current)
    await read($, rev)
    if (!path) return <Text dimColor>No file. Click a .md link or run /md path.</Text>
    const raw = await $.fs.read(path).then(
      t => t as string,
      () => `_Cannot read ${path}_`,
    )
    const { text, hrefs } = await linkifyExisting($, raw, path.slice(0, path.lastIndexOf('/')))

    return (
      <Markdown
        key="md-preview-pane"
        text={text}
        pressableLinks={hrefs}
        onLinkPress={link => void preview($, fromHref(link.href))}
      />
    )
  })
}
