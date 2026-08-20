/**
 * SGE stream parser for DragonRealms / Lich StormFront protocol.
 *
 * Key tag patterns:
 *   <component id='exp SkillName'><preset id='whisper'><d cmd='skill X'>Abbr</d>: rank% [mind]</preset></component>
 *   <component id='room desc'>...</component>
 *   <component id='room exits'>...</component>
 *   <pushStream id='combat'/> ... </stream>
 *   <pushStream id='atmo'/>   ... </stream>
 *   <d cmd='go north'>north</d>   — clickable link
 */

export type StreamId = 'main' | 'exp' | 'combat' | 'atmo' | 'inv' | 'familiar' | 'speech' | 'thoughts' | 'lich'

export interface TextStyle {
  bold?:   boolean
  color?:  string
  preset?: string
}

export interface LinkSpan {
  text: string
  cmd:  string
}

/**
 * One `<inventoryManager>` response, still in raw attribute form.
 *
 * The parser's job stops at "these tags arrived, here are their attributes" —
 * typing, validating and assembling the item tree is lib/inventory.ts, which can be
 * tested without feeding it XML. A big inventory answers across several envelopes:
 * each `<continuation>` is a cursor to re-request, and `state` is set when the
 * server refuses (`stale`) or the response was cut short (`malformed`, ours).
 */
/**
 * One `<image>` inside an injuries dialog. Beyond the `name` severity token, the
 * server may hand us a `scar` rank in its own attribute (which wins over `name`)
 * and a `cmd` — the exact game command for acting on that location. Preferring
 * the server's own command beats guessing one client-side.
 */
export interface InjuryImage {
  id:    string
  name:  string
  scar?: string
  cmd?:  string
}

export interface InvEnvelope {
  id:     string
  room:   string
  root?:  string
  after?: string
  state?: string
  items:         Record<string, string>[]
  continuations: Record<string, string>[]
}

export type GameEvent =
  | { type: 'text';      text: string;   styles: TextStyle[]; stream: StreamId; links?: LinkSpan[]; bolds?: string[] }
  | { type: 'roomName';  name: string }
  | { type: 'roomId';    uid: string }
  | { type: 'roomDesc';  description: string }
  | { type: 'roomExits'; exits: string[] }
  | { type: 'roomObjs';  objs: string }
  | { type: 'roomPlayers'; players: string }
  | { type: 'playerArrived'; player: string }
  | { type: 'playerDeparted'; player: string }
  | { type: 'expSkill';  name: string; rank: number; pct: number; mind: string; mindWord?: string }
  | { type: 'expClear';  name: string }   // empty <component id='exp X'/> — the skill decayed back to clear
  | { type: 'expMeta';   tdps?: number; favors?: number }
  | { type: 'vitals';    field: VitalField; value: number; max?: number; text?: string }
  | { type: 'indicator'; id: string; active: boolean }
  | { type: 'spell';     name: string }
  | { type: 'roundtime'; expires: number }
  | { type: 'cast_time'; expires: number }
  | { type: 'percClear' }   // <clearStream id='percWindow'/> — active-spell list is being refreshed
  // <dialogData id='injuries'> snapshot. `dialogId` distinguishes the character's
  // own window ("injuries") from the per-person windows DR opens for an empath
  // ("injuries<Name>"); `title` carries that window's caption.
  | { type: 'injuries';  images: InjuryImage[]; dialogId: string; title: string }
  | { type: 'inventoryTree'; envelope: InvEnvelope }  // <inventoryManager> — reply to `_inventory manager <id>`
  | { type: 'prompt';    time: number }

export type VitalField = 'health' | 'mana' | 'stamina' | 'spirit'

/**
 * `<pushStream id='…'/>` ids we recognise, mapped onto the streams this client
 * actually keeps. Anything not listed falls back to 'main'.
 *
 * DR does NOT send one tidy `speech` stream: it splits player talk across several
 * ids depending on how the words were produced — `talk` for say/whisper-in-room,
 * `whispers` for directed whispers, and `conversation` for the room-conversation
 * window. All three are the same thing as far as the Conversation panel cares, so
 * they collapse onto 'speech' here. Before this, only the literal `speech` id was
 * recognised and the rest fell through to 'main', which is why whispers and much
 * of ordinary talk never reached the panel at all.
 *
 * `thoughts` is the ESP/amunet network feed and stays its own stream — it's a
 * different conversation from the one happening in the room.
 */
const STREAM_MAP: Record<string, StreamId> = {
  exp:      'exp',
  combat:   'combat',
  atmo:     'atmo',
  inv:      'inv',
  familiar: 'familiar',
  speech:       'speech',
  talk:         'speech',
  whisper:      'speech',
  whispers:     'speech',
  conversation: 'speech',
  thoughts: 'thoughts',
  thought:  'thoughts',
}

/**
 * The two shapes an `<component id='exp Skill'>` body arrives in.
 *
 * The bracketed form — "Athletics:  1,305 66% learning [ 17/34]" — is the usual one;
 * the mindstate word is optional and the fraction may use round brackets. The word
 * form — "Athletics:  1,305 66% learning" — carries no fraction at all and is what
 * the summary rows fall back to. Only the bracketed form was matched before, so a
 * fraction-less push was silently read as a TDP line and dropped.
 *
 * Ranks and totals are matched with commas allowed: DR groups four-digit figures
 * ("TDPs: 3,348"), and a bare \d+ stopped at the comma — turning 3,348 TDPs into 3.
 */
