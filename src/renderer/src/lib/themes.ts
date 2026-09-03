
export interface Highlight {
  id:      string
  pattern: string
  isRegex: boolean
  color:   string
  bgcolor: string
  bold:    boolean
  enabled: boolean
  class?:  string   // optional Genie-style class; disabled classes are skipped
  // Action beyond coloring (Genie-style). Undefined = 'highlight' (colorize).
  // 'gag' hides the matching line; 'sub' rewrites the matched text with `replace`.
  action?:  'gag' | 'sub'
  replace?: string  // replacement text when action === 'sub'
}

function hl(id: string, pattern: string, color: string, bgcolor = '', bold = false, isRegex = false): Highlight {
  return { id, pattern, isRegex, color, bgcolor, bold, enabled: true }
}

export const DEFAULT_HIGHLIGHTS: Highlight[] = [
  // Your character name — bright white on a dark highlight
  hl('char-name',    'Jackreous',             '#ffffff', '#2a1e3a', true),
  // Combat
  hl('death',        '\\bslain\\b|you die|killed\\b', '#ff4040', '#2a0808', true, true),
  hl('roundtime',    'Roundtime:',            '#e0c060', '', true),
  hl('stunned',      'stunned',               '#ff8040', '', true),
  hl('bleeding',     'bleeding',              '#cc3030', '', false),
  hl('webbed',       'webbed',                '#80c0e0', '', false),
  // Loot
  hl('coins',        'copper|silver|gold|platinum', '#e0c060', '', false, true),
  hl('gem',          '\\bgem\\b|\\bstone\\b|\\bcrystal\\b', '#80d8c0', '', false, true),
  // Social
  hl('speech-you',   'says,|say,|exclaims,|asks,', '#7ec8a0', '', false),
  hl('whisper',      'whispers',              '#a898d8', '', true),
  hl('thought',      'thinks,',               '#c890c8', '', true),
  // Danger
  hl('danger',       'critical|CRITICAL|shatters|broken', '#ff6040', '', true),
  // System
  hl('lich-active',  'Lich v',               '#7058c0', '', false),
  hl('exp-gained',   'You gain.*experience', '#60c878', '', false, true),
  // Navigation / social
  hl('also-here',    'Also here:',            '#d4a843', '', true),
  hl('obvious-paths','Obvious paths:',        '#60c878', '', false),
]
/**
 * Which face of a DUAL theme is showing. Single-face themes are always 'dark' —
 * every other theme in the list is dark, and the CSS that keys off a light UI
 * (see :root[data-mode="light"]) must not fire for them.
 */
export type ThemeMode = 'dark' | 'light'

export interface Theme {
  id:   string
  name: string
  /** The theme's own palette, and — for single-face themes — its only one. */
  vars: Record<string, string>
  /**
   * Present only on DUAL themes: the palette for light mode. It is a COMPLETE set
   * rather than a patch over `vars`, because applyTheme writes custom properties
   * onto the root and never clears them — a partial set would leave whichever keys
   * it omitted still holding the dark value.
   */
  light?: Record<string, string>
}

