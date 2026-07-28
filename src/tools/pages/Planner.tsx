import { useMemo, useState } from 'react'
import { parseExpSkills } from '../../renderer/src/lib/exp-parser'
import {
  STATS, RACES, emptyStats, modifierFor, costForRange,
  STARTING_TDPS, tdpsFromCircling, tdpsFromSkills, MAX_CIRCLE_AWARD, tdpsForCircle,
  parseStats, parseCircle, parseTdps,
  type StatBlock, type StatName,
} from '../lib/tdp'

const CUSTOM = 'Custom (enter your own)'

/**
 * TDP planner — "what will these attribute goals cost me, and will I have earned
 * enough by then?"
 *
 * Open to everyone with no sign-in and nothing stored: the whole point is that a
 * player can paste their INFO output and get an answer, whether or not they use
 * Magiloom to play. Every number comes from the formulas in lib/tdp.ts, each of
 * which is sourced and tested.
 */
export function Planner(): JSX.Element {
  const [race, setRace]       = useState<string>('Human')
  const [custom, setCustom]   = useState<Record<StatName, number>>(() =>
    Object.fromEntries(STATS.map(s => [s, 0])) as Record<StatName, number>)
  const [current, setCurrent] = useState<StatBlock>(emptyStats)
  const [target, setTarget]   = useState<StatBlock>(emptyStats)
  const [paste, setPaste]     = useState('')
  const [banked, setBanked]   = useState(0)
  const [circle, setCircle]   = useState(1)
  const [goalCircle, setGoal] = useState(1)

  const racialFor = (stat: StatName): number =>
    race === CUSTOM ? (custom[stat] ?? 0) : modifierFor(race, stat)

  const rows = useMemo(() => STATS.map(stat => {
    const from = current[stat] || 0
    const to   = target[stat]  || 0
    const racial = racialFor(stat)
    return { stat, from, to, racial, cost: to > from ? costForRange(from, to, racial) : 0 }
  }), [current, target, race, custom])

  const totalCost = rows.reduce((n, r) => n + r.cost, 0)
  const fromCircling = tdpsFromCircling(circle, goalCircle)
  const available = banked + fromCircling
  const shortfall = totalCost - available

  /** Fill the form from a pasted INFO report. */
  function applyPaste(): void {
    const stats = parseStats(paste)
    if (Object.keys(stats).length) {
      const next = { ...current, ...stats } as StatBlock
      setCurrent(next)
      // Seed targets from current so the table starts at "no change" rather than at
      // zero, which would read as a huge negative plan.
      setTarget(t => {
        const merged = { ...t }
        for (const s of STATS) if (!merged[s] || merged[s] < next[s]) merged[s] = next[s]
        return merged
      })
    }
    const c = parseCircle(paste)
    if (c !== null) { setCircle(c); setGoal(g => Math.max(g, c)) }
    const t = parseTdps(paste)
    if (t !== null) setBanked(t)
  }

  const setStat = (which: 'current' | 'target', stat: StatName, v: number): void => {
    const fn = which === 'current' ? setCurrent : setTarget
    fn(prev => ({ ...prev, [stat]: v }))
  }

  return (
    <>
      <h1>TDP Planner</h1>
      <p className="lede">
        Work out what your attribute goals will cost, and whether circling will pay for
        them. Nothing is stored and no account is needed — paste your <span className="mono">INFO</span>{' '}
        output and it fills itself in.
      </p>

      <div className="card">
        <h2>Start from your character</h2>
        <div className="field">
          <label htmlFor="paste">Paste your <span className="mono">INFO</span> output (optional)</label>
          <textarea
            id="paste" rows={4} value={paste} onChange={e => setPaste(e.target.value)}
            placeholder="Circle: 27   TDPs: 3,348&#10;Strength: 42   Reflex: 38   …"
            style={{
              width: '100%', fontFamily: "'JetBrains Mono', monospace", fontSize: '.85rem',
              background: 'var(--bg-panel)', color: 'var(--text-bright)',
              border: '1px solid var(--border-hi)', borderRadius: 8, padding: 10, resize: 'vertical',
            }}
          />
        </div>
        <button className="ghost" onClick={applyPaste} disabled={!paste.trim()}>Fill from paste</button>

        <div className="row" style={{ marginTop: 18 }}>
          <div>
            <label htmlFor="race">Race</label>
            <select id="race" value={race} onChange={e => setRace(e.target.value)}>
              {RACES.map(r => <option key={r} value={r}>{r}</option>)}
              <option value={CUSTOM}>{CUSTOM}</option>
            </select>
          </div>
          <div>
            <label htmlFor="banked">TDPs banked</label>
            <input id="banked" type="number" min={0} value={banked}
                   onChange={e => setBanked(Math.max(0, +e.target.value || 0))} />
          </div>
          <div>
            <label htmlFor="circle">Current circle</label>
            <input id="circle" type="number" min={1} max={MAX_CIRCLE_AWARD} value={circle}
                   onChange={e => setCircle(Math.max(1, +e.target.value || 1))} />
          </div>
          <div>
            <label htmlFor="goal">Circle you expect to reach</label>
            <input id="goal" type="number" min={1} max={MAX_CIRCLE_AWARD} value={goalCircle}
                   onChange={e => setGoal(Math.max(1, +e.target.value || 1))} />
          </div>
        </div>

        {race === CUSTOM && (
          <p className="note">
            Enter your own cost modifiers below (−3 is cheapest, +3 dearest). Half-Elf and
            Aelotoi aren't in the published table, so rather than guess we let you supply
            the numbers — in game, <span className="mono">TDP PROJECT &lt;attribute&gt; &lt;goal&gt;</span>{' '}
            tells you the real cost and you can work back from it.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Attributes</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Attribute</th>
                <th className="num">Racial</th>
                <th className="num">Now</th>
                <th className="num">Goal</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.stat}>
                  <td>{r.stat}</td>
                  <td className="num">
                    {race === CUSTOM ? (
                      <input type="number" min={-3} max={3} value={custom[r.stat]}
                             style={{ width: 62, padding: '2px 6px', textAlign: 'right' }}
                             onChange={e => setCustom(c => ({
                               ...c, [r.stat]: Math.max(-3, Math.min(3, +e.target.value || 0)),
                             }))} />
                    ) : (
                      <span className={r.racial < 0 ? '' : 'muted'}>
                        {r.racial > 0 ? `+${r.racial}` : r.racial || '—'}
                      </span>
                    )}
                  </td>
                  <td className="num">
                    <input type="number" min={0} max={999} value={r.from || ''}
                           style={{ width: 76, padding: '2px 6px', textAlign: 'right' }}
                           onChange={e => setStat('current', r.stat, +e.target.value || 0)} />
                  </td>
                  <td className="num">
                    <input type="number" min={0} max={999} value={r.to || ''}
                           style={{ width: 76, padding: '2px 6px', textAlign: 'right' }}
                           onChange={e => setStat('target', r.stat, +e.target.value || 0)} />
                  </td>
                  <td className="num">{r.cost ? r.cost.toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="val accent">{totalCost.toLocaleString()}</div>
          <div className="lbl">TDPs needed</div>
        </div>
        <div className="tile">
          <div className="val">{banked.toLocaleString()}</div>
          <div className="lbl">Banked now</div>
        </div>
        <div className="tile">
          <div className="val">{fromCircling.toLocaleString()}</div>
          <div className="lbl">From circling {circle}→{goalCircle}</div>
        </div>
        <div className="tile">
          {/* Before any goals are entered there is nothing to cover, and claiming
              "Covered" would read as an answer to a question nobody asked. */}
          <div className={`val ${totalCost === 0 ? '' : shortfall > 0 ? 'amber' : 'accent'}`}>
            {totalCost === 0 ? '—' : shortfall > 0 ? shortfall.toLocaleString() : 'Covered'}
          </div>
          <div className="lbl">{totalCost > 0 && shortfall > 0 ? 'Still short' : 'Shortfall'}</div>
        </div>
      </div>

      {totalCost > 0 && (
        <p className="note">
          {shortfall > 0 ? (
            <>
              Circling to {goalCircle} leaves you <strong>{shortfall.toLocaleString()}</strong> TDPs
              short. The rest comes from skill ranks — see below for how that adds up.
            </>
          ) : (
            <>
              Banked TDPs plus circling to {goalCircle} covers this plan with{' '}
              <strong>{Math.abs(shortfall).toLocaleString()}</strong> to spare, before counting
              anything earned from skill ranks.
            </>
          )}
        </p>
      )}

      <CircleIncome />
      <SkillIncome />

      <div className="card tight">
        <p className="note" style={{ margin: 0 }}>
          Costs use <span className="mono">3 × attribute + racial × ⌊attribute ÷ 2⌋</span> per point
          (15 × instead of 3 × at 100 and above), summed point by point the way the game
          does. Sourced from{' '}
          <a href="https://elanthipedia.play.net/Attributes" target="_blank" rel="noopener">Elanthipedia: Attributes</a>
          {' '}and{' '}
          <a href="https://elanthipedia.play.net/Time_Development_Points" target="_blank" rel="noopener">Time Development Points</a>.
          Check against <span className="mono">TDP PROJECT</span> in game before committing to a long plan.
        </p>
      </div>
    </>
  )
}

/**
 * TDPs from circling. Lives here rather than on the Circles page: everything about
 * TDPs belongs in one place, and this number feeds the shortfall above.
 */
function CircleIncome(): JSX.Element {
  const [from, setFrom] = useState(1)
  const [to, setTo]     = useState(30)

  const total = tdpsFromCircling(from, to)
  const each  = Math.max(0, Math.floor(to) - Math.max(1, Math.floor(from)))

  return (
    <div className="card">
      <h2>TDPs from circling</h2>
      <p className="lede">
        Each circle grants TDPs: 50 plus the circle number below circle 10, then 100 plus the
        circle number, and nothing past circle {MAX_CIRCLE_AWARD}. Circle 1 pays nothing — you
        start there.
      </p>
      <div className="row">
        <div>
          <label htmlFor="cf">From circle</label>
          <input id="cf" type="number" min={1} max={MAX_CIRCLE_AWARD} value={from}
                 onChange={e => setFrom(Math.max(1, +e.target.value || 1))} />
        </div>
        <div>
          <label htmlFor="ct">To circle</label>
          <input id="ct" type="number" min={1} max={MAX_CIRCLE_AWARD} value={to}
                 onChange={e => setTo(Math.max(1, +e.target.value || 1))} />
        </div>
        <div className="shrink" style={{ minWidth: 150 }}>
          <div className="tile" style={{ padding: '8px 14px' }}>
            <div className="val accent">{total.toLocaleString()}</div>
            <div className="lbl">TDPs over {each} circle{each === 1 ? '' : 's'}</div>
          </div>
        </div>
      </div>

      {each > 0 && each <= 40 && (
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead><tr><th className="num">Circle</th><th className="num">TDPs</th><th className="num">Running total</th></tr></thead>
            <tbody>
              {Array.from({ length: each }, (_, i) => Math.floor(from) + 1 + i).map((c, i, arr) => (
                <tr key={c}>
                  <td className="num">{c}</td>
                  <td className="num">{tdpsForCircle(c).toLocaleString()}</td>
                  <td className="num muted">
                    {arr.slice(0, i + 1).reduce((n, x) => n + tdpsForCircle(x), 0).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {each > 40 && (
        <p className="note">Range is too wide for a per-circle breakdown — narrow it below 40 circles to see one.</p>
      )}
    </div>
  )
}

/**
 * The other half of TDP income: skill ranks. Every rank gained drops its own rank
 * number into a hidden pool shared across all skills, and every 200 points in that
 * pool is one TDP — so high ranks pay far better than low ones, which is the part
 * people tend to misjudge.
 */
function SkillIncome(): JSX.Element {
  const [text, setText] = useState('')

  // Prefer the real EXP parser — an EXP line carries a rank, a percentage AND a mind
  // pool, and scraping every number out of it would count all three as ranks and
  // roughly triple the answer. Only when the paste isn't EXP-shaped do we fall back
  // to treating it as a hand-typed list of ranks.
  const { ranks, source } = useMemo(() => {
    const skills = parseExpSkills(text)
    if (skills.length) {
      return { ranks: skills.map(s => +s.rank).filter(n => n > 0), source: 'exp' as const }
    }
    const bare = (text.match(/\b\d{1,4}\b/g) ?? []).map(Number).filter(n => n > 0 && n <= 1750)
    return { ranks: bare, source: 'bare' as const }
  }, [text])

  const income = tdpsFromSkills(ranks)

  return (
    <div className="card">
      <h2>TDPs from skill ranks</h2>
      <p className="lede">
        Paste your <span className="mono">EXP ALL</span> output (or just type rank numbers) to see
        what your ranks have been worth. Ranks pay their own number into a shared pool, and
        every 200 points is one TDP — so a rank at 400 is worth four hundred times what your
        first rank was.
      </p>
      <textarea
        rows={10} value={text} onChange={e => setText(e.target.value)}
        placeholder="Climbing:  34  50%  [340/900]   Forging:  5  0%  [0/10]  …"
        style={{
          width: '100%', fontFamily: "'JetBrains Mono', monospace", fontSize: '.85rem',
          background: 'var(--bg-panel)', color: 'var(--text-bright)',
          border: '1px solid var(--border-hi)', borderRadius: 8, padding: 10, resize: 'vertical',
        }}
      />
      {ranks.length > 0 && (
        <div className="tiles" style={{ marginTop: 14 }}>
          <div className="tile">
            <div className="val">{ranks.length}</div>
            <div className="lbl">{source === 'exp' ? 'Skills read' : 'Ranks read'}</div>
          </div>
          <div className="tile">
            <div className="val accent">{income.tdps.toLocaleString()}</div>
            <div className="lbl">TDPs earned</div>
          </div>
          <div className="tile">
            <div className="val">{income.remainder}</div>
            <div className="lbl">Points in the pool</div>
          </div>
          <div className="tile">
            <div className="val amber">{(STARTING_TDPS + income.tdps).toLocaleString()}</div>
            <div className="lbl">With the 600 starting grant</div>
          </div>
        </div>
      )}
      {ranks.length > 0 && source === 'bare' && (
        <p className="note warn">
          That paste didn't look like an <span className="mono">EXP ALL</span> report, so every number
          in it was read as a rank. Paste the full report for an exact figure.
        </p>
      )}
    </div>
  )
}