const EXP_COMP_RE      = /:?\s*([\d,]+)\s+(\d+)%\s+(?:([a-zA-Z][a-zA-Z ]*?)\s+)?[[(]\s*(\d+\/\d+)\s*[\])]/
const EXP_COMP_WORD_RE = /:\s*([\d,]+)\s+(\d+)%\s+([a-zA-Z][a-zA-Z ]*?)\s*$/

/** Parse a possibly comma-grouped integer ("3,348" → 3348). */
const num = (s: string): number => parseInt(s.replace(/,/g, ''), 10) || 0

// ── Module-level stream state ──────────────────────────────────────────────────
let _stream:     StreamId = 'main'
let _inRoomDesc  = false
let _inExits     = false
let _inRoomName  = false
let _inRoomObjs  = false
let _inRoomPlayers = false
let _inAlsoHere  = false
let _suppressComp    = false  // swallow room objs/players components
let _suppressExits   = false  // suppress plain-text exits after XML exits parsed
let _exitsBuf: string | null = null  // accumulate plain-text "Obvious paths:" across lines
let _alsoHereBuf = ''
let _inExpSkill  = ''    // skill name when inside <component id='exp X'>
let _roomDescBuf = ''
let _roomNameBuf = ''
let _roomExitBuf = ''
let _roomObjsBuf = ''
let _roomPlayersBuf = ''
let _compassDirs: string[] = []
let _preXmlPhase        = true   // true until the first XML line arrives after connect
let _inInitialInventory = false  // suppress initial container dump until --- separator
let _shopDetailBuf = ''  // accumulate SHOP item details across lines
let _monoMode = false    // inside <output class="mono">…<output class=""> — render ASCII verbatim (guild registers, maps, tables)
let _lastRoomName = ''   // dedup: both the id='main' and id='room' streamWindows carry the same subtitle
let _inInjuries  = false // inside an injuries <dialogData> — collecting body-injury <image> tags
let _injuryDialog = ''   // that dialog's id ('injuries' = self, 'injuries<Name>' = someone else)
let _injuryTitle  = ''   // and its caption, which names the person the window is about
let _injuryImages: InjuryImage[] = []
let _invMgr: InvEnvelope | null = null  // inside <inventoryManager> — collecting <i>/<continuation>

export function resetParser(): void {
  _stream             = 'main'
  _inRoomDesc         = false
  _inExits            = false
  _inRoomName         = false
  _inRoomObjs         = false
  _inRoomPlayers      = false
  _inAlsoHere         = false
  _suppressComp       = false
  _suppressExits      = false
  _exitsBuf           = null
  _alsoHereBuf        = ''
  _inExpSkill         = ''
  _roomDescBuf        = ''
  _roomNameBuf        = ''
  _roomExitBuf        = ''
  _roomObjsBuf        = ''
  _roomPlayersBuf     = ''
  _compassDirs        = []
  _preXmlPhase        = true
  _inInitialInventory = false
  _shopDetailBuf      = ''
  _monoMode           = false
  _lastRoomName       = ''
  _inInjuries         = false
  _injuryDialog       = ''
  _injuryTitle        = ''
  _injuryImages       = []
  _invMgr             = null
}

