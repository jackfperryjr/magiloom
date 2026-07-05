import { useEffect, useCallback } from 'react'
import { useSetAtom, useAtom } from 'jotai'
import { parseLine, resetParser } from '../lib/sge-parser'
import { connectionStatusAtom, dispatchGameEventAtom, appendDisconnectNoticeAtom } from '../store/game'

export function useGameConnection() {
  const [status, setStatus] = useAtom(connectionStatusAtom)
  const dispatch = useSetAtom(dispatchGameEventAtom)
  const appendDisconnectNotice = useSetAtom(appendDisconnectNoticeAtom)

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
      window.dr.game.onData((raw: string) => parseLine(raw).forEach(dispatch))
    ]
    return () => unsubs.forEach(fn => fn())
  }, [dispatch, setStatus, appendDisconnectNotice])

  const disconnect = useCallback(() => window.dr.game.disconnect(), [])
  const send = useCallback((cmd: string) => window.dr.game.send(cmd), [])

  return { status, disconnect, send }
}
