import { combine, fmtDuration, fmtRanks, type Analysis } from '../lib/logAnalysis'

// A proportional bar drawn behind a table cell. Cheaper to read than a chart and it
// survives any column width; see .bar in styles.css.
const bar = (value: number, max: number): React.CSSProperties =>
  ({ ['--pct' as string]: max > 0 ? Math.round((value / max) * 100) : 0 })

export function Results({ list }: { list: Analysis[] }): JSX.Element {
  const c = combine(list)

  const topSkill = c.skills[0]?.ranksGained ?? 0
  const topRoom  = c.rooms[0]?.msSpent ?? 0
  const topKill  = c.kills[0]?.count ?? 0

  // Ranks/hour is only meaningful with enough active time behind it — a four-minute
  // log extrapolates to a wild number and reads as fact. Below the threshold, say so.
  const enoughTime = c.activeMs >= 10 * 60_000
  const reportsOnly = list.length > 0 && list.every(a => a.expFromReportsOnly || a.skills.length === 0)

  // Whether experience came from structured sidecars (exact) or was scraped back out
  // of flattened text (good, but lossy). Worth stating plainly: the difference decides
  // how much weight someone should put on the number.
  const withExp   = list.filter(a => a.expSource !== 'none')
  const exactExp  = withExp.length > 0 && withExp.every(a => a.expSource === 'events')
  const mixedExp  = withExp.some(a => a.expSource === 'events') && !exactExp
  const exactRooms = c.rooms.length > 0 && list.some(a => a.roomSource === 'events')

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <div className="val">{fmtDuration(c.activeMs)}</div>
          <div className="lbl">Time played</div>
        </div>
        <div className="tile">
          <div className="val accent">{fmtRanks(c.totalRanks)}</div>
          <div className="lbl">Ranks gained</div>
        </div>
        <div className="tile">
          <div className="val amber">{enoughTime ? fmtRanks(c.ranksPerHour) : '—'}</div>
          <div className="lbl">Ranks / hour</div>
        </div>
        <div className="tile">
          <div className="val">{c.totalKills || '—'}</div>
          <div className="lbl">Kills</div>
        </div>
        <div className="tile">
          <div className="val">{c.deaths || '—'}</div>
          <div className="lbl">Deaths</div>
        </div>
        <div className="tile">
          <div className="val">{c.coins ? c.coins.toLocaleString() : '—'}</div>
          <div className="lbl">Coins found</div>
        </div>
      </div>

      <p className="note">
        {c.logs.length} log{c.logs.length === 1 ? '' : 's'}
        {c.chars.length > 0 && <> · {c.chars.join(', ')}</>}
        {c.days.length > 1 && <> · {c.days[0]} to {c.days[c.days.length - 1]}</>}
        {c.days.length === 1 && <> · {c.days[0]}</>}
        {' — '}
        <span className="muted">
          time played counts only active play: any silence longer than five minutes is
          left out, so idling in town doesn't inflate your rate.
        </span>
        {!enoughTime && c.totalRanks > 0 && (
          <> <span className="muted">Too little play time here for a meaningful hourly rate.</span></>
        )}
      </p>

      {reportsOnly && c.totalRanks > 0 && (
        <p className="note warn">
          Experience in this selection came from typed <span className="mono">EXP ALL</span> reports
          rather than live updates, so gains are only measured between the reports you ran.
          Live ticks give a much finer picture.
        </p>
      )}

      <div className="grid two">
        <div className="card">
          <h2>
            Experience{' '}
            {exactExp && <span className="pill">exact</span>}
            {mixedExp && <span className="pill">partly exact</span>}
          </h2>
          {withExp.length > 0 && !exactExp && (
            <p className="note">
              {mixedExp
                ? 'Some of these logs have structured data recorded alongside them and some don\'t; the ones that do are exact, the rest are read back out of the log text.'
                : 'Read back out of the log text, which loses a little — skill names arrive abbreviated and a few updates can\'t be resolved. Newer logs record structured data alongside them and are exact.'}
            </p>
          )}
          {c.skills.length === 0 ? (
            <p className="empty">
              No experience found in these logs.<br />
              <span className="muted">Skills only appear once they tick while logging is on.</span>
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Skill</th><th className="num">Ranks</th><th className="num">/ hr</th></tr>
                </thead>
                <tbody>
                  {c.skills.filter(s => s.ranksGained > 0).map(s => (
                    <tr key={s.skill}>
                      <td className="bar" style={bar(s.ranksGained, topSkill)}><span>{s.skill}</span></td>
                      <td className="num">{fmtRanks(s.ranksGained)}</td>
                      <td className="num muted">{enoughTime ? fmtRanks(s.perHour) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h2>
            Where the time went{' '}
            {exactRooms && <span className="pill">exact</span>}
          </h2>
          {c.rooms.length === 0 ? (
            <p className="empty">
              No rooms in these logs.<br />
              <span className="muted">
                DragonRealms sends the room name in a part of the stream that plain text
                logging doesn't keep, so older logs have no rooms to find. Logs recorded
                from now on save it properly and will show up here.
              </span>
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Room</th><th className="num">Time</th><th className="num">Visits</th></tr>
                </thead>
                <tbody>
                  {c.rooms.slice(0, 15).map(r => (
                    <tr key={r.room}>
                      <td className="bar" style={bar(r.msSpent, topRoom)}><span>{r.room}</span></td>
                      <td className="num">{fmtDuration(r.msSpent)}</td>
                      <td className="num muted">{r.visits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>
          Combat <span className="pill amber">estimated</span>
        </h2>
        <p className="note warn">
          Kills, deaths and coins are matched against the wording of ordinary game prose,
          which varies by creature and by killing blow — treat these as a good indication
          rather than an exact count. Experience, time and rooms above are read from
          structured output and are exact.
        </p>
        {c.kills.length === 0 ? (
          <p className="empty">No kills matched in these logs.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Creature</th><th className="num">Killed</th></tr></thead>
              <tbody>
                {c.kills.slice(0, 20).map(k => (
                  <tr key={k.name}>
                    <td className="bar" style={bar(k.count, topKill)}><span>{k.name}</span></td>
                    <td className="num">{k.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {c.logs.length > 1 && (
        <div className="card">
          <h2>By log</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Log</th><th>Character</th>
                  <th className="num">Played</th><th className="num">Ranks</th><th className="num">Lines</th>
                </tr>
              </thead>
              <tbody>
                {c.logs.map(a => (
                  <tr key={a.name}>
                    <td className="mono">{a.day || a.name}</td>
                    <td>{a.char}</td>
                    <td className="num">{fmtDuration(a.activeMs)}</td>
                    <td className="num">{fmtRanks(a.totalRanks)}</td>
                    <td className="num muted">{a.lineCount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
