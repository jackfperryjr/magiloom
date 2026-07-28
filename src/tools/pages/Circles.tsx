import { useMemo, useState } from 'react'
import { parseExpSkills } from '../../renderer/src/lib/exp-parser'
import { CIRCLE_REQS, GUILDS, checkCircle, guildFromSkills, highestCircleMet, isProjectedCircle } from '../lib/circleReqs'

/**
 * Circle requirements checker.
 *
 * One table does both jobs. Paste an EXP ALL report and every requirement shows the
 * skill filling it, the rank you have, and the circle that rank alone reaches — so you
 * can see at a glance which requirements are holding you back and which are miles
 * ahead. Pick a target circle and the same table gains what that circle asks for and
 * how far short you are.
 *
 * Your guild comes from your guild skill (each guild has exactly one), so the only
 * thing to choose is the circle.
 */
export function Circles(): JSX.Element {
  const [expText, setExpText]  = useState('')
  const [target, setTarget]    = useState<number | null>(null)
  const [sortBy, setSortBy]    = useState<'table' | 'circle'>('circle')

  const ranks = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of parseExpSkills(expText)) {
      const rank = +s.rank
      if (Number.isFinite(rank)) m.set(s.name.trim(), rank)
    }
    return m
  }, [expText])

  // Detection normally succeeds from the guild skill. It can't when DR renames one —
  // Scouting became Instinct, and until that alias was added a Ranger got nothing but
  // "we can't tell which guild you're in". So a manual choice is offered as a FALLBACK
  // when detection fails, never as a step in the normal path: the next rename degrades
  // to one dropdown instead of a dead end.
  const detected = useMemo(() => guildFromSkills(ranks.keys()), [ranks])
  const [picked, setPicked] = useState<string>('')
  const guild = detected ?? (picked || null)
  const at    = useMemo(() => (guild ? highestCircleMet(guild, ranks) : 0), [guild, ranks])

  const first = guild ? CIRCLE_REQS[guild].firstCircle : 2
  const last  = guild ? CIRCLE_REQS[guild].lastCircle  : 300
  const goal  = Math.min(Math.max(target ?? at + 1, first), last)
  const check = guild ? checkCircle(guild, goal, ranks) : null
  const projected = guild ? isProjectedCircle(guild, goal) : false

  const rows = useMemo(() => {
    if (!check) return []
    const list = [...check.slots]
    // Default to the most useful order: whatever is furthest behind, first.
    if (sortBy === 'circle') list.sort((a, b) => a.atCircle - b.atCircle || b.short - a.short)
    return list
  }, [check, sortBy])

  const worstShort = check ? Math.max(...check.slots.map(s => s.short), 0) : 0

  return (
    <>
      <h1>Circles</h1>
      <p className="lede">
        Paste your <span className="mono">EXP ALL</span> to see what circle each of your
        skills supports, and what you'd need for any circle you pick. No account, nothing
        stored.
      </p>

      <div className="card">
        <h2>Your <span className="mono">EXP ALL</span></h2>
        <p className="lede" style={{ fontSize: '.9rem' }}>
          Type <span className="mono">EXP ALL</span> (or <span className="mono">EXP 0</span>) in
          game and paste the whole thing — both are free commands with no roundtime. Your guild
          is worked out from your guild skill.
        </p>
        <textarea
          rows={14} value={expText} onChange={e => setExpText(e.target.value)}
          placeholder={'Small Edged:     38  22%  clear        [0/34]\nEvasion:         45  10%  perusing     [4/40]\nBackstab:        30   0%  clear        [0/30]\n…'}
          style={{
            width: '100%', fontFamily: "'JetBrains Mono', monospace", fontSize: '.85rem',
            background: 'var(--bg-panel)', color: 'var(--text-bright)',
            border: '1px solid var(--border-hi)', borderRadius: 8, padding: 10, resize: 'vertical',
          }}
        />
        {expText.trim() && ranks.size === 0 && (
          <p className="err">
            No skills found in that paste. Rows should look like{' '}
            <span className="mono">Small Edged: 38 22% clear [0/34]</span>.
          </p>
        )}
        {ranks.size > 0 && !detected && (
          <>
            <p className="note warn">
              Read {ranks.size} skills, but none of them is a guild skill, so your guild
              couldn't be worked out. Make sure you pasted the whole report — plain{' '}
              <span className="mono">EXP</span> isn't enough, use{' '}
              <span className="mono">EXP ALL</span>. Commoners have no guild skill and no
              circle requirements. Otherwise, pick your guild below and everything else
              still works.
            </p>
            <div className="row">
              <div style={{ maxWidth: 260 }}>
                <label htmlFor="guild">Guild</label>
                <select id="guild" value={picked} onChange={e => setPicked(e.target.value)}>
                  <option value="">Choose…</option>
                  {GUILDS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>
          </>
        )}
      </div>

      {guild && check && (
        <>
          <div className="tiles">
            <div className="tile">
              <div className="val">{guild}</div>
              <div className="lbl">{detected ? 'Guild' : 'Guild (you picked)'}</div>
            </div>
            <div className="tile">
              <div className="val accent">{at >= first ? at : '—'}</div>
              <div className="lbl">Circle you qualify for</div>
            </div>
            <div className="tile">
              <div className={`val ${check.ready ? 'accent' : 'amber'}`}>
                {check.ready ? 'Met' : check.unmet.length}
              </div>
              <div className="lbl">{check.ready ? `circle ${goal} requirements` : `short for circle ${goal}`}</div>
            </div>
            <div className="tile">
              <div className="val">{check.totalShort ? check.totalShort.toLocaleString() : '—'}</div>
              <div className="lbl">Ranks to go</div>
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0, flex: 1 }}>Requirements for circle {goal}</h2>
              <div className="shrink" style={{ minWidth: 130 }}>
                <label htmlFor="target">Target circle</label>
                <input id="target" type="number" min={first} max={last} value={goal}
                       onChange={e => setTarget(Math.max(first, Math.min(last, +e.target.value || first)))} />
              </div>
              <button className="ghost small shrink"
                      onClick={() => setSortBy(s => (s === 'circle' ? 'table' : 'circle'))}>
                {sortBy === 'circle' ? 'Guild order' : 'Furthest behind first'}
              </button>
              {target !== null && (
                <button className="ghost small shrink" onClick={() => setTarget(null)}>
                  My next circle
                </button>
              )}
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Requirement</th>
                    <th>Your skill</th>
                    <th className="num">Ranks</th>
                    <th className="num">Good to</th>
                    <th className="num">Need</th>
                    <th className="num">Short</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(s => (
                    <tr key={s.slot}>
                      <td className="bar" style={{ ['--pct' as string]: worstShort > 0 ? Math.round((s.short / worstShort) * 100) : 0 }}>
                        <span className="muted">{s.slot}</span>
                      </td>
                      <td>
                        {s.skill === null ? <span className="muted">—</span>
                          : s.tiedWith > 0 && !s.met ? (
                            <span className="muted" data-tooltip={`${s.skill} and ${s.tiedWith} other${s.tiedWith === 1 ? '' : 's'} are tied at ${s.have}`}>
                              any of {s.tiedWith + 1}
                            </span>
                          ) : s.skill}
                      </td>
                      <td className="num muted">{s.have}</td>
                      {/* The circle this requirement alone reaches. Matching the overall
                          number means this is one of the things holding you back. */}
                      <td className="num" style={{ color: s.atCircle <= at ? 'var(--amber)' : 'var(--text-dim)' }}>
                        {s.atCircle < first ? '—' : s.atCircle >= last ? `${last}+` : s.atCircle}
                      </td>
                      <td className="num">{s.needed}</td>
                      <td className="num" style={{ color: s.met ? 'var(--text-dim)' : 'var(--amber)' }}>
                        {s.met ? 'met' : s.short}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {projected && (
              <p className="note warn">
                Nothing above circle {CIRCLE_REQS[guild].scrapedThrough} is published. These
                numbers continue your guild's own per-circle step, which has held exactly
                steady since circle 151 — a projection, not a source. Check{' '}
                <span className="mono">GUILD</span> in game before planning against them.
              </p>
            )}

            <p className="note">
              <strong>Good to</strong> is the circle each requirement would let you reach on its
              own — your circle is the lowest of them, so the amber ones are what's actually
              holding you back. A requirement like <span className="mono">3rd Survival</span>{' '}
              means your third-highest Survival skill, so the skill filling it can change as
              you train.
            </p>
          </div>
        </>
      )}
    </>
  )
}
