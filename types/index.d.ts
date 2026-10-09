export type RecentPaths = string[]

declare module 'claude-code' {
  interface PluginState {
    'md-preview': { path: string; rev: number; recent: RecentPaths }
  }
}
