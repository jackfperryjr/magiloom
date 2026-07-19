import { atom } from 'jotai'
import type { GameEvent, LinkSpan, TextStyle, VitalField, StreamId } from '../lib/sge-parser'
import { parseExpSkills } from '../lib/exp-parser'
import { isAtmospheric } from '../lib/atmospherics'
import { feedTimeLine, computeSky, isTimeReportLine, type SkyCalibration, type SkyState } from '../lib/elanthianTime'
import { weatherFromLine, CLEAR, type WeatherState } from '../lib/weather'
import type { AvatarCrop } from '../lib/avatar'

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
  divider?:   string   // labeled separator line (e.g. "Disconnected"), Discord-style
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

// Append a Discord-style "Disconnected" divider to the main output, marking
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
export const deathsAtom       = atom<OutputLine[]>([])

// ── Connections (logon / logoff / disconnect monitor) ──────────────────────────
// A timestamped feed of connection events: this character's own connect/disconnect
// (fed from GameLayout) plus game lines announcing others logging on/off or link-
// dying. Shown in the Connections panel; matched lines also stay in main output.
export interface LogonEntry { id: number; text: string; timestamp: number; kind: 'on' | 'off' }
export const logonLinesAtom = atom<LogonEntry[]>([])

// DR's "* …" adventure broadcasts announcing players coming online / going offline.
// These almost always arrive as bare "* NAME …" MAIN-stream text, so matching on
// wording (below) is how we route them to the Connections panel and out of the main
// output. (A `pushStream id="logons"` tag very occasionally wraps a logon — seen in
// the Lich logs — but it's rare, and the wording match catches those too.)
// Arrivals read "… joins the adventure." / "just <verb> into the adventure …"
//   (sauntered / crawled / stumbled / teetered / "deposited into the adventure by a
//   mighty dragon"), plus reconnect/return-style broadcasts: "waking from a long
//   catnap, NAME once again prowls the lands.", "comes out from within the shadows
//   with renewed vigor.", horn/bell arrivals ("… heralding the arrival of NAME.",
//   "plaintive bell-tolls … harbinger NAME arrival.").
// Departures are more varied (all harvested from real Lich logs):
//   "retires from the adventure for now." / "retires from the lands to enjoy a nice
//   long catnap." / "returns home from a hard day…" / "returned home to work on a new
//   tune." / "has disconnected." / "wanders off, muttering something about spiders." /
//   "saunters off, muttering prayers under his breath." / "The mournful cry of a battle
//   horn sounds as NAME heads off toward home." / "just found a shadow to hide out
//   in." / "went home to take a nap." / "leaves, looking for more excitement." / "has
//   left to contemplate the life of a warrior." / "just sauntered off-duty to get some
//   rest." Death broadcasts ("struck down", etc.) are caught earlier by DEATH_RE, so
//   they never reach these patterns.
const LOGON_RE  = /\b(?:joins|into) the adventure\b|\bhas reconnected\b|\bhas logged (?:on|in)\b|\bwaking from a long catnap\b|\bcomes out from within the shadows with renewed vigor\b|\bheralding the arrival of\b|\bplaintive bell-tolls\b/i
const LOGOFF_RE = /\bretires from the (?:adventure|lands)\b|\breturn(?:s|ed) home\b|\bheads off toward home\b|\bwanders off, muttering something about spiders\b|\bsaunters off, muttering prayers\b|\bhas disconnected\b|\bfound a shadow to hide out in\b|\bhas logged o(?:ff|ut)\b|\bhas gone link-?dead\b|\bwent home to take a nap\b|\bleaves, looking for more excitement\b|\bhas left to contemplate the life of a\b|\bsauntered off-duty\b/i

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

// ── Room ──────────────────────────────────────────────────────────────────────
export interface RoomState { name: string; description: string; exits: string[]; objs: string; players: string[]; playerNames: string[] }
export const roomAtom = atom<RoomState>({ name: '', description: '', exits: [], objs: '', players: [], playerNames: [] })

