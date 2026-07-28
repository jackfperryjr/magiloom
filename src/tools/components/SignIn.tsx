import { useState } from 'react'
import { login, register, type Account } from '../api'

/**
 * Magiloom account sign-in. Only the log analyzer needs it — the planner and circle
 * calculator are deliberately open — so this is a small inline card rather than a
 * gate wrapped around the whole site.
 */
export function SignIn({ onSignedIn }: { onSignedIn: (a: Account) => void }): JSX.Element {
  const [mode, setMode]         = useState<'login' | 'register'>('login')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [busy, setBusy]         = useState(false)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true); setError('')
    const r = await (mode === 'login' ? login(email, password) : register(email, password))
    setBusy(false)
    if (r.ok) onSignedIn(r.account)
    else setError(r.error)
  }

  return (
    <div className="card">
      <h2>{mode === 'login' ? 'Sign in to see your logs' : 'Create a Magiloom account'}</h2>
      <p className="lede">
        Your logs are private to your account. Signing in here is the same account you
        use in the web app — if you're already signed in there, this page will pick it up.
      </p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="si-email">Email</label>
          <input id="si-email" type="email" autoComplete="email" required
                 value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="si-pass">Password</label>
          <input id="si-pass" type="password" required
                 autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                 value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        {error && <p className="err">{error}</p>}
        <div className="row">
          <button className="shrink" type="submit" disabled={busy}>
            {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
          <button className="ghost shrink" type="button" disabled={busy}
                  onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
            {mode === 'login' ? 'Create an account' : 'I already have one'}
          </button>
        </div>
      </form>
      <p className="note">
        No account? You can still analyze logs — drop your log files below and everything
        is processed in your browser. Nothing is uploaded.
      </p>
    </div>
  )
}
