// Turn a LOOK-at-character block into a text-to-image prompt. DR descriptions are
// near-uniform, so we extract race/gender + the visual sentences with regex (no
// LLM) and drop into a fixed style template — deterministic, offline, and free.

export interface LookFields {
  race:        string
  gender:      '' | 'male' | 'female' | 'nonbinary'
  description: string
}

// Sentences that carry no portrait-relevant visual info (height/age/condition/
// injuries) — dropped so they don't confuse the image model. In a DR LOOK these
// fall between the age/tattoo lines and the "is wearing" clothing list.
const DROP_RE: RegExp[] = [
  /\bis\s+(?:short|tall|average|small|large|huge|tiny|slightly)\b.*\bfor an?\b/i,  // height
  /\bappears?\s+to\s+be\b/i,                                                        // age
  /\bin\s+(?:the\s+|your\s+|her\s+|his\s+|their\s+)?prime\b/i,                      // age
  /\bin\s+(?:good|bad|great|poor|terrible|decent|excellent|reasonable)\s+shape\b/i, // condition
  // Injuries are temporary — drop them. Matches the DR wound sentence: a
  // "has/have" clause naming a wound. Strong wound words (rarely appearance
  // features) match anywhere; ambiguous ones (cut/burn/broken) require a body
  // location, so "a sharply cut jaw" survives but "a deep cut on her cheek" goes.
  /\b(?:has|have)\b.*(?:\b(?:scuffing|scratch(?:es)?|scars?|gashe?s?|bruis\w+|welts?|abrasions?|lacerations?|scrapes?|swollen|swelling|blisters?|charred|fractured?|shattered|mangled|severed|punctures?|slashe?s?|wounds?)\b|\b(?:cuts?|burns?|broken)\b.*\b(?:to|on|along|across|over|around)\s+(?:the|his|her|its|their)\b)/i,
]

// Lines that must never be dropped even if a rule above would match them: the
// clothing list ("is wearing …" may contain "wound"/"blood" as garment flavour)
// and tattoos (permanent, and a tattoo line like "a bleeding heart on her arm"
// looks injury-ish). Keeping these is also what puts the character's attire back
// in the prompt.
const KEEP_RE = /\b(?:is|are)\s+wearing\b|\btattoos?\b/i

function detectGender(text: string): LookFields['gender'] {
  if      (/\b(?:she|her|hers)\b/i.test(text))    return 'female'
  else if (/\b(?:he|him|his)\b/i.test(text))      return 'male'
  else if (/\b(?:they|them|their)\b/i.test(text)) return 'nonbinary'
  return ''
}