function decodeEntities(s: string): string {
  return s
    .replace(/&gt;/g,   '>')
    .replace(/&lt;/g,   '<')
    .replace(/&amp;/g,  '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
}

function looksLikeNpcList(text: string): boolean {
  const stripped = text.replace(/^(You also see|Also here:)\s*/i, '').trim()
  return /^(a|an|the)\s+/i.test(stripped)
}

const TAG_RE = /<([^>]+)>|([^<]+)/g

export function parseLine(raw: string): GameEvent[] {
  const events: GameEvent[] = []
  let styles: TextStyle[]   = []
  let buf    = ''
  let links: LinkSpan[]     = []
  let inLink = false
  let linkCmd = ''
  let linkBuf = ''
  // Inline bold (<pushBold>/<bold>): accumulate the emphasized substring so it
  // stays on the same line as its surrounding text (like links do), instead of
  // flushing and splitting the sentence across separate output lines.
  let bolds: string[] = []
  let inBold  = false
  let boldBuf = ''

  const flush = (forcePreset?: string) => {
    // Inside an exp component the buf must survive intermediate style tags
    // (</preset>, </bold>, etc.) so /component can parse the full abbrev+data.
    // The <d> link text has already been appended to buf via buf+=linkBuf in </d>,
    // so we only need to discard the stale link ref.
    if (_inExpSkill) { links = []; bolds = []; return }
    // An inventory response is data, never output. Its <i/> tags are self-closing so
    // there is normally nothing to swallow, but a stray text node inside the envelope
    // must not reach the game window.
    if (_invMgr) { buf = ''; links = []; bolds = []; return }

    const text = buf.replace(/[\r\n]+/g, ' ').replace(/  +/g, ' ').trim()
    buf = ''
    if (!text || text === '>') return
    const s  = forcePreset ? [{ preset: forcePreset }] : [...styles]
    const ls = links.length > 0 ? [...links] : undefined
    links = []
    const bs = bolds.length > 0 ? [...bolds] : undefined
    bolds = []

    // Handle SHOP item detail buffering
    const isShopDetail = /(Short|Tap|Worn|Cost|Look|Read):/i.test(text)
    if (_shopDetailBuf) {
      // We're buffering SHOP details
      if (isShopDetail) {
        // Continue buffering
        _shopDetailBuf += '\n' + text
        return
      } else {
        // End of sequence - combine with current text
        const combinedText = _shopDetailBuf + ' ' + text
        _shopDetailBuf = ''
        events.push({ type: 'text', text: combinedText, styles: [], stream: _stream })
        return
      }
    } else if (isShopDetail) {
      // Start buffering
      _shopDetailBuf = text
      return
    }

    // Suppress output when inside special components
    if (_suppressComp)    return  // room objs/players — swallowed
    if (_inInitialInventory || (_preXmlPhase && _stream === 'inv')) { buf = ''; return }
    if (_inRoomDesc) { _roomDescBuf += ' ' + text; return }
    if (_inExits)    { _roomExitBuf += ' ' + text; return }
    if (_inRoomObjs) { _roomObjsBuf += ' ' + text; return }
    if (_inRoomPlayers) { _roomPlayersBuf += ' ' + text; return }
    // Buffer "Also here / You also see" content even when it arrives via the XML path
    // (NPC names are often bold-tagged, so they come through flush() not the plain-text branch)
    if (_inAlsoHere) {
      const trimmed = text.trim()
      _alsoHereBuf += trimmed.startsWith(',') ? trimmed : ' ' + trimmed
      if (/\.$/.test(trimmed) || trimmed === '') {
        const combined = _alsoHereBuf.replace(/[\r\n]+/g, ' ').replace(/  +/g, ' ').trim()
        if (combined) {
          events.push(looksLikeNpcList(combined)
            ? { type: 'roomObjs', objs: combined }
            : { type: 'roomPlayers', players: combined })
          events.push({ type: 'text', text: combined, styles: [], stream: _stream })
        } else {
          events.push({ type: 'roomPlayers', players: '' })
          events.push({ type: 'roomObjs', objs: '' })
        }
        _inAlsoHere = false
        _alsoHereBuf = ''
      }
      return
    }
    const alsoFlushMatch = text.match(/^(You also see|Also here:)\s*(.*)$/i)
    if (alsoFlushMatch) {
      const normalized = text.replace(/[\r\n]+/g, ' ').replace(/  +/g, ' ').trim()
      if (alsoFlushMatch[2].trim()) {
        events.push(looksLikeNpcList(normalized)
          ? { type: 'roomObjs', objs: normalized }
          : { type: 'roomPlayers', players: normalized })
        events.push({ type: 'text', text: normalized, styles: [], stream: _stream })
      } else {
        events.push({ type: 'roomPlayers', players: '' })
        events.push({ type: 'roomObjs', objs: '' })
        _inAlsoHere = true
        _alsoHereBuf = normalized
      }
      return
    }
    // Merge trailing text (e.g. ', "Hello."') onto the previous speech/whisper/thought event
    // so that "You say, "Hello."" appears as one line and is fully captured in conv panel.
    const last = events[events.length - 1]
    const SPEECH_PRESETS = new Set(['speech', 'whisper', 'thought'])
    if (last?.type === 'text' && last.stream === _stream &&
        last.styles.some(st => SPEECH_PRESETS.has(st.preset ?? '')) &&
        !s.some(st => SPEECH_PRESETS.has(st.preset ?? ''))) {
      events[events.length - 1] = {
        ...last,
        text: last.text + text,
        links: ls ? [...(last.links ?? []), ...ls] : last.links
      }
      return
    }
    // The room text render's exits line ("Obvious paths: <d>south</d>.") arrives
    // via the XML path with no preset — style it like the panel exits for parity.
    if (s.length === 0 && /^Obvious\s+paths?\b/i.test(text)) {
      events.push({ type: 'text', text, styles: [{ preset: 'roomexits' }], stream: _stream, links: ls })
      return
    }
    events.push({ type: 'text', text, styles: s, stream: _stream, links: ls, bolds: bs })
  }

  // ── Plain-text line (no XML) ───────────────────────────────────────────────
  if (!raw.includes('<')) {
    // Monospace block (guild/hall registers, maps, ASCII tables): emit verbatim,
    // preserving leading whitespace so the game's ASCII framing stays aligned.
    // Must run before the trim + lich-table routing below, which would otherwise
    // strip the indentation and split the box across streams.
    if (_monoMode) {
      const monoText = decodeEntities(raw).replace(/[\r\n]+$/, '')
      if (monoText.trim()) events.push({ type: 'text', text: monoText, styles: [{ preset: 'mono' }], stream: 'main' })
      return events
    }
    const text = decodeEntities(raw).trim()
    if (!text || text === '>') return events
    if (_inRoomDesc) { _roomDescBuf += ' ' + text; return events }
    if (_inExits)    { _roomExitBuf += ' ' + text; return events }
    if (_inRoomName) { _roomNameBuf += ' ' + text; return events }
    if (_inRoomObjs) { _roomObjsBuf += ' ' + text; return events }
    if (_inRoomPlayers) { _roomPlayersBuf += ' ' + text; return events }

    // Parse player movement messages to update room player list
    const arrivalMatch = text.match(/^(\w+) just arrived(?:\.|!)?$/i)
    if (arrivalMatch) {
      events.push({ type: 'playerArrived', player: arrivalMatch[1] })
    }
    const departureMatch = text.match(/^(\w+) just (?:went|left|departed)(?:\s+\w+)?(?:\.|!)?$/i)
    if (departureMatch) {
      events.push({ type: 'playerDeparted', player: departureMatch[1] })
    }

    if (_inAlsoHere) {
      // Join without extra space when continuation starts with a comma
      const trimmed = text.trim()
      _alsoHereBuf += trimmed.startsWith(',') ? trimmed : ' ' + trimmed
      const complete = /\.$/.test(trimmed) || trimmed === ''
      if (complete) {
        const combined = _alsoHereBuf.replace(/[\r\n]+/g, ' ').replace(/  +/g, ' ').trim()
        if (combined) {
          events.push(looksLikeNpcList(combined)
            ? { type: 'roomObjs', objs: combined }
            : { type: 'roomPlayers', players: combined })
          events.push({ type: 'text', text: combined, styles: [], stream: _stream })
        } else {
          // Empty "Also here:" means no one here
          events.push({ type: 'roomPlayers', players: '' })
          events.push({ type: 'roomObjs', objs: '' })
        }
        _inAlsoHere = false
        _alsoHereBuf = ''
      }
      return events  // never emit continuation lines as individual text events
    } else {
      const alsoMatch = text.match(/^(You also see|Also here:)\s*(.*)$/i)
      if (alsoMatch) {
        const normalized = text.replace(/[\r\n]+/g, ' ').replace(/  +/g, ' ').trim()
        if (alsoMatch[2].trim()) {
          events.push(looksLikeNpcList(normalized)
            ? { type: 'roomObjs', objs: normalized }
            : { type: 'roomPlayers', players: normalized })
          events.push({ type: 'text', text: normalized, styles: [], stream: _stream })
        } else {
          // Empty "Also here:" line means any previous visitor list is gone.
          events.push({ type: 'roomPlayers', players: '' })
          events.push({ type: 'roomObjs', objs: '' })
          _inAlsoHere = true
          _alsoHereBuf = normalized
        }
        return events  // don't fall through to the generic text push below
      }
    }
    // Suppress duplicate plain-text exits (DR sends exits both as XML component and plain text)
    if (_suppressExits && /^obvious\s+paths?/i.test(text)) {
      _suppressExits = false
      return events  // already showed these as clickable links
    }
    _suppressExits = false

    // Accumulate multi-line plain-text exits into one line
    // DR sends: "Obvious paths:\nsouthwest,\nwest." as 3 separate parseLine calls
    if (_exitsBuf !== null) {
      // We're mid-accumulation — append this line
      const trimmed = text.replace(/^[,\s]+/, '').trim()
      if (trimmed) _exitsBuf += (_exitsBuf.endsWith(':') ? ' ' : ', ') + trimmed.replace(/\.$/, '')
      // Done when line ends with "." or has no trailing comma
      if (text.trim().endsWith('.') || !text.trim().endsWith(',')) {
        const joined = _exitsBuf
        _exitsBuf = null
        const DIRS = new Set(['north','south','east','west','northeast','northwest',
          'southeast','southwest','up','down','out','in','ne','nw','se','sw','n','s','e','w'])
        const pathPart = joined.replace(/obvious\s+(?:paths?|exits?)\s*:?\s*/i, '')
        const dirs = pathPart.replace(/[.,]/g, ' ').split(/\s+/)
          .map(d => d.trim().toLowerCase()).filter(d => DIRS.has(d))
        const exitLinks = dirs.map(d => ({ text: d, cmd: d }))
        events.push({
          type: 'text', text: joined,
          styles: [{ preset: 'roomexits' }], stream: 'main' as StreamId,
          links: exitLinks.length > 0 ? exitLinks : undefined
        })
        if (dirs.length > 0) events.push({ type: 'roomExits', exits: dirs })
      }
      return events
    }
    if (/^obvious\s+paths?/i.test(text)) {
      // Start accumulating — strip trailing period, will join continuations
      _exitsBuf = text.replace(/\.$/, '').trim()
      // If already complete (ends with . or contains directions after colon on same line)
      const DIRS = new Set(['north','south','east','west','northeast','northwest',
        'southeast','southwest','up','down','out','in','ne','nw','se','sw','n','s','e','w'])
      const pathPart = _exitsBuf.replace(/obvious\s+(?:paths?|exits?)\s*:?\s*/i, '')
      const dirs = pathPart.replace(/[.,]/g, ' ').split(/\s+/)
        .map(d => d.trim().toLowerCase()).filter(d => DIRS.has(d))
      if (dirs.length > 0 && !text.trim().endsWith(',')) {
        // Complete on one line
        const joined = _exitsBuf
        _exitsBuf = null
        const exitLinks = dirs.map(d => ({ text: d, cmd: d }))
        events.push({
          type: 'text', text: joined,
          styles: [{ preset: 'roomexits' }], stream: 'main' as StreamId,
          links: exitLinks.length > 0 ? exitLinks : undefined
        })
        events.push({ type: 'roomExits', exits: dirs })
      }
      // else keep buffering
      return events
    }

    // Lich's script auto-updater chatter ([lich5-update: …]) — including the GitHub
    // rate-limit 403s the server's datacenter IP hits (harmless, cosmetic) — carries
    // no game value, so drop it entirely rather than echoing it to the output.
    if (/^\[lich\d*-update:/i.test(text)) return events

    // Lich script output — route to lich stream so it can be styled/suppressed
    const lichOutput = (
      /^--- Lich[: ]/.test(text) ||
      /^\[\w[\w-]*:/.test(text) ||           // [scriptname: ...]
      /^\[lich\d*:/.test(text) ||             // [lich5-update: ...]
      /^[+|][-=+|\s]/.test(text)               // ASCII table lines: +---+  | col |  | Title |
    )
    const effectiveStream = lichOutput ? 'lich' as StreamId : _stream
    events.push({ type: 'text', text, styles: [], stream: effectiveStream })
    return events
  }

  // ── XML line ───────────────────────────────────────────────────────────────
  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null

  while ((m = TAG_RE.exec(raw)) !== null) {
    const [, tag, textNode] = m
    if (textNode !== undefined) {
      const decoded = decodeEntities(textNode)
      if (inLink) linkBuf += decoded
      else { buf += decoded; if (inBold) boldBuf += decoded }
      continue
    }
    if (!tag) continue

    const spaceIdx = tag.search(/\s/)
    const rawName  = spaceIdx === -1 ? tag : tag.slice(0, spaceIdx)
    const tagName  = rawName.toLowerCase().replace(/\/$/, '')
    const isClose  = tagName.startsWith('/')
    const attrs    = parseAttrs(tag)

    switch (tagName) {

      // ── Clickable link: <d cmd='go north'>north</d> or bare <d>north</d> ──
      case 'd': {
        // No flush here — keeps the link inline with surrounding text so that
        // lines like "Obvious paths: <d>sw</d>, <d>w</d>" stay on one line.
        inLink  = true
        linkCmd = attrs['cmd'] ?? ''
        linkBuf = ''
        break
      }
      case '/d': {
        if (inLink && linkBuf.trim()) {
          const cmd = linkCmd || linkBuf.trim()
          links.push({ text: linkBuf.trim(), cmd })
          buf += linkBuf
        }
        inLink  = false
        linkCmd = ''
        linkBuf = ''
        break
      }

      // ── Component: exp, room desc, room exits ─────────────────────────────
      case 'component': {
        flush()
        const id = (attrs['id'] ?? '').toLowerCase()
        if (id.startsWith('exp ')) {
          const skill = (attrs['id'] ?? '').slice(4).trim()  // preserve case
          // A self-closing component has no body and no </component> to close it.
          // Emit the clear here and stay closed — leaving _inExpSkill set would
          // make the NEXT component's body get read as this skill's exp.
          if (tag.trimEnd().endsWith('/')) events.push({ type: 'expClear', name: skill })
          else _inExpSkill = skill
        } else if (id === 'room desc') {
          _inRoomDesc  = true
          _roomDescBuf = ''
          styles = [{ preset: 'roomdesc' }]
        } else if (id === 'room exits') {
          _inExits     = true
          _roomExitBuf = ''
          styles = [{ preset: 'roomexits' }]
        } else if (id === 'room name') {
          _inRoomName  = true
          _roomNameBuf = ''
          styles = []
        } else if (id === 'room objs') {
          _inRoomObjs  = true
          _roomObjsBuf = ''
          styles = []
        } else if (id === 'room players') {
          _inRoomPlayers  = true
          _roomPlayersBuf = ''
          styles = []
        } else {
          styles = []
        }
        break
      }
      case '/component': {
        if (_inExpSkill) {
          // Parse: "     Aug:  305 66%  [ 1/34]"  (abbr already in buf)
          const raw2 = buf.replace(/[\r\n]+/g, ' ').trim()
          buf = ''
          const sm = raw2.match(EXP_COMP_RE)
          const wm = sm ? null : raw2.match(EXP_COMP_WORD_RE)
          if (sm) {
            events.push({
              type:     'expSkill',
              name:     _inExpSkill,
              rank:     num(sm[1]),
              pct:      parseInt(sm[2]),
              mindWord: sm[3]?.trim(),
              mind:     sm[4],
            })
          } else if (wm) {
            events.push({
              type:     'expSkill',
              name:     _inExpSkill,
              rank:     num(wm[1]),
              pct:      parseInt(wm[2]),
              mindWord: wm[3].trim(),
              mind:     '',
            })
          } else if (!raw2) {
            // An exp component with no body at all is how DR says "this skill has
            // decayed back to clear" — there is no 0% push to match. Without this
            // the panel kept showing whatever the skill last learned, forever.
            // (Only <component> is treated this way. <compDef> is the window's
            // empty-by-design declaration and never reaches here — it isn't parsed.)
            events.push({ type: 'expClear', name: _inExpSkill })
          } else {
            // TDP / favor line: "TDPs: 3,348  Favors: 50"
            const tdpM = raw2.match(/TDPs?:\s*([\d,]+)/i)
            const favM = raw2.match(/Favors?:\s*([\d,]+)/i)
            if (tdpM || favM) {
              events.push({
                type:   'expMeta',
                tdps:   tdpM ? num(tdpM[1]) : undefined,
                favors: favM ? num(favM[1]) : undefined,
              })
            }
          }
          _inExpSkill = ''
          styles = []
          links  = []
        } else if (_suppressComp) {
          buf = ''
          _suppressComp = false
          styles = []
        } else if (_inRoomDesc) {
          const raw3 = (_roomDescBuf + ' ' + buf).replace(/[\r\n]+/g, ' ').replace(/  +/g, ' ').trim()
          buf = ''
          _roomDescBuf = ''
          _inRoomDesc  = false
          if (raw3) {
            events.push({ type: 'roomDesc', description: raw3 })
          }
          styles = []
        } else if (_inExits) {
          const raw2 = (_roomExitBuf + ' ' + buf).replace(/[\r\n,.]+/g, ' ').replace(/  +/g, ' ').trim()
          buf = ''
          _roomExitBuf = ''
          _inExits     = false
          if (raw2) {
            const exitLinks = links.filter(l => l.cmd.startsWith('go '))
            links = []
            const DIRS = new Set(['north','south','east','west','northeast','northwest',
              'southeast','southwest','up','down','out','in','ne','nw','se','sw','n','s','e','w'])
            const pathPart = raw2.replace(/obvious\s+(?:paths?|exits?)\s*:?\s*/i, '')
            const textExits = pathPart.split(/[\s,.]+/).map(e => e.trim().toLowerCase()).filter(e => DIRS.has(e))
            const allExits  = exitLinks.length > 0
              ? exitLinks.map(l => l.cmd.replace('go ', ''))
              : textExits
            events.push({ type: 'roomExits', exits: allExits })
            // Feed the room panel only. The flowing text render that follows
            // (the trailing "Obvious paths: <d>…</d>." line) supplies the single
            // scroll line, in natural order after the name/desc/objs. Emitting a
            // line here too would show exits twice and above the room name.
            _suppressExits = true  // suppress any plain-text exits duplicate
          }
          styles = []
        } else if (_inRoomObjs) {
          const raw = (_roomObjsBuf + ' ' + buf).replace(/[\r\n]+/g, ' ').replace(/  +/g, ' ').trim()
          buf = ''
          _roomObjsBuf = ''
          _inRoomObjs  = false
          if (raw) {
            events.push({ type: 'roomObjs', objs: raw })
          }
          styles = []
        } else if (_inRoomPlayers) {
          const raw = (_roomPlayersBuf + ' ' + buf).replace(/[\r\n]+/g, ' ').replace(/  +/g, ' ').trim()
          buf = ''
          _roomPlayersBuf = ''
          _inRoomPlayers  = false
          // Always emit roomPlayers event, even if empty (to clear the list)
          events.push({ type: 'roomPlayers', players: raw })
          styles = []
        } else if (_inRoomName) {
          const raw = (_roomNameBuf + ' ' + buf).replace(/[\r\n]+/g, ' ').replace(/  +/g, ' ').trim()
          buf = ''
          _roomNameBuf = ''
          _inRoomName = false
          if (raw) {
            events.push({ type: 'roomName', name: raw })
          }
          styles = []
        } else {
          flush()
          styles = []
        }
        break
      }

      // ── Structured inventory — the reply to `_inventory manager <id>` ────
      // <inventoryManager id room [root] [after] [state]>
      //   <i id loc name weight [long] [encum] [in_max] [on_max] [in_selector] [flags] …/>
      //   <continuation root last/>
      // </inventoryManager>
      // Nothing here is output; the whole envelope is handed to lib/inventory.ts.
      case 'inventorymanager': {
        flush()
        const env: InvEnvelope = {
          id:    attrs['id']   ?? '',
          room:  attrs['room'] ?? '',
          ...(attrs['root']  != null ? { root:  attrs['root']  } : {}),
          ...(attrs['after'] != null ? { after: attrs['after'] } : {}),
          ...(attrs['state'] != null ? { state: attrs['state'] } : {}),
          items: [],
          continuations: [],
        }
        // A refused request (state='stale') comes back as a self-closing tag with
        // no body, so there is nothing to collect — emit it and stay closed.
        if (tag.trimEnd().endsWith('/')) events.push({ type: 'inventoryTree', envelope: env })
        else _invMgr = env
        break
      }
      // <i> is only an item inside the envelope — elsewhere it's inline emphasis.
      case 'i':
        if (_invMgr) _invMgr.items.push(attrs)
        break
      case 'continuation':
        if (_invMgr) _invMgr.continuations.push(attrs)
        break
      case '/inventorymanager':
        if (_invMgr) { events.push({ type: 'inventoryTree', envelope: _invMgr }); _invMgr = null }
        buf = ''
        break

      // ── Inline inventory tags (<clearContainer/> + <inv>) ────────────────
      case 'clearcontainer':
        flush()
        events.push({ type: 'text', text: '__clear_inv__', styles: [], stream: 'inv' })
        break
      case 'inv':
        flush()
        _stream = 'inv'
        break
      case '/inv':
        flush()
        _stream = 'main'
        break

      // ── Stream switching ──────────────────────────────────────────────────
      case 'clearstream': {
        flush()
        // clearStream resets a side panel — emit a special event handled in store.
        const csId = (attrs['id'] ?? '').toLowerCase()
        if (csId === 'inv') {
          events.push({ type: 'text', text: '__clear_inv__', styles: [], stream: 'inv' })
        } else if (csId === 'percwindow') {
          // DR refreshes the active-spell list ("Name (N roisaen)" lines that
          // follow) after clearing it. Signal a fresh snapshot is starting.
          events.push({ type: 'percClear' })
        }
        break
      }
      case 'pushstream': {
        flush()
        const id = (attrs['id'] ?? '').toLowerCase()
        _stream = STREAM_MAP[id] ?? 'main'
        if (_preXmlPhase && _stream === 'inv') _inInitialInventory = true
        break
      }
      case '/stream':
      case 'popstream':
        flush()
        _stream = 'main'
        break

      // ── Room name ─────────────────────────────────────────────────────────
      case 'roomname':
        flush(); styles = [{ preset: 'roomname' }]
        break
      case '/roomname': {
        const name = buf.trim(); buf = ''
        styles = []
        if (name) {
          events.push({ type: 'roomName', name })
          // Don't emit as text — room panel handles display
        }
        break
      }

      // ── Vitals ────────────────────────────────────────────────────────────
      case 'vitals': {
        // <vitals health="83" mana="95" stamina="100" spirit="100" encumbrance="3"/>
        flush()
        const validFields: VitalField[] = ['health','mana','stamina','spirit']
        for (const f of validFields) {
          if (attrs[f] !== undefined)
            events.push({ type: 'vitals', field: f, value: parseInt(attrs[f], 10), max: undefined })
        }
        break
      }
      case 'stat': {
        // <stat name="health" value="85" max="150"/> — includes real max
        flush()
        const field = ((attrs['name'] ?? attrs['id'] ?? attrs['type']) ?? '').toLowerCase() as VitalField
        const val   = parseInt(attrs['value'] ?? '0', 10)
        const max   = attrs['max'] !== undefined ? parseInt(attrs['max'], 10) : undefined
        const text  = attrs['text']
        const valid: VitalField[] = ['health','mana','stamina','spirit']
        if (valid.includes(field)) events.push({ type: 'vitals', field, value: val, max, text })
        break
      }

      // ── Progress bars inside <dialogData> — carries HP/MP/etc as 0-100 pct ─
      case 'progressbar': {
        flush()
        const id    = (attrs['id'] ?? '').toLowerCase()
        const value = parseInt(attrs['value'] ?? '0', 10)
        const VITAL_MAP: Record<string, VitalField> = {
          health:        'health',  health2:        'health',
          mana:          'mana',    mana2:          'mana',    concentration: 'mana',
          stamina:       'stamina', stamina2:       'stamina', fatigue:       'stamina', fatigue2: 'stamina',
          spirit:        'spirit',  spirit2:        'spirit',
        }
        const field = VITAL_MAP[id]
        if (field) events.push({ type: 'vitals', field, value, max: 100, text: attrs['text'] })
        break
      }

      // ── Compass: <compass><dir value="sw"/>...</compass> ──────────────────
      case 'compass':
        flush()
        _compassDirs = []
        break
      case 'dir':
        if (attrs['value']) _compassDirs.push(attrs['value'].toLowerCase())
        break
      case '/compass': {
        flush()
        if (_compassDirs.length > 0) {
          const EXPAND: Record<string, string> = {
            n:'north', s:'south', e:'east', w:'west',
            ne:'northeast', nw:'northwest', se:'southeast', sw:'southwest',
            u:'up', d:'down', out:'out', in:'in',
          }
          events.push({ type: 'roomExits', exits: _compassDirs.map(d => EXPAND[d] ?? d) })
        }
        _compassDirs = []
        break
      }

      // ── Indicator ─────────────────────────────────────────────────────────
      case 'indicator': {
        flush()
        const indId = (attrs['id'] ?? '').replace(/^Icon/, '').toLowerCase()
        events.push({ type: 'indicator', id: indId, active: attrs['visible'] === 'y' })
        break
      }

      // ── Spell ─────────────────────────────────────────────────────────────
      case 'spell':
        flush(); buf = ''; break
      case '/spell':
        if (buf.trim()) events.push({ type: 'spell', name: buf.trim() })
        buf = ''; styles = []; break

      // ── Timers ────────────────────────────────────────────────────────────
      case 'roundtime':
        flush()
        events.push({ type: 'roundtime', expires: parseInt(attrs['value'] ?? '0', 10) * 1000 })
        break
      case 'casttime':
        flush()
        events.push({ type: 'cast_time', expires: parseInt(attrs['value'] ?? '0', 10) * 1000 })
        break

      // ── Prompt ────────────────────────────────────────────────────────────
      case 'prompt':
        // A prompt while collecting an inventory envelope means the response ended
        // without its close tag. Hand over what arrived, flagged, rather than
        // holding a half-built tree open until the next response confuses it.
        if (_invMgr) {
          events.push({ type: 'inventoryTree', envelope: { ..._invMgr, state: 'malformed' } })
          _invMgr = null
        }
        flush()
        _preXmlPhase = false
        _inInitialInventory = false
        // A prompt ends the current server message. DR opens streams with
        // <pushStream id="combat"/> etc. but never sends a matching popStream, so
        // without this reset the stream would stay stuck (e.g. every line after a
        // combat hit — room arrivals, prompts — would keep routing to combat).
        _stream = 'main'
        events.push({ type: 'prompt', time: parseInt(attrs['time'] ?? '0', 10) })
        break
      case '/prompt':
        // Discard the prompt indicator text (">", "R>", etc.) — it's a UI marker,
        // not output. (Only bare ">" was being dropped by flush() before.)
        buf = ''
        break

      // ── Styled text ───────────────────────────────────────────────────────
      case 'preset':  flush(); styles = attrs['id'] ? [{ preset: attrs['id'] }] : []; break
      case '/preset': flush(); styles = []; break
      case 'style':   flush(); styles = attrs['id'] ? [{ preset: attrs['id'] }] : []; break
      case '/style':  flush(); styles = []; break
      case 'color':   flush(); styles = attrs['fg'] ? [{ color: attrs['fg'] }] : []; break
      case '/color':  flush(); styles = []; break
      // Bold is inline emphasis (creatures, nouns) — keep it on the same line as
      // its surrounding text by accumulating the substring rather than flushing.
      case 'bold':
      case 'pushbold':
        inBold = true; boldBuf = ''; break
      case '/bold':
      case 'popbold':
      case '/pushbold': {
        const b = boldBuf.replace(/[\r\n]+/g, ' ').replace(/  +/g, ' ').trim()
        if (inBold && b) bolds.push(b)
        inBold = false; boldBuf = ''; break
      }

      // ── Container inventory dump — suppress from main output always ──────────
      case 'exposecontainer': {
        flush()
        _inInitialInventory = true
        break
      }
      case 'container': {
        flush()
        _inInitialInventory = true
        break
      }
      case '/container': {
        buf = ''
        styles = []
        // During login, stay suppressed until <prompt>; during gameplay, clear now
        if (!_preXmlPhase) _inInitialInventory = false
        break
      }

      // ── Stream window (contains room name in subtitle) ────────────────────
      case 'streamwindow': {
        flush()
        const subtitle = attrs['subtitle'] ?? ''
        if (subtitle.startsWith(' - ')) {
          const roomName = subtitle.slice(3).trim()  // Remove " - " prefix
          // A room feed carries this subtitle on both the id='main' and id='room'
          // streamWindows — emit the name only once per distinct room.
          if (roomName && roomName !== _lastRoomName) {
            _lastRoomName = roomName
            events.push({ type: 'roomName', name: roomName })
          }
        }
        break
      }
      // ── Native room id: <nav rm='NNNN'/> ──────────────────────────────────
      // Historically DR sent a bare <nav/> and the only way to get a room id was
      // to turn on ShowRoomID and scrape the "(NNNN)" tag off the room title.
      // Lich 5.20.0 (upstream #1491) adopts the rm attribute as the authoritative
      // UID and stops forcing ShowRoomID on — so the title tag is no longer there
      // by default and this is now the primary source. Still tolerate its absence:
      // pre-5.20 Lich, direct connections, and no-id rooms all send a bare <nav/>.
      // A bare <nav/> deliberately emits an EMPTY uid rather than nothing: rooms
      // without an id must clear the previous room's, or a no-id room inherits it
      // and matches as "same room" (the bug upstream #1467 fixed on their side).
      case 'nav': {
        flush()
        const rm = (attrs['rm'] ?? '').trim()
        events.push({ type: 'roomId', uid: /^\d+$/.test(rm) ? rm : '' })
        break
      }
      case '/nav':
        flush(); break

      // ── Monospace toggle: <output class="mono"/> … <output class=""/> ──────
      // DR wraps ASCII-art blocks (guild/hall registers, maps, tables) in a mono
      // output span. There's no per-register tag — this toggle is the only signal.
      case 'output':
        flush()
        _monoMode = (attrs['class'] ?? '').toLowerCase().includes('mono')
        break

      // ── Body injuries: <dialogData id='injuries'><image id='head' name='Injury1'/>…</dialogData> ──
      // A complete snapshot of a body's wounds/scars, one <image> per location. We
      // collect the child <image> tags and emit them as one event on the closing
      // tag. The id is 'injuries' for the logged-in character; DR also pushes
      // per-person windows ('injuries<Name>') — an empath TOUCHing a patient gets
      // one — so we accept any id starting with 'injuries' and let the store route
      // it. Other dialogData windows (minivitals, etc.) are ignored.
      case 'dialogdata': {
        flush()
        const did = (attrs['id'] ?? '').trim()
        if (did.toLowerCase().startsWith('injuries')) {
          _inInjuries   = true
          _injuryDialog = did
          _injuryTitle  = (attrs['title'] ?? '').trim()
          _injuryImages = []
        }
        break
      }
      case '/dialogdata': {
        flush()
        if (_inInjuries) {
          events.push({ type: 'injuries', images: _injuryImages, dialogId: _injuryDialog, title: _injuryTitle })
          _inInjuries   = false
          _injuryDialog = ''
          _injuryTitle  = ''
          _injuryImages = []
        }
        break
      }
      case 'image': {
        if (_inInjuries && attrs['id']) {
          const img: InjuryImage = { id: attrs['id'], name: attrs['name'] ?? '' }
          if (attrs['scar']) img.scar = attrs['scar']
          if (attrs['cmd'])  img.cmd  = attrs['cmd']
          _injuryImages.push(img)
        }
        break
      }

      case 'left': case 'right':
        flush(); styles = [{ preset: tagName }]; break
      case '/left': case '/right':
        flush(); styles = []; break

      default:
        if (isClose) { flush(); styles = [] }
        break
    }
  }

  flush()

  // Flush any remaining SHOP detail buffer
  if (_shopDetailBuf) {
    events.push({ type: 'text', text: _shopDetailBuf, styles: [], stream: _stream })
    _shopDetailBuf = ''
  }

  return events
}

function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /(\w[\w-]*)(?:=(?:"([^"]*)"|'([^']*)'))?/g
  let m: RegExpExecArray | null
  let first = true
  while ((m = re.exec(tag)) !== null) {
    if (first) { first = false; continue }
    out[m[1]] = m[2] ?? m[3] ?? ''
  }
  return out
}
