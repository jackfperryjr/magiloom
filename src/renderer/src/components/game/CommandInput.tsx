import { useState, useEffect, useRef, useMemo } from 'react'
import { useAtomValue } from 'jotai'
import {
  verbsAtom, verbsWithInfoAtom, verbInfoAtom, beginVerbInfoCapture, roundtimeSecondsAtom,
} from '../../store/game'
import type { ConnectionStatus } from '../../store/game'
import { startDictation, sttAvailable, type DictationHandle } from '../../lib/stt'
import { IconMic } from '../ui/Icons'
import { StatusPanel } from './StatusPanel'

// ── Command autocomplete ──────────────────────────────────────────────────────
// Curated common DragonRealms verbs/commands. Can be augmented at runtime via the
// game's `VERB LIST` output (see setVerbs).
const COMMON_VERBS = [
  'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest',
  'up', 'down', 'out', 'go',
  'look', 'look in', 'search', 'glance', 'read', 'appraise', 'inventory',
  'get', 'put', 'drop', 'stow', 'wear', 'remove', 'wield', 'sheathe', 'ready',
  'open', 'close', 'turn', 'push', 'pull', 'lift', 'lower',
  'attack', 'stance', 'retreat', 'advance', 'aim', 'ambush', 'target',
  'stand', 'sit', 'kneel', 'lie down', 'hide', 'unhide', 'sneak',
  'prepare', 'cast', 'incant', 'invoke', 'channel',
  'health', 'exp', 'experience', 'spells', 'skills', 'info',
  'forage', 'skin', 'gather', 'tend', 'pray',
  'say', 'whisper', 'ask', 'tell', 'shout', 'yell', 'think', 'roleplay',
  'deposit', 'withdraw', 'buy', 'sell', 'order', 'appraise',
]

// Speech-to-text is shelved: the Web Speech API is blocked in Electron (no Google
// key → `network` error). All the mic wiring below stays intact; flip this to true
// once a real STT backend (Vosk offline model or a cloud API) is added.
const MIC_ENABLED = false

interface Suggestion { text: string; tag: string }

function buildSuggestions(
  value: string, history: string[], functionKeys: Record<string, string>, verbs: string[]
): Suggestion[] {
  const q = value.toLowerCase().trimStart()
  if (!q) return []
  const seen = new Set<string>()
  const out: Suggestion[] = []
  const add = (raw: string, tag: string) => {
    const text = raw.trim()
    if (!text) return
    const key = text.toLowerCase()
    if (key === q || !key.startsWith(q) || seen.has(key)) return
    seen.add(key)
    out.push({ text, tag })
  }
  history.forEach(h => add(h, 'history'))
  Object.entries(functionKeys).forEach(([fk, cmd]) => add(cmd, fk))
  verbs.forEach(v => add(v, 'verb'))
  return out.slice(0, 8)
}

