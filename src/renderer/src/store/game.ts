import { atom } from 'jotai'
import type { Getter, Setter } from 'jotai'
import { classifyRoom, localeFromCode } from '../lib/roomLocale'
import { ambienceFromCode } from '../lib/roomAmbient'
import { currentNodeAtom } from './map'
import type { GameEvent, LinkSpan, TextStyle, VitalField, StreamId } from '../lib/sge-parser'
import {
  parseExpSkills, parseRestedExp, parseCircle, parseOverallMind, fractionalRank,
} from '../lib/exp-parser'
import { isAtmospheric } from '../lib/atmospherics'
import { correctionFromTimeLine, computeSky, isTimeReportLine, resetTimeCalibration, type SkyState } from '../lib/elanthianTime'
import { weatherFromLine, weatherFromReportLine, isWeatherHeaderLine, regionFromLine, CLEAR, type WeatherState, type WeatherRegion } from '../lib/weather'
import { computeMoonPositions, correctionFromMoonLine, type MoonCorrections, type MoonPosition } from '../lib/moons'
import { applyGagSub as applyGagSubRules, type TextRule } from '../lib/rules'
import { parseLichList, type LichScript } from '../lib/quickActions'
import type { AvatarCrop } from '../lib/avatar'
import {
  injuriesFromImages, injuriesFromTouch, injuryModeCommand, isHealthy,
  DEFAULT_INJURY_MODE, type Injuries,
} from '../lib/injuries'
import { receiveInvEnvelopeAtom, clearInventoryAtom } from './inventory'

export type { StreamId }

// ── Connection ────────────────────────────────────────────────────────────────
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export const connectionStatusAtom = atom<ConnectionStatus>('disconnected')

// ── Multi-boxing / broadcast ("link") ──────────────────────────────────────────
// Both settings are per-WINDOW (each character runs as its own process), so they
// persist in localStorage (per-instance Chromium session dir) rather than the
// shared settings.json. linkMode: mirror everything I type to my other windows.
// broadcastReceive: let my other windows' broadcasts run in this one.
const LS_LINK = 'magiloom-link-mode'
const LS_RECV = 'magiloom-broadcast-receive'
const _lsBool = (k: string) => { try { return localStorage.getItem(k) === '1' } catch { return false } }
const _lsSet  = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0') } catch { /* ignore */ } }

const _linkMode = atom<boolean>(_lsBool(LS_LINK))
export const linkModeAtom = atom(
  get => get(_linkMode),
  (_get, set, v: boolean) => { set(_linkMode, v); _lsSet(LS_LINK, v) },
)
const _broadcastReceive = atom<boolean>(_lsBool(LS_RECV))
export const broadcastReceiveAtom = atom(
  get => get(_broadcastReceive),
  (_get, set, v: boolean) => { set(_broadcastReceive, v); _lsSet(LS_RECV, v) },
)

// ── Automation classes (Genie-style on/off groups) ──────────────────────────────
// Per-character map of className → enabled. A class absent from the map (or true)
// is ON; only an explicit `false` disables its aliases/triggers/highlights. The
// loader (App) seeds this from charSettings; the `#class` command and the class
// toggle UI update it (and persist to charSettings.classes).
export const classStatesAtom = atom<Record<string, boolean>>({})
// The disabled subset, as a Set for cheap membership tests in the matchers.
export const disabledClassesAtom = atom(get => {
  const s = new Set<string>()
  for (const [k, v] of Object.entries(get(classStatesAtom))) if (v === false) s.add(k)
  return s
})

// ── Output lines ──────────────────────────────────────────────────────────────
export interface OutputLine {
  id:         number
  text:       string
  styles:     TextStyle[]
  stream:     StreamId
  timestamp:  number
  links?:     LinkSpan[]
  bolds?:     string[]   // inline-bold substrings within `text`
  separator?: boolean
  divider?:   string   // labeled separator line (e.g. "Disconnected")
  speaker?:   string   // for conversation lines: who is talking (for the avatar)
  look?:      { name: string; lines: string[] }  // LOOK-at-player block: portrait card
}

