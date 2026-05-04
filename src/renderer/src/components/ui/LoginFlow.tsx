import { useState, useEffect, useRef } from 'react'
import { Tooltip } from './Tooltip'

interface LoginFlowProps { onEnterGame: (characterName: string) => void; onOpenSettings: () => void }

type Screen =
  | 'account-list'
  | 'credentials'
  | 'instance-select'
  | 'character-select'
  | 'connecting'

interface SGECharacter  { id: string; name: string }
interface SGEInstance   { code: string; name: string }
interface SavedAccount  { name: string; lastCharacter?: string }

// ─── Shell ────────────────────────────────────────────────────────────────────
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="login-screen">
      <img src="./icon.png" className="login-watermark" aria-hidden="true" />
      <div className="login-card">
        <div className="login-logo">Meridian</div>
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
function AccountListScreen({ accounts, onSelect, onForget, onForgetAccount, onAddNew, onSettings }: {
  accounts:        SavedAccount[]
  onSelect:        (a: SavedAccount) => void
  onForget:        (name: string) => void
  onForgetAccount: (name: string) => void
  onAddNew:        () => void
  onSettings:      () => void
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
  </>
}

// ─── Screen 2: Credentials ────────────────────────────────────────────────────
function CredentialsScreen({ initialAccount, onSubmit, onBack, error, loading }: {
  initialAccount: string
  onSubmit:       (account: string, password: string) => void
  onBack?:        () => void
  error:          string
  loading:        boolean
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

// ─── Screen 4: Character select ───────────────────────────────────────────────
function CharacterSelectScreen({ characters, lastCharId, onSelect, onBack, error, loading }: {
  characters: SGECharacter[]
  lastCharId?: string
  onSelect:   (c: SGECharacter) => void
  onBack:     () => void
  error:      string
  loading:    boolean
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
    {error && <button className="login-btn-secondary" onClick={onBack}>← Back</button>}
  </>
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
  const [logLines,      setLogLines]      = useState<string[]>([])
  const [error,         setError]         = useState('')
  const [loading,       setLoading]       = useState(false)
  const [detectedPath,  setDetectedPath]  = useState('')

  useEffect(() => {
    Promise.all([window.dr.settings.getAll(), window.dr.lich.detectPath()])
      .then(([s, detected]) => {
        setSavedAccounts(s.accounts ?? [])
        setDetectedPath(detected || '')
        if (!s.accounts?.length) setScreen('credentials')
      })
  }, [])

  useEffect(() => {
    const unsubs = [
      window.dr.lich.onStatus((s: string) => { if (s === 'ready') onEnterGame(selectedCharRef.current?.name ?? '') }),
      window.dr.game.onConnected(() => onEnterGame(selectedCharRef.current?.name ?? '')),
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
    const result = await window.dr.auth.selectCharacter(char.id, char.name, activeAccount)
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
        />
      )}
      {screen === 'credentials' && (
        <CredentialsScreen
          initialAccount={activeAccount}
          onSubmit={handleCredentials}
          onBack={savedAccounts.length > 0 ? () => setScreen('account-list') : undefined}
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
