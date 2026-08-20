/**
 * Body-injury tests — the wire format and the view modes.
 *
 * DR reports wounds through a `<dialogData id='injuries'>` window, and two of its
 * `<image>` attributes carry more than the `name` token does: an explicit `scar`
 * rank, and a `cmd` holding the game's own command for that location. Both were
 * being dropped before, along with any window whose id wasn't exactly "injuries"
 * — which is how DR labels the ones about other people. These tests pin the
 * priority rules so a future rewrite can't quietly lose them again.
 *
 * The injury window also shows one view at a time (external/internal ×
 * wounds/scars/both), selected with `_injury <mode> -1`, so the mode arithmetic
 * is covered here too — get it wrong and the panel silently asks for the wrong
 * layer.
 *
 * Run: npm run test:tools
 */

import { parseLine, resetParser, type GameEvent } from './sge-parser'
import {
  injuriesFromImages, injuriesFromTouch, takeWoundCommand, canTakePart,
  injuryLayer, injuryKind, injuryMode, injuryModeCommand, normalizePart,
  worstWound, woundCount, isHealthy, INJURY_MODE_LABEL, DEFAULT_INJURY_MODE,
} from './injuries'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

/** Parse one raw line and return the injuries events it emitted. */
function injuryEvents(raw: string): Extract<GameEvent, { type: 'injuries' }>[] {
  resetParser()
  return parseLine(raw)
    .filter((e: GameEvent): e is Extract<GameEvent, { type: 'injuries' }> => e.type === 'injuries')
}

// ── Parsing the dialog ───────────────────────────────────────────────────────
{
  const [e] = injuryEvents(
    "<dialogData id='injuries'>"
    + "<image id='head' name='Injury2'/>"
    + "<image id='chest' name='Scar1'/>"
    + "<image id='nsys' name='Nsys3'/>"
    + '</dialogData>',
  )
  check('injuries event emitted', Boolean(e))
  eq('own window has the plain id', e?.dialogId, 'injuries')
  eq('all images collected', e?.images.length, 3)

  const inj = injuriesFromImages(e?.images ?? [])
  eq('wound rank read from name', inj.head?.wound, 2)
  eq('scar rank read from name', inj.chest?.scar, 1)
  eq('nsys stored as a wound level', inj.nsys?.wound, 3)
  eq('unlisted locations stay clear', inj.leftArm, undefined)
}

// The `scar` attribute wins over whatever the name token says.
{
  const [e] = injuryEvents(
    "<dialogData id='injuries'><image id='leftLeg' name='Injury3' scar='2'/></dialogData>",
  )
  eq('scar attribute captured', e?.images[0]?.scar, '2')
  const inj = injuriesFromImages(e?.images ?? [])
  eq('scar attribute wins over the name', inj.leftLeg?.scar, 2)
  eq('and the name is not also read as a wound', inj.leftLeg?.wound, 0)
}

// A server-supplied command is carried through, even on a healthy location.
{
  const [e] = injuryEvents(
    "<dialogData id='injuries'>"
    + "<image id='rightArm' name='Injury1' cmd='take Melete right arm'/>"
    + "<image id='neck' name='Injury0' cmd='look neck'/>"
    + '</dialogData>',
  )
  const inj = injuriesFromImages(e?.images ?? [])
  eq('cmd captured', inj.rightArm?.cmd, 'take Melete right arm')
  eq('cmd kept on an unwounded location', inj.neck?.cmd, 'look neck')
  eq('unwounded stays unwounded', inj.neck?.wound, 0)
}

// Windows about other people carry a suffixed id and a title.
{
  const [e] = injuryEvents(
    "<dialogData id='injuriesMelete' title=\"Melete's Injuries\">"
    + "<image id='abdomen' name='Injury2'/></dialogData>",
  )
  eq('suffixed window still parses', e?.dialogId, 'injuriesMelete')
  eq('title captured', e?.title, "Melete's Injuries")
}