// Incremented on every server prompt (end of a command response). The automapper
// watches this to know when the current room is fully populated so it can fold it
// into the map — a prompt marks the room name/desc/exits as all having landed.
export const promptCountAtom = atom<number>(0)

// ── Inventory ─────────────────────────────────────────────────────────────────
export const inventoryLinesAtom = atom<string[]>([])

// ── Hands ────────────────────────────────────────────────────────────────────
export const handsAtom = atom<{ left: string; right: string }>({ left: '', right: '' })

// ── Indicators ────────────────────────────────────────────────────────────────
export const indicatorsAtom = atom<Record<string, boolean>>({})

// ── Presence (avatar status; shared so notifications can honor Do Not Disturb) ──
export type PresenceMode = 'online' | 'idle' | 'dnd'
export const presenceModeAtom = atom<PresenceMode>('online')

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

// ── Ambient: weather + Elanthian sky (day/night) ────────────────────────────────
// weatherAtom is driven by ambient weather messages + the `weather` command
// (lib/weather.ts). skyCalibrationAtom holds the deterministic-clock anchor seeded
// from one `TIME` report (lib/elanthianTime.ts); skyAtom recomputes the live
// day/night state off tickAtom each second — no polling. Both feed AmbientOverlay.
export const weatherAtom = atom<WeatherState>(CLEAR)
export const skyCalibrationAtom = atom<SkyCalibration | null>(null)
export const skyAtom = atom<SkyState | null>(get => {
  get(tickAtom)  // re-evaluate every second so day/night advances live
  const cal = get(skyCalibrationAtom)
  return cal ? computeSky(Date.now(), cal) : null
})

// True while the connect-time seed is fetching TIME/weather silently, so their
// report lines are suppressed from the main output (set/cleared from App).
let _skySeedSilent = false
export const beginSilentSkySeedAtom = atom(null, () => { _skySeedSilent = true })
export const endSilentSkySeedAtom   = atom(null, () => { _skySeedSilent = false })
// True on the line immediately after `weather`'s "You glance up at the sky." header —
// that line is the weather state, whose clear-sky wording varies too much to enumerate.
let _weatherReportNext = false

// ── Experience ────────────────────────────────────────────────────────────────
export interface ExpSkill { name: string; rank: number; pct: number; mind: string; mindWord?: string }
export interface ExpState  { skills: ExpSkill[]; tdps: number; favors: number }
export const expAtom = atom<ExpState>({ skills: [], tdps: 0, favors: 0 })

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
  set(deathsAtom, [])
  set(logonLinesAtom, [])
  set(inventoryLinesAtom, [])
  set(roomAtom, { name: '', description: '', exits: [], objs: '', players: [], playerNames: [] })
  set(vitalsAtom, {
    health:  { value: 100, max: 100 },
    mana:    { value: 100, max: 100 },
    stamina: { value: 100, max: 100 },
    spirit:  { value: 100, max: 100 },
  })
  set(handsAtom, { left: '', right: '' })
  set(indicatorsAtom, {})
  set(expAtom, { skills: [], tdps: 0, favors: 0 })
  set(activeSpellAtom, '')
  set(activeSpellsAtom, [])
  set(roundtimeAtom, 0)
  set(castTimeAtom, 0)
  set(weatherAtom, CLEAR)
  set(skyCalibrationAtom, null)
  set(profilesAtom, {})
  set(selfNameAtom, '')
  set(serverAvatarsAtom, {})
  set(aiAvatarsAtom, {})
  set(presenceModeAtom, 'online')
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
  _weatherReportNext = false
  _gameMove          = null
})

