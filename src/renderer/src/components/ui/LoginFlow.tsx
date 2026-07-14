import { useState, useEffect, useRef } from 'react'
import { Tooltip } from './Tooltip'

interface LoginFlowProps { onEnterGame: (characterName: string, accountName: string, watching?: boolean) => void; onOpenSettings: () => void }

type Screen =
  | 'account-list'
  | 'credentials'
  | 'instance-select'
  | 'character-select'
  | 'connecting'
  | 'magiloom-account'
  | 'watch-select'

interface SGECharacter  { id: string; name: string }
interface SGEInstance   { code: string; name: string }
interface SavedAccount  { name: string; lastCharacter?: string }

// ─── Shell ────────────────────────────────────────────────────────────────────
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <img src="./icon.png" className="login-hero" alt="MAGILOOM" />
        <div className="login-logo">MAGILOOM</div>
        <div className="login-logo-sub">DragonRealms Client</div>
        {children}
      </div>
    </div>
  )
}

function Back({ onClick }: { onClick: () => void }) {
  return <button className="login-btn-secondary" onClick={onClick}>← Back</button>
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

function AccountListScreen({ accounts, onSelect, onForget, onForgetAccount, onAddNew, onSettings, syncBadge }: {
  accounts:        SavedAccount[]
  onSelect:        (a: SavedAccount) => void
  onForget:        (name: string) => void
  onForgetAccount: (name: string) => void
  onAddNew:        () => void
  onSettings:      () => void
  syncBadge:       React.ReactNode
}) {
  return <>
    <div className="login-screen-title">Welcome back</div>
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
    <button className="login-btn-secondary" onClick={onSettings}>⚙ Settings</button>
    {syncBadge}
  </>
}

// ─── Screen 2: Credentials ────────────────────────────────────────────────────
function CredentialsScreen({ initialAccount, onSubmit, onBack, error, loading, syncBadge }: {
  initialAccount: string
  onSubmit:       (account: string, password: string) => void
  onBack?:        () => void
  error:          string
  loading:        boolean
  syncBadge?:     React.ReactNode
}) {
  const [account,  setAccount]  = useState(initialAccount)
  const [password, setPassword] = useState('')
  const submit = () => { if (account && password) onSubmit(account, password) }

  useEffect(() => {
    if (!initialAccount) return
    window.dr.auth.getPassword(initialAccount).then(p => { if (p) setPassword(p) })
  }, [initialAccount])

  return <>
    {onBack && <Back onClick={onBack} />}
    <div className="login-screen-title">Sign in</div>
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
    {syncBadge}
  </>
}

// ─── Screen 3: Instance selection ─────────────────────────────────────────────
// Friendly display names for known DR instances
const INSTANCE_LABELS: Record<string, string> = {
  DR:  'DragonRealms — Prime',
  DRX: 'DragonRealms — Platinum',
  DRF: 'DragonRealms — The Fallen',
  DRT: 'DragonRealms — Prime Test',
  DRD: 'DragonRealms — Development',
}

function InstanceSelectScreen({ instances, onSelect, onBack, error, loading }: {
  instances: SGEInstance[]
  onSelect:  (inst: SGEInstance) => void
  onBack:    () => void
  error:     string
  loading:   boolean
}) {
  // Filter to only DR instances — hide GS4, etc.
  const drInstances = instances.filter(i => i.code.startsWith('DR'))

  return <>
    <Back onClick={onBack} />
    <div className="login-screen-title">Choose server</div>
    <div className="login-accounts-list">
      {drInstances.map(inst => (
        <button key={inst.code}
          className="login-account-btn"
          onClick={() => !loading && onSelect(inst)}
          disabled={loading}>
          <div className="login-account-info">
            <span className="login-account-name">
              {INSTANCE_LABELS[inst.code] ?? inst.name}
            </span>
            <span className="login-account-last">{inst.code}</span>
          </div>
          <span className="login-account-arrow">›</span>
        </button>
      ))}
    </div>
    {error && <div className="login-error">{error}</div>}
  </>
}

// ─── Connect-with-Lich toggle ─────────────────────────────────────────────────
// Decides, per login, whether this session routes through Lich (scripts +
// automation) or connects directly. Applies to both the desktop app and the
// web/PWA client — the backend launches or skips Lich based on this flag.
function LichToggle({ on, available, onChange }: {
  on: boolean; available: boolean; onChange: (on: boolean) => void
}) {
  const sub = on
    ? (available ? 'Lich enabled' : 'No Lich detected — direct connection')
    : 'Direct connection'
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
function CharacterSelectScreen({ characters, lastCharId, onSelect, onBack, error, loading,
  useLich, lichAvailable, onToggleLich }: {
  characters: SGECharacter[]
  lastCharId?: string
  onSelect:   (c: SGECharacter) => void
  onBack:     () => void
  error:      string
  loading:    boolean
  useLich:       boolean
  lichAvailable: boolean
  onToggleLich:  (on: boolean) => void
}) {
  return <>
    <Back onClick={onBack} />
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
    </div>
    <LichToggle on={useLich} available={lichAvailable} onChange={onToggleLich} />
    {error && <div className="login-error">{error}</div>}
  </>
}

// ─── Screen 5: Connecting ─────────────────────────────────────────────────────
function ConnectingScreen({ characterName, logLines, error, onBack }: {
  characterName: string
  logLines:      string[]
  error:         string
  onBack:        () => void
}) {
  return <>
    <div className="login-screen-title">
      {error ? 'Connection failed' : `Entering as ${characterName}…`}
    </div>
    {!error && <div className="login-connecting-dots"><span /><span /><span /></div>}
    {!error && <p className="login-hint">Connecting to DragonRealms…</p>}
    {error && <div className="login-error">{error}</div>}
    {logLines.length > 0 && <LoginLog lines={logLines} />}
    {error && <button className="login-btn-secondary" onClick={onBack}>← Back</button>}
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

// ─── Settings ─────────────────────────────────────────────────────────────────
function SettingsScreen({ initialPath, detectedPath, onSave, onBack }: {
  initialPath:  string
  detectedPath: string
  onSave:       (path: string) => void
  onBack:       () => void
}) {
  const [lichPath, setLichPath] = useState(initialPath || detectedPath)
  return <>
    <Back onClick={onBack} />
    <div className="login-screen-title">Settings</div>
    <div className="login-fields">
      <label className="login-label">Lich path
        <input className="login-input login-input-mono" type="text"
          placeholder={detectedPath || 'C:\\Ruby4Lich5\\Lich5\\lich.rbw'}
          value={lichPath} onChange={e => setLichPath(e.target.value)} />
        <span className="login-hint">Path to lich.rbw — auto-detected if blank</span>
      </label>
    </div>
    <button className="login-btn" onClick={() => onSave(lichPath)}>Save</button>
  </>
}

// ─── Magiloom account (web only) ──────────────────────────────────────────────
// A real Magiloom account (email + password), separate from the DragonRealms
// account. Signing in syncs your settings + Lich profiles/custom scripts across
// devices — so you can upload a setup.yaml on your computer and use it on your
// phone. (Intentionally says nothing about the paid tier yet.)
function MagiloomAccountScreen({ onDone, onBack }: {
  onDone: (account: MagiloomAccount) => void
  onBack: () => void
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
    <Back onClick={onBack} />
    <div className="login-screen-title">{mode === 'signup' ? 'Create account' : 'Sign in to Magiloom'}</div>
    <p className="login-hint" style={{ marginTop: 0 }}>
      Sync your settings and Lich setups across your devices.
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
    <Back onClick={onBack} />
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
  </>
}

// ─── Root controller ──────────────────────────────────────────────────────────
export function LoginFlow({ onEnterGame, onOpenSettings }: LoginFlowProps) {
  const [screen,        setScreen]        = useState<Screen>('account-list')
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([])
  const [activeAccount, setActiveAccount] = useState('')
  const [instances,     setInstances]     = useState<SGEInstance[]>([])
  const [characters,    setCharacters]    = useState<SGECharacter[]>([])
  const [lastCharId,    setLastCharId]    = useState<string | undefined>()
  const [selectedChar,  setSelectedChar]  = useState<SGECharacter | null>(null)
  const selectedCharRef = useRef<SGECharacter | null>(null)
  const activeAccountRef = useRef('')
  const [logLines,      setLogLines]      = useState<string[]>([])
  const [error,         setError]         = useState('')
  const [loading,       setLoading]       = useState(false)
  const [detectedPath,  setDetectedPath]  = useState('')
  const [useLich,       setUseLich]       = useState(false)
  const [lichAvailable, setLichAvailable] = useState(false)
  const useLichRef = useRef(false)
  const [magiAccount,   setMagiAccount]   = useState<MagiloomAccount | null>(null)

  useEffect(() => {
    Promise.all([window.dr.settings.getAll(), window.dr.lich.detectPath()])
      .then(([s, detected]) => {
        setSavedAccounts(s.accounts ?? [])
        setDetectedPath(detected || '')
        // Lich is available when a path is configured or auto-detected (desktop),
        // or the server reports a shared install (web/PWA). Default the toggle to
        // the user's last choice, else to whether Lich is available at all.
        const available = !!(s.lichPath || detected)
        setLichAvailable(available)
        const initial = s.connectWithLich ?? available
        setUseLich(initial); useLichRef.current = initial
        if (!s.accounts?.length) setScreen('credentials')
      })
  }, [])

  // Reflect an existing Magiloom sign-in (web only) in the sync badge.
  useEffect(() => {
    if (window.dr.account?.isSignedIn()) window.dr.account.current().then(a => { if (a) setMagiAccount(a) })
  }, [])

  // After signing in/out, the socket re-buckets to the account (or device); pull the
  // now-current saved DR accounts for this identity and return to the list.
  const onMagiloomSignedIn = async (a: MagiloomAccount) => {
    setMagiAccount(a); await refreshSettings(); setScreen('account-list')
  }
  const onMagiloomSignOut = async () => {
    window.dr.account?.signOut(); setMagiAccount(null); await refreshSettings()
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
    const unsubs = [
      window.dr.lich.onStatus((s: string) => { if (s === 'ready') onEnterGame(selectedCharRef.current?.name ?? '', activeAccountRef.current) }),
      window.dr.game.onConnected(() => onEnterGame(selectedCharRef.current?.name ?? '', activeAccountRef.current)),
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
    return s
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
    // If only one DR instance, skip the selection screen
    const drOnly = result.instances.filter(i => i.code.startsWith('DR'))
    if (drOnly.length === 1) {
      await handleInstanceSelect(drOnly[0])
    } else {
      setScreen('instance-select')
    }
  }

  // Step 2: instance → character list
  const handleInstanceSelect = async (inst: SGEInstance) => {
    setLoading(true); setError('')
    const result = await window.dr.auth.selectInstance(inst.code)
    setLoading(false)
    if (!result.ok) { setError(result.error); return }
    setCharacters(result.characters)
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
    if (!result.ok) setError(result.error ?? 'Failed to connect.')
  }

  return (
    <Shell>
      {screen === 'account-list' && (
        <AccountListScreen
          accounts={savedAccounts}
          onSelect={a => { setActiveAccount(a.name); setLastCharId(a.lastCharacter); setError(''); setScreen('credentials') }}
          onForget={name => window.dr.auth.forgetPassword(name)}
          onForgetAccount={async name => { await window.dr.auth.forgetAccount(name); await refreshSettings() }}
          onAddNew={() => { setActiveAccount(''); setError(''); setScreen('credentials') }}
          onSettings={onOpenSettings}
          syncBadge={accountFooter}
        />
      )}
      {screen === 'magiloom-account' && (
        <MagiloomAccountScreen onDone={onMagiloomSignedIn} onBack={() => setScreen('account-list')} />
      )}
      {screen === 'watch-select' && (
        <WatchSelectScreen onWatch={onWatchSession} onBack={() => setScreen('account-list')} />
      )}
      {screen === 'credentials' && (
        <CredentialsScreen
          initialAccount={activeAccount}
          onSubmit={handleCredentials}
          onBack={savedAccounts.length > 0 ? () => setScreen('account-list') : undefined}
          error={error}
          loading={loading}
          syncBadge={accountFooter}
        />
      )}
      {screen === 'instance-select' && (
        <InstanceSelectScreen
          instances={instances}
          onSelect={handleInstanceSelect}
          onBack={() => setScreen('credentials')}
          error={error}
          loading={loading}
        />
      )}
      {screen === 'character-select' && (
        <CharacterSelectScreen
          characters={characters}
          lastCharId={lastCharId}
          onSelect={handleCharacterSelect}
          onBack={() => setScreen(instances.length > 1 ? 'instance-select' : 'credentials')}
          error={error}
          loading={loading}
          useLich={useLich}
          lichAvailable={lichAvailable}
          onToggleLich={toggleLich}
        />
      )}
      {screen === 'connecting' && (
        <ConnectingScreen
          characterName={selectedChar?.name ?? ''}
          logLines={logLines}
          error={error}
          onBack={() => { setError(''); setScreen('character-select') }}
        />
      )}
    </Shell>
  )
}