export function parseLookFields(lines: string[]): LookFields {
  const head = lines[0] ?? ''
  // Race (and any profession) is the trailing ", a/an <Race…>." on the first line.
  const race = (head.match(/,\s+an?\s+([A-Za-z' -]+?)\.?\s*$/)?.[1] ?? '').trim()

  const body = lines.slice(1)
  const gender = detectGender(body.join(' '))

  const description = body
    .filter(l => l.trim() && (KEEP_RE.test(l) || !DROP_RE.some(re => re.test(l))))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return { race, gender, description }
}

// Lower-body clothing pulls the model into a full/waist-up shot to show it, which
// fights a bust crop — strip those items from the "wearing" list so only
// upper-body attire (visible in a bust) remains.
const LOWER_BODY_RE = /\b(?:skirts?|boots?|greaves?|leggings?|trousers?|pants?|breeches|kilts?|sandals?|shoes?|slippers?|footwear|hose|stockings?|leg|legs|thigh\w*|shin\w*|anklets?)\b/i

// Full/upper-body garments cover the torso and read in a bust crop. They must be
// kept even when their phrasing mentions a lower-body word (e.g. "a dress with
// flowing skirts") — otherwise the whole garment is stripped and the subject
// renders bare-chested.
const FULL_BODY_RE = /\b(?:dress(?:es)?|gowns?|robes?|tunics?|cloaks?|capes?|coats?|frocks?|kimonos?|togas?|surcoats?|habits?|cassocks?|chemises?|shifts?|kirtles?|bodices?|corsets?|blouses?|shirts?|vests?|doublets?|jerkins?)\b/i

function trimLowerBody(desc: string): string {
  return desc.replace(/((?:is|are)\s+wearing\s+)([^.]*)(\.)/i, (_m, pre: string, list: string, dot: string) => {
    const kept = list.split(/,\s*|\s+and\s+/).map(s => s.trim()).filter(Boolean).filter(it => FULL_BODY_RE.test(it) || !LOWER_BODY_RE.test(it))
    if (kept.length === 0) return ''
    const joined = kept.length === 1 ? kept[0] : `${kept.slice(0, -1).join(', ')} and ${kept[kept.length - 1]}`
    return pre + joined + dot
  }).replace(/\s+/g, ' ').trim()
}

export function buildPortraitPrompt(f: LookFields): string {
  const who  = [f.gender, f.race].filter(Boolean).join(' ') || 'person'
  let desc = trimLowerBody(f.description)
    // Drop full-body cues ("…and a slender figure") that pull the crop downward.
    .replace(/\b(?:and|from|with)\s+an?\s+[\w-]+\s+(?:figure|physique|build|frame|stature|silhouette|body)\b/gi, '')
    .replace(/\s+([.,])/g, '$1').replace(/\s{2,}/g, ' ').trim()
  if (desc.length > 1400) desc = desc.slice(0, 1400)
  // If garments are described, tell the model they're visible at the crop line —
  // a tight bust crop otherwise tends to render worn clothing (esp. dresses/gowns)
  // as a bare chest.
  const clothed = /\bwearing\b/i.test(desc) || FULL_BODY_RE.test(desc)
  return `Close-up bust portrait of a ${who}, tightly cropped just below the collarbone — only ` +
    `the head, neck, shoulders and upper chest are visible; the lower body, waist and legs are ` +
    `out of frame. Front view. ` +
    `${desc} ` +
    (clothed ? `The subject is fully clothed, the described garments covering the shoulders and chest. ` : '') +
    `Style: painterly digital illustration, soft cinematic lighting, plain dark neutral ` +
    `background, single subject, detailed face. No text, no watermark, no border.`
}

// Shared style tail so every portrait — generic or special-cased — reads as one
// consistent set of illustrations.
const STYLE_TAIL =
  'Style: painterly digital illustration, single subject, detailed face. ' +
  'No text, no watermark, no border.'

// Some LOOK descriptions are fully themed and carry no ordinary body text, so the
// generic template would feed the image model framing text and title fluff. These
// get bespoke prompts instead.

// Fully concealed: shrouded in shadow or an enveloping cloak, nothing visible but
// empty hands. DR emits "<Name> seems to be wrapped in dark shadows / enveloped in
// a dark cloak, concealing all but <his/her> empty hands."
const CONCEAL_RE = /\bseems to be (wrapped in dark shadows|enveloped in a dark cloak)\b/i

// Duskruin "Champion of the Arena" and Celestial Aspect cosmetics: the subject is
// seen through a coloured haze, giving only race + a couple of visual traits, e.g.
// "Through a deep crimson haze, you see a Human Champion of Duskruin Arena with
// weathered skin and green eyes."
const HAZE_RE = /Through an?\s+(.+?)\s+haze,\s+you see an?\s+(.+?)\s+with\s+([^.]+?)\./i

function specialPortraitPrompt(lines: string[]): string | null {
  const text = lines.join(' ').replace(/\s+/g, ' ').trim()

  const conceal = text.match(CONCEAL_RE)
  if (conceal) {
    const shroud = /cloak/i.test(conceal[1])
      ? 'enveloped head to toe in a heavy dark hooded cloak'
      : 'wrapped head to toe in swirling dark shadows'
    const who = detectGender(text) ? `${detectGender(text)} figure` : 'figure'
    return `Close-up bust portrait of a mysterious ${who} ${shroud}, face and form ` +
      `hidden in darkness with only a pair of empty hands emerging from the gloom. ` +
      `Front view, tightly cropped to head, shoulders and upper chest. ` +
      `Low-key shadowy lighting, black background, ominous mood. ${STYLE_TAIL}`
  }

  const haze = text.match(HAZE_RE)
  if (haze) {
    const hazeDesc = haze[1].trim().toLowerCase()            // "deep crimson", "shadowy black"
    // Strip the cosmetic title so only the race remains ("Human", "Dark Elf").
    const race = (haze[2].replace(/\s+(?:Champion of Duskruin Arena|Celestial Aspect of\s+\w+)\s*$/i, '').trim()) || 'person'
    const traits = haze[3].trim()                            // "weathered skin and green eyes"
    return `Close-up bust portrait of a ${race} with ${traits}, seen through a ${hazeDesc} ` +
      `haze that suffuses the whole image and dominates the colour palette. ` +
      `Front view, tightly cropped to head, shoulders and upper chest. ` +
      `Dramatic cinematic lighting. ${STYLE_TAIL}`
  }

  return null
}

export function promptFromLook(lines: string[]): string {
  return specialPortraitPrompt(lines) ?? buildPortraitPrompt(parseLookFields(lines))
}
