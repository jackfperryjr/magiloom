// Heroicons v2 solid — viewBox 0 0 24 24

type IconProps = { size?: number; className?: string; style?: React.CSSProperties }

export function IconCog({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path fillRule="evenodd" clipRule="evenodd" d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 00-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 00-2.282.819l-.922 1.597a1.875 1.875 0 00.432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 000 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 00-.432 2.385l.922 1.597a1.875 1.875 0 002.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 002.28-.819l.923-1.597a1.875 1.875 0 00-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 000-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 00-2.282-.818l-1.019.382c-.115.043-.283.031-.45-.083a7.49 7.49 0 00-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 00-1.85-1.567h-1.843zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z" />
    </svg>
  )
}

export function IconMic({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
      <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.751 6.751 0 01-6 6.709v2.291h3a.75.75 0 010 1.5h-7.5a.75.75 0 010-1.5h3v-2.291a6.751 6.751 0 01-6-6.709v-1.5A.75.75 0 016 10.5z" />
    </svg>
  )
}

export function IconArrowDownTray({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path fillRule="evenodd" d="M12 2.25a.75.75 0 01.75.75v11.69l3.22-3.22a.75.75 0 111.06 1.06l-4.5 4.5a.75.75 0 01-1.06 0l-4.5-4.5a.75.75 0 111.06-1.06l3.22 3.22V3a.75.75 0 01.75-.75zm-9 13.5a.75.75 0 01.75.75v2.25a1.5 1.5 0 001.5 1.5h13.5a1.5 1.5 0 001.5-1.5V16.5a.75.75 0 011.5 0v2.25a3 3 0 01-3 3H5.25a3 3 0 01-3-3V16.5a.75.75 0 01.75-.75z" clipRule="evenodd" />
    </svg>
  )
}

export function IconExclamationTriangle({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
    </svg>
  )
}

export function IconTrash({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path fillRule="evenodd" clipRule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 013.878.512.75.75 0 11-.256 1.478l-.209-.035-1.005 13.07a3 3 0 01-2.991 2.77H8.084a3 3 0 01-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 01-.256-1.478A48.567 48.567 0 017.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 013.369 0c1.603.051 2.815 1.387 2.815 2.951zm-6.136-1.452a51.196 51.196 0 013.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 00-6 0v-.113c0-.794.609-1.428 1.364-1.452zm-.355 5.945a.75.75 0 10-1.5.058l.347 9a.75.75 0 101.499-.058l-.346-9zm5.48.058a.75.75 0 10-1.498-.058l-.347 9a.75.75 0 001.5.058l.345-9z" />
    </svg>
  )
}

export function IconPaintBrush({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path fillRule="evenodd" d="M20.599 1.5c-.376 0-.743.111-1.055.32l-5.08 3.385a18.747 18.747 0 00-3.471 2.987 10.04 10.04 0 014.815 4.815 18.748 18.748 0 002.987-3.472l3.386-5.079A1.902 1.902 0 0020.599 1.5zm-8.3 14.025a18.76 18.76 0 001.896-1.207 8.026 8.026 0 00-4.513-4.513A18.75 18.75 0 008.475 11.7l-.278.5a5.26 5.26 0 013.601 3.602l.502-.278zM6.75 13.5A3.75 3.75 0 003 17.25a1.5 1.5 0 01-1.601 1.497.75.75 0 00-.7 1.123 5.25 5.25 0 009.8-2.62 3.75 3.75 0 00-3.75-3.75z" clipRule="evenodd" />
    </svg>
  )
}

export function IconPhoto({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path fillRule="evenodd" d="M1.5 6a2.25 2.25 0 012.25-2.25h16.5A2.25 2.25 0 0122.5 6v12a2.25 2.25 0 01-2.25 2.25H3.75A2.25 2.25 0 011.5 18V6zM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0021 18v-1.94l-2.69-2.689a1.5 1.5 0 00-2.12 0l-.88.879.97.97a.75.75 0 11-1.06 1.06l-5.16-5.159a1.5 1.5 0 00-2.12 0L3 16.061zm10.125-7.81a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0z" clipRule="evenodd" />
    </svg>
  )
}