// ── CommandInput ──────────────────────────────────────────────────────────────
export function CommandInput({ onSend, onEcho, functionKeys = {}, status, leading }: {
  onSend: (cmd: string) => void
  onEcho: (cmd: string) => void
  functionKeys?: Record<string, string>
  status?: ConnectionStatus
  leading?: React.ReactNode   // mobile: the character avatar/menu, docked in the bar
}) {
  const inputRef   = useRef<HTMLInputElement>(null)
  const historyRef = useRef<string[]>([])
  const histIdxRef = useRef(-1)
  const [value, setValue] = useState('')
  const [open,  setOpen]  = useState(false)
  const [sel,   setSel]   = useState(0)
  // Click-to-toggle dictation. recRef holds the live recognizer; onRef is the
  // intended on/off state (so we can auto-restart when the recognizer times out on
  // silence, keeping it "on" until the user clicks off).
  const [listening, setListening] = useState(false)
  const [micMsg,    setMicMsg]    = useState('')
  const recRef = useRef<DictationHandle | null>(null)
  const onRef  = useRef(false)
  const micOn  = sttAvailable()
  const gameVerbs    = useAtomValue(verbsAtom)
  const verbsWithInfo = useAtomValue(verbsWithInfoAtom)
  const verbInfo     = useAtomValue(verbInfoAtom)
  const rt           = useAtomValue(roundtimeSecondsAtom)  // roundtime badge in the input

  useEffect(() => { inputRef.current?.focus() }, [])

  const allVerbs = useMemo(
    () => (gameVerbs.length ? Array.from(new Set([...COMMON_VERBS, ...gameVerbs])).sort() : COMMON_VERBS),
    [gameVerbs]
  )
  const suggestions = useMemo(
    () => buildSuggestions(value, historyRef.current, functionKeys, allVerbs),
    [value, functionKeys, allVerbs]
  )
  const showSug = open && suggestions.length > 0

  useEffect(() => { if (sel >= suggestions.length) setSel(0) }, [suggestions.length, sel])

  // Fetch VERB INFO (debounced) for the highlighted suggestion when it's a known
  // single-word verb we haven't fetched yet — used for the detail popover.
  const verbSet   = useMemo(() => new Set(allVerbs.map(v => v.toLowerCase())), [allVerbs])
  const infoKnown = useMemo(() => Object.keys(verbsWithInfo).length > 0, [verbsWithInfo])
  const activeName = showSug ? suggestions[sel]?.text.toLowerCase() : undefined
  const activeInfo = activeName ? verbInfo[activeName] : undefined
  useEffect(() => {
    if (!activeName || activeName.includes(' ') || !verbSet.has(activeName)) return
    if (infoKnown && !verbsWithInfo[activeName]) return   // sweep knows it has no detail
    if (verbInfo[activeName] !== undefined) return         // already fetched
    const t = window.setTimeout(() => { beginVerbInfoCapture(activeName); onSend(`verb info ${activeName}`) }, 300)
    return () => window.clearTimeout(t)
  }, [activeName, verbSet, infoKnown, verbsWithInfo, verbInfo, onSend])

  const submit = () => {
    const val = value.trim()
    if (!val) return
    onEcho(val)
    onSend(val)
    historyRef.current = [val, ...historyRef.current.slice(0, 99)]
    histIdxRef.current = -1
    setValue('')
    setOpen(false)
  }

  const accept = (text: string) => {
    setValue(text)
    setOpen(false)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSug) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => (s + 1) % suggestions.length); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSel(s => (s - 1 + suggestions.length) % suggestions.length); return }
      if (e.key === 'Tab')       { e.preventDefault(); accept(suggestions[sel]?.text ?? value); return }
      if (e.key === 'Escape')    { e.preventDefault(); setOpen(false); return }
      if (e.key === 'Enter')     { submit(); return }
      return
    }
    if (e.key === 'Enter') { submit(); return }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.min(histIdxRef.current + 1, historyRef.current.length - 1)
      histIdxRef.current = next
      setValue(historyRef.current[next] ?? '')
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.max(histIdxRef.current - 1, -1)
      histIdxRef.current = next
      setValue(next === -1 ? '' : historyRef.current[next] ?? '')
    }
  }

  // Click the mic to toggle dictation on/off. While on it listens continuously and
  // fills the input with what it hears; you review and press Enter to send.
  const startMic = () => {
    setMicMsg('')
    onRef.current = true
    recRef.current = startDictation({
      continuous: true,
      onText: (t) => { setValue(t); setOpen(false) },
      onError: (err) => {
        onRef.current = false; setListening(false); recRef.current = null
        setMicMsg(
          err === 'not-allowed' || err === 'service-not-allowed' ? 'Microphone permission denied'
          : err === 'network' || err === 'unavailable' ? 'Speech recognition unavailable in this build'
          : err === 'no-speech' ? '' : 'Dictation error',
        )
      },
      // The recognizer stops itself after long silence — restart (briefly delayed to
      // avoid a hot loop) while still toggled on.
      onEnd: () => { recRef.current = null; if (onRef.current) setTimeout(startMic, 300); else { setListening(false); inputRef.current?.focus() } },
    })
    if (recRef.current) setListening(true)
  }
  const toggleMic = () => {
    if (!micOn) { setMicMsg('Speech recognition unavailable in this build'); return }
    if (onRef.current) { onRef.current = false; recRef.current?.stop() }
    else startMic()
  }

  return (
    <div className="command-input-wrap">
      {leading}
      {showSug && (
        <div className="cmd-popup">
          {activeInfo && activeInfo.length > 0 && (
            <div className="cmd-verbinfo">
              <div className="cmd-verbinfo-title">{activeName}</div>
              {activeInfo.map((e, i) => (
                <div key={i} className="cmd-verbinfo-row">
                  {e.syntax && <div className="cmd-verbinfo-syntax">{e.syntax}</div>}
                  {e.desc && <div className="cmd-verbinfo-desc">{e.desc}</div>}
                </div>
              ))}
            </div>
          )}
          <div className="cmd-suggest">
            {suggestions.map((s, i) => (
              <div
                key={s.text}
                className={'cmd-suggest-item' + (i === sel ? ' active' : '')}
                onMouseDown={e => { e.preventDefault(); accept(s.text) }}
                onMouseEnter={() => setSel(i)}
              >
                <span className="cmd-suggest-text">{s.text}</span>
                <span className="cmd-suggest-tag">{s.tag}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <span className="command-prompt">&gt;</span>
      <input
        ref={inputRef}
        className="command-input"
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={e => { setValue(e.target.value); setOpen(true); histIdxRef.current = -1 }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        placeholder="Send Commands"
      />
      {rt > 0 && <span className="command-rt" data-tooltip="Roundtime">RT {rt}s</span>}
      {MIC_ENABLED && (
        <button
          type="button"
          className={'command-mic ' + (listening ? 'mic-on' : 'mic-off')}
          data-tooltip={listening ? 'Listening — click to turn off' : micMsg || 'Click to speak commands'}
          onClick={toggleMic}
        >
          <IconMic size={18} />
        </button>
      )}
      <StatusPanel status={status ?? 'disconnected'} />
    </div>
  )
}
