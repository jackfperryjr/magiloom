import { useEffect, useCallback, useRef } from 'react'
import { useSetAtom, useAtom, useAtomValue } from 'jotai'
import { parseLine, resetParser } from '../lib/sge-parser'
import { connectionStatusAtom, dispatchGameEventAtom, appendDisconnectNoticeAtom, appendScriptOutputAtom, echoCommandAtom, linkModeAtom, broadcastReceiveAtom, classStatesAtom, disabledClassesAtom } from '../store/game'
import { expandAlias, matchTriggers, substituteVars, type Alias, type Trigger } from '../lib/automation'

// Ignore a repeat firing of the same trigger command within this window, so a
// trigger whose command re-produces its own matching line can't storm the game.
const TRIGGER_COOLDOWN_MS = 500

export function useGameConnection(charName = '') {
  const [status, setStatus] = useAtom(connectionStatusAtom)
  const dispatch = useSetAtom(dispatchGameEventAtom)
  const appendDisconnectNotice = useSetAtom(appendDisconnectNoticeAtom)
  const appendScriptOutput = useSetAtom(appendScriptOutputAtom)
  const echoCommand = useSetAtom(echoCommandAtom)
  const linkMode = useAtomValue(linkModeAtom)
  const receive  = useAtomValue(broadcastReceiveAtom)
  const disabledClasses = useAtomValue(disabledClassesAtom)
  const classStates = useAtomValue(classStatesAtom)
  const setClassStates = useSetAtom(classStatesAtom)

  // Aliases/triggers live in refs so the stable send/onData callbacks always see
  // the latest rules without re-subscribing the game listeners.
  const aliasesRef  = useRef<Alias[]>([])
  const triggersRef = useRef<Trigger[]>([])
  const varsRef     = useRef<Record<string, string>>({})
  const cooldownRef = useRef<Map<string, number>>(new Map())
  // Link mode lives in a ref so `send` stays a stable callback (it changes what
  // typing does, but must not re-subscribe the game listeners).
  const linkRef = useRef(linkMode)
  useEffect(() => { linkRef.current = linkMode }, [linkMode])
  // Disabled classes + current class-state map in refs, same reason.
  const disabledRef = useRef(disabledClasses)
  useEffect(() => { disabledRef.current = disabledClasses }, [disabledClasses])
  const classStatesRef = useRef(classStates)
  useEffect(() => { classStatesRef.current = classStates }, [classStates])
  // Push this window's receive opt-in down to the main-process bus.
  useEffect(() => { window.dr.broadcast.setReceive(receive) }, [receive])

  // Toggle a Genie-style class on/off and persist it for this character.
  const applyClassCommand = useCallback((name: string, action: 'on' | 'off' | 'toggle') => {
    const prev = classStatesRef.current
    const isOn = prev[name] !== false
    const next = action === 'toggle' ? !isOn : action === 'on'
    const map  = { ...prev, [name]: next }
    setClassStates(map)
    if (charName) window.dr.settings.patchChar(charName, { classes: map })
  }, [charName, setClassStates])

  // Named global variables (#var), per character. Set via the `#var` command and
  // substituted (%name) into every sent command below.
  const applyVarCommand = useCallback((rest: string, unset: boolean) => {
    const arg = rest.trim()
    const persist = (map: Record<string, string>) => {
      varsRef.current = map
      if (charName) window.dr.settings.patchChar(charName, { vars: map })
    }
    if (unset) {
      const name = arg.split(/\s+/)[0]
      if (name && Object.prototype.hasOwnProperty.call(varsRef.current, name)) {
        const map = { ...varsRef.current }; delete map[name]; persist(map)
        appendScriptOutput(`[var] %${name} removed`)
      }
      return
    }
    if (!arg) {
      const entries = Object.entries(varsRef.current)
      appendScriptOutput(entries.length ? entries.map(([k, v]) => `%${k} = ${v}`).join('\n') : '[var] no variables set')
      return
    }
    const sp = arg.search(/\s/)
    const name = (sp === -1 ? arg : arg.slice(0, sp)).replace(/^%/, '')
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { appendScriptOutput(`[var] invalid name "${name}"`); return }
    if (sp === -1) { appendScriptOutput(`%${name} = ${varsRef.current[name] ?? '(unset)'}`); return }
    const value = arg.slice(sp + 1).trim()
    persist({ ...varsRef.current, [name]: value })
    appendScriptOutput(`[var] %${name} = ${value}`)
  }, [charName, appendScriptOutput])

  // Load this character's automation rules (per-character, falling back to
  // globals), reloading on character switch and whenever settings are saved.
  useEffect(() => {
    const load = () => window.dr.settings.getChar(charName).then(c => {
      aliasesRef.current  = (c.aliases  ?? []) as Alias[]
      triggersRef.current = (c.triggers ?? []) as Trigger[]
      varsRef.current     = (c.vars     ?? {}) as Record<string, string>
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

  // Local execution of one command: expand aliases, then route. A leading '.'
  // runs a native .cmd script ('.kill'/'.stop' halts all); everything else goes
  // to the game. This is the shared core — it never broadcasts, so triggers and
  // received broadcasts can reuse it without looping.
  const runLocal = useCallback((cmd: string) => {
    // Client-side class control: `#class <name> [on|off|toggle]` (default toggle).
    // Never reaches the game.
    const cm = cmd.trim().match(/^#class\s+(\S+)\s*(on|off|toggle)?$/i)
    if (cm) { applyClassCommand(cm[1].toLowerCase(), (cm[2]?.toLowerCase() as 'on' | 'off' | 'toggle') ?? 'toggle'); return }

    // Client-side variables: `#var [name [value]]`, `#unvar name`. Never sent.
    const vm = cmd.trim().match(/^#(unvar|var)\b\s*(.*)$/i)
    if (vm) { applyVarCommand(vm[2], vm[1].toLowerCase() === 'unvar'); return }

    // Expand aliases (args %1..%9), then substitute named %vars, then route.
    const line = substituteVars(expandAlias(cmd, aliasesRef.current, disabledRef.current), varsRef.current)
    const t = line.trimStart()
    if (t.startsWith('.')) {
      const [name, ...args] = t.slice(1).trim().split(/\s+/)
      if (name === 'kill' || name === 'stop') window.dr.script.stop()
      else if (name) window.dr.script.run(name, args)
      return
    }
    window.dr.game.send(line)
  }, [applyClassCommand, applyVarCommand])

  // Outbound chokepoint for USER input. Handles multi-boxing on top of runLocal:
  //   `// cmd` → run here AND broadcast to my other windows
  //   `/ cmd`  → broadcast to my other windows only (skip this one)
  //   link on  → every normal command also mirrors to my other windows
  // Peers only run it if they've opted in to receive (per-window setting).
  const send = useCallback((cmd: string) => {
    const t = cmd.trimStart()
    if (t.startsWith('/')) {
      const all  = t.startsWith('//')                   // '//' = include this window
      const body = t.replace(/^\/+\s*/, '')
      if (!body) return
      window.dr.broadcast.send(body)
      if (all) runLocal(body)
      return
    }
    runLocal(cmd)
    if (linkRef.current) window.dr.broadcast.send(cmd)
  }, [runLocal])

  // A command broadcast from one of my other windows: echo it here and run it
  // locally (never re-broadcast — runLocal, not send — or windows would loop).
  useEffect(() => {
    return window.dr.broadcast.onIncoming((cmd: string) => {
      echoCommand(cmd)
      runLocal(cmd)
    })
  }, [echoCommand, runLocal])

  // Inbound automation: fire matching triggers off each incoming game line.
  // Triggers run locally only (runLocal) so an auto-fire never storms peers.
  const runTriggers = useCallback((raw: string) => {
    const trigs = triggersRef.current
    if (trigs.length === 0) return
    const lines = raw.replace(/<[^>]*>/g, '').split('\n')
    for (const l of lines) {
      const line = l.trim()
      if (!line) continue
      for (const cmd of matchTriggers(line, trigs, disabledRef.current)) {
        const now  = Date.now()
        const last = cooldownRef.current.get(cmd) ?? 0
        if (now - last < TRIGGER_COOLDOWN_MS) continue
        cooldownRef.current.set(cmd, now)
        echoCommand(cmd)   // show the auto-fired command like a normal echo
        runLocal(cmd)
      }
    }
  }, [echoCommand, runLocal])

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