// ── Gags & substitutions ────────────────────────────────────────────────────
// A subset of the highlight rules (action gag/sub) applied to incoming text at
// INGEST — a gag drops the line, a sub rewrites its text before it's shown. App
// pushes the current character's gag/sub rules here whenever highlights load;
// class gating is applied live via disabledClassesAtom in dispatch.
export interface TextRule {
  pattern: string; isRegex: boolean; action: 'gag' | 'sub'
  replace?: string; enabled: boolean; class?: string
}
let _gagSubRules: TextRule[] = []
export function setGagSubRules(rules: TextRule[]): void { _gagSubRules = rules }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Returns the (possibly rewritten) text, or null when a gag suppresses the line.
function applyGagSub(text: string, disabled: ReadonlySet<string>): string | null {
  if (_gagSubRules.length === 0) return text
  let out = text
  for (const r of _gagSubRules) {
    if (!r.enabled || !r.pattern || (r.class && disabled.has(r.class))) continue
    if (r.action === 'gag') {
      let hit = false
      if (r.isRegex) { try { hit = new RegExp(r.pattern, 'i').test(out) } catch { hit = false } }
      else hit = out.toLowerCase().includes(r.pattern.toLowerCase())
      if (hit) return null
    } else { // sub — replace every occurrence
      try {
        const re = new RegExp(r.isRegex ? r.pattern : escapeRe(r.pattern), 'gi')
        out = out.replace(re, r.replace ?? '')
      } catch { /* invalid regex — skip */ }
    }
  }
  return out
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
          const w = weatherFromLine(text)
          if (w) set(weatherAtom, w)
          // Indoors, `weather` replies "That's a bit hard to do while inside." — there's
          // no sky to read, so fade the weather overlay out (set clear).
          const inside = /hard to do while inside|can't (?:do that|see the sky) (?:while |from )?inside/i.test(text)
          if (inside) set(weatherAtom, CLEAR)
          const cal = feedTimeLine(text)
          if (cal) set(skyCalibrationAtom, cal)

          // The `weather` command prints "You glance up at the sky." then a state line
          // whose clear-sky wording varies a lot ("The sky is a sharp, clear blue."). We
          // handle THAT line by position: if it isn't a recognized precipitation report,
          // default it to clear — and flag it so it's suppressed during a silent poll
          // whatever it says.
          let reportLine = false
          if (_weatherReportNext) {
            _weatherReportNext = false
            reportLine = true
            const isPrecip = /\b(rain|snow|sleet|hail|storm|downpour|blizzard|drizzl|flurr|precipitat|thunder|lightning)\b/i.test(text)
            if (!w && !inside && !isPrecip) set(weatherAtom, CLEAR)
          }
          if (/^\s*You glance up at the sky\.?/i.test(text)) _weatherReportNext = true

          // Suppress the silent connect-seed / background weather-poll output from the
          // main window: the "glance up" header, its (any-wording) state line, plus the
          // recognized weather / time / indoors replies.
          if (_skySeedSilent && (w || inside || reportLine || isTimeReportLine(text) || /^\s*You glance up at the sky\./i.test(text))) {
            return
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
            set(combatLinesAtom, [...get(combatLinesAtom).slice(-499), line])
            break
          case 'atmo':
            set(atmoLinesAtom, [...get(atmoLinesAtom).slice(-199), line])
            // Don't echo atmo to main output — it clutters it
            break
          case 'speech': {
            const isSpeech = line.styles.some(s => ['speech','whisper','thought'].includes(s.preset ?? ''))
            const isScript = /^\S+:\s/.test(line.text) || /\.lic\b/.test(line.text)
            if (isSpeech && /"/.test(line.text) && !isScript) {
              set(convLinesAtom, appendDedup(get(convLinesAtom), { ...line, speaker: extractSpeaker(line.text) }, 200))
            } else {
              set(outputLinesAtom, appendDedup(get(outputLinesAtom), line))
              _outputDirty = true
            }
            break
          }
          default: {
            const isHandUpdate = event.styles.some(s => s.preset === 'left' || s.preset === 'right')
            if (!isHandUpdate && !_silentExpBatch) {
              // DR's server-wide death broadcast reads "* NAME was just struck
              // down at LOCATION!" — the "just" (and other death verbs) must not
              // break the match, or the death never reaches the Deaths panel.
              const DEATH_RE = /\*\s+.+?\s+(?:was (?:just )?(?:struck down|slain|killed|vanquished|destroyed)|died|perished|succumbed|fell lifeless)\b|you have died|you are dead/i
              if (isAtmospheric(event.text)) {
                // Atmospheric-item messages have no stream tag in DR; matched by
                // text and routed to the Atmo panel only (suppressed from main).
                set(atmoLinesAtom, [...get(atmoLinesAtom).slice(-199), line])
              } else if (DEATH_RE.test(event.text)) {
                // Deaths live only in the Deaths panel — suppress from main output.
                set(deathsAtom, [...get(deathsAtom).slice(-199), line])
              } else if (LOGON_RE.test(event.text) || LOGOFF_RE.test(event.text)) {
                // Logon/logoff/disconnect "* …" broadcasts live only in the
                // Connections panel — suppress from main output (they're spammy).
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
              for (const r of reportedSkills) {
                _expBatchNames.add(r.name)
                const entry: ExpSkill = {
                  name: r.name, rank: parseInt(r.rank, 10), pct: parseInt(r.pct, 10),
                  mind: r.frac, mindWord: r.mind || undefined,
                }
                const idx = skills.findIndex(s => s.name === r.name)
                skills = idx >= 0 ? skills.map((s, i) => i === idx ? entry : s) : [...skills, entry]
              }
              set(expAtom, { ...exp, skills })
            } else if (_expBatchNames) {
              const exp = get(expAtom)
              const seen = _expBatchNames
              set(expAtom, {
                ...exp,
                skills: exp.skills.map(s => seen.has(s.name) ? s : clearSkillExp(s)),
              })
              _expBatchNames  = null
              _silentExpBatch = false
            }
            break
          }
        }
        // Route hand content
        if (event.styles.some(s => s.preset === 'left'))  set(handsAtom, { ...get(handsAtom), left:  event.text.trim() })
        if (event.styles.some(s => s.preset === 'right')) set(handsAtom, { ...get(handsAtom), right: event.text.trim() })
        // Also route main-stream speech/whisper/thought to conv panel.
        // appendDedup handles the case where speech arrives in both the pushStream
        // and the main stream, so only the first copy is kept.
        if (event.styles.some(s => ['speech','whisper','thought'].includes(s.preset ?? '')) && /"/.test(event.text) && !/^\S+:\s/.test(event.text) && !/\.lic\b/.test(event.text)) {
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

      case 'roomPlayers':
        const playerList = event.players.replace(/^(Also here|You also see):\s*/i, '').split(/,\s*/).filter(p => p.trim())
        set(roomAtom, { ...get(roomAtom), players: playerList, playerNames: playerList })
        break

      case 'playerArrived':
        const currentPlayers = get(roomAtom).playerNames
        if (!currentPlayers.includes(event.player)) {
          const newPlayers = [...currentPlayers, event.player]
          const playerText = newPlayers.length > 0 ? `Also here: ${newPlayers.join(', ')}` : ''
          set(roomAtom, { ...get(roomAtom), players: newPlayers, playerNames: newPlayers })
        }
        break

      case 'playerDeparted':
        const currentPlayers2 = get(roomAtom).playerNames
        const newPlayers2 = currentPlayers2.filter(p => p !== event.player)
        const playerText2 = newPlayers2.length > 0 ? `Also here: ${newPlayers2.join(', ')}` : ''
        set(roomAtom, { ...get(roomAtom), players: newPlayers2, playerNames: newPlayers2 })
        break

      case 'expSkill': {
        const skill = { name: event.name, rank: event.rank, pct: event.pct, mind: event.mind, mindWord: event.mindWord }
        const exp   = get(expAtom)
        const idx   = exp.skills.findIndex(s => s.name === skill.name)
        const skills = idx >= 0
          ? exp.skills.map((s, i) => i === idx ? skill : s)
          : [...exp.skills, skill]
        set(expAtom, { ...exp, skills })
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

      case 'vitals': {
        const prev = get(vitalsAtom)
        set(vitalsAtom, {
          ...prev,
          [event.field]: { value: event.value, max: event.max ?? prev[event.field].max }
        })
        break
      }

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
