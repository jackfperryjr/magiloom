import { atom } from 'jotai'
import type { GameEvent, LinkSpan, TextStyle, VitalField, StreamId } from '../lib/sge-parser'
import { parseExpSkills } from '../lib/exp-parser'
import { isAtmospheric } from '../lib/atmospherics'

export type { StreamId }

// ── Connection ────────────────────────────────────────────────────────────────
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export const connectionStatusAtom = atom<ConnectionStatus>('disconnected')

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

// Skip appending if the last line in the array is identical and was added within
// 300 ms — catches protocol-level duplicates (e.g. double-fired IPC listeners).
function appendDedup(lines: OutputLine[], line: OutputLine, max: number): OutputLine[] {
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
  set(outputLinesAtom, [...lines.slice(-4999), {
    id: lineId++, text: '', styles: [], stream: 'main' as StreamId,
    timestamp: Date.now(), divider: 'Disconnected',
  }])
})

// Stream-specific lines
export const expLinesAtom     = atom<OutputLine[]>([])
export const combatLinesAtom  = atom<OutputLine[]>([])
export const atmoLinesAtom    = atom<OutputLine[]>([])
export const convLinesAtom    = atom<OutputLine[]>([])
export const deathsAtom       = atom<OutputLine[]>([])
export const lichMsgAtom      = atom<string[]>([])

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

// Server-backed custom avatars fetched by name (data URLs), keyed by lowercased
// name. A `null` value is a negative cache: "no custom image, use the identicon."
// Undefined means "not fetched yet". Populated by useEnsureAvatars.
export const serverAvatarsAtom = atom<Record<string, string | null>>({})

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
// Matches the first line of both "You see …, a RACE." (others) and "You are …, a
// RACE." (yourself). Anchored on the trailing ", a/an <Race>." so it doesn't fire
// on ordinary "You are …" lines. The name is NOT taken from this line — a prefix
// title ("Blood Channeler Elanarie …") makes the first word unreliable — see the
// per-case extraction in the prompt handler.
const LOOK_START_RE = /^You (?:see|are) [A-Z][^,]*?,.*\ban?\s+[A-Z][A-Za-z' -]*\.?\s*$/
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

// ── Active spell ──────────────────────────────────────────────────────────────
export const activeSpellAtom = atom<string>('')

// ── Timers ────────────────────────────────────────────────────────────────────
export const roundtimeAtom        = atom<number>(0)  // epoch-ms end time of current RT
export const castTimeAtom         = atom<number>(0)
export const tickAtom             = atom<number>(0)  // Updated every second for countdowns
export const roundtimeSecondsAtom = atom(get => {
  get(tickAtom)  // Depend on tick to re-evaluate every second
  return Math.max(0, Math.ceil((get(roundtimeAtom) - Date.now()) / 1000))
})

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
    const preset = command.startsWith(';') ? 'echo-script' : 'echo'
    const line   = mkLine(command, [{ preset }], 'main')
    set(outputLinesAtom, [...get(outputLinesAtom).slice(-4999), line])
    // Pre-open the exp batch on the command itself, not the first matching report
    // line — a report with zero active skills never matches at all, so waiting
    // for a match to start the batch meant it could never close (never clearing).
    if (command.trim().toLowerCase() === 'exp') {
      _expBatchNames  = new Set()
      _silentExpBatch = false  // manual send wins over any pending background poll
    }
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
  set(lichMsgAtom, [])
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
  set(roundtimeAtom, 0)
  set(castTimeAtom, 0)
  set(profilesAtom, {})
  set(selfNameAtom, '')
  set(serverAvatarsAtom, {})
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
  _expBatchNames     = null
  _silentExpBatch    = false
})

// ── Dispatch ──────────────────────────────────────────────────────────────────
export const dispatchGameEventAtom = atom(
  null,
  (get, set, event: GameEvent) => {
    switch (event.type) {

      case 'text': {
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
            // Lich script output — append to lich log, don't show in game panel
            set(lichMsgAtom, [...get(lichMsgAtom).slice(-499), event.text])
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
              set(outputLinesAtom, appendDedup(get(outputLinesAtom), line, 5000))
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
              } else {
                set(outputLinesAtom, appendDedup(get(outputLinesAtom), line, 5000))
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

      case 'prompt':
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
          const name = _lookSelf
            ? (_lookBuf[0].match(/^You are ([A-Z][\w'-]+)/)?.[1] ?? '')
            : (_lookBuf[1]?.match(/^([A-Z][\w'-]+)/)?.[1]
               ?? _lookBuf[0].match(/^You see ([A-Z][\w'-]+)/)?.[1] ?? '')
          set(outputLinesAtom, [...get(outputLinesAtom).slice(-4999), {
            id: lineId++, text: _lookBuf.join('\n'), styles: [], stream: 'main' as StreamId,
            timestamp: Date.now(), look: { name, lines: _lookBuf },
          }])
          _outputDirty = true
          _lookCapturing = false; _lookSelf = false; _lookBuf = []
        }
        // Space out consecutive command-response chunks: if new content landed in
        // the main output since the last prompt, flush a separator (blank line).
        if (_outputDirty) {
          set(outputLinesAtom, [...get(outputLinesAtom).slice(-4999), mkSeparator()])
          _outputDirty = false
        }
        break
    }
  }
)
