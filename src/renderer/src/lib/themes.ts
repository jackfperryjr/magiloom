
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
export interface Theme {
  id:   string
  name: string
  vars: Record<string, string>
}

export const THEMES: Theme[] = [
  {
    id: 'magiloom',
    name: 'Default',
    vars: {
      '--bg-shell':      '#1a1540',
      '--bg-panel':      '#221c50',
      '--bg-input':      '#15103a',
      '--bg-sidebar':    '#1d1848',
      '--border':        '#544e96',
      '--border-soft':   '#2c2658',
      '--border-accent': '#9a95ff',
      '--text-main':     '#c8c4e8',
      '--text-dim':      '#645d8e',
      '--text-bright':   '#f0eeff',
      '--text-muted':    '#8b86cc',
      '--accent':        '#9a95ff',
      '--accent-glow':   'rgba(139,134,248,0.24)',
      '--accent-dim':    '#241d54',
      '--color-roomname':'#ffffff',
      '--color-roomdesc':'#a29ecc',
      '--color-speech':  '#58e058',
      '--color-whisper': '#6f9dff',
      '--color-thought': '#e058d8',
      '--color-warning': '#ff5820',
      '--color-bonus':   '#38d838',
      '--color-penalty': '#e83838',
      '--health-color':  '#dd1818',
      '--mana-color':    '#1850d0',
      '--stamina-color': '#40b8e0',
      '--spirit-color':  '#8828b8',
      '--bg-theme-image': 'radial-gradient(ellipse at 50% 0%, rgba(150,146,255,0.16) 0%, transparent 55%)',
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
      '--color-roomname':'#e08850',
      '--color-roomdesc':'#9a7070',
      '--color-speech':  '#58e058',
      '--color-whisper': '#6f9dff',
      '--color-thought': '#e058d8',
      '--color-warning': '#ff5040',
      '--color-bonus':   '#80c060',
      '--color-penalty': '#e03030',
      '--health-color':  '#e03030',
      '--mana-color':    '#9040c0',
      '--stamina-color': '#c07030',
      '--spirit-color':  '#d04080',
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
      '--color-roomname':'#c8b050',
      '--color-roomdesc':'#789078',
      '--color-speech':  '#58e058',
      '--color-whisper': '#6f9dff',
      '--color-thought': '#e058d8',
      '--color-warning': '#e07840',
      '--color-bonus':   '#60d870',
      '--color-penalty': '#d05040',
      '--health-color':  '#b03030',
      '--mana-color':    '#3880a0',
      '--stamina-color': '#48b858',
      '--spirit-color':  '#60a870',
      '--bg-theme-image': 'radial-gradient(ellipse at 20% 80%, rgba(20,60,20,0.2) 0%, transparent 60%)',
    }
  },
  {
    id: 'parchment',
    name: 'Parchment',
    vars: {
      '--bg-shell':      '#e5dac0',
      '--bg-panel':      '#f3ecdb',
      '--bg-input':      '#faf5e9',
      '--bg-sidebar':    '#ebe1c9',
      '--border':        '#cbb68c',
      '--border-soft':   '#ddd0af',
      '--border-accent': '#9a4718',
      '--text-main':     '#3b2c18',
      '--text-dim':      '#9c8a64',
      '--text-bright':   '#241708',
      '--text-muted':    '#786244',
      '--accent':        '#9a4718',
      '--accent-glow':   'rgba(154,71,24,0.20)',
      '--accent-dim':    '#ecdcc0',
      '--color-roomname':'#7a3410',
      '--color-roomdesc':'#5c4a34',
      '--color-speech':  '#1a7a34',
      '--color-whisper': '#2f52c0',
      '--color-thought': '#9c2894',
      '--color-warning': '#c23000',
      '--color-bonus':   '#137a30',
      '--color-penalty': '#c01818',
      '--health-color':  '#c02020',
      '--mana-color':    '#2848b8',
      '--stamina-color': '#1e8038',
      '--spirit-color':  '#7a2a90',
      '--bg-theme-image': 'url("data:image/svg+xml,%3Csvg%20width%3D%22200%22%20height%3D%22200%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cfilter%20id%3D%22n%22%3E%3CfeTurbulence%20type%3D%22fractalNoise%22%20baseFrequency%3D%220.9%22%20numOctaves%3D%224%22%20stitchTiles%3D%22stitch%22%2F%3E%3CfeColorMatrix%20type%3D%22saturate%22%20values%3D%220%22%2F%3E%3C%2Ffilter%3E%3Crect%20width%3D%22200%22%20height%3D%22200%22%20filter%3D%22url%28%23n%29%22%20opacity%3D%220.04%22%2F%3E%3C%2Fsvg%3E")',
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
      '--color-roomname':'#ffffff',
      '--color-roomdesc':'#b5bac1',
      '--color-speech':  '#58e058',
      '--color-whisper': '#6f9dff',
      '--color-thought': '#e058d8',
      '--color-warning': '#f23f43',
      '--color-bonus':   '#23a559',
      '--color-penalty': '#f23f43',
      '--health-color':  '#f23f43',
      '--mana-color':    '#5865f2',
      '--stamina-color': '#23a559',
      '--spirit-color':  '#9b59b6',
      '--bg-theme-image': 'none',
    }
  },
  {
    id: 'ff4',
    name: 'Final Fantasy IV',
    vars: {
      '--bg-shell':      '#000018',
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
      '--color-roomname':'#FFFFFF',
      '--color-roomdesc':'#A8A8A8',
      '--color-speech':  '#58e058',
      '--color-whisper': '#6f9dff',
      '--color-thought': '#e058d8',
      '--color-warning': '#FF5820',
      '--color-bonus':   '#38D838',
      '--color-penalty': '#E82020',
      '--health-color':  '#E82020',
      '--mana-color':    '#60A8FF',
      '--stamina-color': '#30D0F8',
      '--spirit-color':  '#C038E8',
      '--bg-theme-image': 'none',
    }
  },
]

export function applyTheme(id: string): void {
  const theme = THEMES.find(t => t.id === id) ?? THEMES[0]
  const root  = document.documentElement
  for (const [key, val] of Object.entries(theme.vars)) {
    root.style.setProperty(key, val)
  }
  root.dataset.theme = theme.id
  document.body.style.backgroundImage = theme.vars['--bg-theme-image'] ?? 'none'
}