// Pull the speaker out of a speech/whisper/thought line so the conversation
// panel can show their avatar. DR speech leads with the speaker after an
// optional [Channel] prefix; "You say/whisper/think" is the local character.
const SPEAKER_RE = /^([A-Z][a-z'-]+)\b/
export function extractSpeaker(text: string): string | undefined {
  const t = text.replace(/^\s*\[[^\]]*\]\s*/, '').trimStart()
  if (/^You\b/.test(t)) return 'You'
  return t.match(SPEAKER_RE)?.[1]
}

let lineId = 0
const mkLine = (text: string, styles: OutputLine['styles'], stream: StreamId, links?: LinkSpan[], bolds?: string[]): OutputLine => ({
  id: lineId++, text, styles, stream, timestamp: Date.now(), links, bolds
})

// Set whenever new content lands in the main output; the next server prompt
// (end of a command response) flushes a separator so each chunk is spaced out.
let _outputDirty = false
const mkSeparator = (): OutputLine => ({
  id: lineId++, text: '', styles: [], stream: 'main', timestamp: Date.now(), separator: true
})

// Rolling cap on the main output buffer. Configurable from settings (Output
// Buffer Size) via setOutputBufferSize; a smaller buffer means fewer retained
// lines → fewer DOM nodes and smaller per-append array copies. Previously the
// cap was hardcoded to 5000 at every call site and the setting was ignored.
let _outputBufferSize = 5000
export function setOutputBufferSize(n: number): void {
  if (Number.isFinite(n) && n >= 100) _outputBufferSize = Math.floor(n)
}
// Append `line` to the main output, trimming to the current buffer cap. Kept as
// a helper so the cap lives in one place.
const appendMain = (lines: OutputLine[], line: OutputLine): OutputLine[] =>
  [...lines.slice(-(_outputBufferSize - 1)), line]

// Skip appending if the last line in the array is identical and was added within
// 300 ms — catches protocol-level duplicates (e.g. double-fired IPC listeners).
// `max` defaults to the main output buffer cap; side panels pass their own.
function appendDedup(lines: OutputLine[], line: OutputLine, max: number = _outputBufferSize): OutputLine[] {
  const last = lines[lines.length - 1]
  if (last && last.text === line.text && line.timestamp - last.timestamp < 300) return lines
  return [...lines.slice(-(max - 1)), line]
}

// Main game output (stream = 'main' + echoes)
export const outputLinesAtom  = atom<OutputLine[]>([])

// Append a labeled "Disconnected" divider to the main output, marking
// where the connection dropped. Guarded so repeated disconnect events (or a
// disconnect with no intervening output) don't stack multiple dividers.
export const appendDisconnectNoticeAtom = atom(null, (get, set) => {
  const lines = get(outputLinesAtom)
  if (lines[lines.length - 1]?.divider) return
  set(outputLinesAtom, appendMain(lines, {
    id: lineId++, text: '', styles: [], stream: 'main' as StreamId,
    timestamp: Date.now(), divider: 'Disconnected',
  }))
})

// Stream-specific lines
export const expLinesAtom     = atom<OutputLine[]>([])
export const combatLinesAtom  = atom<OutputLine[]>([])
export const atmoLinesAtom    = atom<OutputLine[]>([])
export const convLinesAtom    = atom<OutputLine[]>([])
// ESP / amunet traffic — the `thoughts` stream, plus any `thought`-preset line that
// arrives untagged on main. Deliberately separate from convLinesAtom: thoughts are a
// different conversation from the one happening in the room, and mixing them made the
// Conversation panel unreadable on a busy network.
export const thoughtLinesAtom = atom<OutputLine[]>([])
export const deathsAtom       = atom<OutputLine[]>([])

// ── Connections (logon / logoff / disconnect monitor) ──────────────────────────
// A timestamped feed of connection events: this character's own connect/disconnect
// (fed from GameLayout) plus game lines announcing others logging on/off or link-
// dying. Shown in the Connections panel; matched lines also stay in main output.
export interface LogonEntry { id: number; text: string; timestamp: number; kind: 'on' | 'off' }
export const logonLinesAtom = atom<LogonEntry[]>([])

// DR's "* …" adventure broadcasts announcing players coming online / going offline.
// These always arrive as a single "* NAME …" MAIN-stream line, so the caller gates on
// that leading "*" before testing these patterns — that lets the wording matches stay
// loose (adventures, shadows, home, arrival/departure) without misfiring on ordinary
// chat. (A `pushStream id="logons"` tag very occasionally wraps a logon — seen in the
// Lich logs — but it's rare, and the wording match catches those too.)
//
// Patterns below were verified against ~12k real "* …" broadcasts in the Lich logs;
// the broad tokens (join/arrives/arrival for on, depart*/leaves/home for off) cover
// the many flavor variants a single hub throws off. Highlights:
// Arrivals — "… joins the adventure." (also joined/join, "…into the adventure",
//   "…with little fanfare", "…after escaping another!"), "NAME arrives, <flavor>."
//   ("…hands clasped in near perpetual prayer.", "…an air of celebration"), reconnect/
//   wake broadcasts ("waking from a long catnap, NAME once again prowls the lands.",
//   "comes out from within the shadows with renewed vigor.", "snuck out of the shadow
//   he was hiding in.", "just woke up from a nap, ready to join the adventure once
//   again.", "has woken up in search of new ale!", "just limped in for another
//   adventure.", "wanders in from exploring.", "returns from trailblazing."), and
//   horn/bell/whistle arrivals ("…heralds the arrival of NAME.", "…NAME's arrival to
//   the adventure.", "plaintive bell-tolls … harbinger NAME arrival.").
// Departures — "retires from the adventure for now." / "retires from the lands to
//   enjoy a nice long catnap." / "retires to the shadows." / "returns home from a hard
//   day…" / "returned home to work on a new tune." / "heads home…" / "heads off toward
//   home." / "has disconnected." / "wanders off, muttering …" / "wandered into another
//   adventure." / "fades swiftly into the shadows." / "(quietly) departs (from) the
//   adventure …" / "…announces/signals the departure of NAME." / "found a shadow to
//   hide out in." / "went home to take a nap." / "crawled home, seeking rest…" / "sets
//   off into the wilds." / "leaves, looking for more excitement." / "limped away from
//   the adventure for now." / "sauntered off-duty to get some rest." / "back to her
//   woodland grove." Death broadcasts ("struck down", etc.) are caught earlier by
//   DEATH_RE, so they never reach these patterns. Resurrection ("arises from the ashes
//   of death") and creature spawn/despawn flavor deliberately stay in main output.
const LOGON_RE  = /\bjoin(?:s|ed)? the adventure\b|\binto the adventure\b|\bhas reconnected\b|\bhas logged (?:on|in)\b|\bwaking from a long catnap\b|\bwok(?:e|en) up\b|\bcomes out from within the shadows with renewed vigor\b|\bsnuck out of the shadow\b|\breturns from trailblazing\b|\blimped in\b|\bwanders in\b|\barrives\b|\barrival\b/i
const LOGOFF_RE = /\bretires (?:from the (?:adventure|lands)|to the shadows)\b|\breturn(?:s|ed) home\b|\bheads (?:off toward )?home\b|\bwanders off, muttering\b|\bwandered into another adventure\b|\bsaunters off, muttering prayers\b|\bfades swiftly into the shadows\b|\bdeparts? (?:from )?the adventure\b|\bdeparture\b|\bhas disconnected\b|\bfound a shadow to hide out in\b|\bhas logged o(?:ff|ut)\b|\bhas gone link-?dead\b|\bwent home to take a nap\b|\bcrawled home\b|\bsets off into the wilds\b|\bleaves, looking for more excitement\b|\bhas left to contemplate the life of a\b|\blimped away\b|\bsauntered off-duty\b|\bback to (?:his|her|their) woodland grove\b/i

export const appendLogonAtom = atom(null, (get, set, e: { text: string; kind: 'on' | 'off' }) => {
  set(logonLinesAtom, [...get(logonLinesAtom).slice(-199), { id: lineId++, text: e.text, timestamp: Date.now(), kind: e.kind }])
})

// ── Vitals ────────────────────────────────────────────────────────────────────
export interface VitalState { value: number; max: number }

export const vitalsAtom = atom<Record<VitalField, VitalState>>({
  health:  { value: 100, max: 100 },
  mana:    { value: 100, max: 100 },
  stamina: { value: 100, max: 100 },
  spirit:  { value: 100, max: 100 },
})

// Whether a real health reading has arrived for this session. The values above are a
// placeholder, not a measurement, so the first push must not be diffed against them
// as if it were a hit (see the 'vitals' case in dispatch).
let _healthSeen = false

// ── Body injuries ───────────────────────────────────────────────────────────
// The logged-in character's wounds/scars per body location, fed by DR's
// `<dialogData id='injuries'>` snapshots (see lib/injuries.ts). Always reflects
// the current character; drives the Body panel's default "Character" view.
export const bodyInjuriesAtom = atom<Injuries>({})

// A perceived patient's body (empath "Patient" view). Empaths can perceive
// another player's health; that data has no dialogData feed we can rely on, so
// this is populated best-effort / for preview (a sample or a future PERCEIVE
// parse) and keyed by the patient's name. `null` = no patient loaded.
export interface PatientBody { name: string; injuries: Injuries }
export const patientBodyAtom = atom<PatientBody | null>(null)

// Which body the Body panel/overlay is showing. Shared so the panel and its
// pop-out overlay stay on the same subject. 'patient' is the empath view.
export type BodySubject = 'character' | 'patient'
export const bodySubjectAtom = atom<BodySubject>('character')

// Which injury view the game is reporting (see INJURY_MODE_LABEL). The window
// only ever shows one layer at a time, so switching this re-requests the feed —
// it's a live query, not a display filter. Seeded from settings on load and
// written through on change; also re-sent on connect (see useGameConnection).
export const injuryModeAtom = atom<number>(DEFAULT_INJURY_MODE)

// True between asking for a view and the game answering. Without it an empty
// figure would read as "Unharmed" during the round trip, which is a lie.
export const injuryPendingAtom = atom<boolean>(false)
let _injuryPendingTimer = 0

export const setInjuryModeAtom = atom(null, (get, set, mode: number) => {
  if (mode === get(injuryModeAtom)) return
  set(injuryModeAtom, mode)
  window.dr?.settings?.patch?.({ injuryMode: mode })
  // The previous view's snapshot describes a different layer/kind, so drop it
  // rather than show stale wounds under the new heading until the reply lands.
  set(bodyInjuriesAtom, {})
  if (get(connectionStatusAtom) !== 'connected') return
  window.dr.game.send(injuryModeCommand(mode))
  set(injuryPendingAtom, true)
  // Give up waiting eventually: with nothing to report the game sends nothing,
  // and an empty view is then the honest answer.
  window.clearTimeout(_injuryPendingTimer)
  _injuryPendingTimer = window.setTimeout(() => set(injuryPendingAtom, false), 3000)
})

// Render the figure as a text list instead (accessibility, and small panels).
export const bodyTextModeAtom = atom<boolean>(false)
export const setBodyTextModeAtom = atom(null, (_get, set, on: boolean) => {
  set(bodyTextModeAtom, on)
  window.dr?.settings?.patch?.({ bodyTextMode: on })
})

// TOUCH capture: after an empath sends `touch <patient>`, we buffer the response
// lines (a health assessment) until the next prompt, parse them into the
// patient's wounds (injuriesFromTouch), and show them on the Patient view. The
// diagnostic link expires, so the panel offers a Refresh (re-touch) that re-arms
// this. The response still echoes to the main output (not suppressed).
// Whose body an injuries window describes. The plain `injuries` window is the
// logged-in character (→ null); DR also pushes windows about other people, whose
// id carries a suffix ("injuriesMelete") and whose title usually names them
// ("Melete's Injuries"). Prefer the title — it's the human-readable one — and fall
// back to the id suffix. Returns null for our own window.
export function injuryDialogSubject(dialogId: string, title = ''): string | null {
  const suffix = dialogId.trim().replace(/^injuries/i, '').replace(/[^A-Za-z]/g, '')
  if (!suffix) return null
  const fromTitle = title.match(/([A-Z][a-z]+)(?:'s)?\s+injur/i)?.[1]
  const name = fromTitle || suffix
  return name.charAt(0).toUpperCase() + name.slice(1)
}

let _touchName: string | null = null
let _touchBuf: string[] = []
export const beginTouchCaptureAtom = atom(null, (get, set, name: string) => {
  _touchName = name
  _touchBuf  = []
  // Switch to the Patient view and show the patient immediately — keep any prior
  // wounds (e.g. on a refresh of the same patient) until the new response parses.
  const prev = get(patientBodyAtom)
  set(patientBodyAtom, { name, injuries: prev?.name === name ? prev.injuries : {} })
  set(bodySubjectAtom, 'patient')
})

// ── Room ──────────────────────────────────────────────────────────────────────
// `uid` is the native DR room id from <nav rm='NNNN'/>. Empty when the room has
// no id, or when Lich predates 5.20.0 / we're connected directly — the automapper
// falls back to scraping the title tag in that case.
export interface RoomState { name: string; uid: string; description: string; exits: string[]; objs: string; players: string[]; playerNames: string[] }
export const roomAtom = atom<RoomState>({ name: '', uid: '', description: '', exits: [], objs: '', players: [], playerNames: [] })

// Coarse locale of the current room (cave / forest / tavern / …). Drives the ambient
// room-tint overlay; recomputes whenever the room changes.
//
// The BAKED value wins wherever the shipped map has the room. The live classifier
// only ever sees one room, and over the shipped corpus that produced 5,121 pairs of
// connected same-title rooms that classified differently — a tint that flickered as
// you walked a street. The bake sees the graph and smooths those runs to one locale
// (see scripts/build-rooms.js). Live classification stays the fallback for rooms the
// crawl never recorded, where a flicker is still better than no tint at all.
export const roomLocaleAtom = atom(get => {
  const baked = get(currentNodeAtom)?.locale
  if (baked) return localeFromCode(baked)
  const r = get(roomAtom)
  return classifyRoom(r.name, r.description)
})

// The room's ambient EFFECT (embers at a forge, underwater in a sunken ship), a
// different axis from its locale colour — see lib/roomAmbient. Rare by design: ~2%
// of rooms have one. Baked-only, deliberately. These effects are far more assertive
// than a tint, so a live keyword guess putting drifting embers in the wrong room is
// worth avoiding at the cost of missing unmapped ones.
export const roomAmbienceAtom = atom(get => ambienceFromCode(get(currentNodeAtom)?.ambience))

// Incremented on every server prompt (end of a command response). The automapper
// watches this to know when the current room is fully populated so it can fold it
// into the map — a prompt marks the room name/desc/exits as all having landed.
export const promptCountAtom = atom<number>(0)

// ── Inventory ─────────────────────────────────────────────────────────────────
export const inventoryLinesAtom = atom<string[]>([])

// ── Hands ────────────────────────────────────────────────────────────────────
// '' means the hand is empty — see handContent().
export const handsAtom = atom<{ left: string; right: string }>({ left: '', right: '' })

/** What the game reports for a hand, with its "Empty" placeholder reduced to ''. */
export const handContent = (text: string): string => {
  const trimmed = text.trim()
  return /^empty$/i.test(trimmed) ? '' : trimmed
}

// ── Indicators ────────────────────────────────────────────────────────────────
export const indicatorsAtom = atom<Record<string, boolean>>({})

// ── Presence (avatar status; shared so notifications can honor Do Not Disturb) ──
export type PresenceMode = 'online' | 'idle' | 'dnd'
export const presenceModeAtom = atom<PresenceMode>('online')
// Auto-idle flag (no keyboard/pointer activity for a while). Driven by the single
// useAutoIdle instance in the character bar and read by both the avatar status dot
// and Loomy's idle lantern-raise, so the two stay in lockstep.
export const autoIdleAtom = atom(false)

// ── Avatars ─────────────────────────────────────────────────────────────────
// Local self-uploads, keyed by lowercased character name (mirrors settings.json
// `avatars`). Shared so the character bar and the conversation panel resolve
// from one source. selfNameAtom is the logged-in character, so "You" speech
// resolves to their avatar. See lib/avatar.ts for the resolution precedence.
export const avatarsAtom  = atom<Record<string, string>>({})
export const selfNameAtom = atom<string>('')

// Per-character crop (pan/zoom) for the avatar circle. The stored image is the
// full original; this positions the circular window over it. Keyed by lowercased
// character name, mirrors settings.avatarCrops. See lib/avatar.ts AvatarCrop.
export const avatarCropsAtom = atom<Record<string, AvatarCrop>>({})

// Server-backed custom avatars fetched by name (data URLs), keyed by lowercased
// name. A `null` value is a negative cache: "no custom image, use the identicon."
// Undefined means "not fetched yet". Populated by useEnsureAvatars.
export const serverAvatarsAtom = atom<Record<string, string | null>>({})

// AI-generated LOOK portraits (data URLs), keyed by lowercased character name.
// `null` = generation attempted and unavailable. Ranks below a real bucket image
// (see LookCard) so an uploaded/shared avatar always overrides the generated one.
export const aiAvatarsAtom = atom<Record<string, string | null>>({})

// ── Verbs (command autocomplete) ───────────────────────────────────────────────
// Populated once from the game's `VERB LIST` output during a silent sweep, then
// cached in settings. Raw lines look like "accept" or "accept (info)"; the
// "(info)" suffix marks verbs that have `VERB INFO` detail available.
const stripInfo = (v: string) => v.replace(/\s*\(info\)\s*$/i, '').trim()

export const verbRawAtom = atom<string[]>([])
export const verbsAtom = atom(get =>
  Array.from(new Set(get(verbRawAtom).map(stripInfo).filter(Boolean))).sort()
)
export const verbsWithInfoAtom = atom(get => {
  const m: Record<string, true> = {}
  for (const v of get(verbRawAtom)) if (/\(info\)\s*$/i.test(v)) m[stripInfo(v).toLowerCase()] = true
  return m
})

const VERB_LINE_RE = /^[a-z][a-z'-]*( \(info\))?$/i
let _verbCapture = false
let _verbBuf: string[] = []
export function beginVerbCapture() { _verbCapture = true; _verbBuf = [] }
export function endVerbCapture()   { _verbCapture = false; _verbBuf = [] }

// ── Profile (PROFILE <name> summary shown in the character menu) ────────────────
export interface ProfileInfo {
  name?:     string
  spouse?:   string
  roleplay?: string
  pvp?:      string
}
// Parsed PROFILE summaries, keyed by lowercased character name (self + others
// viewed from the conversation panel).
export const profilesAtom = atom<Record<string, ProfileInfo>>({})

// Recognized "Key: Value" labels in a PROFILE block. During the fetch window
// these are captured (and suppressed from the main output), then parsed for the
// menu summary; any other output during the window passes through untouched.
const PROFILE_LABEL_RE = /^(Name|Race|Profession|Gender|Age|Circle|Guild|House|Spouse|Roleplay Stance|PvP Stance|Citizenship|Disposition|Marital Status):\s*(.+)$/i
let _profileCaptureName: string | null = null
let _profileBuf: string[] = []

function parseProfile(lines: string[]): ProfileInfo {
  const info: ProfileInfo = {}
  for (const l of lines) {
    const m = l.match(PROFILE_LABEL_RE)
    if (!m) continue
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if      (key === 'name')            info.name = val
    else if (key === 'spouse')          info.spouse = val
    else if (key === 'roleplay stance') info.roleplay = val
    else if (key === 'pvp stance')      info.pvp = val
  }
  return info
}

export const beginProfileCaptureAtom = atom(null, (_get, _set, name: string) => {
  _profileCaptureName = name.trim().toLowerCase()
  _profileBuf = []
})
export const endProfileCaptureAtom = atom(null, (get, set) => {
  const name = _profileCaptureName
  _profileCaptureName = null
  if (name && _profileBuf.length) {
    set(profilesAtom, { ...get(profilesAtom), [name]: parseProfile(_profileBuf) })
  }
  _profileBuf = []
})

// ── Verb info (VERB INFO detail for autocomplete popover) ──────────────────────
export interface VerbInfoEntry { syntax: string; desc: string }
export const verbInfoAtom = atom<Record<string, VerbInfoEntry[]>>({})
let _verbInfoName:    string | null = null   // armed flag: awaiting a VERB INFO block
let _verbInfoHeader:  string | null = null   // actual verb from the response header
let _verbInfoStarted = false
let _verbInfoBuf: string[] = []

// ── LOOK-at-player capture ─────────────────────────────────────────────────────
// A "look <player>" reply is "You see NAME, a RACE." + description lines, ending
// at a prompt. We buffer it and emit one portrait "look card" (avatar + text).
let _lookCapturing = false
let _lookSelf = false
let _lookBuf: string[] = []
// Target of the most recent "look <name>" command, used to key a portrait for
// LOOK replies that carry no name in their text (see LOOK_HAZE_RE). Set by
// echoCommandAtom, consumed and cleared when a LOOK block is flushed.
let _pendingLookTarget = ''
// Matches the first line of both "You see …, a RACE." (others) and "You are …, a
// RACE." (yourself). Anchored on the trailing ", a/an <Race>." so it doesn't fire
// on ordinary "You are …" lines. The name is NOT taken from this line — a prefix
// title ("Blood Channeler Elanarie …") makes the first word unreliable — see the
// per-case extraction in the prompt handler.
const LOOK_START_RE = /^You (?:see|are) [A-Z][^,]*?,.*\ban?\s+[A-Z][A-Za-z' -]*\.?\s*$/
// Special themed LOOKs whose first line is the whole description and does NOT open
// with "You see NAME, a RACE." A shrouded character ("<Name> seems to be wrapped
// in dark shadows / enveloped in a dark cloak, concealing all but <his/her> empty
// hands.") or a Duskruin/Celestial cosmetic seen "Through a <colour> haze, you
// see a <race> Champion/Aspect … with … eyes." lookPortrait.ts renders bespoke
// prompts for these; here we just need to capture the block.
const LOOK_CONCEAL_RE = /^[A-Z][\w'-]+ seems to be (?:wrapped in dark shadows|enveloped in a dark cloak), concealing all but (?:his|her|their|its)\s+empty hands\b/
const LOOK_HAZE_RE    = /^Through an?\s+.+?\s+haze,\s+you see an?\s+.+?\s+with\s+.+/i

// Stable short key derived from a LOOK's text (FNV-1a). Used to file a nameless
// haze-cosmetic portrait under the LOOK itself, so identical hazes share one
// cached image rather than being (mis)attributed to whoever was looked at.
function hashLook(text: string): string {
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim()
  let h = 0x811c9dc5
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
export function beginVerbInfoCapture(name: string) {
  _verbInfoName = name.toLowerCase(); _verbInfoHeader = null; _verbInfoStarted = false; _verbInfoBuf = []
}
function parseVerbInfo(name: string, lines: string[]): VerbInfoEntry[] {
  const entries: VerbInfoEntry[] = []
  for (const l of lines) {
    const t = l.trim()
    if (!t || /^syntax:$/i.test(t)) continue
    const first = (t.split(/\s+/)[0] ?? '').toUpperCase()
    if (first === name.toUpperCase()) {
      entries.push({ syntax: t, desc: '' })
    } else if (entries.length) {
      const e = entries[entries.length - 1]
      e.desc = e.desc ? `${e.desc} ${t}` : t
    } else {
      entries.push({ syntax: '', desc: t })
    }
  }
  return entries
}

// ── Active spell (the currently PREPARED spell, from the <spell> tag) ───────────
export const activeSpellAtom = atom<string>('')

// ── Active spells (buffs currently in effect, with remaining duration) ──────────
// DR pushes these on its `percWindow` as bare lines "Spell Name  (N roisaen)"
// (roisaen = DR time unit), refreshed after a <clearStream id='percWindow'/> or
// inline after a cast. Each emission is the COMPLETE list, so a contiguous run
// replaces the panel wholesale (mirrors the exp-batch pattern). The lines are
// suppressed from the main output — they're panel-only, like atmo/combat.
// One roisaen ≈ one real minute, so `expires` (epoch-ms, stamped when the snapshot
// commits) lets the panel run a live mm:ss countdown between game resends instead
// of showing a frozen whole-minute value.
export const ROISAEN_MS = 60_000
export interface ActiveSpell { name: string; roisaen: number; expires: number }
export const activeSpellsAtom = atom<ActiveSpell[]>([])

const ACTIVE_SPELL_RE = /^(.+?)\s+\((\d+)\s+roisaen\)\s*$/
function parseActiveSpell(text: string): ActiveSpell | null {
  const m = ACTIVE_SPELL_RE.exec(text.trim())
  return m ? { name: m[1].trim(), roisaen: parseInt(m[2], 10), expires: 0 } : null
}
// Accumulates the current snapshot; null = not mid-snapshot. Committed on the
// next prompt. A percClear opens an empty batch so a fully-expired list clears.
let _spellBatch: ActiveSpell[] | null = null

// ── Timers ────────────────────────────────────────────────────────────────────
export const roundtimeAtom        = atom<number>(0)  // epoch-ms end time of current RT
export const castTimeAtom         = atom<number>(0)
export const tickAtom             = atom<number>(0)  // Updated every second for countdowns
export const roundtimeSecondsAtom = atom(get => {
  get(tickAtom)  // Depend on tick to re-evaluate every second
  return Math.max(0, Math.ceil((get(roundtimeAtom) - Date.now()) / 1000))
})

// ── Combat "heat" ───────────────────────────────────────────────────────────────
// A 0→1 intensity driving the red edge-vignette in AmbientOverlay. It is a HIT
// flash, not a combat-state light: the only thing that raises it is losing health
// (see the 'vitals' case), so the panel stays clean while you're swinging and
// flares only when something lands on you. Trading blows lands hits often enough
// that the flashes run together on their own — which is the point — but a fight
// you're winning cleanly never lights up.
//
// Stored as the raw {level, at} of the last flash; the derived combatHeatAtom
// decays it exponentially against the clock.
export const combatHeatRawAtom = atom<{ level: number; at: number }>({ level: 0, at: 0 })
const HEAT_TAU_MS = 700    // e-folding time of the decay (~2s from a full flash to dark)
export const combatHeatAtom = atom(get => {
  get(tickAtom)            // re-evaluate every second while it decays
  const { level, at } = get(combatHeatRawAtom)
  if (level <= 0) return 0
  const decayed = level * Math.exp(-(Date.now() - at) / HEAT_TAU_MS)
  return decayed < 0.02 ? 0 : Math.min(1, decayed)
})

// Add `amount` to the current (decayed) heat and re-anchor it to now. Reads through
// the derived level so repeated bumps accumulate from where the decay left off
// rather than snapping to the raw stored value.
function bumpHeat(get: Getter, set: Setter, amount: number): void {
  const { level, at } = get(combatHeatRawAtom)
  const current = level <= 0 ? 0 : level * Math.exp(-(Date.now() - at) / HEAT_TAU_MS)
  set(combatHeatRawAtom, { level: Math.min(1, Math.max(current, 0) + amount), at: Date.now() })
}

// ── Ambient: weather + Elanthian sky (day/night) ────────────────────────────────
// weatherAtom is driven by ambient weather messages + the `weather` command
// (lib/weather.ts). skyAtom is closed-form off the wall clock (lib/elanthianTime.ts)
// and recomputes each tick — no polling, and correct from the first frame, so it is
// never null. skyCorrectionAtom carries the offset a TIME report taught us, if any.
// Both feed AmbientOverlay and the Calendar panel.
export const weatherAtom = atom<WeatherState>(CLEAR)
// Which weather message set the current room uses — latched off desert-only prose so
// a Muspar'i reading isn't graded against the temperate table.
export const weatherRegionAtom = atom<WeatherRegion>('standard')
export const skyCorrectionAtom = atom<number>(0)
export const skyAtom = atom<SkyState>(get => {
  get(tickAtom)  // re-evaluate every second so day/night advances live
  return computeSky(Date.now(), get(skyCorrectionAtom))
})

// Moon positions are closed-form from each moon's orbit (lib/moons.ts): no anchor,
// no network, correct on connect. moonCorrectionsAtom holds the per-moon offset that
// a witnessed rise/set taught us, which is normally empty because the model already
// agrees. moonsAtom recomputes off tickAtom so arcs and countdowns advance live.
export const moonCorrectionsAtom = atom<MoonCorrections>({})
export const moonsAtom = atom<MoonPosition[]>(get => {
  get(tickAtom)  // recompute each second so arc + countdowns advance live
  return computeMoonPositions(Date.now(), get(moonCorrectionsAtom))
})

// True while the connect-time seed is fetching TIME/weather silently, so their
// report lines are suppressed from the main output (set/cleared from App).
let _skySeedSilent = false
export const beginSilentSkySeedAtom = atom(null, () => { _skySeedSilent = true })
export const endSilentSkySeedAtom   = atom(null, () => { _skySeedSilent = false })
// Non-blank lines still eligible to carry `weather`'s state sentence after its
// "You glance up at the sky." header. A small window (not strictly the next line)
// so a blank/interleaved line can't eat the reply — that used to leave the overlay
// stuck clear while it was actually raining.
let _weatherReportWait = 0
// Two non-blank lines: enough to survive one interleaved line, small enough that an
// ambient cloud message ("…disappear behind a thick bank of clouds.") arriving later
// can't be mistaken for the reply and clear a live rain overlay. Blank lines don't
// consume the window at all.
const WEATHER_REPORT_WINDOW = 2

// ── Experience ────────────────────────────────────────────────────────────────
export interface ExpSkill { name: string; rank: number; pct: number; mind: string; mindWord?: string }
/**
 * Rested experience, in seconds. `stored` is the whole bank, `usable` what is
 * left of this cycle's slice of it, `refresh` how long until the next cycle.
 * Absent for characters DR never reports it for (free accounts, empty bank).
 */
export interface RestedExp { stored: number; usable: number; refresh: number }
export interface ExpState  {
  skills: ExpSkill[]
  tdps: number
  favors: number
  rested?: RestedExp
  circle: number
  /** "Overall state of mind: X" from the report — the character's aggregate mindstate. */
  overallMind: string
  /** Raw `exp sleep` notice; empty means awake. See sleepState() for the reading. */
  sleep: string
  /** When this session's rank counting started, for the elapsed-time figure. */
  sessionStart: number
  /**
   * Fractional ranks (rank + pct/100) per skill, as first seen this session.
   * Subtracting these from the current figures is what "ranks gained" means —
   * DR reports no such total, so it only exists if we remember where we started.
   */
  baselines: Record<string, number>
}
export const emptyExp = (): ExpState => ({
  skills: [], tdps: 0, favors: 0,
  circle: 0, overallMind: '', sleep: '',
  sessionStart: Date.now(), baselines: {},
})
export const expAtom = atom<ExpState>(emptyExp())

/** Fold a skill's starting position into the baselines, first sighting only. */
function withBaseline(baselines: Record<string, number>, s: ExpSkill): Record<string, number> {
  return baselines[s.name] === undefined ? { ...baselines, [s.name]: fractionalRank(s) } : baselines
}

// Plain "exp" reports omit skills that have decayed back to 0 field experience
// rather than printing them at 0% — so a skill silently dropping out of a fresh
// report (vs. never having been mentioned at all) means it's now cleared.
// Tracks the names seen in the run of exp-report lines currently being read.
let _expBatchNames: Set<string> | null = null
// When true the current exp batch was triggered by the background poller, so
// its main-stream report text should be suppressed from the game output panel.
// Cleared when the batch closes or when the user manually sends exp.
let _silentExpBatch = false

// Resets one skill's field experience to cleared, preserving its known capacity
// (e.g. "340/900" -> "0/900"). Used both when an EXP report omits a decayed
// skill and when a mass drain wipes every skill at once.
function clearSkillExp(s: ExpSkill): ExpSkill {
  const cap = s.mind.split('/')[1]
  return { ...s, pct: 0, mind: cap ? `0/${cap}` : '', mindWord: 'clear' }
}

// Two events drain ALL field experience at once without pushing per-skill
// component updates, so the panel would otherwise keep showing stale exp until
// the next full EXP report:
//   1. the log-on system's mass absorption a few seconds after login, and
//   2. the player-initiated "boost" drain.
// Match only the invariant phrasing — the "hours built up" count in #1 varies
// per account.
const EXP_DRAIN_RE = /Log-on system converted|drained your field experience/i

// ── Echo ──────────────────────────────────────────────────────────────────────
export const echoCommandAtom = atom(
  null,
  (get, set, command: string) => {
    const preset = command.startsWith(';') || command.startsWith('.') ? 'echo-script' : 'echo'
    const line   = mkLine(command, [{ preset }], 'main')
    set(outputLinesAtom, appendMain(get(outputLinesAtom), line))
    // Remember who a "look <name>" targeted so a themed reply that carries no name
    // in its text (haze cosmetics) can still be keyed to a portrait. Consumed and
    // cleared when the LOOK block flushes.
    const lookAt = command.trim().match(/^(?:look|l)(?:\s+at)?\s+([A-Za-z][\w'-]*)$/i)
    if (lookAt) {
      const w = lookAt[1].toLowerCase()
      _pendingLookTarget = w.charAt(0).toUpperCase() + w.slice(1)
    }
    // Pre-open the exp batch on the command itself, not the first matching report
    // line — a report with zero active skills never matches at all, so waiting
    // for a match to start the batch meant it could never close (never clearing).
    if (command.trim().toLowerCase() === 'exp') {
      _expBatchNames  = new Set()
      _silentExpBatch = false  // manual send wins over any pending background poll
    }
    // A hand-typed `;list` refreshes the Scripts panel too — read the reply, but
    // leave it on screen: the player asked to see it.
    if (/^;\s*(?:l|la|list)(?:\s+all)?$/i.test(command.trim())) {
      _lichListWait   = LICH_LIST_WINDOW
      _lichListSilent = false
    }
  }
)

// Append a line emitted by a running native .cmd script to the main output,
// styled like a script echo.
export const appendScriptOutputAtom = atom(
  null,
  (get, set, text: string) => {
    const line = mkLine(text, [{ preset: 'echo-script' }], 'main')
    set(outputLinesAtom, appendMain(get(outputLinesAtom), line))
  }
)

// Append a client/Lich diagnostic line (SGE auth, Lich manager status, connection,
// script-engine errors, the main-process log) to the main output, styled as a dim
// system notice. This is where the old dedicated Lich log side panel now flows.
export const appendSystemLineAtom = atom(
  null,
  (get, set, text: string) => {
    const line = mkLine(text, [{ preset: 'system' }], 'main')
    set(outputLinesAtom, appendMain(get(outputLinesAtom), line))
  }
)

// ── Silent exp poll ───────────────────────────────────────────────────────────
// Called by the background poller before sending "exp". Marks the upcoming
// batch as silent so the report text is suppressed from the main game panel.
// We deliberately do NOT pre-open _expBatchNames here — doing so would cause
// the batch to close immediately on the first non-skill text that arrives
// during the network round-trip (the batch-close fires whenever _expBatchNames
// is truthy and no skill lines matched), resetting _silentExpBatch = false
// before the actual exp report is ever received.  The batch opens naturally on
// the first skill line, and the prompt handler below is the fallback cleanup
// for the zero-active-skills case where the batch never opens at all.
export const beginSilentExpAtom = atom(null, () => {
  _silentExpBatch = true
})

// ── Lich `;list` poll ─────────────────────────────────────────────────────────
// Lich has no push channel for "what's running", so the Scripts panel asks it the
// only way there is: send `;list` and read the one-line reply. The reply is
// parsed by parseLichList (lib/quickActions.ts) and, when the poll was ours,
// swallowed so the panel doesn't cost the player a screenful of chatter.
//
// The window is measured in eligible lines rather than milliseconds so a slow
// round-trip can't close it early; the prompt handler shuts it either way.
export const lichScriptsAtom = atom<LichScript[]>([])
let _lichListWait   = 0
let _lichListSilent = false
// Counted in 'lich'-stream lines, which is where the reply lands — so game text
// can't consume the window. Generous because every running script's own chatter
// ([name: ...]) shares that stream, and someone with six scripts up can easily
// emit a few lines in the millisecond or two before Lich answers.
const LICH_LIST_WINDOW = 12

/** Open the read window before sending `;list`. Silent polls hide the reply. */
export const beginLichListAtom = atom(null, (_get, _set, silent: boolean) => {
  _lichListWait   = LICH_LIST_WINDOW
  _lichListSilent = silent
})

// ── Session reset ───────────────────────────────────────────────────────────
// Wipe all per-character live state so switching characters (or reconnecting as
// a different one) starts clean instead of inheriting the previous character's
// panels, room, vitals, profile summary, etc. Account/global state (avatars from
// settings, function keys, highlights, connection status) is intentionally left
// alone. Called from GameLayout whenever the active character changes.
export const resetSessionAtom = atom(null, (_get, set) => {
  set(outputLinesAtom, [])
  set(expLinesAtom, [])
  set(combatLinesAtom, [])
  set(atmoLinesAtom, [])
  set(convLinesAtom, [])
  set(thoughtLinesAtom, [])
  set(deathsAtom, [])
  set(logonLinesAtom, [])
  set(inventoryLinesAtom, [])
  set(clearInventoryAtom)
  set(roomAtom, { name: '', uid: '', description: '', exits: [], objs: '', players: [], playerNames: [] })
  set(vitalsAtom, {
    health:  { value: 100, max: 100 },
    mana:    { value: 100, max: 100 },
    stamina: { value: 100, max: 100 },
    spirit:  { value: 100, max: 100 },
  })
  _healthSeen = false   // the placeholder above isn't a reading — see _healthSeen
  set(handsAtom, { left: '', right: '' })
  set(bodyInjuriesAtom, {})
  set(patientBodyAtom, null)
  set(bodySubjectAtom, 'character')
  _touchName = null
  _touchBuf  = []
  set(indicatorsAtom, {})
  // A new session restarts the rank count and the clock with it.
  set(expAtom, emptyExp())
  set(activeSpellAtom, '')
  set(activeSpellsAtom, [])
  set(roundtimeAtom, 0)
  set(castTimeAtom, 0)
  set(combatHeatRawAtom, { level: 0, at: 0 })
  set(weatherAtom, CLEAR)
  set(weatherRegionAtom, 'standard')
  // The clock and moon corrections are learned per world, not per character, and the
  // model is right without them — but a fresh session re-derives them from scratch.
  set(skyCorrectionAtom, 0)
  set(moonCorrectionsAtom, {})
  resetTimeCalibration()
  set(profilesAtom, {})
  set(selfNameAtom, '')
  // Note: serverAvatarsAtom is NOT reset — it's a name-keyed cache of shared
  // (bucket) images, account-global like `avatars`, and useEnsureAvatars only
  // requests each name once per session. Clearing it here emptied the cache
  // without clearing that request set, so a character seen before the switch
  // was never re-fetched and fell back to a letter avatar — most visible in the
  // web client, whose local `avatars` bucket is empty so every image is shared.
  set(aiAvatarsAtom, {})
  set(presenceModeAtom, 'online')
  set(lichScriptsAtom, [])
  // Note: verbRawAtom / verbInfoAtom are game-global (same for every character)
  // and cached in settings, so they are deliberately NOT reset here.

  // Module-level capture/batch flags — clear any in-flight silent fetch so it
  // can't bleed into or suppress the new character's output.
  _outputDirty       = false
  _verbCapture       = false
  _verbBuf           = []
  _profileCaptureName = null
  _profileBuf        = []
  _verbInfoName      = null
  _verbInfoHeader    = null
  _verbInfoStarted   = false
  _verbInfoBuf       = []
  _lookCapturing     = false
  _lookSelf          = false
  _lookBuf           = []
  _pendingLookTarget = ''
  _expBatchNames     = null
  _silentExpBatch    = false
  _spellBatch        = null
  _skySeedSilent     = false
  _weatherReportWait = 0
  _lichListWait      = 0
  _lichListSilent    = false
  _gameMove          = null
})

// ── Gags & substitutions ────────────────────────────────────────────────────
// A subset of the highlight rules (action gag/sub) applied to incoming text at
// INGEST — a gag drops the line, a sub rewrites its text before it's shown. App
// pushes the current character's gag/sub rules here whenever highlights load;
// class gating is applied live via disabledClassesAtom in dispatch.
export type { TextRule }

// The matching itself lives in lib/rules.ts, shared with the renderer and with the
// Test box in the highlights editor, so every pattern goes through the regex guard
// in one place. This just holds the current character's rules.
let _gagSubRules: TextRule[] = []
export function setGagSubRules(rules: TextRule[]): void { _gagSubRules = rules }

function applyGagSub(text: string, disabled: ReadonlySet<string>): string | null {
  return applyGagSubRules(text, _gagSubRules, disabled)
}

// ── Movement direction from the game's own confirmation ────────────────────────
// The game narrates each successful compass move ("You go east.", "You run
// southeast.") no matter who issued it — typed, clicked, or Lich `;go2` (which
// moves us server-side, so the outbound-command capture never sees it). This is
// the automapper's authoritative direction signal. Posture lines ("You stand up.",
// "You sit down.") are excluded via the verb blacklist.
const MOVE_VERB_SKIP = new Set(['stand', 'sit', 'kneel', 'lie', 'lay', 'get'])
const GAME_MOVE_RE = /^You\s+([a-z]+)\s+(north|south|east|west|northeast|northwest|southeast|southwest|up|down|out|in)\.?$/i
function parseGameMove(text: string): string | null {
  const m = text.trim().match(GAME_MOVE_RE)
  if (!m || MOVE_VERB_SKIP.has(m[1].toLowerCase())) return null
  return m[2].toLowerCase()
}
let _gameMove: { dir: string; move: string; ts: number } | null = null
export function currentGameMove(): { dir: string; move: string; ts: number } | null { return _gameMove }
export function clearGameMove(): void { _gameMove = null }

// ── Dispatch ──────────────────────────────────────────────────────────────────
export const dispatchGameEventAtom = atom(
  null,
  (get, set, event: GameEvent) => {
    switch (event.type) {

      case 'text': {
        // Capture the game's movement confirmation for the automapper (authoritative
        // direction, covers Lich `;go2`). Runs before any suppression/return below.
        if (event.stream === 'main') {
          const md = parseGameMove(event.text)
          if (md) _gameMove = { dir: md, move: md, ts: Date.now() }
          // Buffer a pending TOUCH assessment (parsed on the next prompt). The
          // lines still flow to the main output; we just also collect them.
          if (_touchName) _touchBuf.push(event.text)
        }
        // Silent VERB LIST sweep — capture single-token verb lines, suppress from output
        if (_verbCapture) {
          const t = event.text.trim()
          if (/^verb list /i.test(t)) return
          if (VERB_LINE_RE.test(t)) { _verbBuf.push(t); return }
        }
        // Silent PROFILE fetch — the response is a self-contained
        // <output class="mono"> block, so suppress the whole block from the main
        // output (including optional free-form fields like "Features" that aren't
        // in PROFILE_LABEL_RE) and capture the recognized "Key: Value" lines for
        // the character-menu summary. Non-mono output during the window passes
        // through untouched.
        if (_profileCaptureName) {
          const t = event.text.trim()
          if (/^profile\b/i.test(t)) return
          const isMonoLine = event.styles.some(s => s.preset === 'mono')
          if (isMonoLine || PROFILE_LABEL_RE.test(t)) {
            if (PROFILE_LABEL_RE.test(t)) _profileBuf.push(t)
            return
          }
        }
        // Silent VERB INFO fetch — capture the detail block, suppress from output
        if (_verbInfoName) {
          const t = event.text.trim()
          if (!_verbInfoStarted) {
            if (/^verb info /i.test(t)) return
            const h = t.match(/^Verb information for verb "([^"]+)"/i)
            if (h) { _verbInfoStarted = true; _verbInfoHeader = h[1].toLowerCase(); return }
          } else {
            _verbInfoBuf.push(t)
            return
          }
        }
        // Gags & substitutions: drop or rewrite the line before it's routed. Runs
        // after the internal silent sweeps (which the user doesn't gag) but before
        // panel routing, so a gag hides it everywhere and a sub is reflected in
        // whichever panel the line lands in.
        {
          const subbed = applyGagSub(event.text, get(disabledClassesAtom))
          if (subbed === null) return                 // gagged
          event.text = subbed                          // sub rewrite (no-op if unchanged)
        }
        // Ambient weather + Elanthian clock. Weather transition/report lines drive
        // the overlay (and stay visible in main); a TIME report (re)calibrates the
        // deterministic day/night clock. During the silent connect-time seed the
        // report lines are suppressed from the main output.
        if (event.stream === 'main') {
          const text = event.text
          // Desert prose switches the whole reading to the Muspar'i message set; the
          // region latches so it survives into lines that don't say either way.
          const region = regionFromLine(text)
          if (region) set(weatherRegionAtom, region)
          const season = get(skyAtom).season
          const readRegion = get(weatherRegionAtom)

          const w = weatherFromLine(text, season, readRegion)
          if (w) set(weatherAtom, w)
          // Indoors, `weather` replies "That's a bit hard to do while inside." — there's
          // no sky to read, so fade the weather overlay out (set clear).
          const inside = /hard to do while inside|can't (?:do that|see the sky) (?:while |from )?inside/i.test(text)
          if (inside) set(weatherAtom, CLEAR)
          // A TIME report verifies the closed-form clock; it only returns a value when
          // the report and the model actually disagree.
          const corrected = correctionFromTimeLine(text, Date.now(), get(skyCorrectionAtom))
          if (corrected !== null) set(skyCorrectionAtom, corrected)
          // Same for a passive moon rise/set broadcast: normally the model already
          // agrees and this is a no-op. The line stays visible in main (like weather).
          const mc = correctionFromMoonLine(text, Date.now(), get(moonCorrectionsAtom))
          if (mc) set(moonCorrectionsAtom, { ...get(moonCorrectionsAtom), [mc.name]: mc.correction })

          // The `weather` command prints "You glance up at the sky." then a state line
          // whose wording varies a lot ("The sky is a sharp, clear blue.", "A light rain
          // patters silently down from dark skies above."). We grade that line by POSITION
          // via weatherFromReportLine, which also resolves un-transcribed wordings by
          // keyword and defaults a precipitation-free sky description to clear — and flag
          // it so it's suppressed during a silent poll whatever it says.
          let reportLine = false
          if (_weatherReportWait > 0 && text.trim()) {
            const r = weatherFromReportLine(text, season, readRegion)
            if (r) {
              _weatherReportWait = 0
              reportLine = true
              if (!w && !inside) set(weatherAtom, r)
            } else {
              _weatherReportWait--          // not the reply (blank lines don't count) — keep waiting
            }
          }
          if (isWeatherHeaderLine(text)) {
            // The state sentence sometimes rides on the header line itself; if it does,
            // it's already been graded (weatherFromLine strips the header), so don't open
            // a window that a later line could answer.
            const sameLine = weatherFromReportLine(text, season, readRegion)
            if (sameLine) {
              reportLine = true
              if (!w && !inside) set(weatherAtom, sameLine)
            }
            _weatherReportWait = sameLine ? 0 : WEATHER_REPORT_WINDOW
          }
          if (inside) _weatherReportWait = 0

          // Suppress the silent connect-seed / background weather-poll output from the
          // main window: the "glance up" header, its (any-wording) state line, plus the
          // recognized weather / time / indoors replies.
          if (_skySeedSilent && (w || inside || reportLine || isTimeReportLine(text) || isWeatherHeaderLine(text))) {
            return
          }
        }
        // Lich's `;list` reply. Only read while a poll is in flight, so ordinary
        // `--- Lich:` notices are never mistaken for a script list.
        //
        // This is the 'lich' stream, NOT 'main': the parser retags every `--- Lich:`
        // line onto its own stream (see lichOutput in lib/sge-parser.ts) so Lich
        // chatter can be styled apart from game text. Gating this on 'main' meant it
        // never ran at all — the reply was neither parsed nor suppressed.
        if (event.stream === 'lich' && _lichListWait > 0) {
          const list = parseLichList(event.text)
          if (list) {
            set(lichScriptsAtom, list)
            _lichListWait = 0
            if (_lichListSilent) { _lichListSilent = false; return }
            _lichListSilent = false
          } else if (event.text.trim()) {
            _lichListWait--
          }
        }
        // Active-spell list ("Name (N roisaen)"): accumulate into the current
        // snapshot and suppress from main — it shows only in the Spells panel.
        // Committed on the next prompt (see the prompt handler).
        if (event.stream === 'main') {
          const spell = parseActiveSpell(event.text)
          if (spell) {
            if (_spellBatch === null) _spellBatch = []
            // Dedupe by name: with Lich running the same buff list can arrive twice
            // in one snapshot (DR's native percWindow + Lich's re-emission), which
            // otherwise doubled every row. Keep one entry per spell, latest value.
            const existing = _spellBatch.find(s => s.name === spell.name)
            if (existing) existing.roisaen = spell.roisaen
            else _spellBatch.push(spell)
            return
          }
        }
        // LOOK at a player: buffer the description block (suppressing the raw
        // lines) so the prompt handler can emit it as a single portrait card.
        if (event.stream === 'main') {
          if (_lookCapturing) { _lookBuf.push(event.text); return }
          if (LOOK_START_RE.test(event.text)) {
            _lookCapturing = true
            _lookSelf = /^You are\b/.test(event.text)
            _lookBuf = [event.text]
            return
          }
          // Themed LOOKs (shrouded / haze) whose first line IS the description.
          if (LOOK_CONCEAL_RE.test(event.text) || LOOK_HAZE_RE.test(event.text)) {
            _lookCapturing = true
            _lookSelf = false
            _lookBuf = [event.text]
            return
          }
        }
        const line = mkLine(event.text, event.styles, event.stream, event.links, event.bolds)

        // A logon or boost drain wipes all field experience at once; clear the
        // panel to match. The message itself still routes to output below.
        if (EXP_DRAIN_RE.test(event.text)) {
          const exp = get(expAtom)
          set(expAtom, { ...exp, skills: exp.skills.map(clearSkillExp) })
        }

        // Three figures ride the EXP report TEXT rather than any component:
        // rested exp (the `exp rexp` component that ought to carry it arrives
        // empty every single time), the circle, and the overall mindstate. Read
        // here rather than on the parser's component path so a silent background
        // poll fills the panel too: this runs before the routing below suppresses
        // the report, and the lines still show in main when the player asked.
        {
          const rested = parseRestedExp(event.text)
          if (rested) set(expAtom, { ...get(expAtom), rested })
          const circle = parseCircle(event.text)
          if (circle !== null) set(expAtom, { ...get(expAtom), circle })
          const overallMind = parseOverallMind(event.text)
          if (overallMind !== null) set(expAtom, { ...get(expAtom), overallMind })
        }

        // Route to stream-specific atoms
        switch (event.stream) {
          case 'exp':
            // Exp text lines go to expLinesAtom; actual skill data comes via expSkill events
            set(expLinesAtom, [...get(expLinesAtom).slice(-499), line])
            break
          case 'inv': {
            const t = event.text
            if (t === '__clear_inv__') {
              set(inventoryLinesAtom, [])
            } else {
              set(inventoryLinesAtom, [...get(inventoryLinesAtom).slice(-299), t])
            }
            break
          }
          case 'lich':
            // Lich script output — show inline in the main game panel (styled like a
            // script echo) now that the separate Lich log side panel is gone.
            set(outputLinesAtom, appendMain(get(outputLinesAtom), mkLine(event.text, [{ preset: 'echo-script' }], 'main')))
            break
          case 'combat':
            // Combat lives only in the Combat panel — don't echo to main output.
            // Deliberately does NOT touch the heat vignette: combat-tagged text is a
            // poor proxy for danger (DR routes plenty of it here during the login
            // burst, and every swing you land is a line too). Only losing health
            // flashes the panel — see the 'vitals' case.
            set(combatLinesAtom, [...get(combatLinesAtom).slice(-499), line])
            break
          case 'atmo':
            set(atmoLinesAtom, [...get(atmoLinesAtom).slice(-199), line])
            // Don't echo atmo to main output — it clutters it
            break
          case 'speech': {
            // DR tags speech with a preset most of the time, but not always — a
            // `talk`/`whispers`/`conversation` push is itself the statement that this
            // line is somebody talking, so the quote is enough. Requiring a preset
            // here dropped every untagged say straight back into main output.
            const isScript = /^\S+:\s/.test(line.text) || /\.lic\b/.test(line.text)
            if (/"/.test(line.text) && !isScript) {
              set(convLinesAtom, appendDedup(get(convLinesAtom), { ...line, speaker: extractSpeaker(line.text) }, 200))
            } else {
              set(outputLinesAtom, appendDedup(get(outputLinesAtom), line))
              _outputDirty = true
            }
            break
          }
          case 'thoughts':
            set(thoughtLinesAtom, appendDedup(get(thoughtLinesAtom), { ...line, speaker: extractSpeaker(line.text) }, 200))
            break
          default: {
            const isHandUpdate = event.styles.some(s => s.preset === 'left' || s.preset === 'right')
            if (!isHandUpdate && !_silentExpBatch) {
              // DR's server-wide death broadcast reads "* NAME was just struck
              // down at LOCATION!" — the "just" (and other death verbs) must not
              // break the match, or the death never reaches the Deaths panel. The
              // verb phrases follow the official templates on Elanthipedia's
              // "Character Death Messaging" page (struck down / disintegrated /
              // cremated / burned alive / turned into an ice statue / crystallized /
              // starved to death / purged by the Hounds of Rutilor / lost to the
              // Plane of Exile / smote by / fed …self to Maelshyve). Note "entered
              // the Void" is NOT a death; the present-tense "disintegrates into
              // nothingness" is a creature despawn — both intentionally excluded.
              const DEATH_RE = /\*\s+.+?\s+(?:was (?:just )?(?:struck down|slain|killed|vanquished|destroyed|cremated|burned alive|turned into an ice statue)|has been crystallized|(?:just )?disintegrated|starved to death|was purged by the hounds|was lost to the plane|was smote by|fed (?:him|her|them)self to maelshyve|died|perished|succumbed|fell lifeless)\b|you have died|you are dead/i
              if (isAtmospheric(event.text)) {
                // Atmospheric-item messages have no stream tag in DR; matched by
                // text and routed to the Atmo panel only (suppressed from main).
                set(atmoLinesAtom, [...get(atmoLinesAtom).slice(-199), line])
              } else if (DEATH_RE.test(event.text)) {
                // Deaths live only in the Deaths panel — suppress from main output.
                set(deathsAtom, [...get(deathsAtom).slice(-199), line])
              } else if (/^\*\s/.test(event.text) && (LOGON_RE.test(event.text) || LOGOFF_RE.test(event.text))) {
                // Logon/logoff/disconnect "* …" broadcasts live only in the
                // Connections panel — suppress from main output (they're spammy).
                // Gated on the leading "*" so the loose wording matches can't grab
                // ordinary chat that mentions adventures/shadows/home.
                const kind = LOGOFF_RE.test(event.text) ? 'off' : 'on'
                const text = event.text.replace(/^\*\s+/, '')   // drop the "* " broadcast prefix
                set(logonLinesAtom, [...get(logonLinesAtom).slice(-199), { id: lineId++, text, timestamp: Date.now(), kind }])
              } else {
                set(outputLinesAtom, appendDedup(get(outputLinesAtom), line))
                _outputDirty = true
              }
            }

            // Keep the side-panel skill list in sync with the readable EXP report:
            // a contiguous run of report lines is one snapshot, and any previously
            // known skill that drops out of it has decayed back to 0% / clear.
            const reportedSkills = parseExpSkills(event.text)
            if (reportedSkills.length > 0) {
              if (!_expBatchNames) _expBatchNames = new Set()
              const exp = get(expAtom)
              let skills = exp.skills
              let baselines = exp.baselines
              for (const r of reportedSkills) {
                _expBatchNames.add(r.name)
                const entry: ExpSkill = {
                  name: r.name, rank: parseInt(r.rank, 10), pct: parseInt(r.pct, 10),
                  mind: r.frac, mindWord: r.mind || undefined,
                }
                const idx = skills.findIndex(s => s.name === r.name)
                skills = idx >= 0 ? skills.map((s, i) => i === idx ? entry : s) : [...skills, entry]
                baselines = withBaseline(baselines, entry)
              }
              set(expAtom, { ...exp, skills, baselines })
            } else if (_expBatchNames) {
              const exp = get(expAtom)
              const seen = _expBatchNames
              set(expAtom, {
                ...exp,
                skills: exp.skills.map(s => seen.has(s.name) ? s : clearSkillExp(s)),
              })
              _expBatchNames  = null
              // Deliberately NOT clearing _silentExpBatch here. The report's tail
              // — total ranks, TDPs, rested exp, state of mind — arrives AFTER the
              // last skill line, so dropping suppression at the first non-skill
              // line leaked four lines of it into the output on every poll. The
              // prompt at the end of the response closes the window instead (see
              // the prompt handler), which costs one command round-trip of
              // suppression and hides the whole report rather than most of it.
            }
            break
          }
        }
        // Route hand content. The game says "Empty" for a bare hand, which is a state,
        // not an item — normalise it to '' here so there is one representation of empty
        // and every consumer can render it the same way. (Before this, a hand the game
        // had reported showed the literal "Empty" while one it had not yet reported fell
        // back to a component's own placeholder, so the same state looked different in
        // different panels.)
        if (event.styles.some(s => s.preset === 'left'))  set(handsAtom, { ...get(handsAtom), left:  handContent(event.text) })
        if (event.styles.some(s => s.preset === 'right')) set(handsAtom, { ...get(handsAtom), right: handContent(event.text) })
        // Also route main-stream speech/whisper/thought to their panels. appendDedup
        // handles the case where a line arrives on both the pushStream and the main
        // stream, so only the first copy is kept. Thoughts split off to their own
        // panel: on a live ESP network they otherwise drown out room conversation.
        const preset   = event.styles.find(s => ['speech','whisper','thought'].includes(s.preset ?? ''))?.preset
        const quoted   = /"/.test(event.text) && !/^\S+:\s/.test(event.text) && !/\.lic\b/.test(event.text)
        if (preset === 'thought' && event.stream !== 'thoughts') {
          set(thoughtLinesAtom, appendDedup(get(thoughtLinesAtom), { ...line, speaker: extractSpeaker(line.text) }, 200))
        } else if (preset && quoted) {
          set(convLinesAtom, appendDedup(get(convLinesAtom), { ...line, speaker: extractSpeaker(line.text) }, 200))
        }
        break
      }

      case 'roomName':
        set(roomAtom, {
          ...get(roomAtom),
          name: event.name,
        })
        break

      // <nav> leads the room feed on arrival, so this lands before roomName/roomDesc
      // — which is why roomDesc must not clear it.
      case 'roomId':
        set(roomAtom, { ...get(roomAtom), uid: event.uid })
        break

      case 'roomDesc':
        set(roomAtom, {
          ...get(roomAtom),
          description: event.description,
          exits: [],
          objs: '',
          players: [],
          playerNames: [],
        })
        break

      case 'roomExits':
        set(roomAtom, { ...get(roomAtom), exits: event.exits })
        break

      case 'roomObjs':
        set(roomAtom, { ...get(roomAtom), objs: event.objs })
        break

      case 'roomPlayers': {
        const playerList = event.players.replace(/^(Also here|You also see):\s*/i, '').split(/,\s*/).filter(p => p.trim())
        set(roomAtom, { ...get(roomAtom), players: playerList, playerNames: playerList })
        break
      }

      case 'playerArrived': {
        const currentPlayers = get(roomAtom).playerNames
        if (!currentPlayers.includes(event.player)) {
          const newPlayers = [...currentPlayers, event.player]
          set(roomAtom, { ...get(roomAtom), players: newPlayers, playerNames: newPlayers })
        }
        break
      }

      case 'playerDeparted': {
        const currentPlayers2 = get(roomAtom).playerNames
        const newPlayers2 = currentPlayers2.filter(p => p !== event.player)
        set(roomAtom, { ...get(roomAtom), players: newPlayers2, playerNames: newPlayers2 })
        break
      }

      case 'expSkill': {
        const skill = { name: event.name, rank: event.rank, pct: event.pct, mind: event.mind, mindWord: event.mindWord }
        const exp   = get(expAtom)
        const idx   = exp.skills.findIndex(s => s.name === skill.name)
        const skills = idx >= 0
          ? exp.skills.map((s, i) => i === idx ? skill : s)
          : [...exp.skills, skill]
        // Baseline from the live push as well as the report, so a skill that
        // ticks up before this session's first EXP report still counts from
        // where it started rather than from the report.
        set(expAtom, { ...exp, skills, baselines: withBaseline(exp.baselines, skill) })
        break
      }

      case 'expSleep': {
        const exp = get(expAtom)
        if (exp.sleep !== event.text) set(expAtom, { ...exp, sleep: event.text })
        break
      }

      // DR announces decay by pushing an EMPTY exp component for the skill rather
      // than a 0% one, so this is the only live signal that a skill went back to
      // clear. Unknown names are ignored — the exp window declares components for
      // skills the character has never trained.
      case 'expClear': {
        const exp = get(expAtom)
        const idx = exp.skills.findIndex(s => s.name === event.name)
        if (idx >= 0 && exp.skills[idx].pct > 0) {
          set(expAtom, { ...exp, skills: exp.skills.map((s, i) => i === idx ? clearSkillExp(s) : s) })
        }
        break
      }

      case 'expMeta': {
        const exp = get(expAtom)
        set(expAtom, {
          ...exp,
          tdps:   event.tdps   ?? exp.tdps,
          favors: event.favors ?? exp.favors,
        })
        break
      }

      case 'expRested': {
        const exp = get(expAtom)
        set(expAtom, {
          ...exp,
          rested: { stored: event.stored, usable: event.usable, refresh: event.refresh },
        })
        break
      }

      case 'vitals': {
        const prev = get(vitalsAtom)
        // A drop in health means we just took a hit — flash the panel, scaled a
        // little by how hard the hit was.
        //
        // The FIRST health reading of a session is a baseline, never a hit: vitals
        // start at a placeholder 100/100 (see vitalsAtom / resetSessionAtom), so
        // logging in on anything less than full health read as a drop and flashed
        // the panel red on every connect.
        if (event.field === 'health') {
          if (!_healthSeen) {
            _healthSeen = true
          } else if (event.value < prev.health.value) {
            const dropFrac = prev.health.max > 0 ? (prev.health.value - event.value) / prev.health.max : 0
            bumpHeat(get, set, 0.55 + Math.min(0.45, dropFrac * 2))
          }
        }
        set(vitalsAtom, {
          ...prev,
          [event.field]: { value: event.value, max: event.max ?? prev[event.field].max }
        })
        break
      }

      case 'injuries': {
        // A complete snapshot of one body's wounds/scars — replace wholesale.
        const injuries = injuriesFromImages(event.images)
        const who      = injuryDialogSubject(event.dialogId, event.title)
        if (!who) { set(bodyInjuriesAtom, injuries); set(injuryPendingAtom, false); break }
        // A window about someone else (an empath's patient). Structured data beats
        // the TOUCH text scrape, so it wins and cancels any capture in flight.
        set(patientBodyAtom, { name: who, injuries })
        set(bodySubjectAtom, 'patient')
        _touchName = null
        _touchBuf  = []
        break
      }

      case 'inventoryTree':
        // One envelope of a `_inventory manager` walk; store/inventory.ts owns the
        // assembly and decides whether more branches need requesting.
        set(receiveInvEnvelopeAtom, event.envelope)
        break

      case 'indicator':
        set(indicatorsAtom, { ...get(indicatorsAtom), [event.id]: event.active })
        break

      case 'spell':
        set(activeSpellAtom, event.name)
        break

      case 'roundtime':
        set(roundtimeAtom, event.expires)
        break

      case 'cast_time':
        set(castTimeAtom, event.expires)
        break

      case 'percClear':
        // A fresh active-spell snapshot is starting. Open an empty batch so that
        // if NO spell lines follow (all buffs expired), the prompt commits an
        // empty list and the panel clears.
        _spellBatch = []
        break

      case 'prompt':
        // A TOUCH response lands as one server message ending in this prompt.
        // Parse the buffered lines into the patient's wounds — but only once at
        // least one line has arrived, so an unrelated prompt (vitals fire often)
        // between sending `touch` and the reply doesn't close an empty capture.
        if (_touchName && _touchBuf.length > 0) {
          const name    = _touchName
          const scraped = injuriesFromTouch(_touchBuf)
          // The scrape is heuristic: an empty result on a refresh is far more
          // likely a parse miss than a patient who healed between touches, so
          // don't blank a reading we already have.
          const prev = get(patientBodyAtom)
          const keepPrev = isHealthy(scraped) && prev?.name === name && !isHealthy(prev.injuries)
          if (!keepPrev) set(patientBodyAtom, { name, injuries: scraped })
          _touchName = null
          _touchBuf  = []
        }
        // Commit any accumulated active-spell snapshot (a contiguous run of
        // "Name (N roisaen)" lines, or an empty batch from a percClear with no
        // spells left) as the complete new list.
        if (_spellBatch !== null) {
          // Stamp each buff's real-time expiry from its roisaen count so the panel
          // can count down live (see ROISAEN_MS) until the next game resend.
          const committedAt = Date.now()
          set(activeSpellsAtom, _spellBatch.map(s => ({ ...s, expires: committedAt + s.roisaen * ROISAEN_MS })))
          _spellBatch = null
        }
        // The server sends <prompt> at the end of every command response.
        // If _silentExpBatch is still true here it means either no skills are
        // active (the batch never opened) or the batch-close line never arrived
        // — either way the poll is done, so clear the flag now.
        if (_silentExpBatch) {
          _expBatchNames  = null
          _silentExpBatch = false
        }
        // Flush any verbs captured since the last prompt into the reactive atom.
        if (_verbCapture && _verbBuf.length > 0) {
          set(verbRawAtom, Array.from(new Set([...get(verbRawAtom), ..._verbBuf])).sort())
          _verbBuf = []
        }
        // Finalize a VERB INFO fetch: parse the captured block and cache it under
        // the verb named in the response header (robust to fast re-highlighting).
        // Only commit once the response has actually begun (_verbInfoStarted) —
        // otherwise an unrelated prompt (vitals/exp updates fire constantly) that
        // lands between arming the capture and the reply arriving would commit an
        // empty entry, disarm the capture, and cache [] so it never refetches.
        if (_verbInfoName && _verbInfoStarted) {
          const name = _verbInfoHeader ?? _verbInfoName
          set(verbInfoAtom, { ...get(verbInfoAtom), [name]: parseVerbInfo(name, _verbInfoBuf) })
          _verbInfoName = null; _verbInfoHeader = null; _verbInfoStarted = false; _verbInfoBuf = []
        }
        // Flush a captured LOOK block as a single portrait card. The avatar key is
        // the character's FIRST name: for yourself it follows "You are"; for others
        // the first line may carry a prefix title, so take it from the second line,
        // which always leads with the name ("Elanarie has …").
        if (_lookCapturing && _lookBuf.length) {
          const blob = _lookBuf.join(' ')
          let rawName: string
          if (_lookSelf) {
            rawName = _lookBuf[0].match(/^You are ([A-Z][\w'-]+)/)?.[1] ?? ''
          } else if (LOOK_HAZE_RE.test(blob)) {
            // Haze cosmetic: the LOOK carries no character name and the portrait
            // depicts a generic hazed figure, not a person — so key it to the LOOK
            // text itself. Identical hazes then share one cached image instead of
            // being filed under whoever we happened to look at.
            rawName = 'haze-' + hashLook(blob)
          } else if (/\bconcealing all but (?:his|her|their|its)\s+empty hands\b/i.test(blob)) {
            // Shrouded: the concealed line leads with the character's name.
            rawName = _lookBuf.find(l => /\bseems to be\b/i.test(l))?.match(/^([A-Z][\w'-]+)/)?.[1]
                   ?? _pendingLookTarget
          } else {
            // Key the portrait to the character's FIRST name. The description body
            // always leads with it ("Catheroine has a soft-featured face …"), so the
            // second line is the authoritative source — it isolates the given name
            // from BOTH prefix titles AND a trailing surname ("You see Paintress
            // Catheroine Rotschreck, …" → Catheroine, not Rotschreck), and resolves
            // an abbreviated look ("l mits" → "Mitsuri has …" → Mitsuri). Fall back
            // to the "You see" line's word-before-comma (correct for single-name
            // characters) only when there's no description line to read.
            rawName = _lookBuf[1]?.match(/^([A-Z][\w'-]+)/)?.[1]
                   || _lookBuf[0].match(/^You see .*?([A-Z][\w'-]+),/)?.[1]
                   || _pendingLookTarget
                   || _lookBuf[0].match(/^You see ([A-Z][\w'-]+)/)?.[1] || ''
          }
          // A description line can lead with a possessive ("Refia's …"); strip the
          // trailing 's so the key matches the avatar/portrait ("refia", not "refia's").
          const name = rawName.replace(/'s$/i, '').replace(/'$/, '')
          set(outputLinesAtom, appendMain(get(outputLinesAtom), {
            id: lineId++, text: _lookBuf.join('\n'), styles: [], stream: 'main' as StreamId,
            timestamp: Date.now(), look: { name, lines: _lookBuf },
          }))
          _outputDirty = true
          _lookCapturing = false; _lookSelf = false; _lookBuf = []; _pendingLookTarget = ''
        }
        // Space out consecutive command-response chunks: if new content landed in
        // the main output since the last prompt, flush a separator (blank line).
        if (_outputDirty) {
          set(outputLinesAtom, appendMain(get(outputLinesAtom), mkSeparator()))
          _outputDirty = false
        }
        // Signal the automapper that a full server message just closed — the room
        // atom now holds a complete room (name/desc/exits) it can fold into the map.
        set(promptCountAtom, get(promptCountAtom) + 1)
        break
    }
  }
)
