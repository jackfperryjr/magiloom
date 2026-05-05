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

export type StreamId = 'main' | 'exp' | 'combat' | 'atmo' | 'inv' | 'familiar' | 'speech' | 'lich'

export interface TextStyle {
  bold?:   boolean
  color?:  string
  preset?: string
}

export interface LinkSpan {
  text: string
  cmd:  string
}

export type GameEvent =
  | { type: 'text';      text: string;   styles: TextStyle[]; stream: StreamId; links?: LinkSpan[] }
  | { type: 'roomName';  name: string }
  | { type: 'roomDesc';  description: string }
  | { type: 'roomExits'; exits: string[] }
  | { type: 'roomObjs';  objs: string }
  | { type: 'roomPlayers'; players: string }
  | { type: 'playerArrived'; player: string }
  | { type: 'playerDeparted'; player: string }
  | { type: 'expSkill';  name: string; rank: number; pct: number; mind: string; mindWord?: string }
  | { type: 'expMeta';   tdps?: number; favors?: number }
  | { type: 'vitals';    field: VitalField; value: number; max?: number; text?: string }
  | { type: 'indicator'; id: string; active: boolean }
  | { type: 'spell';     name: string }
  | { type: 'roundtime'; expires: number }
  | { type: 'cast_time'; expires: number }
  | { type: 'prompt';    time: number }

export type VitalField = 'health' | 'mana' | 'stamina' | 'spirit'

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

function looksLikeRoomName(text: string): boolean {
  // DragonRealms room names often look like "[Area, Subarea] (roomid)" or "Room Name"
  const trimmed = text.trim()
  if (!trimmed || trimmed.length < 3 || trimmed.length > 200) return false
  if (/^(you|also here|obvious|roundtime|exp|tdp|you are|your|the|an?|some)/i.test(trimmed)) return false
  if (/^[<>\[\]]/.test(trimmed) && !/^\[.*\]$/.test(trimmed)) return false  // allow complete [brackets] but not incomplete
  if (/^[\[\(]/.test(trimmed) && /[\]\)]$/.test(trimmed)) return true  // [Area] or (id)
  if (/^\[.*\]\s*\(.*\)$/.test(trimmed)) return true  // [Area, Subarea] (roomid)
  // Regular room names: start with capital, contain location words, no XML chars
  if (/[<>:]/.test(trimmed)) return false  // avoid XML-like chars
  return /^[A-Z]/.test(trimmed) && /\b(of|the|and|in|on|at|to|from|north|south|east|west|up|down|out|in|forest|glade|path|road|street|square|plaza|shop|inn|tavern|guild|hall|tower|castle|keep|gate|bridge|river|lake|mountain|hill|valley|cave|mine|dungeon|room|chamber|hallway|corridor|door|portal)\b/i.test(trimmed)
}

const TAG_RE = /<([^>]+)>|([^<]+)/g

