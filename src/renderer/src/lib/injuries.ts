/**
 * Body injuries model for DragonRealms.
 *
 * DR's StormFront/Wrayth feed reports the character's wounds through a
 * `<dialogData id='injuries'>` window whose children are one `<image>` per body
 * location, e.g.
 *
 *   <dialogData id='injuries'>
 *     <image id='head'     name='Injury1'/>
 *     <image id='rightArm' name='Scar2'/>
 *     <image id='nsys'     name='Nsys3'/>
 *   </dialogData>
 *
 * The `name` encodes severity: `Injury1..3` (bleeding/broken wounds, 1 = minor,
 * 3 = severe), `Scar1..3` (healed-but-scarred), and `Nsys1..3` for nervous-system
 * damage on the special `nsys` location. A healthy location is either omitted or
 * carries `Injury0`. Each dialogData block is a COMPLETE snapshot — anything not
 * listed is healthy.
 *
 * NOTE: the exact wire strings are the well-documented StormFront convention;
 * they haven't been diffed against a live DR/Lich capture in this repo yet, so
 * `parseInjuryName` is deliberately lenient (case-insensitive, accepts the
 * `wound`/`nerves` synonyms). If a real log shows different tokens, widen it here.
 */

// The 14 locations DR tracks. Order is head→toe, left/right paired, nsys last.
export const BODY_PARTS = [
  'head', 'neck', 'leftEye', 'rightEye',
  'chest', 'abdomen', 'back',
  'leftArm', 'rightArm', 'leftHand', 'rightHand',
  'leftLeg', 'rightLeg',
  'nsys',
] as const

export type BodyPart = typeof BODY_PARTS[number]

// Human-readable labels for tooltips/legend.
export const PART_LABEL: Record<BodyPart, string> = {
  head: 'Head', neck: 'Neck', leftEye: 'Left eye', rightEye: 'Right eye',
  chest: 'Chest', abdomen: 'Abdomen', back: 'Back',
  leftArm: 'Left arm', rightArm: 'Right arm', leftHand: 'Left hand', rightHand: 'Right hand',
  leftLeg: 'Left leg', rightLeg: 'Right leg',
  nsys: 'Nervous system',
}

// Per-location state: a wound level and a scar level, each 0–3 (0 = none).
export interface PartInjury { wound: number; scar: number }
export type Injuries = Partial<Record<BodyPart, PartInjury>>

// Severity words for tooltips (index = level).
export const WOUND_WORD = ['none', 'minor', 'moderate', 'severe']
export const SCAR_WORD  = ['none', 'faint scar', 'scar', 'deep scar']
export const NSYS_WORD   = ['none', 'lightheaded', 'dizzy', 'convulsing']

// Wound-severity colors (level 0 = healthy base handled by the figure fill).
export const WOUND_COLOR = ['', '#e0b84a', '#e07a2a', '#dd2222'] // 1 amber, 2 orange, 3 red
export const SCAR_COLOR  = '#5f8fd4'                              // scars read as a cool blue tint

// Normalize the many id spellings DR/clients use to our canonical BodyPart.
const PART_ALIASES: Record<string, BodyPart> = {
  head: 'head', neck: 'neck',
  lefteye: 'leftEye', righteye: 'rightEye',
  chest: 'chest', abdomen: 'abdomen', abs: 'abdomen', back: 'back',
  leftarm: 'leftArm', rightarm: 'rightArm',
  lefthand: 'leftHand', righthand: 'rightHand',
  leftleg: 'leftLeg', rightleg: 'rightLeg',
  nsys: 'nsys', nerves: 'nsys', nervous: 'nsys',
}

export function normalizePart(id: string): BodyPart | null {
  return PART_ALIASES[id.trim().toLowerCase().replace(/[\s_-]/g, '')] ?? null
}

export interface ParsedInjuryName { kind: 'wound' | 'scar' | 'nsys'; level: number }

