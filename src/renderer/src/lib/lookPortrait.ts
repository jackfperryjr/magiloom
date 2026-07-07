// Turn a LOOK-at-character block into a text-to-image prompt. DR descriptions are
// near-uniform, so we extract race/gender + the visual sentences with regex (no
// LLM) and drop into a fixed style template — deterministic, offline, and free.

export interface LookFields {
  race:        string
  gender:      '' | 'male' | 'female' | 'nonbinary'
  description: string
}

// Sentences that carry no portrait-relevant visual info (height/age/condition/
// injuries) — dropped so they don't confuse the image model.
const DROP_RE: RegExp[] = [
  /\bis\s+(?:short|tall|average|small|large|huge|tiny|slightly)\b.*\bfor an?\b/i,
  /\bappears?\s+to\s+be\b/i,
  /\bin\s+(?:the\s+|your\s+|her\s+|his\s+|their\s+)?prime\b/i,
  /\bin\s+(?:good|bad|great|poor|terrible|decent|excellent|reasonable)\s+shape\b/i,
  /\b(?:scars?|scuffing|bruis\w*|wounds?|welts?|abrasions?|lacerations?|swelling|scrapes?)\b/i,
]

export function parseLookFields(lines: string[]): LookFields {
  const head = lines[0] ?? ''
  // Race (and any profession) is the trailing ", a/an <Race…>." on the first line.
  const race = (head.match(/,\s+an?\s+([A-Za-z' -]+?)\.?\s*$/)?.[1] ?? '').trim()

  const body = lines.slice(1)
  const scan = body.join(' ')
  let gender: LookFields['gender'] = ''
  if      (/\b(?:she|her|hers)\b/i.test(scan)) gender = 'female'
  else if (/\b(?:he|him|his)\b/i.test(scan))   gender = 'male'
  else if (/\b(?:they|them|their)\b/i.test(scan)) gender = 'nonbinary'

  const description = body
    .filter(l => l.trim() && !DROP_RE.some(re => re.test(l)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return { race, gender, description }
}

// Lower-body clothing pulls the model into a full/waist-up shot to show it, which
// fights a bust crop — strip those items from the "wearing" list so only
// upper-body attire (visible in a bust) remains.
const LOWER_BODY_RE = /\b(?:skirts?|boots?|greaves?|leggings?|trousers?|pants?|breeches|kilts?|sandals?|shoes?|slippers?|footwear|hose|stockings?|leg|legs|thigh\w*|shin\w*|anklets?)\b/i

function trimLowerBody(desc: string): string {
  return desc.replace(/((?:is|are)\s+wearing\s+)([^.]*)(\.)/i, (_m, pre: string, list: string, dot: string) => {
    const kept = list.split(/,\s*|\s+and\s+/).map(s => s.trim()).filter(Boolean).filter(it => !LOWER_BODY_RE.test(it))
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
  return `Close-up bust portrait of a ${who}, tightly cropped just below the collarbone — only ` +
    `the head, neck, shoulders and upper chest are visible; the lower body, waist and legs are ` +
    `out of frame. Front view. ` +
    `${desc} ` +
    `Style: painterly digital illustration, soft cinematic lighting, plain dark neutral ` +
    `background, single subject, detailed face. No text, no watermark, no border.`
}

export function promptFromLook(lines: string[]): string {
  return buildPortraitPrompt(parseLookFields(lines))
}
