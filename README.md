# md-preview

A Claude Code mod that opens markdown files as rendered pages. Click a `.md` link in Claude's reply and you get a GitHub-styled preview with syntax highlighting, images and Mermaid diagrams.

## Install

At the Claude Code prompt in a terminal session, run:

```
/plugin install md-preview --marketplace wicksipedia/md-preview
```

Answer `y` to add the marketplace, then press Enter to pick the user scope. The mod starts working in that session.

## Use

Click any of these in a reply from Claude:

- markdown links such as `[plan](docs/plan.md)`
- paths in backticks such as `` `docs/plan.md` ``
- bare paths such as docs/plan.md

The mod links bare paths and backtick paths only when the file exists. A plain click opens the preview. Ctrl-click and Cmd-click keep your terminal's own behaviour.

To open a file by name, run `/md <path>`.

The mod also lists the last five markdown files that Claude read or edited in a row above the prompt. Click one to preview it.

While the preview is open, the mod checks the file once a second. When the file changes, the page reloads and keeps your scroll position, so you can watch Claude edit a doc.

## Where the preview shows

In bigtty, the preview opens in a browser pane beside the terminal. The page works offline: its styles and scripts ship in `assets/`.

Without bigtty, the preview opens in a Claude Code side pane. That pane draws markdown with the terminal's own renderer: headings, lists, tables and code, but no images or diagrams.

## Requirements

Plain clicks reach the mod in the fullscreen terminal layout and in the desktop app. In the standard terminal layout, use `/md <path>`.

## Limits

- A link to another `.md` file inside the browser preview opens the raw file.
- If you change directory during a session, bare paths still resolve against the directory the session started in.

## Develop

```
claude --plugin-dir .
claude plugin validate .
claude plugin test .
```

`claude plugin test .` runs two kinds of test:

- Unit tests (`hooks/linkify.test.ts`, `hooks/preview.test.ts`) check the link and page-building functions on their own.
- Integration tests (`hooks/integration.test.ts`) load the whole mod into the Claude Code test engine. Fake hooks stand in for the disk, btty and the side pane. The tests run `/md`, mount the reply, pane and prompt-row components, press links, and move a fake clock to check live reload.

## Bundled assets

`assets/` holds copies of these files:

- github-markdown-css 5.5.1
- highlight.js 11.9.0, with the `github` and `github-dark` styles
- marked 12.0.2
- mermaid 10.9.1

`scripts/update-assets.sh` holds the pinned versions and downloads each file from jsDelivr. To update a library:

1. Change its version at the top of `scripts/update-assets.sh`.
2. Run `scripts/update-assets.sh`.
3. Change the version in the list above.
4. Run `claude plugin test .`, then open a preview with code, a table and a Mermaid diagram to check it still renders.

To check that the files in `assets/` match the pinned versions, run `scripts/update-assets.sh --check`.

## License

MIT. See [LICENSE](LICENSE).
