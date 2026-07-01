import { atom } from 'jotai'
import type { GameEvent, LinkSpan, TextStyle, VitalField, StreamId } from '../lib/sge-parser'
import { parseExpSkills } from '../lib/exp-parser'

export type { StreamId }

// ── Connection ────────────────────────────────────────────────────────────────
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export const connectionStatusAtom = atom<ConnectionStatus>('disconnected')

// ── Output lines ──────────────────────────────────────────────────────────────
export interface OutputLine {
  id:        number
  text:      string
  styles:    TextStyle[]
  stream:    StreamId
  timestamp: number
  links?:    LinkSpan[]
}

let lineId = 0
const mkLine = (text: string, styles: OutputLine['styles'], stream: StreamId, links?: LinkSpan[]): OutputLine => ({
  id: lineId++, text, styles, stream, timestamp: Date.now(), links
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

// ── Active spell ──────────────────────────────────────────────────────────────
export const activeSpellAtom = atom<string>('')

// ── Timers ────────────────────────────────────────────────────────────────────
export const roundtimeAtom        = atom<number>(0)
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
    if (command.trim().toLowerCase() === 'exp') _expBatchNames = new Set()
  }
)

// ── Dispatch ──────────────────────────────────────────────────────────────────
export const dispatchGameEventAtom = atom(
  null,
  (get, set, event: GameEvent) => {
    switch (event.type) {

      case 'text': {
        const line = mkLine(event.text, event.styles, event.stream, event.links)

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
            set(combatLinesAtom, [...get(combatLinesAtom).slice(-499), line])
            set(outputLinesAtom, [...get(outputLinesAtom).slice(-4999), line])
            break
          case 'atmo':
            set(atmoLinesAtom, [...get(atmoLinesAtom).slice(-199), line])
            // Don't echo atmo to main output — it clutters it
            break
          case 'speech': {
            const isSpeech = line.styles.some(s => ['speech','whisper','thought'].includes(s.preset ?? ''))
            const isScript = /^\S+:\s/.test(line.text) || /\.lic\b/.test(line.text)
            if (isSpeech && /"/.test(line.text) && !isScript) {
              set(convLinesAtom, appendDedup(get(convLinesAtom), line, 200))
            } else {
              set(outputLinesAtom, appendDedup(get(outputLinesAtom), line, 5000))
            }
            break
          }
          default: {
            const isHandUpdate = event.styles.some(s => s.preset === 'left' || s.preset === 'right')
            if (!isHandUpdate) {
              set(outputLinesAtom, appendDedup(get(outputLinesAtom), line, 5000))
              const DEATH_RE = /\*\s+.+?\s+(was struck down|was slain|was killed|died|perished|succumbed|fell lifeless)|you have died|you are dead/i
              if (DEATH_RE.test(event.text)) {
                set(deathsAtom, [...get(deathsAtom).slice(-199), line])
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
                skills: exp.skills.map(s => {
                  if (seen.has(s.name)) return s
                  const cap = s.mind.split('/')[1]  // preserve known capacity, e.g. "0/900"
                  return { ...s, pct: 0, mind: cap ? `0/${cap}` : '', mindWord: 'clear' }
                }),
              })
              _expBatchNames = null
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
          set(convLinesAtom, appendDedup(get(convLinesAtom), line, 200))
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
    }
  }
)