export function IconPower({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path fillRule="evenodd" d="M12 2.25a.75.75 0 01.75.75v9a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM6.166 5.106a.75.75 0 010 1.06 8.25 8.25 0 1011.668 0 .75.75 0 111.06-1.06c3.808 3.807 3.808 9.98 0 13.788-3.807 3.808-9.98 3.808-13.788 0-3.808-3.807-3.808-9.98 0-13.788a.75.75 0 011.06 0z" clipRule="evenodd" />
    </svg>
  )
}

// two opposing horizontal arrows — "switch character"
export function IconSwitch({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path fillRule="evenodd" d="M15.97 2.47a.75.75 0 011.06 0l3.75 3.75a.75.75 0 010 1.06l-3.75 3.75a.75.75 0 11-1.06-1.06l2.47-2.47H4.5a.75.75 0 010-1.5h13.94l-2.47-2.47a.75.75 0 010-1.06zM8.03 13.97a.75.75 0 010 1.06l-2.47 2.47H19.5a.75.75 0 010 1.5H5.56l2.47 2.47a.75.75 0 11-1.06 1.06l-3.75-3.75a.75.75 0 010-1.06l3.75-3.75a.75.75 0 011.06 0z" clipRule="evenodd" />
    </svg>
  )
}

export function IconBolt({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path fillRule="evenodd" d="M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 0 01.913-.143z" clipRule="evenodd" />
    </svg>
  )
}

// tower broadcast — used for the multi-boxing "link" control. The concentric
// arcs read as "broadcasting"; the pulse animation scales the whole glyph.
export function IconBroadcast({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} style={style} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
      <path d="M16.616 13.924a5 5 0 1 0 -9.23 0" />
      <path d="M20.307 15.469a9 9 0 1 0 -16.615 0" />
      <path d="M9 21l3 -9l3 9" />
      <path d="M10 19h4" />
    </svg>
  )
}

// Add-contact / send-message controls in the Messages panel.
export function IconPlus({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path fillRule="evenodd" clipRule="evenodd" d="M12 3.75a1.05 1.05 0 011.05 1.05v6.15h6.15a1.05 1.05 0 010 2.1h-6.15v6.15a1.05 1.05 0 01-2.1 0v-6.15H4.8a1.05 1.05 0 010-2.1h6.15V4.8A1.05 1.05 0 0112 3.75z" />
    </svg>
  )
}

export function IconPaperAirplane({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
    </svg>
  )
}

// ── Panel rail glyphs ─────────────────────────────────────────────────────────
// One per sidebar panel, drawn on the same 24-grid as the Heroicons above but
// hand-authored — the stock set has nothing for a doorway, crossed swords or a
// skull. They render at 22px inside a 42px tile, so they're built for silhouette:
// solid masses, no detail below ~1.5 units, counters (skull eyes, speech dots)
// punched with fillRule="evenodd" so they stay open at size. currentColor
// throughout, which is what lets them work on every theme.

export function IconPanelRoom({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path fillRule="evenodd" clipRule="evenodd" d="M12 1.75A8.25 8.25 0 0 0 3.75 10v10.5c0 .69.56 1.25 1.25 1.25h14c.69 0 1.25-.56 1.25-1.25V10A8.25 8.25 0 0 0 12 1.75Zm0 3.5A4.75 4.75 0 0 0 7.25 10v9.5h9.5V10A4.75 4.75 0 0 0 12 5.25ZM15.4 15.9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
    </svg>
  )
}

export function IconPanelMap({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M8 4.2 2.9 6.35a.9.9 0 0 0-.55.83v11.6a.6.6 0 0 0 .83.55L8 17.5Z" />
      <path d="M9.6 4.2v13.3l4.8 2V6.2Z" />
      <path d="M16 6.2v13.3l5.15-2.17a.9.9 0 0 0 .55-.83V4.9a.6.6 0 0 0-.83-.55L16 6.2Z" />
    </svg>
  )
}

