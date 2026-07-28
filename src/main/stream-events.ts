/**
 * Structured event extraction for the log sidecar.
 *
 * WHY THIS ISN'T sge-parser. The renderer's parser (src/renderer/src/lib/sge-parser.ts)
 * already understands all of this, but it keeps its ~25 pieces of stream state in
 * MODULE-level variables — one implicit parser per module, which is exactly right for
 * a renderer that drives a single game connection, and unusable in the headless server
 * where one process runs many sessions concurrently. Two sessions feeding one shared
 * `_inExpSkill` would attribute one character's experience to another's log.
 *
 * So this is a small, per-instance extractor that reads only the structured events a
 * durable log needs, and none of the presentation logic (stream routing, suppression,
 * mono mode, inventory dumps) that the module state actually exists to serve. It is
 * ~90 lines against the parser's ~850 precisely because it isn't trying to render
 * anything.
 *
 * The duplication is real but narrow: the two exp/room shapes below are the same ones
 * sge-parser matches, and they're covered by tests on both sides. If sge-parser is
 * ever made instantiable — which it would need to be to ship as a package — this
 * should collapse into it and become a thin filter over GameEvent.
 */

export type StreamEvent =
  /** A skill's experience changed. `pool` is the mind-state fraction, e.g. "1/34". */
  | { t: number; e: 'exp';  skill: string; rank: number; pct: number; pool?: string; mind?: string }
  /** The character moved. */
  | { t: number; e: 'room'; name: string }
  /** The TDP/favor line from the experience window. */
  | { t: number; e: 'tdp';  tdps?: number; favors?: number }
  /** Written once when a log file is opened, so a reader knows what it's holding. */
  | { t: number; e: 'session'; char: string; version: number }

/** Bump when the event shape changes in a way readers must notice. */
export const EVENT_FORMAT_VERSION = 1

