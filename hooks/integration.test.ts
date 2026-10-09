import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const CWD = '/repo'

/** Stand in for the disk, btty and the pane host beneath the mod. */
function world(on: On, files: Record<string, string>, opts: { btty?: boolean } = {}) {
  const disk = new Map(Object.entries(files))
  const mtimes = new Map<string, number>([...disk.keys()].map(p => [p, 1]))
  const writes: { path: string; text: string }[] = []
  const runs: string[][] = []
  const opened: { id: string; title?: string }[] = []

  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', async () => ({ value: CWD }))
  on('fs.exists', async (_$, e) => ({ value: disk.has(e.path) }))
  on('fs.read', async (_$, e) => {
    const text = disk.get(e.path)
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.stat', async (_$, e) => {
    if (!disk.has(e.path)) return { deny: `ENOENT ${e.path}` }
    return { value: { kind: 'file', size: 0, mtimeMs: mtimes.get(e.path) ?? 0, isLink: false } }
  })
  on('fs.write', async (_$, e) => (writes.push({ path: e.path, text: e.text }), { value: undefined }))
  on('process.run', async (_$, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: opts.btty ? 0 : 127, stdout: '', stderr: '' } }
  })
  on('ui.open', async (_$, e) => (opened.push({ id: e.id, title: e.title }), { value: { isPlaced: true } }))
  on('ui.status', async () => ({ value: undefined }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.call', async () => ({ result: 'ok' as never }))
  const clock = mock.clock(on)

  const edit = (path: string, text: string) => {
    disk.set(path, text)
    mtimes.set(path, (mtimes.get(path) ?? 0) + 1)
  }
  return { writes, runs, opened, clock, edit }
}

const start = ($: Engine) => $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
const md = ($: Engine, args: string) => $.command.run({ command: 'md', args, origin: { kind: 'composer' } })
const SURFACES = ['terminal', 'desktop'] as const

test('/md without a path shows usage', async ($, on) => {
  world(on, {})
  await start($)
  expect(await md($, '  ')).toEqual({ text: 'Usage: /md <path>' })
})

test('/md in bigtty writes the page and opens it in a browser pane', async ($, on) => {
  const w = world(on, { '/repo/docs/a.md': '# Title\n</script>' }, { btty: true })
  await start($)
  expect(await md($, 'docs/a.md')).toEqual({ text: 'Previewing docs/a.md' })

  const page = '/tmp/md-preview/_repo_docs_a.md.html'
  expect(w.writes.map(x => x.path)).toEqual([page])
  expect(w.writes[0]?.text).toContain('"# Title\\n\\u003c/script>"')
  expect(w.runs).toEqual([['btty', 'browser', 'open', `file://${page}`]])
  expect(w.opened).toEqual([])
})

test('/md without bigtty opens the side pane with the file', async ($, on) => {
  const w = world(on, { '/repo/a.md': '# A' })
  await start($)
  await md($, 'a.md')
  expect(w.opened).toEqual([{ id: 'md-preview', title: 'a.md' }])

  const pane = await $.ui.mount({
    plugin: 'md-preview',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'md-preview',
    props: { title: 'a.md', isFocused: true },
  })
  expect((await pane.find({ key: 'md-preview-pane' }))?.text).toBe('# A')
})

test('the side pane asks for a file when none is open', async ($, on) => {
  world(on, {})
  await start($)
  const pane = await $.ui.mount({
    plugin: 'md-preview',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'md-preview',
    props: { title: '', isFocused: false },
  })
  expect(await pane.drawn()).toEqual(expect.objectContaining({ type: 'Text', children: ['No file. Click a .md link or run /md path.'] }))
})

test('an edit reloads the browser page within a second', async ($, on) => {
  const w = world(on, { '/repo/a.md': 'one' }, { btty: true })
  await start($)
  await md($, 'a.md')
  await w.clock.advance(1000)
  expect(w.writes.length).toBe(1)

  w.edit('/repo/a.md', 'two')
  await w.clock.advance(1000)
  expect(w.writes.length).toBe(2)
  expect(w.writes[1]?.text).toContain('"two"')
  expect(w.runs.at(-1)).toEqual(['btty', 'browser', 'reload'])
})

test('the row above the prompt lists the last five markdown files used', async ($, on) => {
  world(on, {})
  await start($)
  for (const n of [1, 2, 3, 4, 5, 6, 2]) {
    await $.tool.call({ tool: 'Read', file_path: `/repo/${n}.md` } as never)
  }
  await $.tool.call({ tool: 'Read', file_path: '/repo/code.ts' } as never)

  for (const surface of SURFACES) {
    const band = await $.ui.mount({
      plugin: 'md-preview',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false },
    })
    const text = (await band.find({ key: 'md-preview-recent' }))?.text ?? ''
    expect(text.match(/\[[^\]]+\]/g)).toEqual(['[2.md]', '[6.md]', '[5.md]', '[4.md]', '[3.md]'])
  }
})

test('a reply links existing markdown paths, and a press opens the preview', async ($, on) => {
  const w = world(on, { '/repo/docs/plan.md': '# Plan' }, { btty: true })
  await start($)

  for (const surface of SURFACES) {
    const reply = await $.ui.mount({
      plugin: 'md-preview',
      surface,
      component: 'AssistantMessage',
      requestId: `r-${surface}`,
      props: { text: 'See docs/plan.md and docs/gone.md', isFirstOfReply: true },
    })
    const body = await reply.find({ key: `md-preview-r-${surface}` })
    expect(body?.text).toBe('See [docs/plan.md](file:///repo/docs/plan.md) and docs/gone.md')

    await reply.press({ key: `md-preview-r-${surface}`, link: { href: 'file:///repo/docs/plan.md' } })
    expect(w.runs.at(-1)).toEqual(['btty', 'browser', 'open', 'file:///tmp/md-preview/_repo_docs_plan.md.html'])
  }
})

test('a reply with no markdown paths is left to the engine', async ($, on) => {
  world(on, {})
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, e.props.text)
  })
  await start($)
  const reply = await $.ui.mount({
    plugin: 'md-preview',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'plain',
    props: { text: 'Nothing to link here.', isFirstOfReply: true },
  })
  expect(await reply.find({ key: 'md-preview-plain' })).toBeUndefined()
  expect(await reply.drawn()).toEqual({ type: 'Text', children: ['Nothing to link here.'] })
})
