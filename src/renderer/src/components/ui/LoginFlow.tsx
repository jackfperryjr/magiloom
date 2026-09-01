import { useState, useEffect, useRef } from 'react'
import { Tooltip } from './Tooltip'
import { LoginArt } from './LoginArt'
import { loginProgress, showLog, STALL_MS } from '../../lib/loginProgress'

interface LoginFlowProps {
  onEnterGame: (characterName: string, accountName: string, watching?: boolean) => void
  onOpenSettings: () => void
  // "Switch character" shortcut: when a DR account name is given, skip the account
  // picker and go straight to that account's character list (re-authenticating with
  // the saved password behind the scenes). Falls back to the credentials screen if
  // no password is saved. undefined/null = the normal full login flow.
  switchAccount?: string | null
}

type Screen =
  | 'account-list'
  | 'credentials'
  | 'beacons'
  | 'instance-select'
  | 'character-select'
  | 'chargen'
  | 'connecting'
  | 'magiloom-account'
  | 'watch-select'

// The two entry screens are tabs of the same landing card; everything after them
// is a step of the flow and hides the tab bar.
const TABBED: Screen[] = ['credentials', 'beacons']

interface SGECharacter  { id: string; name: string }
interface SGEInstance   { code: string; name: string }
interface SavedAccount  { name: string; lastCharacter?: string }
// Mirrors AppSettings['loginPaths'][number] (env.d.ts) — the shapes in that file are
// module-scoped, so the login screen restates the ones it uses, as it already does
// for SGECharacter/SGEInstance/SavedAccount.
interface LoginPath {
  id:           string
  account:      string
  game:         GameCode
  instance:     string
  instanceName: string
  charId:       string
  charName:     string
  lich:         boolean
  usedAt:       number
}

/** Most-recently-walked path first. */
const sortBeacons = (b: LoginPath[]): LoginPath[] =>
  [...b].sort((x, y) => (y.usedAt ?? 0) - (x.usedAt ?? 0))

// ─── Shell ────────────────────────────────────────────────────────────────────
function Shell({ children, tabs }: { children: React.ReactNode; tabs?: React.ReactNode }) {
  return (
    <div className="login-screen">
      <LoginArt />
      <div className="login-card">
        <img src="./icon.png" className="login-hero" alt="Lantern" />
        <div className="login-logo">LANTERN</div>
        {tabs}
        {/* The card is a fixed size, so screens never resize it as you switch
            tabs or step through the flow — the body scrolls instead. */}
        <div className="login-body">{children}</div>
      </div>
    </div>
  )
}

// ─── Landing tabs ─────────────────────────────────────────────────────────────
// Sign in (type an account) vs Beacons (one click down a remembered path).
// Settings rides along on the right — the login card is the only way in before a
// character exists, so it can't live behind the game UI.
function TabBar({ tab, onTab, onSettings }: {
  tab:        Screen
  onTab:      (s: Screen) => void
  onSettings: () => void
}) {
  return (
    <div className="login-tabs">
      <button className="login-tab" aria-selected={tab === 'credentials'}
        onClick={() => onTab('credentials')}>Sign in</button>
      <button className="login-tab" aria-selected={tab === 'beacons'}
        onClick={() => onTab('beacons')}>Beacons</button>
      <Tooltip text="Settings">
        <button className="login-tab-settings" onClick={onSettings} aria-label="Settings">⚙</button>
      </Tooltip>
    </div>
  )
}

// Back always renders LAST in a screen so it lands at the bottom of the card.
function Back({ onClick }: { onClick: () => void }) {
  return <button className="login-btn-secondary login-back" onClick={onClick}>← Back</button>
}

// ─── Game selector ────────────────────────────────────────────────────────────
// Lives on the server screen (post-login) rather than the entry screens: which
// games an account can play isn't knowable until SGE answers with its instance
// list. Switching games re-filters that list by instance-code prefix.
//
// GemStone IV is shown but inert until its protocol support lands. A disabled
// <button> would swallow the hover events its tooltip needs, so it stays
// clickable-but-inert via aria-disabled instead.
type GameCode = 'DR' | 'GS4'

const GAMES: { code: GameCode; name: string; glyph: string; prefix: string; ready: boolean }[] = [
  { code: 'DR',  name: 'DragonRealms', glyph: '🐉', prefix: 'DR', ready: true  },
  { code: 'GS4', name: 'GemStone IV',  glyph: '💎', prefix: 'GS', ready: false },
]

const gamePrefix = (g: GameCode): string => GAMES.find(x => x.code === g)?.prefix ?? 'DR'

function GameSelect({ game, onSelect }: { game: GameCode; onSelect: (g: GameCode) => void }) {
  return (
    <div className="login-games">
      {GAMES.map(g => {
        const btn = (
          <button
            key={g.code}
            className="login-game-btn"
            aria-disabled={!g.ready}
            aria-pressed={game === g.code}
            onClick={() => g.ready && onSelect(g.code)}
          >
            <span className="login-game-glyph">{g.glyph}</span>
            <span className="login-game-name">{g.name}</span>
          </button>
        )
        return g.ready
          ? btn
          : <Tooltip key={g.code} text="GemStone IV support is coming later">{btn}</Tooltip>
      })}
    </div>
  )
}

