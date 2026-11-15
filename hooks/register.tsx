import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Metric, Row, Split, Usage, View } from '../types'

const PANE = 'token-usage'
const DAYS = 7
const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767']
const MUTED = '#898781'

const usage = atom({ plugin: 'token-usage', key: 'usage' } as const, null, { shape: 'usage-1' })
const metric = atom({ plugin: 'token-usage', key: 'metric' } as const, 'all', { shape: 'metric-1' })
const view = atom({ plugin: 'token-usage', key: 'view' } as const, 'session', { shape: 'view-1' })

const val = (v: number[] | undefined, m: Metric) => {
  if (!v) return 0
  const [i, o, cw, cr] = v
  return m === 'out' ? o : m === 'nocr' ? i + o + cw : i + o + cw + cr
}
const part = (s: Split | undefined, m: Metric) => ({
  main: val(s?.main, m),
  sub: val(s?.sub, m),
})
const fmt = (n: number) =>
  n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n))

const nice = (v: number) => {
  if (v <= 0) return 1
  const raw = v / 3
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p * 3
  return 10 * p * 3
}

function chart(u: Usage, rows: Row[], m: Metric, horizontal: boolean): string {
  const ids = u.models.map(x => x.id)
  const color = (id: string) => COLORS[ids.indexOf(id)] ?? MUTED
  const W = 360
  const defs = ids
    .map(
      (id, i) =>
        `<pattern id="h${i}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${color(id)}"/><rect width="2.5" height="6" fill="#1a1a19" opacity="0.55"/></pattern>`,
    )
    .join('')
  let body = ''
  const totals = rows.map(r => ids.reduce((s, id) => s + part(r.byModel[id], m).main + part(r.byModel[id], m).sub, 0))
  const top = nice(Math.max(...totals, 0))
  if (horizontal) {
    const H = 44
    const x0 = 6, iw = W - 12
    let x = x0
    ids.forEach((id, i) => {
      const p = part(rows[0].byModel[id], m)
      const wm = (iw * p.main) / top, ws = (iw * p.sub) / top
      if (wm > 0) { body += `<rect x="${x}" y="8" width="${wm}" height="22" fill="${color(id)}"/>`; x += wm }
      if (ws > 0) { body += `<rect x="${x}" y="8" width="${ws}" height="22" fill="url(#h${i})"/>`; x += ws }
    })
    body += `<text x="${x0}" y="42" font-size="10" fill="${MUTED}">0</text><text x="${W - 6}" y="42" font-size="10" text-anchor="end" fill="${MUTED}">${fmt(top)}</text>`
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${defs}</defs>${body}</svg>`
  }
  const H = 170, l = 38, b = 20, t = 8, ih = H - t - b, iw = W - l - 4
  for (let k = 0; k <= 3; k++) {
    const y = t + ih - (ih * k) / 3
    body += `<line x1="${l}" x2="${W - 4}" y1="${y}" y2="${y}" stroke="${MUTED}" stroke-opacity="${k ? 0.25 : 0.6}"/><text x="${l - 4}" y="${y + 3}" font-size="10" text-anchor="end" fill="${MUTED}">${fmt((top * k) / 3)}</text>`
  }
  const band = iw / rows.length, bw = Math.min(28, band * 0.6)
  rows.forEach((r, ri) => {
    let y = t + ih
    const x = l + band * ri + (band - bw) / 2
    ids.forEach((id, i) => {
      const p = part(r.byModel[id], m)
      for (const [fill, v] of [[color(id), p.main], [`url(#h${i})`, p.sub]] as const) {
        const h = (ih * v) / top
        if (h > 0) { body += `<rect x="${x}" y="${y - h}" width="${bw}" height="${Math.max(0, h - 1)}" fill="${fill}"/>`; y -= h }
      }
    })
    body += `<text x="${x + bw / 2}" y="${H - 6}" font-size="10" text-anchor="middle" fill="${MUTED}">${r.label.split(' ')[1] ?? r.label}</text>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${defs}</defs>${body}</svg>`
}

