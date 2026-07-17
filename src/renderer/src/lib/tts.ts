/**
 * Text-to-speech via the Web Speech API (built into Chromium/Electron — uses the OS
 * voices, no assets or network needed). Used to speak whispers / mentions / custom
 * alert lines. Fails silently if unavailable.
 */

let _voice: SpeechSynthesisVoice | null = null

function pickVoice(): SpeechSynthesisVoice | null {
  if (_voice) return _voice
  const vs = window.speechSynthesis?.getVoices?.() ?? []
  _voice = vs.find(v => /^en[-_]/i.test(v.lang) && v.default)
        ?? vs.find(v => /^en[-_]/i.test(v.lang))
        ?? vs[0] ?? null
  return _voice
}

// Voices load asynchronously; reset the cached pick when the list arrives.
if (typeof window !== 'undefined' && window.speechSynthesis) {
  try { window.speechSynthesis.onvoiceschanged = () => { _voice = null } } catch { /* ignore */ }
}

export function speak(text: string, rate = 1.05): void {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!synth || !clean) return
  try {
    const u = new SpeechSynthesisUtterance(clean)
    const v = pickVoice()
    if (v) u.voice = v
    u.rate = rate
    synth.speak(u)
  } catch { /* TTS unavailable */ }
}