// ─── Screen 1: Saved accounts ─────────────────────────────────────────────────
function SyncBadge({ account, onSignIn, onSignOut }: {
  account: MagiloomAccount | null
  onSignIn: () => void
  onSignOut: () => void
}) {
  // Web only — desktop's preload has no `account` API (desktop stays local + free).
  if (!window.dr.account) return null
  return account
    ? <button className="login-sync-badge" onClick={onSignOut}>
        <span className="login-sync-on">● Synced</span>
        <span className="login-sync-email">{account.email}</span>
        <span className="login-sync-action">Sign out</span>
      </button>
    : <button className="login-btn-secondary" onClick={onSignIn}>☁ Sign in to sync across devices</button>
}

function AccountListScreen({ accounts, onSelect, onForget, onForgetAccount, onAddNew, onBack }: {
  accounts:        SavedAccount[]
  onSelect:        (a: SavedAccount) => void
  onForget:        (name: string) => void
  onForgetAccount: (name: string) => void
  onAddNew:        () => void
  onBack:          () => void
}) {
  return <>
    <div className="login-screen-title">Your accounts</div>
    <div className="login-accounts-list">
      {accounts.map(a => (
        <button key={a.name} className="login-account-btn" onClick={() => onSelect(a)}>
          <div className="login-account-info">
            <span className="login-account-name">{a.name}</span>
            {a.lastCharacter && <span className="login-account-last">Last: {a.lastCharacter}</span>}
          </div>
          <div className="login-account-actions">
            <Tooltip text="Forget saved password">
              <span
                className="login-account-forget"
                onClick={e => { e.stopPropagation(); onForget(a.name) }}
              >🔑</span>
            </Tooltip>
            <Tooltip text="Remove account">
              <span
                className="login-account-forget"
                onClick={e => { e.stopPropagation(); onForgetAccount(a.name) }}
              >×</span>
            </Tooltip>
          </div>
          <span className="login-account-arrow">›</span>
        </button>
      ))}
    </div>
    <button className="login-btn-secondary" onClick={onAddNew}>+ Add account</button>
    <Back onClick={onBack} />
  </>
}

// ─── Screen 2: Credentials ────────────────────────────────────────────────────
// The landing screen. It shows only the last-used account (prefilled, with its
// saved password) — the full saved-account list is one click away under
// "Other accounts", which is also where accounts get added and forgotten.
function CredentialsScreen({ initialAccount, onSubmit, onBack, onOtherAccounts, error, loading, syncBadge }: {
  initialAccount: string
  onSubmit:       (account: string, password: string) => void
  onBack?:        () => void
  onOtherAccounts?: () => void
  error:          string
  loading:        boolean
  syncBadge?:     React.ReactNode
}) {
  const [account,  setAccount]  = useState(initialAccount)
  const [password, setPassword] = useState('')
  const submit = () => { if (account && password) onSubmit(account, password) }

  // initialAccount arrives asynchronously on the landing screen (it's the saved
  // last-used account, read from settings after mount), so mirror it into the
  // field rather than only seeding useState.
  useEffect(() => {
    if (!initialAccount) return
    setAccount(initialAccount)
    window.dr.auth.getPassword(initialAccount).then(p => { if (p) setPassword(p) })
  }, [initialAccount])

  // No screen title here — the selected tab above the card body already says it.
  return <>
    <div className="login-fields">
      <label className="login-label">Account name
        <input className="login-input" type="text" autoComplete="username"
          value={account} onChange={e => setAccount(e.target.value)} disabled={loading} />
      </label>
      <label className="login-label">Password
        <input className="login-input" type="password" autoComplete="current-password"
          value={password} onChange={e => setPassword(e.target.value)} disabled={loading}
          onKeyDown={e => e.key === 'Enter' && submit()} />
      </label>
    </div>
    {error && <div className="login-error">{error}</div>}
    <button className="login-btn" onClick={submit}
      disabled={loading || !account || !password}>
      {loading ? 'Signing in…' : 'Sign in'}
    </button>
    {onOtherAccounts && (
      <button className="login-btn-secondary" onClick={onOtherAccounts}>Other accounts</button>
    )}
    {syncBadge}
    {onBack && <Back onClick={onBack} />}
  </>
}

// ─── Beacons: one-click login routes ──────────────────────────────────────────
// A beacon is a whole path back into the game — account → game → server →
// character → Lich — recorded automatically the last time you walked it. One
// click replays it: re-auth with the saved password, pick the server, pick the
// character, connect.
function BeaconsScreen({ beacons, onRun, onForget, error, loading }: {
  beacons:  LoginPath[]
  onRun:    (b: LoginPath) => void
  onForget: (id: string) => void
  error:    string
  loading:  boolean
}) {
  return <>
    {beacons.length === 0 && (
      <p className="login-hint">
        Sign in once and Lantern lights a beacon on the way — account, server, character
        and Lich. After that, one click follows it straight back into the game.
      </p>
    )}
    <div className="login-accounts-list">
      {beacons.map(b => (
        <button key={b.id}
          className="login-account-btn login-beacon-btn"
          data-inst={b.instance}
          onClick={() => !loading && onRun(b)}
          disabled={loading}>
          <span className="login-instance-dot" />
          <div className="login-account-info">
            <span className="login-account-name">{b.charName}</span>
            <span className="login-beacon-path">
              {b.account} · {b.game} · {b.instanceName}{b.lich ? ' · Lich' : ''}
            </span>
          </div>
          <div className="login-account-actions">
            <Tooltip text="Forget this beacon">
              <span
                className="login-account-forget"
                onClick={e => { e.stopPropagation(); onForget(b.id) }}
              >×</span>
            </Tooltip>
          </div>
          <span className="login-account-arrow">›</span>
        </button>
      ))}
    </div>
    {error && <div className="login-error">{error}</div>}
  </>
}