let busy = false
async function refresh($: any) {
  if (busy) return
  busy = true
  try {
    const id = await $.session.id()
    const run = await $.process.run(['python3', `${$.plugin.root}/scan.py`, id, String(DAYS)], { timeoutMs: 120000 })
    const next: Usage =
      run.exitCode === 0
        ? JSON.parse(run.stdout)
        : { models: [], session: { key: id, label: '', byModel: {} }, days: [], at: Date.now(), error: run.stderr.slice(0, 300) }
    await update($, usage, () => next)
  } catch (err) {
    await update($, usage, () => ({ models: [], session: { key: '', label: '', byModel: {} }, days: [], at: Date.now(), error: String(err) }))
  } finally {
    busy = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'token-usage', description: 'Show token usage by model in a side panel' })
    void $.ui.open({ id: PANE, title: 'Token usage' })
    void refresh($)
    $.clock.every(20000, () => refresh($))
    return next(e)
  })
  on('command.run', { command: 'token-usage' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Token usage' })
    void refresh($)
    return { text: 'Token usage pane opened.' }
  })
  on('turn.complete', async ($, e, next) => {
    void refresh($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e) as any
    const { Box, Text, Button } = ui
    const u = await read($, usage)
    const m = await read($, metric)
    const v = await read($, view)
    const toggle = (label: string, isOn: boolean, fn: () => void) => (
      <Button key={label} plain onPress={fn}>
        <Text bold={isOn} dimColor={!isOn}>{isOn ? `[${label}]` : ` ${label} `}</Text>
      </Button>
    )
    const controls = (
      <Box flexDirection="column">
        <Box>
          {toggle('Session', v === 'session', () => update($, view, () => 'session'))}
          {toggle('7 days', v === 'days', () => update($, view, () => 'days'))}
        </Box>
        <Box>
          {toggle('All', m === 'all', () => update($, metric, () => 'all'))}
          {toggle('No cache reads', m === 'nocr', () => update($, metric, () => 'nocr'))}
          {toggle('Output', m === 'out', () => update($, metric, () => 'out'))}
        </Box>
      </Box>
    )
    if (!u) return <Box flexDirection="column">{controls}<Text dimColor>Reading logs…</Text></Box>
    if (u.error) return <Box flexDirection="column">{controls}<Text color="red">Scan failed: {u.error}</Text></Box>

    const rows = v === 'session' ? [u.session] : u.days
    const ids = u.models.map(x => x.id)
    const sum = (r: Row, id: string) => { const p = part(r.byModel[id], m); return p.main + p.sub }
    const grand = rows.reduce((s, r) => s + ids.reduce((a, id) => a + sum(r, id), 0), 0)
    const color = (id: string) => COLORS[ids.indexOf(id)] ?? MUTED
    const active = u.models.filter(x => rows.some(r => sum(r, x.id) > 0))
    const hasSub = rows.some(r => ids.some(id => part(r.byModel[id], m).sub > 0))
    const svg = ui.Svg
      ? <ui.Svg source={chart(u, rows, m, v === 'session')} alt="Stacked token usage by model" />
      : null

    return (
      <Box flexDirection="column">
        {controls}
        <Text dimColor>{v === 'session' ? 'This session' : 'Last 7 days'} · {fmt(grand)} tokens · {new Date(u.at).toLocaleTimeString()}</Text>
        {grand === 0 && <Text dimColor>No usage in this range yet.</Text>}
        {svg}
        {active.map(x => {
          const tot = rows.reduce((s, r) => s + sum(r, x.id), 0)
          const sub = rows.reduce((s, r) => s + part(r.byModel[x.id], m).sub, 0)
          const bar = '█'.repeat(Math.max(1, Math.round((12 * tot) / (grand || 1))))
          return (
            <Box key={x.id}>
              <Text color={color(x.id)}>{svg ? '■' : bar} </Text>
              <Text>{x.name} {fmt(tot)} · {grand ? Math.round((100 * tot) / grand) : 0}%{sub ? ` (subagents ${fmt(sub)})` : ''}</Text>
            </Box>
          )
        })}
        {hasSub && <Text dimColor>Solid = main thread · striped = subagents</Text>}
      </Box>
    )
  })
}