// Calendar panel: the sky dome with sun/moons/weather — a moon and star say
// "time of day" far better than a date grid at this size.
export function IconPanelSky({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M15.8 4.2a8.4 8.4 0 1 0 3.85 11.3A6.9 6.9 0 0 1 15.8 4.2Z" />
      <path d="M19.5 1.4 20.4 3.6 22.6 4.5 20.4 5.4 19.5 7.6 18.6 5.4 16.4 4.5 18.6 3.6Z" />
    </svg>
  )
}

// Arms-out figure, echoing the wound silhouette the Body panel itself draws.
export function IconPanelBody({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M12 1.4a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
      <path d="M4.6 8.7h14.8a1.35 1.35 0 0 1 0 2.7H4.6a1.35 1.35 0 0 1 0-2.7Z" />
      <path d="M9.5 8.5h5v6.2a1.3 1.3 0 0 1-1.3 1.3h-2.4a1.3 1.3 0 0 1-1.3-1.3Z" />
      <path d="M9.4 14.6h2.2v6.3a1.1 1.1 0 1 1-2.2 0Z" />
      <path d="M12.4 14.6h2.2v6.3a1.1 1.1 0 1 1-2.2 0Z" />
    </svg>
  )
}

export function IconPanelExperience({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M4.5 13.5h3.25a.75.75 0 0 1 .75.75v6a.75.75 0 0 1-.75.75H4.5a.75.75 0 0 1-.75-.75v-6a.75.75 0 0 1 .75-.75Z" />
      <path d="M10.375 8.25h3.25a.75.75 0 0 1 .75.75v11.25a.75.75 0 0 1-.75.75h-3.25a.75.75 0 0 1-.75-.75V9a.75.75 0 0 1 .75-.75Z" />
      <path d="M16.25 3h3.25a.75.75 0 0 1 .75.75v16.5a.75.75 0 0 1-.75.75h-3.25a.75.75 0 0 1-.75-.75V3.75A.75.75 0 0 1 16.25 3Z" />
    </svg>
  )
}

export function IconPanelSpells({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M12 2.2Q13.1 10.9 21.8 12 13.1 13.1 12 21.8 10.9 13.1 2.2 12 10.9 10.9 12 2.2Z" />
      <path d="M19.4 2.6Q19.8 5.2 22.4 5.6 19.8 6 19.4 8.6 19 6 16.4 5.6 19 5.2 19.4 2.6Z" />
    </svg>
  )
}

// Crossed swords. The blades are tapered triangles rather than strokes — drawn as
// plain strokes with wedge tips, the whole thing reads as a four-headed arrow.
export function IconPanelCombat({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M21.6 2.4 8.2 17.5 6.5 15.8Z" />
      <path d="M2.4 2.4 17.5 15.8 15.8 17.5Z" />
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4.3 16.1 7.9 19.7" />
        <path d="M19.7 16.1 16.1 19.7" />
        <path d="M6.1 17.9 4.7 19.3" />
        <path d="M17.9 17.9 19.3 19.3" />
      </g>
      <path d="M3.9 19.6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z" />
      <path d="M20.1 19.6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z" />
    </svg>
  )
}

// Cloud built as overlapping circles + a base bar (union under nonzero fill) —
// far more predictable at this size than a single swept outline.
export function IconPanelAtmo({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M9 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
      <path d="M14.5 6.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2Z" />
      <path d="M17.6 10.9a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z" />
      <path d="M6.6 13.4h11.4v4.7H6.6a2.35 2.35 0 0 1 0-4.7Z" />
      <path d="M4.6 20.2h9a1.1 1.1 0 0 1 0 2.2h-9a1.1 1.1 0 0 1 0-2.2Z" />
    </svg>
  )
}