// ─── Screen 3: Instance selection ─────────────────────────────────────────────
// Friendly display names for known DR instances. Each also gets its own accent
// colour (see .login-instance-btn[data-inst] in login.css) so the servers are
// tellable apart at a glance — Platinum and Prime Test especially, since picking
// the wrong one is a wasted login.
// The game name isn't repeated here — the game selector sits directly above.
// Anything not listed falls back to the name SGE itself reports.
const INSTANCE_LABELS: Record<string, string> = {
  DR:  'Prime',
  DRX: 'Platinum',
  DRF: 'The Fallen',
  DRT: 'Prime Test',
  DRD: 'Development',
  GS3: 'Prime',
  GSX: 'Platinum',
  GSF: 'Shattered',
  GST: 'Test',
}

function InstanceSelectScreen({ instances, onSelect, onBack, error, loading, game, onGame }: {
  instances: SGEInstance[]
  onSelect:  (inst: SGEInstance) => void
  onBack:    () => void
  error:     string
  loading:   boolean
  game:      GameCode
  onGame:    (g: GameCode) => void
}) {
  const shown = instances.filter(i => i.code.startsWith(gamePrefix(game)))

  return <>
    <div className="login-screen-title">Choose game &amp; server</div>
    <GameSelect game={game} onSelect={onGame} />
    {shown.length === 0 && (
      <p className="login-hint">
        No {game === 'GS4' ? 'GemStone IV' : 'DragonRealms'} servers on this account.
      </p>
    )}
    <div className="login-accounts-list">
      {shown.map(inst => (
        <button key={inst.code}
          className="login-account-btn login-instance-btn"
          data-inst={inst.code}
          onClick={() => !loading && onSelect(inst)}
          disabled={loading}>
          <span className="login-instance-dot" />
          <div className="login-account-info">
            <span className="login-account-name">
              {INSTANCE_LABELS[inst.code] ?? inst.name}
            </span>
          </div>
          <span className="login-instance-code">{inst.code}</span>
          <span className="login-account-arrow">›</span>
        </button>
      ))}
    </div>
    {error && <div className="login-error">{error}</div>}
    <Back onClick={onBack} />
  </>
}

// ─── Connect-with-Lich toggle ─────────────────────────────────────────────────
// Decides, per login, whether this session routes through Lich (scripts +
// automation) or connects directly. Applies to both the desktop app and the
// web/PWA client — the backend launches or skips Lich based on this flag.
function LichToggle({ on, available, onChange }: {
  on: boolean; available: boolean; onChange: (on: boolean) => void
}) {
  // Drive the subtitle off the ACTUAL toggle state, not the (possibly stale) detection
  // snapshot: when the toggle is on the session connects through Lich, so never claim a
  // "direct connection" here. The "not detected" hint is only useful when Lich is off
  // AND unavailable — a nudge that turning it on won't do anything.
  const sub = on
    ? 'Lich enabled'
    : (available ? 'Direct connection' : 'Direct connection — no Lich detected')
  return (
    <label className="login-lich-toggle">
      <div className="login-lich-text">
        <span className="login-lich-title">Connect with Lich</span>
        <span className="login-lich-sub">{sub}</span>
      </div>
      <input type="checkbox" className="broadcast-switch"
        checked={on} onChange={e => onChange(e.target.checked)} />
    </label>
  )
}

// ─── Screen 4: Character select ───────────────────────────────────────────────
function CharacterSelectScreen({ characters, lastCharId, onSelect, onCreate, onBack, error, loading,
  useLich, lichAvailable, onToggleLich }: {
  characters: SGECharacter[]
  lastCharId?: string
  onSelect:   (c: SGECharacter) => void
  /** Omitted where the character generator isn't available (web). */
  onCreate?:  () => void
  onBack:     () => void
  error:      string
  loading:    boolean
  useLich:       boolean
  lichAvailable: boolean
  onToggleLich:  (on: boolean) => void
}) {
  return <>
    <div className="login-screen-title">Choose character</div>
    <div className="login-accounts-list">
      {characters.map(c => (
        <button key={c.id}
          className="login-account-btn"
          onClick={() => !loading && onSelect(c)} disabled={loading}>
          <div className="login-account-info">
            <span className="login-account-name">{c.name}</span>
            {c.id === lastCharId && <span className="login-account-last">Last played</span>}
          </div>
          <span className="login-account-arrow">›</span>
        </button>
      ))}
      {onCreate
        ? <button className="login-account-btn login-account-new" onClick={onCreate} disabled={loading}>
            <div className="login-account-info">
              <span className="login-account-name">+ New character</span>
            </div>
            <span className="login-account-arrow">›</span>
          </button>
        // Web has no character generator (the IPC is desktop-only), so the slot
        // stays visible but inert — aria-disabled, since a disabled <button>
        // would swallow the hover events the tooltip needs.
        : <Tooltip text="Character creation is only available in the desktop app">
            <button className="login-account-btn login-account-new" aria-disabled="true">
              <div className="login-account-info">
                <span className="login-account-name">+ New character</span>
              </div>
              <span className="login-account-arrow">›</span>
            </button>
          </Tooltip>}
    </div>
    <LichToggle on={useLich} available={lichAvailable} onChange={onToggleLich} />
    {error && <div className="login-error">{error}</div>}
    <Back onClick={onBack} />
  </>
}

