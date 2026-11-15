export type Vec = [number, number, number, number]
export type Split = { main: Vec; sub: Vec }
export type Row = { key: string; label: string; byModel: Record<string, Split> }
export type Usage = {
  models: { id: string; name: string }[]
  session: Row
  days: Row[]
  at: number
  error?: string
}
export type Metric = 'all' | 'nocr' | 'out'
export type View = 'session' | 'days'

declare module 'claude-code' {
  interface PluginState {
    'token-usage': {
      usage: Shaped<Usage | null>
      metric: Shaped<Metric>
      view: Shaped<View>
    }
  }
}