// "Injury2" → {wound,2}; "Scar1" → {scar,1}; "Nsys3" → {nsys,3}; "Injury0"/none → null.
export function parseInjuryName(name: string): ParsedInjuryName | null {
  const m = name.trim().match(/^(injury|wound|scar|nsys|nerves?)\s*(\d)$/i)
  if (!m) return null
  const level = parseInt(m[2], 10)
  if (!level) return null // level 0 = healthy
  const tok = m[1].toLowerCase()
  if (tok.startsWith('scar')) return { kind: 'scar', level }
  if (tok.startsWith('n'))    return { kind: 'nsys', level }
  return { kind: 'wound', level }
}

// Build an Injuries snapshot from the raw {id,name} pairs of one dialogData block.
export function injuriesFromImages(images: { id: string; name: string }[]): Injuries {
  const out: Injuries = {}
  for (const img of images) {
    const part = normalizePart(img.id)
    if (!part) continue
    const parsed = parseInjuryName(img.name)
    if (!parsed) continue
    const cur = out[part] ?? { wound: 0, scar: 0 }
    if (parsed.kind === 'scar') cur.scar = Math.max(cur.scar, parsed.level)
    else                        cur.wound = Math.max(cur.wound, parsed.level) // nsys stored as wound level
    out[part] = cur
  }
  return out
}

// The worst wound level present anywhere (drives the "N wounds" summary/severity).
export function worstWound(inj: Injuries): number {
  let w = 0
  for (const p of BODY_PARTS) if (inj[p]) w = Math.max(w, inj[p]!.wound)
  return w
}

export function woundCount(inj: Injuries): number {
  let n = 0
  for (const p of BODY_PARTS) if (p !== 'nsys' && (inj[p]?.wound ?? 0) > 0) n++
  return n
}

export function isHealthy(inj: Injuries): boolean {
  return BODY_PARTS.every(p => !inj[p] || (inj[p]!.wound === 0 && inj[p]!.scar === 0))
}

// A short one-line description of a location's state, for tooltips.
export function describePart(part: BodyPart, pi?: PartInjury): string {
  const label = PART_LABEL[part]
  if (!pi || (pi.wound === 0 && pi.scar === 0)) return `${label}: healthy`
  const bits: string[] = []
  if (pi.wound > 0) bits.push(part === 'nsys' ? NSYS_WORD[pi.wound] : `${WOUND_WORD[pi.wound]} wound`)
  if (pi.scar  > 0) bits.push(SCAR_WORD[pi.scar])
  return `${label}: ${bits.join(', ')}`
}

// ── Empath wound transfer (the TAKE command) ────────────────────────────────
// DR empaths pull a patient's wounds onto themselves with
//   TAKE <patient> <body part> [scar]
// (e.g. "TAKE Melete head"), and everything at once with "TAKE <patient> everything".
// See https://elanthipedia.play.net/Empath_healing#Healing_patients
// The nervous system (nsys) has no body-part token, so it isn't taken by location.
const DR_TAKE_PART: Partial<Record<BodyPart, string>> = {
  head: 'head', neck: 'neck', leftEye: 'left eye', rightEye: 'right eye',
  chest: 'chest', abdomen: 'abdomen', back: 'back',
  leftArm: 'left arm', rightArm: 'right arm', leftHand: 'left hand', rightHand: 'right hand',
  leftLeg: 'left leg', rightLeg: 'right leg',
}

export function canTakePart(part: BodyPart): boolean {
  return DR_TAKE_PART[part] !== undefined
}

// The `TAKE <patient> <part> [scar]` command for one location — wounds take
// priority; a scar-only location transfers the scar. Null if the location can't
// be taken (nsys) or is unharmed.
export function takeWoundCommand(patient: string, part: BodyPart, pi?: PartInjury): string | null {
  const bp = DR_TAKE_PART[part]
  if (!bp || !pi) return null
  if (pi.wound > 0) return `take ${patient} ${bp}`
  if (pi.scar  > 0) return `take ${patient} ${bp} scar`
  return null
}