// ─── Character creation ───────────────────────────────────────────────────────
// DragonRealms' character generator is a game session in its own right (see
// main/chargen.ts). It talks line-oriented text over the Wizard front end, so
// this screen is a console: the generator's own prompts, its numbered options
// lifted into buttons, and a command line for anything else it asks for.

/** Visible text of one generator line: Wizard control codes and tags removed. */
function cleanGenLine(line: string): string {
  return line
    .split('\x1b')[0]                              // ESC-prefixed Wizard control codes
    .replace(/<d\s+cmd=['"][^'"]*['"][^>]*>/gi, '')
    .replace(/<\/d>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\r/g, '')
}

interface GenOption { cmd: string; label: string }

/** Clickable choices in the generator's last screenful: <d cmd> links, then "N) label". */
function genOptions(lines: string[]): GenOption[] {
  const out  = new Map<string, GenOption>()
  const tail = lines.slice(-14)
  for (const raw of tail) {
    for (const m of raw.matchAll(/<d\s+cmd=['"]([^'"]+)['"][^>]*>([^<]+)<\/d>/gi)) {
      out.set(m[1].trim().toUpperCase(), { cmd: m[1].trim(), label: m[2].trim() })
    }
  }
  if (out.size === 0) {
    for (const raw of tail) {
      for (const m of cleanGenLine(raw).matchAll(/(\d+)\)\s+(.+?)(?=\s{2,}\d+\)|\s*$)/g)) {
        const cmd = `CHOOSE ${m[1]}`
        out.set(cmd, { cmd, label: m[2].trim() })
      }
    }
  }
  return [...out.values()].slice(0, 12)
}

function CharGenScreen({ onLeave }: { onLeave: () => void }) {
  const [lines,  setLines]  = useState<string[]>([])
  const [ended,  setEnded]  = useState(false)
  const [error,  setError]  = useState('')
  const [input,  setInput]  = useState('')
  const tailRef = useRef('')
  const logRef  = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const api = window.dr.chargen
    if (!api) { setError('Character creation is only available in the desktop app.'); return }
    const unsubs = [
      api.onData(chunk => {
        // Reassemble across chunk boundaries — the generator does not align its
        // writes to line ends.
        tailRef.current += chunk.replace(/\r/g, '')
        const parts = tailRef.current.split('\n')
        tailRef.current = parts.pop() ?? ''
        if (parts.length) setLines(prev => [...prev, ...parts].slice(-400))
      }),
      api.onError(m  => setError(m)),
      api.onClosed(() => setEnded(true)),
    ]
    api.start().then(r => { if (!r.ok) { setError(r.error); setEnded(true) } })
    return () => { unsubs.forEach(fn => fn()); api.stop() }
  }, [])

  // Follow the tail as the generator writes.
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight }, [lines])

  const send = (cmd: string) => {
    if (ended || !cmd.trim()) return
    setLines(prev => [...prev, `> ${cmd}`].slice(-400))
    window.dr.chargen?.send(cmd)
  }

  const options = ended ? [] : genOptions(lines)

  return <>
    <div className="login-screen-title">Create a character</div>
    <p className="login-hint" style={{ marginTop: 0 }}>
      {ended
        ? 'The generator session has ended. Sign in again — a character you finished creating will be in the list.'
        : 'Answer the generator\'s prompts. When your character is finished, come back and sign in as them.'}
    </p>
    <div className="login-log login-chargen-log" ref={logRef}>
      {lines.length === 0 && !error && <div className="login-log-line">Entering the character generator…</div>}
      {lines.map((l, i) => {
        const text = l.startsWith('> ') ? l : cleanGenLine(l)
        return text.trim()
          ? <div key={i} className={'login-log-line' + (l.startsWith('> ') ? ' login-chargen-echo' : '')}>{text}</div>
          : null
      })}
    </div>
    {options.length > 0 && (
      <div className="login-chargen-options">
        {options.map(o => (
          <button key={o.cmd} className="login-btn-secondary login-chargen-option"
            onClick={() => send(o.cmd)}>{o.label}</button>
        ))}
      </div>
    )}
    {!ended && (
      <div className="login-chargen-entry">
        <input className="login-input" value={input} autoFocus
          placeholder="Type a command…"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { send(input); setInput('') } }} />
        <button className="login-btn" onClick={() => { send(input); setInput('') }}>Send</button>
      </div>
    )}
    {error && <div className="login-error">{error}</div>}
    <Back onClick={onLeave} />
  </>
}

