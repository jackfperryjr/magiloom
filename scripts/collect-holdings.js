#!/usr/bin/env node
// Fill the account inventory by logging each character in and asking.
//
// The account inventory (Lantern → character menu → Account inventory) only knows
// what a character reported the last time INV LIST or VAULT STANDARD was run on it.
// This walks every character on every saved game account, in turn: logs in, runs the
// reports, files them, and logs out again. Run it when you want the whole list fresh.
//
//   node scripts/collect-holdings.js --dry-run        # show the plan; logs nobody in
//   node scripts/collect-holdings.js                  # everyone
//   node scripts/collect-holdings.js --only Refia,Penello
//
// It goes THROUGH the Magiloom server rather than straight to the game, for two
// reasons: the server already holds the game passwords you saved from the login
// screen (so none are typed or stored here), and the account inventory lives there.
// It is an ordinary client — it speaks the same WebSocket envelope the web app does
// and uses the same parser and report reader, bundled from src/ at start-up, so what
// it files is exactly what the app would have filed had you typed the commands.
//
// THINGS IT WILL DO TO YOUR CHARACTERS — read before running:
//   • Logging a character in DISCONNECTS any other character of the same game account
//     that is playing. Accounts with a character live in another Lantern web session
//     are skipped (override with --force); a character logged in some other way —
//     the desktop app, another front end — cannot be seen from here and WILL be
//     dropped.
//   • INV LIST costs 3 seconds of roundtime, VAULT STANDARD 5 and a runner. Each
//     character is in the game for roughly 20–30 seconds, standing wherever they
//     were left.
//   • It logs out with QUIT, so characters leave cleanly rather than lingering.
//
// Sign-in: MAGILOOM_EMAIL / MAGILOOM_PASSWORD (prompted for when not set), and
// MAGILOOM_TOKEN — the server's access token, the same one the web build is given.
// MAGILOOM_SERVER overrides the server (default: the hosted one).
//
// Options:
//   --dry-run            List accounts and characters and what would be run. Signs in
//                        to each game account to read its character list, but enters
//                        the game with no one.
//   --only A,B           Only these characters.
//   --skip A,B           Everyone but these.
//   --accounts X,Y       Only these game accounts.
//   --instance CODE      Game instance to use for every account (default: the one each
//                        account last logged in to from Lantern, else DR — Prime).
//   --no-vault           INV LIST only.
//   --family             Also run VAULT FAMILY, once per game account.
//   --force              Don't skip accounts that have a character playing.
//   --pause SECONDS      Wait between characters (default 3).

const { buildSync } = require('esbuild')
const path = require('path')
const fs = require('fs')
const readline = require('readline')

const ROOT = path.resolve(__dirname, '..')

// ── Options ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = name => argv.includes(`--${name}`)
const opt  = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? (argv[i + 1] ?? '') : '' }
const list = name => opt(name).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

const OPTS = {
  dryRun:   flag('dry-run'),
  only:     list('only'),
  skip:     list('skip'),
  accounts: list('accounts'),
  instance: opt('instance'),
  vault:    !flag('no-vault'),
  family:   flag('family'),
  force:    flag('force'),
  pause:    Math.max(0, Number(opt('pause') || 3)) * 1000,
}
if (flag('help') || flag('h')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 47).map(l => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(0)
}