export function IconPanelConversation({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path fillRule="evenodd" clipRule="evenodd" d="M4.5 3h15A2.5 2.5 0 0 1 22 5.5v9A2.5 2.5 0 0 1 19.5 17H10.4l-4.2 3.7A.9.9 0 0 1 4.7 20V17h-.2A2.5 2.5 0 0 1 2 14.5v-9A2.5 2.5 0 0 1 4.5 3Zm3 6.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm4.5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm4.5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z" />
    </svg>
  )
}

export function IconPanelMessages({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M2.25 6.75A2.25 2.25 0 0 1 4.5 4.5h15a2.25 2.25 0 0 1 2.25 2.25v.2l-9.44 5.24a.75.75 0 0 1-.62 0L2.25 6.95Z" />
      <path d="M2.25 8.66v8.59A2.25 2.25 0 0 0 4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V8.66l-8.71 4.83a2.25 2.25 0 0 1-2.08 0Z" />
    </svg>
  )
}

export function IconPanelInventory({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M3 5.25A1.75 1.75 0 0 1 4.75 3.5h14.5A1.75 1.75 0 0 1 21 5.25v1.5A1.75 1.75 0 0 1 19.25 8.5H4.75A1.75 1.75 0 0 1 3 6.75Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M4.25 10h15.5v8.25A2.75 2.75 0 0 1 17 21H7a2.75 2.75 0 0 1-2.75-2.75Zm5 2.75a.9.9 0 0 0 0 1.8h5.5a.9.9 0 0 0 0-1.8Z" />
    </svg>
  )
}

export function IconPanelDeaths({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2.25c-5.1 0-8.75 3.6-8.75 8.4 0 2.9 1.35 5.2 3.4 6.6v2.5A2.25 2.25 0 0 0 8.9 22h6.2a2.25 2.25 0 0 0 2.25-2.25v-2.5c2.05-1.4 3.4-3.7 3.4-6.6 0-4.8-3.65-8.4-8.75-8.4ZM8.6 9.2a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Zm6.8 0a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Zm-4.8 7.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Zm2.8 0a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Z" />
    </svg>
  )
}

// Logons/logoffs of other players — two figures, not a chain link.
export function IconPanelConnections({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M8.5 3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
      <path d="M2.5 18.2c0-3.15 2.7-5.7 6-5.7s6 2.55 6 5.7v1.05c0 .69-.56 1.25-1.25 1.25H3.75c-.69 0-1.25-.56-1.25-1.25Z" />
      <path d="M17 5.25a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
      <path d="M16.4 13.05c2.65.2 4.85 2.4 5.1 5.15.07.72-.53 1.3-1.25 1.3H16.2c.2-.4.3-.85.3-1.3v-1.05c0-1.5-.43-2.9-1.18-4.06.34-.03.7-.05 1.08-.04Z" />
    </svg>
  )
}

export function IconPanelScripts({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path fillRule="evenodd" clipRule="evenodd" d="M5 3.25h14A2.75 2.75 0 0 1 21.75 6v12A2.75 2.75 0 0 1 19 20.75H5A2.75 2.75 0 0 1 2.25 18V6A2.75 2.75 0 0 1 5 3.25Zm0 2A.75.75 0 0 0 4.25 6v12c0 .41.34.75.75.75h14c.41 0 .75-.34.75-.75V6a.75.75 0 0 0-.75-.75Z" />
      <path d="M7.4 9.6 10.4 12.4 7.4 15.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.8 15.6h4.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// ── Window control icons ──────────────────────────────────────────────────────

export function IconWinMinimize({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 1" fill="currentColor" aria-hidden>
      <rect width="10" height="1"/>
    </svg>
  )
}

export function IconWinMaximize({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <rect x="0.5" y="0.5" width="9" height="9"/>
    </svg>
  )
}

export function IconWinRestore({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <rect x="2.5" y="0.5" width="7" height="7"/>
      <path d="M0.5 2.5v7h7v-2" strokeLinejoin="round"/>
    </svg>
  )
}

export function IconWinClose({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <line x1="0" y1="0" x2="10" y2="10"/>
      <line x1="10" y1="0" x2="0" y2="10"/>
    </svg>
  )
}