// ─── Screen 5: Connecting ─────────────────────────────────────────────────────
// The log used to run under this screen on every login. It earns its place when
// something breaks and not otherwise, so the normal path is a progress bar and
// the log comes back on an error — or on a login that sits on one stage longer
// than a healthy one ever does (see showLog).
function ConnectingScreen({ characterName, logLines, error, onBack }: {
  characterName: string
  logLines:      string[]
  error:         string
  onBack:        () => void
}) {
  const { stage, label, value } = loginProgress(logLines)
  const [stalled, setStalled] = useState(false)

  // Restart the stall clock on every stage change, so the log surfaces only when
  // progress has actually stopped — not merely because a login was slow overall.
  useEffect(() => {
    setStalled(false)
    const timer = window.setTimeout(() => setStalled(true), STALL_MS)
    return () => window.clearTimeout(timer)
  }, [stage])

  const withLog = showLog(error, stalled ? STALL_MS : 0)

  return <>
    <div className="login-screen-title">
      {error ? 'Connection failed' : `Entering as ${characterName}…`}
    </div>
    {!error && (
      <div className="login-progress" role="progressbar" aria-label="Login progress"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
        <div className="login-progress-fill" style={{ width: `${value * 100}%` }} />
      </div>
    )}
    {!error && (
      <p className="login-hint">
        {stalled ? `${label.replace(/…$/, '')} — still working` : label}
      </p>
    )}
    {error && <div className="login-error">{error}</div>}
    {withLog && logLines.length > 0 && <LoginLog lines={logLines} />}
    {error && <Back onClick={onBack} />}
  </>
}

// Live connection log (SGE / Lich / game output). Surfaced so failures like
// "Lich exited with code 0" are diagnosable without the desktop dev tools.
function LoginLog({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight }, [lines])
  return (
    <div className="login-log" ref={ref}>
      {lines.map((l, i) => <div key={i} className="login-log-line">{l}</div>)}
    </div>
  )
}

// ─── Magiloom account (web only) ──────────────────────────────────────────────
// A real Magiloom account (email + password), separate from the DragonRealms
// account. Signing in syncs your settings + Lich profiles/custom scripts across
// devices — so you can upload a setup.yaml on your computer and use it on your
// phone. (Intentionally says nothing about the paid tier yet.)
function MagiloomAccountScreen({ onDone, onBack }: {
  onDone: (account: MagiloomAccount) => void
  // Omitted when sign-in is mandatory (MAGILOOM_REQUIRE_ACCOUNT) — no way to skip past it.
  onBack?: () => void
}) {
  const [mode,     setMode]     = useState<'signin' | 'signup'>('signin')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const submit = async () => {
    if (!email || !password || loading) return
    setLoading(true); setError('')
    const api = window.dr.account!
    const r = await (mode === 'signup' ? api.signUp(email, password) : api.signIn(email, password))
    setLoading(false)
    if (r.ok) onDone(r.account)
    else setError(r.error)
  }

  return <>
    <div className="login-screen-title">{mode === 'signup' ? 'Create account' : 'Sign in to Magiloom'}</div>
    <p className="login-hint" style={{ marginTop: 0 }}>
      {onBack
        ? 'Sync your settings and Lich setups across your devices.'
        : 'Sign in or create a free account to continue.'}
    </p>
    <div className="login-fields">
      <label className="login-label">Email
        <input className="login-input" type="email" autoComplete="email"
          value={email} onChange={e => setEmail(e.target.value)} disabled={loading} />
      </label>
      <label className="login-label">Password
        <input className="login-input" type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password} onChange={e => setPassword(e.target.value)} disabled={loading}
          onKeyDown={e => e.key === 'Enter' && submit()} />
      </label>
    </div>
    {error && <div className="login-error">{error}</div>}
    <button className="login-btn" onClick={submit} disabled={loading || !email || !password}>
      {loading ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
    </button>
    <button className="login-btn-secondary" onClick={() => { setError(''); setMode(mode === 'signup' ? 'signin' : 'signup') }}>
      {mode === 'signup' ? 'Have an account? Sign in' : 'New here? Create an account'}
    </button>
    {onBack && <Back onClick={onBack} />}
  </>
}

// ─── Watch a running session (paid) ───────────────────────────────────────────
// Attach to another of the account's live sessions and mirror its stream — e.g.
// check on a character running on your desktop from your phone.
function WatchSelectScreen({ onWatch, onBack }: {
  onWatch: (s: WatchSession) => void
  onBack:  () => void
}) {
  const [sessions, setSessions] = useState<WatchSession[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    window.dr.account?.sessions()
      .then(list => setSessions(list.filter(s => s.connected && !s.current)))
      .catch(() => setError('Could not load your running sessions.'))
  }, [])
  return <>
    <div className="login-screen-title">Watch a session</div>
    <p className="login-hint" style={{ marginTop: 0 }}>Attach to a character already running on your account.</p>
    {sessions === null && !error && <p className="login-hint">Loading…</p>}
    {sessions && sessions.length === 0 && <p className="login-hint">No running sessions to watch.</p>}
    <div className="login-accounts-list">
      {sessions?.map(s => (
        <button key={s.conn} className="login-account-btn" onClick={() => onWatch(s)}>
          <div className="login-account-info">
            <span className="login-account-name">{s.charName || 'Unknown character'}</span>
            <span className="login-account-last">● Live</span>
          </div>
          <span className="login-account-arrow">›</span>
        </button>
      ))}
    </div>
    {error && <div className="login-error">{error}</div>}
    <Back onClick={onBack} />
  </>
}