const SERVER = (process.env.MAGILOOM_SERVER || 'wss://magiserver.up.railway.app').replace(/\/+$/, '')
const HTTP   = SERVER.replace(/^ws(s?):\/\//, 'http$1://')

// How long to wait for the game before giving up on one step.
const LOGIN_TIMEOUT  = 60_000
const REPORT_TIMEOUT = 15_000

const sleep = ms => new Promise(r => setTimeout(r, ms))
const log   = (...a) => console.log(...a)

// ── The app's own parser and report reader ───────────────────────────────────
// Bundled from src/ on every run, so this can never drift from what the client
// recognises as a report. esbuild is already here (it ships with vite).
function loadLib() {
  const out = path.join(ROOT, 'node_modules', '.cache', 'collect-holdings', 'lib.cjs')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const entry = path.join(path.dirname(out), 'entry.ts')
  const lib = path.join(ROOT, 'src', 'renderer', 'src', 'lib').replace(/\\/g, '/')
  fs.writeFileSync(entry,
    `export { parseLine, resetParser } from '${lib}/sge-parser'\n` +
    `export { HoldingsReader } from '${lib}/holdings'\n`)
  buildSync({ entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' })
  return require(out)
}

// ── Server connection (the web client's envelope; see src/web/dr.ts) ──────────
//   invoke → { t:'invoke', id, channel, args }   ← { t:'result', id, ok, result|error }
//   event  ← { t:'event', channel, args }
class Client {
  constructor(url) {
    this.url = url
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
  }

  open() {
    return new Promise((resolve, reject) => {
      const ws = this.ws = new WebSocket(this.url)
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error('Could not reach the server (is MAGILOOM_TOKEN right?).'))
      ws.onclose = () => {
        for (const p of this.pending.values()) p.reject(new Error('The server closed the connection.'))
        this.pending.clear()
      }
      ws.onmessage = ev => {
        let msg
        try { msg = JSON.parse(String(ev.data)) } catch { return }
        if (msg.t === 'result') {
          const p = this.pending.get(msg.id)
          if (!p) return
          this.pending.delete(msg.id)
          if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || 'request failed'))
        } else if (msg.t === 'event') {
          for (const cb of [...(this.listeners.get(msg.channel) ?? [])]) cb(...(msg.args ?? []))
        }
      }
    })
  }

  invoke(channel, ...args) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ t: 'invoke', id, channel, args }))
    })
  }

  on(channel, cb) {
    if (!this.listeners.has(channel)) this.listeners.set(channel, new Set())
    this.listeners.get(channel).add(cb)
    return () => this.listeners.get(channel).delete(cb)
  }

  /** Resolve on the next `channel` event, or reject after `ms`. */
  once(channel, ms, what) {
    return new Promise((resolve, reject) => {
      const off = this.on(channel, (...a) => { clearTimeout(t); off(); resolve(a) })
      const t = setTimeout(() => { off(); reject(new Error(`Timed out waiting for ${what}.`)) }, ms)
    })
  }

  close() { try { this.ws.close() } catch { /* already closed */ } }
}

// ── Prompts for anything not supplied ────────────────────────────────────────
function ask(question, { hidden = false } = {}) {
  if (!process.stdin.isTTY) throw new Error(`${question.trim()} is not set, and there is no terminal to ask on.`)
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    // Hidden input: let readline keep track of what is typed, and print nothing.
    if (hidden) rl._writeToOutput = s => { if (s.includes(question)) process.stdout.write(question) }
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()) })
  })
}

// ── One character ────────────────────────────────────────────────────────────
/**
 * Log `character` in, run the reports, file them, log out.
 * Returns what was filed, e.g. { inv: 214, vault: 110 }, or throws with the reason.
 */