// Same shapes sge-parser matches — "     Aug:  305 66%  [ 1/34]" and the trailing
// "TDPs: 3348  Favors: 50" line that shares the exp component.
const EXP_RE   = /:?\s*(\d+)\s+(\d+)%\s+(?:([a-zA-Z][a-zA-Z ]*?)\s+)?[[(]\s*(\d+\/\d+)\s*[\])]/
const TDP_RE   = /TDPs?:\s*(\d+)/i
const FAVOR_RE = /Favors?:\s*(\d+)/i
// Attribute values are matched to their OWN closing quote via a backreference, not to
// "any quote". DR is full of apostrophes — Vela'Tohr Woods, Ain Ghazal, Mo'ur — and a
// naive [^'"]* stops dead at the first one, so subtitle=" - [Vela'Tohr Woods, Blighted
// Tangle]" silently became " - [Vela". Room names were being truncated mid-word.
const ID_RE       = /\bid=(['"])(.*?)\1/i
const SUBTITLE_RE = /\bsubtitle=(['"])(.*?)\1/i

/**
 * `exp`-prefixed component ids that are NOT skills. The experience window carries a
 * few summary rows alongside the skills; `favor` and `tdp` are read as totals below,
 * and the others hold prose or nothing at all.
 */
const NON_SKILL_EXP_IDS = new Set(['tdp', 'favor', 'rexp', 'sleep'])

/** Longest tag fragment we'll hold across reads before deciding it isn't a tag. */
const MAX_PENDING = 4096

/**
 * Strip a room title down to its name.
 *
 * DR sends "[Crossing, Town Square]". Lich, acting as proxy, appends its own room id:
 * "[Kaal Utewg, Old Growth] (4219310)", or "(**)" when it can't identify the room. The
 * closing bracket is therefore NOT at the end of the string, so trimming a trailing "]"
 * leaves the id and half the punctuation attached — room names read as
 * "Kaal Utewg, Old Growth] (4219310)" and the same room logged through Lich and
 * through Magiloom would count as two different places.
 */
function cleanRoomName(raw: string): string {
  return raw.trim()
    .replace(/^\[/, '')
    .replace(/\]\s*(?:\(\s*(?:\d+|\*+)\s*\))?\s*$/, '')
    .trim()
}

function decodeEntities(s: string): string {
  return s.replace(/&gt;/g, '>').replace(/&lt;/g, '<')
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .replace(/&amp;/g, '&')
}

/**
 * Feed raw stream chunks in, get structured events out. One instance per game
 * connection — it carries the little state needed to span a component that arrives
 * split across two socket reads.
 */
export class StreamEventExtractor {
  private expSkill = ''      // non-empty while inside <component id='exp X'>
  private expIsSkill = true  // false for the summary rows (tdp, favor, rexp, sleep)
  private inRoom   = false   // inside <component id='room name'>
  private buf      = ''      // text collected inside whichever of those is open
  private pending  = ''      // a trailing fragment of a tag split across reads
  private lastRoom = ''      // dedup — see the streamWindow note in handleTag

  /** Drop all partial state — call when the connection resets. */
  reset(): void {
    this.expSkill = ''
    this.expIsSkill = true
    this.inRoom = false
    this.buf = ''
    this.pending = ''
    this.lastRoom = ''
  }

  /**
   * Extract events from one raw chunk. `now` is injectable so tests don't depend on
   * the wall clock. Never throws: a malformed chunk yields no events rather than
   * breaking the game loop it's called from.
   */
  feed(chunk: string, now: number = Date.now()): StreamEvent[] {
    const events: StreamEvent[] = []
    const capturing = (): boolean => this.expSkill !== '' || this.inRoom

    // A socket read can end anywhere, including halfway through "<component id=…".
    // Anything after a final unclosed '<' is held back and prepended to the next
    // chunk, so a tag split across two reads is still seen as one tag.
    let text = this.pending + chunk
    this.pending = ''
    const lastOpen = text.lastIndexOf('<')
    if (lastOpen !== -1 && text.indexOf('>', lastOpen) === -1) {
      const fragment = text.slice(lastOpen)
      // Don't hold a fragment forever: a stray '<' in text that never closes would
      // otherwise swallow the rest of the session. DR escapes real angle brackets as
      // &lt;, so a long unclosed run means it wasn't a tag — treat it as text.
      if (fragment.length <= MAX_PENDING) {
        this.pending = fragment
        text = text.slice(0, lastOpen)
      }
    }

    const tag = /<[^>]*>/g
    let pos = 0
    let m: RegExpExecArray | null

    while ((m = tag.exec(text)) !== null) {
      if (capturing()) this.buf += text.slice(pos, m.index)
      pos = tag.lastIndex
      this.handleTag(m[0], now, events)
    }
    if (capturing()) this.buf += text.slice(pos)

    return events
  }

  private handleTag(raw: string, now: number, out: StreamEvent[]): void {
    const closing = raw.startsWith('</')
    const name = (closing ? raw.slice(2) : raw.slice(1)).match(/^[a-zA-Z][\w:-]*/)?.[0]?.toLowerCase()

    // ── Room name, the way DR actually sends it ─────────────────────────────────
    // The primary source is an ATTRIBUTE — <streamWindow id='room' subtitle=' - [Crossing,
    // Town Square]'> — not element text. That distinction is the whole reason the sidecar
    // has to exist for rooms: flattening the stream to text deletes attributes outright,
    // so a room name never appears in the text log at all and nothing can recover it
    // afterwards. The same subtitle rides both the id='main' and id='room' windows, so
    // emit only on change (mirroring sge-parser's _lastRoomName).
    if (name === 'streamwindow' && !closing) {
      const subtitle = decodeEntities(SUBTITLE_RE.exec(raw)?.[2] ?? '')
      if (subtitle.startsWith(' - ')) {
        const room = cleanRoomName(subtitle.slice(3))
        if (room && room !== this.lastRoom) {
          this.lastRoom = room
          out.push({ t: now, e: 'room', name: room })
        }
      }
      return
    }

    if (name !== 'component') return

    if (closing) {
      const text = decodeEntities(this.buf).replace(/[\r\n]+/g, ' ').trim()

      if (this.expSkill) {
        const skill = this.expSkill
        this.expSkill = ''
        this.buf = ''
        const em = this.expIsSkill ? EXP_RE.exec(text) : null
        if (em) {
          out.push({
            t: now, e: 'exp', skill,
            rank: +em[1], pct: +em[2],
            mind: em[3]?.trim() || undefined,
            pool: em[4],
          })
          return
        }
        // The same component carries the TDP/favor summary line.
        const tm = TDP_RE.exec(text), fm = FAVOR_RE.exec(text)
        if (tm || fm) {
          out.push({
            t: now, e: 'tdp',
            tdps:   tm ? +tm[1] : undefined,
            favors: fm ? +fm[1] : undefined,
          })
        }
        return
      }

      if (this.inRoom) {
        this.inRoom = false
        this.buf = ''
        // The secondary source: <component id='room name'>[Crossing, Town Square]</component>.
        // Deduped against the streamWindow subtitle above, since a single move can
        // deliver the name both ways and that would count as two visits.
        const stripped = cleanRoomName(text)
        if (stripped && stripped !== this.lastRoom) {
          this.lastRoom = stripped
          out.push({ t: now, e: 'room', name: stripped })
        }
      }
      return
    }

    // Opening <component>: start capturing only for the two ids we care about, and
    // close out any component still open (a missing </component> must not make the
    // buffer grow without bound).
    const id = (ID_RE.exec(raw)?.[2] ?? '').trim()
    this.expSkill = ''
    this.inRoom = false
    this.buf = ''
    if (/^exp\s+/i.test(id)) {
      const name = id.replace(/^exp\s+/i, '').trim()
      // `exp tdp` and `exp favor` still need capturing — they carry the totals — but
      // they must never be reported as a skill named "tdp".
      this.expSkill = name
      this.expIsSkill = !NON_SKILL_EXP_IDS.has(name.toLowerCase())
    }
    else if (id.toLowerCase() === 'room name') this.inRoom = true
  }
}

/** Serialize events as JSON Lines — one self-contained object per line. */
export function toJsonl(events: StreamEvent[]): string {
  return events.map(e => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '')
}

/**
 * Read a sidecar back. Tolerant by design: a log can be truncated mid-line by a
 * tail-read or by a crash, and one unparseable line is no reason to lose the rest.
 */
export function parseJsonl(content: string): StreamEvent[] {
  const out: StreamEvent[] = []
  for (const line of content.split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue
    try {
      const v = JSON.parse(s) as StreamEvent
      if (v && typeof v === 'object' && typeof (v as { t?: unknown }).t === 'number') out.push(v)
    } catch { /* skip a partial or corrupt line */ }
  }
  return out
}

/**
 * Strip XML tags and decode the few entities DR uses, yielding plain visible lines.
 * Every tag becomes a line break — which is what makes the text log readable, and also
 * what throws the attributes away (see the room-name note above).
 *
 * Lives here rather than in log-store because it is pure string handling: log-store
 * imports fs and path, and importing this from there pulled node built-ins into the
 * browser bundle that reads Lich logs.
 */
export function stripToLines(rawChunk: string): string[] {
  return rawChunk
    .replace(/<[^>]+>/g, '\n')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .split('\n')
}