// Non-injury dialogs are still ignored.
{
  const events = injuryEvents("<dialogData id='minivitals'><image id='head' name='Injury3'/></dialogData>")
  eq('minivitals is not an injuries window', events.length, 0)
}

// Feet are real locations; they used to be dropped on the floor.
{
  eq('left foot normalizes', normalizePart('leftFoot'), 'leftFoot')
  eq('right foot normalizes', normalizePart('rightFoot'), 'rightFoot')
  const inj = injuriesFromImages([{ id: 'rightFoot', name: 'Injury2' }])
  eq('foot wound survives parsing', inj.rightFoot?.wound, 2)
}

// ── Commands ────────────────────────────────────────────────────────────────
{
  const withCmd  = { wound: 2, scar: 0, cmd: 'transfer Melete left arm' }
  const noCmd    = { wound: 2, scar: 0 }
  const scarOnly = { wound: 0, scar: 1 }
  eq('server command wins', takeWoundCommand('Melete', 'leftArm', withCmd), 'transfer Melete left arm')
  eq('fallback builds a TAKE', takeWoundCommand('Melete', 'leftArm', noCmd), 'take Melete left arm')
  eq('scar-only takes the scar', takeWoundCommand('Melete', 'leftArm', scarOnly), 'take Melete left arm scar')
  eq('nsys has no location command', takeWoundCommand('Melete', 'nsys', noCmd), null)
  eq('feet have none either', takeWoundCommand('Melete', 'leftFoot', noCmd), null)
  eq('unless the game sent one', takeWoundCommand('Melete', 'leftFoot', withCmd), 'transfer Melete left arm')
  check('canTakePart follows the command', canTakePart('leftFoot', withCmd) && !canTakePart('leftFoot', noCmd))
  eq('nothing to take on a clear location', takeWoundCommand('Melete', 'leftArm', { wound: 0, scar: 0 }), null)
}

// ── View modes ──────────────────────────────────────────────────────────────
{
  eq('default is external, worst-of', DEFAULT_INJURY_MODE, 2)
  eq('mode 0 is external', injuryLayer(0), 'external')
  eq('mode 3 is internal', injuryLayer(3), 'internal')
  eq('mode 4 is scars', injuryKind(4), 'scar')
  eq('mode 5 is both', injuryKind(5), 'both')
  eq('external wounds recombines', injuryMode('external', 'wound'), 0)
  eq('internal scars recombines', injuryMode('internal', 'scar'), 4)
  eq('command shape', injuryModeCommand(3), '_injury 3 -1')
  eq('every mode is labelled', INJURY_MODE_LABEL.length, 6)
  // Round-trip: decomposing and recombining any mode is the identity.
  const roundTrips = [0, 1, 2, 3, 4, 5].every(m => injuryMode(injuryLayer(m), injuryKind(m)) === m)
  check('layer/kind round-trip', roundTrips)
}

// ── Summaries ───────────────────────────────────────────────────────────────
{
  const inj = injuriesFromImages([
    { id: 'head', name: 'Injury1' },
    { id: 'chest', name: 'Injury3' },
    { id: 'leftLeg', name: 'Scar2' },
    { id: 'nsys', name: 'Nsys2' },
  ])
  eq('worst wound found', worstWound(inj), 3)
  eq('nsys excluded from the wound count', woundCount(inj), 2)
  check('not healthy', !isHealthy(inj))
  check('empty is healthy', isHealthy({}))
  check('a scar alone is not healthy', !isHealthy({ back: { wound: 0, scar: 1 } }))
}

// ── TOUCH text fallback ─────────────────────────────────────────────────────
// Used only when no structured window arrives; still needs to not invent wounds.
{
  const inj = injuriesFromTouch([
    'You see a deep gash on her right arm.',
    'Her left foot has a minor cut.',
    'She appears healthy otherwise.',
  ])
  eq('severity word maps to a rank', inj.rightArm?.wound, 2)
  eq('foot line matches the foot', inj.leftFoot?.wound, 1)
  check('healthy lines add nothing', Object.keys(inj).length === 2)
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ injuries: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ injuries: ${passed} passed`)