export const THEMES: Theme[] = [
  {
    id: 'magiloom',   // internal id kept stable (saved prefs + ragdoll sprite); display is "Lantern"
    name: 'Lantern',
    vars: {
      '--bg-shell':      '#1a1540',
      '--bg-panel':      '#221c50',
      '--bg-input':      '#15103a',
      '--bg-sidebar':    '#1d1848',
      '--border':        '#544e96',
      '--border-soft':   '#2c2658',
      '--border-accent': '#6467dc',
      '--text-main':     '#c8c4e8',
      '--text-dim':      '#645d8e',
      '--text-bright':   '#f0eeff',
      '--text-muted':    '#8b86cc',
      '--accent':        '#9a95ff',
      '--accent-glow':   'rgba(100,103,220,0.28)',
      '--accent-dim':    '#241d54',
      '--amber':         '#f0a24a',
      '--amber-glow':    'rgba(240,162,74,0.28)',
      '--bg-overlay':    'rgba(10, 8, 24, 0.92)',
      '--color-roomname':'#ffffff',
      '--color-roomdesc':'#a29ecc',
      '--color-speech':  '#58e058',
      '--color-whisper': '#6f9dff',
      '--color-thought': '#e058d8',
      '--color-warning': '#ff5820',
      '--color-bonus':   '#38d838',
      '--color-penalty': '#e83838',
      '--color-bold':    '#f0d84a',
      '--health-color':  '#dd1818',
      '--mana-color':    '#1850d0',
      '--stamina-color': '#40b8e0',
      '--spirit-color':  '#8828b8',
      // The map draws on its own sheet: a desaturated indigo slate, a periwinkle
      // haze for the cloud mottling, and a deep vignette for the aged edge.
      '--map-bg':       '#191634',
      '--map-haze':     'rgba(154,149,255,0.055)',
      '--map-vignette': 'rgba(5,3,18,0.55)',
      '--map-chip':     'rgba(21,16,58,0.72)',
      '--map-room':      '#2a2456',
      '--map-room-hover':'#39337a',
      '--map-line':      '#5f58a8',
      // The plush ragdoll in the Body panel. It sits ON the panel, so its fill has to
      // clear --bg-panel by enough to read as an object rather than a smudge — the
      // old shared #3a3470 was only a shade off this theme's #221c50 and vanished
      // into it. Lifted well clear here, keeping the periwinkle cast.
      '--body-base':     '#4d4596',
      '--body-eye':      '#1c1650',
      '--body-outline':  '#15102f',
      // Periwinkle wash from the top + a faint warm amber pool at the bottom edge,
      // like a lantern's light settling into the room. Both are subtle by design.
      '--bg-theme-image': 'radial-gradient(ellipse at 50% 0%, rgba(100,103,220,0.18) 0%, transparent 55%), radial-gradient(ellipse 75% 42% at 50% 100%, rgba(240,162,74,0.06) 0%, transparent 60%)',
    }
  },
  {
    id: 'bloodstone',
    name: 'Bloodstone',
    vars: {
      '--bg-shell':      '#0d0808',
      '--bg-panel':      '#160c0c',
      '--bg-input':      '#1e1010',
      '--bg-sidebar':    '#110909',
      '--border':        '#3a1818',
      '--border-soft':   '#280f0f',
      '--border-accent': '#6a2020',
      '--text-main':     '#d8b8b0',
      '--text-dim':      '#6a4040',
      '--text-bright':   '#f0ddd8',
      '--text-muted':    '#8a5858',
      '--accent':        '#c03030',
      '--accent-glow':   'rgba(192,48,48,0.18)',
      '--accent-dim':    '#4a1010',
      '--bg-overlay':    'rgba(14, 5, 5, 0.92)',
      '--color-roomname':'#e08850',
      '--color-roomdesc':'#9a7070',
      '--color-speech':  '#58e058',
      '--color-whisper': '#6f9dff',
      '--color-thought': '#e058d8',
      '--color-warning': '#ff5040',
      '--color-bonus':   '#80c060',
      '--color-penalty': '#e03030',
      '--color-bold':    '#f0d84a',
      '--health-color':  '#e03030',
      '--mana-color':    '#9040c0',
      '--stamina-color': '#c07030',
      '--spirit-color':  '#d04080',
      '--map-bg':       '#1a1213',
      '--map-haze':     'rgba(192,48,48,0.05)',
      '--map-vignette': 'rgba(4,2,2,0.45)',
      '--map-chip':     'rgba(14,8,8,0.75)',
      '--map-room':      '#2a1a1b',
      '--map-room-hover':'#3d2526',
      '--map-line':      '#5c2e2e',
      // An indigo doll on a blood-red theme was the most literal case of the figure
      // "sticking out": it was the one element on screen still wearing Lantern's hue.
      '--body-base':     '#663232',
      '--body-eye':      '#200f0f',
      '--body-outline':  '#1a0a0a',
      '--bg-theme-image': 'radial-gradient(ellipse at 80% 20%, rgba(120,20,20,0.15) 0%, transparent 60%)',
    }
  },
  {
    id: 'forest',
    name: 'Thornwood',
    vars: {
      '--bg-shell':      '#080e08',
      '--bg-panel':      '#0c140c',
      '--bg-input':      '#101a10',
      '--bg-sidebar':    '#0a110a',
      '--border':        '#1e3020',
      '--border-soft':   '#142018',
      '--border-accent': '#2e5030',
      '--text-main':     '#b8d0b0',
      '--text-dim':      '#486048',
      '--text-bright':   '#daeeda',
      '--text-muted':    '#688068',
      '--accent':        '#4a9050',
      '--accent-glow':   'rgba(74,144,80,0.18)',
      '--accent-dim':    '#1a3820',
      '--bg-overlay':    'rgba(5, 12, 6, 0.92)',
      '--color-roomname':'#c8b050',
      '--color-roomdesc':'#789078',
      '--color-speech':  '#58e058',
      '--color-whisper': '#6f9dff',
      '--color-thought': '#e058d8',
      '--color-warning': '#e07840',
      '--color-bonus':   '#60d870',
      '--color-penalty': '#d05040',
      '--color-bold':    '#f0d84a',
      '--health-color':  '#b03030',
      '--mana-color':    '#3880a0',
      '--stamina-color': '#48b858',
      '--spirit-color':  '#60a870',
      '--map-bg':       '#111a12',
      '--map-haze':     'rgba(74,144,80,0.05)',
      '--map-vignette': 'rgba(2,7,3,0.45)',
      '--map-chip':     'rgba(8,14,9,0.75)',
      '--map-room':      '#1b2a1d',
      '--map-room-hover':'#273d2a',
      '--map-line':      '#33553a',
      '--body-base':     '#2f4d31',
      '--body-eye':      '#0e1c10',
      '--body-outline':  '#08110a',
      '--bg-theme-image': 'radial-gradient(ellipse at 20% 80%, rgba(20,60,20,0.2) 0%, transparent 60%)',
    }
  },
  {
    // The one DUAL theme: a near-neutral warm grey with a light face and a dark one,
    // toggled from the character bar (see CharacterBar / applyTheme's `mode`). It
    // replaced Parchment, which was the app's only light theme — every light-UI
    // workaround that used to be scoped to [data-theme="parchment"] is now scoped to
    // [data-mode="light"] instead, so it covers this theme's light face and any
    // future one.
    //
    // The palette is drawn from the DISCONNECTED look (.app-shell-idle drains the
    // client with grayscale/saturate/brightness), but it deliberately is not that
    // filter frozen into a palette. If the chrome went fully neutral the idle filter
    // would have almost nothing left to take, and "not attached to the game" — the
    // one state that filter exists to signal — would stop reading. So the greys keep
    // a warm ash cast, and the FUNCTIONAL colours (vitals, speech, warnings) stay as
    // saturated here as in any other theme. Draining those is what disconnecting
    // still visibly does.
    id: 'ashfall',
    name: 'Ashfall',
    vars: {
      '--bg-shell':      '#191715',
      '--bg-panel':      '#221f1c',
      '--bg-input':      '#141210',
      '--bg-sidebar':    '#1d1a18',
      '--border':        '#4a443e',
      '--border-soft':   '#2c2825',
      '--border-accent': '#8a8078',
      '--text-main':     '#cdc7c0',
      '--text-dim':      '#6d665f',
      '--text-bright':   '#f2eee9',
      '--text-muted':    '#9a938b',
      '--accent':        '#b0a69c',
      '--accent-glow':   'rgba(176,166,156,0.22)',
      '--accent-dim':    '#332e2a',
      '--bg-overlay':    'rgba(12, 10, 9, 0.92)',
      '--color-roomname':'#f0ece6',
      '--color-roomdesc':'#a09890',
      '--color-speech':  '#58e058',
      '--color-whisper': '#6f9dff',
      '--color-thought': '#e058d8',
      '--color-warning': '#ff6a34',
      '--color-bonus':   '#38d838',
      '--color-penalty': '#e83838',
      '--color-bold':    '#f0d84a',
      '--health-color':  '#d02828',
      '--mana-color':    '#3a6ad0',
      '--stamina-color': '#3ab0c0',
      '--spirit-color':  '#9a58c8',
      '--map-bg':       '#1c1a18',
      '--map-haze':     'rgba(200,190,180,0.045)',
      '--map-vignette': 'rgba(6,5,4,0.5)',
      '--map-chip':     'rgba(18,16,14,0.75)',
      '--map-room':      '#2b2724',
      '--map-room-hover':'#3b3631',
      '--map-line':      '#5a534b',
      '--body-base':     '#4f4941',
      '--body-eye':      '#191614',
      '--body-outline':  '#141210',
      // Ash settling: a pale drift off the top, a heavier bank pooling at the floor.
      '--bg-theme-image': 'radial-gradient(ellipse at 50% 0%, rgba(198,184,168,0.055) 0%, transparent 55%), radial-gradient(ellipse 80% 40% at 50% 100%, rgba(120,104,88,0.10) 0%, transparent 62%)',
    },
    // Light: the same warm grey turned over. Tones invert; hue and the functional
    // colours do not — the semantic palette only DARKENS to stay legible on a pale
    // panel (a #58e058 speech green on near-white is unreadable).
    light: {
      '--bg-shell':      '#dedbd6',
      '--bg-panel':      '#f1eeea',
      '--bg-input':      '#faf8f5',
      '--bg-sidebar':    '#e6e2dd',
      '--border':        '#bab2a8',
      '--border-soft':   '#d6d0c8',
      '--border-accent': '#6b6259',
      '--text-main':     '#2c2823',
      '--text-dim':      '#8a8178',
      '--text-bright':   '#15120f',
      '--text-muted':    '#6a625a',
      '--accent':        '#6b6259',
      '--accent-glow':   'rgba(107,98,89,0.20)',
      '--accent-dim':    '#e4dfd8',
      '--bg-overlay':    'rgba(38, 33, 28, 0.66)',
      '--color-roomname':'#2a251f',
      '--color-roomdesc':'#5a5249',
      '--color-speech':  '#1a7a34',
      '--color-whisper': '#2f52c0',
      '--color-thought': '#9c2894',
      '--color-warning': '#c23000',
      '--color-bonus':   '#137a30',
      '--color-penalty': '#c01818',
      '--color-bold':    '#8a5a0c',   // deep goldenrod — legible on the pale ash panel
      '--health-color':  '#c02020',
      '--mana-color':    '#2848b8',
      '--stamina-color': '#1a7f8c',
      '--spirit-color':  '#7a2a90',
      '--map-bg':       '#e8e4de',
      '--map-haze':     'rgba(90,80,70,0.045)',
      '--map-vignette': 'rgba(90,78,64,0.20)',
      '--map-chip':     'rgba(244,241,236,0.82)',
      '--map-room':      '#d6d0c7',
      '--map-room-hover':'#c5bdb2',
      '--map-line':      '#a89e92',
      // The doll is the reason a shared palette couldn't survive. On a #f1eeea panel
      // the old dark-indigo fill under a near-black outline was the highest-contrast
      // object in the whole client — a plush toy drawn like a warning sign. Inverted
      // here the way the rest of this face is: the fill goes to a warm mid-tone that
      // reads as an object without shouting, and the OUTLINE is the real fix. A bold
      // dark keyline is what makes a figure pop off a dark panel and what makes it
      // harsh on a pale one, so it drops to a soft warm grey barely darker than the
      // fill. The wound colours deliberately do not move (see body.css) — they are
      // the one thing on this figure that is allowed to shout.
      '--body-base':     '#bdb2a4',
      '--body-eye':      '#574e45',
      '--body-outline':  '#8b8072',
      // Same two drifts, re-aimed: ash reads as shadow on a pale ground, not light.
      '--bg-theme-image': 'radial-gradient(ellipse at 50% 0%, rgba(90,78,64,0.05) 0%, transparent 55%), radial-gradient(ellipse 80% 40% at 50% 100%, rgba(70,60,50,0.07) 0%, transparent 62%)',
    }
  },
  {
    id: 'discord',
    name: 'Discord',
    vars: {
      '--bg-shell':      '#141517',
      '--bg-panel':      '#1e1f22',
      '--bg-input':      '#2b2d31',
      '--bg-sidebar':    '#18191c',
      '--border':        '#111214',
      '--border-soft':   '#202127',
      '--border-accent': '#5865f2',
      '--text-main':     '#dbdee1',
      '--text-dim':      '#80848e',
      '--text-bright':   '#ffffff',
      '--text-muted':    '#949ba4',
      '--accent':        '#5865f2',
      '--accent-glow':   'rgba(88,101,242,0.22)',
      '--accent-dim':    '#2c2f6b',
      '--bg-overlay':    'rgba(6, 7, 9, 0.9)',
      '--color-roomname':'#ffffff',
      '--color-roomdesc':'#b5bac1',
      '--color-speech':  '#58e058',
      '--color-whisper': '#6f9dff',
      '--color-thought': '#e058d8',
      '--color-warning': '#f23f43',
      '--color-bonus':   '#23a559',
      '--color-penalty': '#f23f43',
      '--color-bold':    '#f0d84a',
      '--health-color':  '#f23f43',
      '--mana-color':    '#5865f2',
      '--stamina-color': '#23a559',
      '--spirit-color':  '#9b59b6',
      '--map-bg':       '#212429',
      '--map-haze':     'rgba(88,101,242,0.05)',
      '--map-vignette': 'rgba(0,0,0,0.45)',
      '--map-chip':     'rgba(24,25,28,0.78)',
      '--map-room':      '#31353c',
      '--map-room-hover':'#3f444d',
      '--map-line':      '#4a505a',
      '--body-base':     '#4b4f5e',
      '--body-eye':      '#15161a',
      '--body-outline':  '#111214',
      '--bg-theme-image': 'none',
    }
  },
  {
    id: 'ff4',
    // Display name is the series, not the entry: the palette is drawn from IV but
    // it's meant to evoke Final Fantasy generally. The `ff4` id stays put — saved
    // per-character prefs and every [data-theme="ff4"] rule key off it.
    name: 'Final Fantasy',
    vars: {
      '--bg-shell':      '#020233',
      '--bg-panel':      'linear-gradient(180deg, #0000A8 0%, #000050 100%)',
      '--bg-input':      '#000048',
      '--bg-sidebar':    'linear-gradient(180deg, #0000A8 0%, #000050 100%)',
      '--border':        '#5068d0',
      '--border-soft':   '#1c2878',
      '--border-accent': '#FCFCFC',
      '--text-main':     '#FCFCFC',
      '--text-dim':      '#A8A8A8',
      '--text-bright':   '#FFFFFF',
      '--text-muted':    '#C8C8D8',
      '--accent':        '#FCFCFC',
      '--accent-glow':   'rgba(252,252,252,0.15)',
      '--accent-dim':    '#000060',
      '--bg-overlay':    'rgba(2, 2, 26, 0.9)',
      '--color-roomname':'#FFFFFF',
      '--color-roomdesc':'#A8A8A8',
      '--color-speech':  '#58e058',
      '--color-whisper': '#6f9dff',
      '--color-thought': '#e058d8',
      '--color-warning': '#FF5820',
      '--color-bonus':   '#38D838',
      '--color-penalty': '#E82020',
      '--color-bold':    '#F0D84A',
      '--health-color':  '#E82020',
      '--mana-color':    '#60A8FF',
      '--stamina-color': '#30D0F8',
      '--spirit-color':  '#C038E8',
      '--map-bg':       '#01073a',
      '--map-haze':     'rgba(80,104,208,0.09)',
      '--map-vignette': 'rgba(0,0,16,0.5)',
      '--map-chip':     'rgba(0,0,72,0.8)',
      '--map-room':      '#0a1470',
      '--map-room-hover':'#1a28a0',
      '--map-line':      '#5068d0',
      // This theme was first given a pale fill under a white keyline, on the theory
      // that white borders are this palette's own language so the figure would read
      // as something out of the menu it sits in. It didn't: that argument is about
      // UI CHROME, and the doll is not chrome, it's a sprite sitting on the chrome.
      // The result measured 3.9-5.4:1 against the panel where every other theme sits
      // near 2:1, and a figure two to three times louder than the same figure
      // everywhere else is exactly the inconsistency all of this exists to remove.
      //
      // So it gets the ordinary treatment: a blue a step off the panel's own, with a
      // dark keyline like everywhere else. Contrast is measured against the GRADIENT
      // MIDPOINT (#00007c) rather than either end — --bg-panel here is a gradient and
      // the figure sits in the middle of it, so neither stop is the real background.
      '--body-base':     '#3a48a0',
      '--body-eye':      '#0a0e38',
      '--body-outline':  '#10164a',
      '--bg-theme-image': 'none',
    }
  },
]

/** Whether `id` is a theme with two faces, and so has a mode worth toggling. */
export function isDualTheme(id: string): boolean {
  return !!THEMES.find(t => t.id === id)?.light
}

export function applyTheme(id: string, mode: ThemeMode = 'dark'): void {
  const theme = THEMES.find(t => t.id === id) ?? THEMES[0]
  // A saved mode of 'light' on a theme that has no light face is not an error — it's
  // what you get after switching from the dual theme to a single-face one — so it
  // falls back rather than blanking the palette.
  const light = mode === 'light' && !!theme.light
  const vars  = light ? theme.light! : theme.vars
  const root  = document.documentElement
  for (const [key, val] of Object.entries(vars)) {
    root.style.setProperty(key, val)
  }
  root.dataset.theme = theme.id
  // Read by every rule that needs a light UI rather than a specific theme.
  root.dataset.mode = light ? 'light' : 'dark'
  document.body.style.backgroundImage = vars['--bg-theme-image'] ?? 'none'
}