export function parseLine(raw: string): GameEvent[] {
  // Debug logging for roundtime data
  console.log('RAW:', raw)

  const events: GameEvent[] = []
  let styles: TextStyle[]   = []
  let buf    = ''
  let links: LinkSpan[]     = []
  let inLink = false
  let linkCmd = ''
  let linkBuf = ''

  const flush = (forcePreset?: string) => {
    let text = buf.replace(/[\r\n]+/g, ' ').replace(/  +/g, ' ').trim()
    buf = ''
    if (!text || text === '>') return
    const s  = forcePreset ? [{ preset: forcePreset }] : [...styles]
    const ls = links.length > 0 ? [...links] : undefined
    links = []

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
    if (_inExpSkill)      return  // exp data — only expSkill event matters
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
    events.push({ type: 'text', text, styles: s, stream: _stream, links: ls })
  }

  // ── Plain-text line (no XML) ───────────────────────────────────────────────
  if (!raw.includes('<')) {
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
      else buf += decoded
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
          _inExpSkill = (attrs['id'] ?? '').slice(4).trim()  // preserve case
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
          const sm = raw2.match(/:?\s*(\d+)\s+(\d+)%\s+(?:([a-zA-Z][a-zA-Z ]*?)\s+)?[\[\(]\s*(\d+\/\d+)\s*[\]\)]/)
          if (sm) {
            events.push({
              type:     'expSkill',
              name:     _inExpSkill,
              rank:     parseInt(sm[1]),
              pct:      parseInt(sm[2]),
              mindWord: sm[3]?.trim(),
              mind:     sm[4],
            })
          } else {
            // TDP / favor line: "TDPs: 3348  Favors: 50"
            const tdpM = raw2.match(/TDPs?:\s*(\d+)/i)
            const favM = raw2.match(/Favors?:\s*(\d+)/i)
            if (tdpM || favM) {
              events.push({
                type:   'expMeta',
                tdps:   tdpM ? parseInt(tdpM[1]) : undefined,
                favors: favM ? parseInt(favM[1]) : undefined,
              })
            }
          }
          _inExpSkill = ''
          styles = []
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
          const raw2 = (_roomExitBuf + ' ' + buf).replace(/[\r\n,\.]+/g, ' ').replace(/  +/g, ' ').trim()
          buf = ''
          _roomExitBuf = ''
          _inExits     = false
          if (raw2) {
            const exitLinks = links.filter(l => l.cmd.startsWith('go '))
            links = []
            const DIRS = new Set(['north','south','east','west','northeast','northwest',
              'southeast','southwest','up','down','out','in','ne','nw','se','sw','n','s','e','w'])
            const pathPart = raw2.replace(/obvious\s+(?:paths?|exits?)\s*:?\s*/i, '')
            const textExits = pathPart.split(/[\s,\.]+/).map(e => e.trim().toLowerCase()).filter(e => DIRS.has(e))
            const allExits  = exitLinks.length > 0
              ? exitLinks.map(l => l.cmd.replace('go ', ''))
              : textExits
            events.push({ type: 'roomExits', exits: allExits })
            _suppressExits = true  // suppress duplicate plain-text exits
            // Build synthetic links from text exits if no <d> tags present
            const finalLinks = exitLinks.length > 0
              ? exitLinks
              : allExits.map(dir => ({ text: dir, cmd: dir }))
            events.push({
              type: 'text', text: raw2,
              styles: [{ preset: 'roomexits' }], stream: 'main',
              links: finalLinks.length > 0 ? finalLinks : undefined
            })
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
      case 'clearstream':
        flush()
        // clearStream resets inv panel - emit special event handled in store
        if ((attrs['id'] ?? '').toLowerCase() === 'inv') {
          events.push({ type: 'text', text: '__clear_inv__', styles: [], stream: 'inv' })
        }
        break
      case 'pushstream': {
        flush()
        const id = (attrs['id'] ?? '').toLowerCase()
        const map: Record<string, StreamId> = {
          exp: 'exp', combat: 'combat', atmo: 'atmo',
          inv: 'inv', familiar: 'familiar', speech: 'speech'
        }
        _stream = map[id] ?? 'main'
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
        flush()
        _preXmlPhase = false
        _inInitialInventory = false
        events.push({ type: 'prompt', time: parseInt(attrs['time'] ?? '0', 10) })
        break

      // ── Styled text ───────────────────────────────────────────────────────
      case 'preset':  flush(); styles = attrs['id'] ? [{ preset: attrs['id'] }] : []; break
      case '/preset': flush(); styles = []; break
      case 'style':   flush(); styles = attrs['id'] ? [{ preset: attrs['id'] }] : []; break
      case '/style':  flush(); styles = []; break
      case 'color':   flush(); styles = attrs['fg'] ? [{ color: attrs['fg'] }] : []; break
      case '/color':  flush(); styles = []; break
      case 'bold':    flush(); styles = [{ bold: true }]; break
      case '/bold':   flush(); styles = []; break
      case 'pushbold': flush(); styles = [{ bold: true }]; break
      case 'popbold':
      case '/pushbold': flush(); styles = []; break

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
          const roomName = subtitle.slice(3)  // Remove " - " prefix
          if (roomName.trim()) {
            events.push({ type: 'roomName', name: roomName.trim() })
          }
        }
        break
      }
      case 'nav': case '/nav':
        flush(); break

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