async function collect(client, lib, { account, password, instance, character, wantVault, wantFamily }) {
  lib.resetParser()
  const reader = new lib.HoldingsReader()
  let prompts = 0
  let waitSeconds = 0          // set when the game answers "...wait N seconds."
  let onReport = null          // resolver for the report currently being waited on
  let onPrompt = null

  const offData = client.on('game:data', raw => {
    for (const e of lib.parseLine(raw)) {
      if (e.type === 'text' && e.stream === 'main') {
        const wait = /^\.\.\.wait (\d+) seconds?/i.exec(e.text.trim())
        if (wait) waitSeconds = Number(wait[1])
        reader.line(e)
      } else if (e.type === 'prompt') {
        prompts++
        const report = reader.prompt()
        if (report && onReport) { const r = onReport; onReport = null; r(report) }
        if (onPrompt) { const p = onPrompt; onPrompt = null; p() }
      }
    }
  })

  const nextPrompt = ms => new Promise((resolve, reject) => {
    const t = setTimeout(() => { onPrompt = null; reject(new Error('The game stopped answering.')) }, ms)
    onPrompt = () => { clearTimeout(t); resolve() }
  })

  /** Send a report command and wait for the report. Retries once if told to wait. */
  const report = async command => {
    for (let attempt = 0; attempt < 2; attempt++) {
      waitSeconds = 0
      reader.command(command)
      const got = new Promise((resolve, reject) => {
        const t = setTimeout(() => { onReport = null; reject(new Error('no report came back')) }, REPORT_TIMEOUT)
        onReport = r => { clearTimeout(t); resolve(r) }
      })
      await client.invoke('game:send', command)
      try { return await got }
      catch (err) {
        if (!waitSeconds || attempt) throw err
        await sleep((waitSeconds + 1) * 1000)     // still in roundtime: wait it out, once
      }
    }
  }

  const filed = {}
  let inGame = false
  try {
    // SGE sign-in is three steps, and the character can only be picked once per
    // sign-in — so this is repeated in full for every character.
    const auth = await client.invoke('auth:login', account, password)
    if (!auth?.ok) throw new Error(auth?.error || 'the game account sign-in was refused')
    const inst = await client.invoke('auth:select-instance', instance)
    if (!inst?.ok) throw new Error(inst?.error || `instance ${instance} is not available`)
    const who = (inst.characters ?? []).find(c => c.name.toLowerCase() === character.toLowerCase())
    if (!who) throw new Error(`no character named ${character} on ${account} (${instance})`)

    const connected = client.once('game:connected', LOGIN_TIMEOUT, 'the game connection')
    const launch = await client.invoke('auth:select-character', who.id, who.name, account, false)
    if (launch && launch.ok === false) throw new Error(launch.error || 'could not enter the game')
    await connected
    inGame = true

    // Logging in prints news, the room and more; wait for it to finish before typing.
    await nextPrompt(LOGIN_TIMEOUT)
    await sleep(2500)

    const put = async r => {
      await client.invoke('holdings:put', { account, character: who.name, kind: r.kind, items: r.items })
      filed[r.kind] = r.items.length
    }

    await put(await report('inv list'))
    if (wantVault) {
      await sleep(4000)                           // INV LIST's roundtime
      try { await put(await report('vault standard')) }
      catch (err) { filed.vaultError = err.message }
    }
    if (wantFamily) {
      await sleep(6000)                           // the vault report's roundtime
      try { await put(await report('vault family')) }
      catch (err) { filed.familyError = err.message }
    }
    return filed
  } finally {
    offData()
    if (inGame) {
      // QUIT so the character leaves the game, rather than dropping the socket and
      // leaving it standing there until it times out.
      const gone = client.once('game:disconnected', 12_000, 'the logout').catch(() => null)
      await sleep(Math.max(0, waitSeconds) * 1000)
      await client.invoke('game:send', 'quit').catch(() => {})
      if (!(await gone)) await client.invoke('game:disconnect').catch(() => {})
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const lib = loadLib()

  // Sign in to the Magiloom account.
  const email = process.env.MAGILOOM_EMAIL || await ask('Magiloom email: ')
  const pass  = process.env.MAGILOOM_PASSWORD || await ask('Magiloom password: ', { hidden: true })
  const res = await fetch(`${HTTP}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pass }),
  }).then(r => r.json()).catch(() => null)
  if (!res?.ok) throw new Error(res?.error || 'Could not sign in to Magiloom.')

  // Its own device and connection id: a session of its own, beside any you have open.
  const params = new URLSearchParams({ user: `collect-${crypto.randomUUID()}`, conn: crypto.randomUUID(), auth: res.token })
  if (process.env.MAGILOOM_TOKEN) params.set('token', process.env.MAGILOOM_TOKEN)
  const client = new Client(`${SERVER}/ws?${params}`)
  await client.open()

  try {
    try { await client.invoke('holdings:get') }
    catch { throw new Error('This server has no account inventory yet (magiserver needs the holdings store deployed).') }

    const settings = await client.invoke('settings:get-all')
    const paths = settings.loginPaths ?? []
    const names = new Map()        // lower-case → as written
    for (const a of settings.accounts ?? []) names.set(a.name.toLowerCase(), a.name)
    for (const p of paths) if (!names.has(p.account.toLowerCase())) names.set(p.account.toLowerCase(), p.account)
    const accounts = [...names.entries()]
      .filter(([k]) => !OPTS.accounts.length || OPTS.accounts.includes(k))
      .map(([, v]) => v).sort()
    if (!accounts.length) throw new Error('No game accounts are saved on this Magiloom account. Log a character in from Lantern first.')

    // Characters playing right now in another Lantern web session of this account.
    const live = (await client.invoke('session:list').catch(() => []))
      .filter(s => s.connected && !s.current && s.charName).map(s => s.charName.toLowerCase())

    const results = []
    for (const account of accounts) {
      log(`\n${account}`)
      let password = await client.invoke('auth:get-password', account).catch(() => null)
      if (!password) password = process.env[`DR_PASSWORD_${account.toUpperCase()}`] || await ask(`  Game password for ${account}: `, { hidden: true })

      // The instance this account last used from Lantern, unless told otherwise.
      const recent = paths.filter(p => p.account.toLowerCase() === account.toLowerCase())
        .sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0))[0]
      const instance = OPTS.instance || recent?.instance || 'DR'

      // Read the character list. This signs in to the account but enters no game.
      const auth = await client.invoke('auth:login', account, password)
      if (!auth?.ok) { log(`  skipped — sign-in refused: ${auth?.error ?? 'unknown error'}`); continue }
      const inst = await client.invoke('auth:select-instance', instance)
      if (!inst?.ok) { log(`  skipped — ${inst?.error ?? `instance ${instance} unavailable`}`); continue }
      const everyone = (inst.characters ?? []).map(c => c.name)
      const chosen = everyone.filter(n =>
        (!OPTS.only.length || OPTS.only.includes(n.toLowerCase())) && !OPTS.skip.includes(n.toLowerCase()))

      const playing = everyone.filter(n => live.includes(n.toLowerCase()))
      if (playing.length && !OPTS.force) {
        log(`  skipped — ${playing.join(', ')} is playing, and logging anyone else in would disconnect them (--force to do it anyway)`)
        continue
      }
      if (!chosen.length) { log('  no characters selected'); continue }

      const commands = ['inv list', ...(OPTS.vault ? ['vault standard'] : [])]
      if (OPTS.dryRun) {
        for (const [i, name] of chosen.entries()) {
          log(`  ${name}: ${[...commands, ...(OPTS.family && i === 0 ? ['vault family'] : [])].join(', ')}`)
        }
        continue
      }

      for (const [i, character] of chosen.entries()) {
        process.stdout.write(`  ${character} … `)
        try {
          const filed = await collect(client, lib, {
            account, password, instance, character,
            wantVault: OPTS.vault, wantFamily: OPTS.family && i === 0,
          })
          const parts = [`${filed.inv ?? 0} on person`]
          if (OPTS.vault) parts.push(filed.vault != null ? `${filed.vault} in vault` : `no vault report (${filed.vaultError})`)
          if (OPTS.family && i === 0) parts.push(filed.family != null ? `${filed.family} in family vault` : `no family vault report (${filed.familyError})`)
          log(parts.join(', '))
          results.push({ character, ok: true })
        } catch (err) {
          log(`failed — ${err.message}`)
          results.push({ character, ok: false })
        }
        await sleep(OPTS.pause)
      }
    }

    if (!OPTS.dryRun) {
      const ok = results.filter(r => r.ok).length
      log(`\n${ok} of ${results.length} characters recorded.`)
      if (ok < results.length) process.exitCode = 1
    } else {
      log('\nDry run — nobody was logged in to the game.')
    }
  } finally {
    client.close()
  }
}

main().catch(err => { console.error(`\n${err.message}`); process.exit(1) })
