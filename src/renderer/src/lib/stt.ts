/**
 * Push-to-talk dictation via the Web Speech API (webkitSpeechRecognition).
 *
 * CAVEAT: in Electron this often fails with a `network` error — Electron's Chromium
 * lacks the Google Speech API key the online recognizer needs. It works where the
 * platform provides on-device recognition; otherwise it degrades to a clear error
 * (surfaced to the mic button). A cloud key or a bundled local model (Whisper/Vosk)
 * would be the fallback if this proves unavailable.
 */

type SpeechRecognitionCtor = new () => SpeechRecognitionLike
interface SpeechRecognitionLike {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number
  start(): void; stop(): void; abort(): void
  onresult: ((ev: SpeechResultEvent) => void) | null
  onerror:  ((ev: { error?: string }) => void) | null
  onend:    (() => void) | null
}
interface SpeechResultEvent {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

function ctor(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function sttAvailable(): boolean {
  return typeof window !== 'undefined' && !!ctor()
}

export interface DictationHandle { stop(): void }

export function startDictation(opts: {
  onText:   (text: string, final: boolean) => void
  onError?: (err: string) => void
  onEnd?:   () => void
  continuous?: boolean
}): DictationHandle | null {
  const Ctor = ctor()
  if (!Ctor) { opts.onError?.('unavailable'); return null }
  const rec = new Ctor()
  rec.lang = 'en-US'
  rec.interimResults = true
  rec.continuous = !!opts.continuous
  rec.maxAlternatives = 1
  rec.onresult = (ev) => {
    let interim = '', finalText = ''
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i]
      if (r.isFinal) finalText += r[0].transcript
      else interim += r[0].transcript
    }
    if (finalText) opts.onText(finalText.trim(), true)
    else if (interim) opts.onText(interim.trim(), false)
  }
  rec.onerror = (e) => opts.onError?.(e.error || 'error')
  rec.onend = () => opts.onEnd?.()
  try { rec.start() } catch { opts.onError?.('start-failed'); return null }
  return { stop: () => { try { rec.stop() } catch { /* ignore */ } } }
}
