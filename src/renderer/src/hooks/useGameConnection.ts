import { useEffect, useCallback, useRef } from 'react'
import { useSetAtom, useAtom } from 'jotai'
import { parseLine, resetParser } from '../lib/sge-parser'
import { connectionStatusAtom, dispatchGameEventAtom, appendDisconnectNoticeAtom, appendScriptOutputAtom, echoCommandAtom } from '../store/game'
import { expandAlias, matchTriggers, type Alias, type Trigger } from '../lib/automation'

// Ignore a repeat firing of the same trigger command within this window, so a
// trigger whose command re-produces its own matching line can't storm the game.
const TRIGGER_COOLDOWN_MS = 500

export function useGameConnection(charName = '') {
  const [status, setStatus] = useAtom(connectionStatusAtom)
  const dispatch = useSetAtom(dispatchGameEventAtom)
  const appendDisconnectNotice = useSetAtom(appendDisconnectNoticeAtom)
  const appendScriptOutput = useSetAtom(appendScriptOutputAtom)
  const echoCommand = useSetAtom(echoCommandAtom)

  // Aliases/triggers live in refs so the stable send/onData callbacks always see
  // the latest rules without re-subscribing the game listeners.
  const aliasesRef  = useRef<Alias[]>([])
  const triggersRef = useRef<Trigger[]>([])
  const cooldownRef = useRef<Map<string, number>>(new Map())

  // Load this character's automation rules (per-character, falling back to
  // globals), reloading on character switch and whenever settings are saved.
  useEffect(() => {
    const load = () => window.dr.settings.getChar(charName).then(c => {
      aliasesRef.current  = (c.aliases  ?? []) as Alias[]
      triggersRef.current = (c.triggers ?? []) as Trigger[]
    })
    load()
    window.addEventListener('settings:saved', load)
    return () => window.removeEventListener('settings:saved', load)
  }, [charName])

  useEffect(() => {
    const unsub = window.dr.script.onOutput((line: string) => appendScriptOutput(line))
    return unsub
  }, [appendScriptOutput])

  const disconnect = useCallback(() => window.dr.game.disconnect(), [])

  // Outbound chokepoint: expand aliases, then route. A leading '.' runs a native
  // .cmd script ('.kill'/'.stop' halts all); everything else goes to the game.
  const send = useCallback((cmd: string) => {
    const line = expandAlias(cmd, aliasesRef.current)
    const t = line.trimStart()
    if (t.startsWith('.')) {
      const [name, ...args] = t.slice(1).trim().split(/\s+/)
      if (name === 'kill' || name === 'stop') window.dr.script.stop()
      else if (name) window.dr.script.run(name, args)
      return
    }
    window.dr.game.send(line)
  }, [])

  // Inbound automation: fire matching triggers off each incoming game line.
  const runTriggers = useCallback((raw: string) => {
    const trigs = triggersRef.current
    if (trigs.length === 0) return
    const lines = raw.replace(/<[^>]*>/g, '').split('\n')
    for (const l of lines) {
      const line = l.trim()
      if (!line) continue
      for (const cmd of matchTriggers(line, trigs)) {
        const now  = Date.now()
        const last = cooldownRef.current.get(cmd) ?? 0
        if (now - last < TRIGGER_COOLDOWN_MS) continue
        cooldownRef.current.set(cmd, now)
        echoCommand(cmd)   // show the auto-fired command like a normal echo
        send(cmd)
      }
    }
  }, [echoCommand, send])

  useEffect(() => {
    // When GameLayout mounts, we may have already connected (the connected
    // event fired before this hook ran). Ask for current status immediately.
    window.dr.game.getStatus().then((s: string) => {
      if (s === 'connected')    setStatus('connected')
      if (s === 'disconnected') setStatus('disconnected')
    })

    const unsubs = [
      window.dr.game.onConnected(()       => { resetParser(); setStatus('connected') }),
      window.dr.game.onDisconnected(()    => { setStatus('disconnected'); appendDisconnectNotice() }),
      window.dr.game.onError(()           => { setStatus('error'); appendDisconnectNotice() }),
      window.dr.game.onData((raw: string) => { parseLine(raw).forEach(dispatch); runTriggers(raw) })
    ]
    return () => unsubs.forEach(fn => fn())
  }, [dispatch, setStatus, appendDisconnectNotice, runTriggers])

  return { status, disconnect, send }
}