// Take everything at once — all external + internal wounds AND scars.
export const takeAllCommand = (patient: string): string => `take ${patient} everything`

// ── Parse a TOUCH / PERCEIVE HEALTH response into wounds ─────────────────────
// When an empath TOUCHes a patient the game prints a health assessment — a set
// of lines each describing a wound/scar at a body location. There's no machine-
// readable tag for it, so we scan the text.
//
// UNVERIFIED: Elanthipedia documents the commands but not the exact output text,
// and this can't be tested without an empath. The matching is deliberately
// lenient (body-part name + a severity/injury keyword). Tune against a real
// TOUCH capture — widen SEVERITY_* / INJURY_RE or PART_MATCHERS as needed.

// Most-specific first so "right arm" wins over a bare "arm", etc.
const PART_MATCHERS: [RegExp, BodyPart][] = [
  [/\bright eye\b/i,  'rightEye'],  [/\bleft eye\b/i,  'leftEye'],
  [/\bright hand\b/i, 'rightHand'], [/\bleft hand\b/i, 'leftHand'],
  [/\bright arm\b/i,  'rightArm'],  [/\bleft arm\b/i,  'leftArm'],
  [/\bright leg\b/i,  'rightLeg'],  [/\bleft leg\b/i,  'leftLeg'],
  [/\bhead\b/i, 'head'], [/\bneck\b/i, 'neck'], [/\bchest\b/i, 'chest'],
  [/\babdomen\b/i, 'abdomen'], [/\bback\b/i, 'back'],
  [/nervous system|\bnerves?\b/i, 'nsys'],
]

// Injury nouns that mark a line as describing a wound (vs. flavor text).
const INJURY_RE = /\b(wound|cut|gash|slash|burn|bruis\w*|broken|fractur\w*|lacerat\w*|bleed\w*|scratch\w*|scar|swelling|mangl\w*|sever\w*)\b/i
const HEALTHY_RE = /\b(no wounds?|uninjured|unharmed|healthy|unhurt|is (?:fine|clear)|appears? (?:fine|healthy))\b/i

function detectPart(line: string): BodyPart | null {
  for (const [re, part] of PART_MATCHERS) if (re.test(line)) return part
  return null
}

// Map a line's descriptor words to a 1–3 severity rank (0 = no injury described).
function severityRank(line: string): number {
  if (/\b(devastating|useless|grievous|mangl\w*|shatter\w*|gaping|critical|mortal|severe)\b/i.test(line)) return 3
  if (/\b(harmful|damaging|deep|nasty|significant|major|heav\w*|badly)\b/i.test(line)) return 2
  if (/\b(minor|small|slight|light|insignificant|negligib\w*|superficial|shallow|faint|scratch\w*|bruis\w*)\b/i.test(line)) return 1
  return INJURY_RE.test(line) ? 1 : 0  // an injury noun with no adjective → minor
}

export function injuriesFromTouch(lines: string[]): Injuries {
  const out: Injuries = {}
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || HEALTHY_RE.test(line) || !INJURY_RE.test(line)) continue
    const part = detectPart(line)
    if (!part) continue
    const rank = severityRank(line)
    if (rank === 0) continue
    const isScar = /\bscars?\b/i.test(line)
    const cur = out[part] ?? { wound: 0, scar: 0 }
    if (isScar) cur.scar  = Math.max(cur.scar,  rank)
    else        cur.wound = Math.max(cur.wound, rank)
    out[part] = cur
  }
  return out
}

// ── Sample data (preview) ───────────────────────────────────────────────────
// Used to preview the figure without an empath / without taking real wounds —
// e.g. the patient panel's "Load sample" affordance. Not game data.
export function sampleInjuries(): Injuries {
  return {
    head:     { wound: 1, scar: 0 },
    chest:    { wound: 2, scar: 1 },
    rightArm: { wound: 3, scar: 0 },
    leftLeg:  { wound: 0, scar: 2 },
    abdomen:  { wound: 1, scar: 0 },
    nsys:     { wound: 2, scar: 0 },
  }
}
