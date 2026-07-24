import { useState } from 'react'

// Magiloom account sign-in / create, as a modal — the same form the login screen
// uses (MagiloomAccountScreen), surfaced from the in-game user menu so you can sign
// in without leaving the game. Create-account stays here (the mode toggle), per the
// product decision. Web only: callers gate on `window.dr.account` before rendering.
export function AccountSignInModal({ onClose, onSignedIn }: {
  onClose:    () => void
  onSignedIn: (account: MagiloomAccount) => void
}) {
  const [mode,     setMode]     = useState<'signin' | 'signup'>('signin')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const submit = async () => {
    const api = window.dr.account
    if (!api || !email || !password || loading) return
    setLoading(true); setError('')
    const r = await (mode === 'signup' ? api.signUp(email, password) : api.signIn(email, password))
    setLoading(false)
    if (r.ok) onSignedIn(r.account)
    else setError(r.error)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="avatar-modal account-modal">
        <div className="avatar-modal-header">
          <span className="modal-title">{mode === 'signup' ? 'Create account' : 'Sign in to Magiloom'}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
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
        <div className="avatar-modal-actions">
          <button className="login-btn" onClick={submit} disabled={loading || !email || !password}>
            {loading ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </div>
        <button className="login-btn-secondary" onClick={() => { setError(''); setMode(mode === 'signup' ? 'signin' : 'signup') }}>
          {mode === 'signup' ? 'Have an account? Sign in' : 'New here? Create an account'}
        </button>
      </div>
    </div>
  )
}