// ─── Root controller ──────────────────────────────────────────────────────────
export function LoginFlow({ onEnterGame, onOpenSettings, switchAccount }: LoginFlowProps) {
  // Mandatory sign-in gate (web only; desktop has no `account` API). When the server
  // requires an account and we're not signed in, open straight on the Magiloom
  // account screen with no way to skip it — every other screen needs a live WS the
  // server won't grant until we're authenticated.
  const requireAcct = !!window.dr.account?.required?.()
  const mustSignIn  = requireAcct && !window.dr.account?.isSignedIn?.()
  const [screen,        setScreen]        = useState<Screen>(mustSignIn ? 'magiloom-account' : 'credentials')
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([])
  const [activeAccount, setActiveAccount] = useState('')
  const [instances,     setInstances]     = useState<SGEInstance[]>([])
  const [characters,    setCharacters]    = useState<SGECharacter[]>([])
  const [lastCharId,    setLastCharId]    = useState<string | undefined>()
  const [selectedChar,  setSelectedChar]  = useState<SGECharacter | null>(null)
  const selectedCharRef = useRef<SGECharacter | null>(null)
  const activeAccountRef = useRef('')
  // Last-played account + character, recovered from settings on mount. On a COLD
  // resume (a page reload / update that reconnects to a still-running server session)
  // the user never walked through character-select, so selectedCharRef is null — these
  // stand in so we re-enter the game as the right character instead of a blank one.
  const lastAccountRef  = useRef('')
  const lastCharNameRef = useRef('')
  const [logLines,      setLogLines]      = useState<string[]>([])
  const [error,         setError]         = useState('')
  const [loading,       setLoading]       = useState(false)
  const [useLich,       setUseLich]       = useState(false)
  const [lichAvailable, setLichAvailable] = useState(false)
  const useLichRef = useRef(false)
  const [magiAccount,   setMagiAccount]   = useState<MagiloomAccount | null>(null)
  // Which Simutronics game to sign in to. Drives which instances the server screen
  // lists; seeded from what the account actually has once SGE answers.
  const [game,          setGame]          = useState<GameCode>('DR')
  const [beacons,       setBeacons]       = useState<LoginPath[]>([])
  // Where the connecting screen's Back should return to — the character list on a
  // normal login, the beacon list when a beacon was replaying.
  const [connectBack,   setConnectBack]   = useState<Screen>('character-select')

  useEffect(() => {
    Promise.all([window.dr.settings.getAll(), window.dr.lich.detectPath()])
      .then(([s, detected]) => {
        setSavedAccounts(s.accounts ?? [])
        setBeacons(sortBeacons(s.loginPaths ?? []))
        // Land on the last-used account, prefilled (its saved password fills in
        // behind it). Other saved accounts are one click away. A "switch character"
        // launch already named its account — don't overwrite it when this resolves.
        if (s.lastAccount && !switchAccount) setActiveAccount(s.lastAccount)
        // Remember the last-played identity for the cold-resume fallback below.
        lastAccountRef.current  = s.lastAccount ?? ''
        lastCharNameRef.current = s.accounts?.find(a => a.name === s.lastAccount)?.lastCharacter ?? ''
        // Lich is available when a path is configured or auto-detected (desktop),
        // or the server reports a shared install (web/PWA). Default the toggle to
        // the user's last choice, else to whether Lich is available at all.
        const available = !!(s.lichPath || detected)
        setLichAvailable(available)
        const initial = s.connectWithLich ?? available
        setUseLich(initial); useLichRef.current = initial
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reflect an existing Magiloom sign-in (web only) in the sync badge. Also validates
  // the stored token: when sign-in is required and the token turns out stale/expired
  // (current() resolves null), clear it and fall back to the mandatory gate — otherwise
  // isSignedIn() (presence-only) would let us past a token the server will reject.
  useEffect(() => {
    const api = window.dr.account
    if (!api?.isSignedIn()) return
    api.current().then(a => {
      if (a) setMagiAccount(a)
      else if (requireAcct) { api.signOut(); setMagiAccount(null); setScreen('magiloom-account') }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // After signing in/out, the socket re-buckets to the account (or device); pull the
  // now-current saved DR accounts for this identity and return to the list.
  const onMagiloomSignedIn = async (a: MagiloomAccount) => {
    setMagiAccount(a); await refreshSettings(); setScreen('credentials')
  }
  const onMagiloomSignOut = async () => {
    window.dr.account?.signOut(); setMagiAccount(null)
    // When an account is mandatory, signing out returns to the gate rather than the
    // (now unauthenticated, server-rejected) DR account list.
    if (requireAcct) { setScreen('magiloom-account'); return }
    await refreshSettings()
  }

  // Watch a running session: attach to it (reconnects with ?watch=) and enter game
  // mirroring it. We know the character from the picker; the server replays its state.
  const onWatchSession = (s: WatchSession) => {
    window.dr.account?.watch(s.conn)
    onEnterGame(s.charName, '', true)   // watch mode → enables the "Leave session" menu item
  }

  // Account footer shown on the entry screens: sync status + (paid) a watch entry.
  const accountFooter = (
    <>
      <SyncBadge account={magiAccount} onSignIn={() => { setError(''); setScreen('magiloom-account') }} onSignOut={onMagiloomSignOut} />
      {magiAccount?.tier === 'paid' && (
        <button className="login-btn-secondary" onClick={() => { setError(''); setScreen('watch-select') }}>
          👁 Watch a running session
        </button>
      )}
    </>
  )

  // Persist the toggle so it's remembered next login; keep a ref so the character
  // handler reads the current value without re-creating listeners.
  const toggleLich = (on: boolean) => {
    setUseLich(on); useLichRef.current = on
    window.dr.settings.patch({ connectWithLich: on })
  }

  // Keep a ref of the active account so the connection listeners (registered
  // once) always read the current value rather than a stale closure.
  useEffect(() => { activeAccountRef.current = activeAccount }, [activeAccount])

  useEffect(() => {
    // Which character/account to enter as. A fresh login has selectedCharRef set (the
    // user just picked); a cold resume falls back to the last-played identity so the
    // reconnect lands back in-game as the right character.
    const resumeName = () => selectedCharRef.current?.name ?? lastCharNameRef.current
    const resumeAcct = () => activeAccountRef.current || lastAccountRef.current
    const unsubs = [
      window.dr.lich.onStatus((s: string) => { if (s === 'ready') onEnterGame(resumeName(), resumeAcct()) }),
      window.dr.game.onConnected(() => onEnterGame(resumeName(), resumeAcct())),
      window.dr.lich.onError((msg: string) => setError(msg)),
      window.dr.lich.onLog((l: string) =>
        setLogLines(prev => [...prev.slice(-99), l.trimEnd()])
      )
    ]
    return () => unsubs.forEach(fn => fn())
  }, [onEnterGame])

  const refreshSettings = async () => {
    const s = await window.dr.settings.getAll()
    setSavedAccounts(s.accounts ?? [])
    setBeacons(sortBeacons(s.loginPaths ?? []))
    return s
  }

  // ── Beacons ────────────────────────────────────────────────────────────────
  // Light a beacon for the path just walked. One per account+server+character, so
  // repeat logins refresh the existing entry (Lich choice, timestamp) instead of
  // piling up duplicates.
  const lightBeacon = async (inst: SGEInstance, char: SGECharacter, account: string, lich: boolean) => {
    const s = await window.dr.settings.getAll()
    const prior = s.loginPaths ?? []
    const same = (b: LoginPath) =>
      b.account.toLowerCase() === account.toLowerCase() &&
      b.instance === inst.code &&
      b.charName.toLowerCase() === char.name.toLowerCase()
    const entry: LoginPath = {
      id:           prior.find(same)?.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      account,
      game:         inst.code.startsWith('GS') ? 'GS4' : 'DR',
      instance:     inst.code,
      instanceName: INSTANCE_LABELS[inst.code] ?? inst.name,
      charId:       char.id,
      charName:     char.name,
      lich,
      usedAt:       Date.now(),
    }
    const loginPaths = [entry, ...prior.filter(b => !same(b))]
    setBeacons(sortBeacons(loginPaths))
    await window.dr.settings.patch({ loginPaths })
  }

  const forgetBeacon = async (id: string) => {
    const s = await window.dr.settings.getAll()
    const loginPaths = (s.loginPaths ?? []).filter(b => b.id !== id)
    setBeacons(sortBeacons(loginPaths))
    await window.dr.settings.patch({ loginPaths })
  }

  // Replay a saved path end to end. Every step can fail on its own (password
  // forgotten, server down, character deleted), so each one reports where it broke
  // rather than dumping the user back at the start with a generic error.
  const runBeacon = async (b: LoginPath) => {
    setError(''); setLogLines([])
    const pw = await window.dr.auth.getPassword(b.account)
    if (!pw) {
      setActiveAccount(b.account)
      setScreen('credentials')
      setError(`No saved password for ${b.account} — sign in once to relight this beacon.`)
      return
    }
    setActiveAccount(b.account); activeAccountRef.current = b.account
    setGame(b.game)
    setSelectedChar({ id: b.charId, name: b.charName })
    selectedCharRef.current = { id: b.charId, name: b.charName }
    setConnectBack('beacons')
    setLoading(true); setScreen('connecting')

    const login = await window.dr.auth.login(b.account, pw)
    if (!login.ok) { setLoading(false); setError(login.error); return }
    setInstances(login.instances)

    const inst = await window.dr.auth.selectInstance(b.instance)
    if (!inst.ok) { setLoading(false); setError(inst.error); return }
    setCharacters(inst.characters)

    // SGE character ids can be reissued; fall back to the name before giving up.
    const char = inst.characters.find(c => c.id === b.charId)
      ?? inst.characters.find(c => c.name.toLowerCase() === b.charName.toLowerCase())
    if (!char) {
      setLoading(false)
      setError(`${b.charName} is no longer on ${b.account}.`)
      return
    }

    selectedCharRef.current = char
    setUseLich(b.lich); useLichRef.current = b.lich
    const result = await window.dr.auth.selectCharacter(char.id, char.name, b.account, b.lich)
    setLoading(false)
    if (!result.ok) setError(result.error ?? 'Failed to connect.')
    else await lightBeacon({ code: b.instance, name: b.instanceName }, char, b.account, b.lich)
  }

  // Step 1: credentials → instance list
  const handleCredentials = async (account: string, password: string) => {
    setLoading(true); setError(''); setLogLines([])
    const result = await window.dr.auth.login(account, password)
    setLoading(false)
    if (!result.ok) { setError(result.error); return }
    window.dr.auth.savePassword(account, password)
    setActiveAccount(account)
    setInstances(result.instances)
    await refreshSettings()
    // Nothing to choose with a single DR instance — skip the server screen. (Once
    // GemStone is playable this also has to account for the game picker being the
    // only reason to stop here.)
    const drOnly = result.instances.filter(i => i.code.startsWith('DR'))
    if (drOnly.length === 1) {
      await handleInstanceSelect(drOnly[0])
    } else {
      setScreen('instance-select')
    }
  }

  // Step 2: instance → character list
  const selectedInstRef = useRef<SGEInstance | null>(null)
  const handleInstanceSelect = async (inst: SGEInstance) => {
    setLoading(true); setError('')
    const result = await window.dr.auth.selectInstance(inst.code)
    setLoading(false)
    if (!result.ok) { setError(result.error); return }
    selectedInstRef.current = inst
    setCharacters(result.characters)
    setConnectBack('character-select')
    setScreen('character-select')
  }

  // Step 3: character → Lich launch
  const handleCharacterSelect = async (char: SGECharacter) => {
    setSelectedChar(char)
    selectedCharRef.current = char
    setLoading(true); setError(''); setLogLines([])
    setScreen('connecting')
    const result = await window.dr.auth.selectCharacter(char.id, char.name, activeAccount, useLichRef.current)
    setLoading(false)
    if (!result.ok) { setError(result.error ?? 'Failed to connect.'); return }
    // The path worked — remember it so it's one click next time.
    const inst = selectedInstRef.current
    if (inst) await lightBeacon(inst, char, activeAccount, useLichRef.current)
  }

  // "Switch character" shortcut: re-authenticate the current account with its saved
  // password and land on the character list, skipping the account picker. Runs once.
  const switchStarted = useRef(false)
  useEffect(() => {
    if (!switchAccount || switchStarted.current) return
    switchStarted.current = true
    setActiveAccount(switchAccount)
    activeAccountRef.current = switchAccount
    setScreen('credentials')   // shows the account + a spinner while we re-auth
    window.dr.auth.getPassword(switchAccount).then(pw => {
      // With a saved password we sign in silently and advance to character-select;
      // without one the credentials screen is already up for manual entry.
      if (pw) handleCredentials(switchAccount, pw)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchAccount])

  return (
    <Shell tabs={TABBED.includes(screen)
      ? <TabBar tab={screen} onTab={s => { setError(''); setScreen(s) }} onSettings={onOpenSettings} />
      : undefined}>
      {screen === 'account-list' && (
        <AccountListScreen
          accounts={savedAccounts}
          onSelect={a => { setActiveAccount(a.name); setLastCharId(a.lastCharacter); setError(''); setScreen('credentials') }}
          onForget={name => window.dr.auth.forgetPassword(name)}
          onForgetAccount={async name => { await window.dr.auth.forgetAccount(name); await refreshSettings() }}
          onAddNew={() => { setActiveAccount(''); setError(''); setScreen('credentials') }}
          onBack={() => setScreen('credentials')}
        />
      )}
      {screen === 'magiloom-account' && (
        <MagiloomAccountScreen
          onDone={onMagiloomSignedIn}
          onBack={mustSignIn ? undefined : () => setScreen('credentials')}
        />
      )}
      {screen === 'watch-select' && (
        <WatchSelectScreen onWatch={onWatchSession} onBack={() => setScreen('credentials')} />
      )}
      {screen === 'credentials' && (
        <CredentialsScreen
          initialAccount={activeAccount}
          onSubmit={handleCredentials}
          onOtherAccounts={savedAccounts.length > 0 ? () => { setError(''); setScreen('account-list') } : undefined}
          error={error}
          loading={loading}
          syncBadge={accountFooter}
        />
      )}
      {screen === 'beacons' && (
        <BeaconsScreen
          beacons={beacons}
          onRun={runBeacon}
          onForget={forgetBeacon}
          error={error}
          loading={loading}
        />
      )}
      {screen === 'instance-select' && (
        <InstanceSelectScreen
          instances={instances}
          onSelect={handleInstanceSelect}
          onBack={() => setScreen('credentials')}
          error={error}
          loading={loading}
          game={game}
          onGame={setGame}
        />
      )}
      {screen === 'character-select' && (
        <CharacterSelectScreen
          characters={characters}
          lastCharId={lastCharId}
          onSelect={handleCharacterSelect}
          onCreate={window.dr.chargen ? () => { setError(''); setScreen('chargen') } : undefined}
          onBack={() => setScreen(instances.length > 1 ? 'instance-select' : 'credentials')}
          error={error}
          loading={loading}
          useLich={useLich}
          lichAvailable={lichAvailable}
          onToggleLich={toggleLich}
        />
      )}
      {screen === 'chargen' && (
        // Leaving drops the generator socket; the SGE session was consumed to
        // launch it, so the way back to a character list is a fresh sign-in.
        <CharGenScreen onLeave={() => { setError(''); setScreen('credentials') }} />
      )}
      {screen === 'connecting' && (
        <ConnectingScreen
          characterName={selectedChar?.name ?? ''}
          logLines={logLines}
          error={error}
          onBack={() => { setError(''); setScreen(connectBack) }}
        />
      )}
    </Shell>
  )
}
