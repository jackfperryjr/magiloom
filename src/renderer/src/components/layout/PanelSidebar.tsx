import { useState, useRef, useCallback, useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { Tooltip } from '../ui/Tooltip'
import { convLinesAtom } from '../../store/game'
import { useIsMobile } from '../../hooks/useIsMobile'

export type PanelId = 'room' | 'map' | 'experience' | 'spells' | 'conversation' | 'inventory' | 'combat' | 'atmo' | 'deaths' | 'connections' | 'scripts' | 'lich'

export interface PanelConfig {
  id:      PanelId
  label:   string
  visible: boolean
}

const DEFAULT_PANELS: PanelConfig[] = [
  { id: 'room',         label: 'Room',          visible: true  },
  { id: 'map',          label: 'Map',           visible: true  },
  { id: 'experience',   label: 'Experience',    visible: true  },
  { id: 'spells',       label: 'Active Spells', visible: false  },
  { id: 'combat',       label: 'Combat',        visible: true },
  { id: 'atmo',         label: 'Atmosphere',    visible: false },
  { id: 'conversation', label: 'Conversation',  visible: true },
  { id: 'inventory',    label: 'Inventory',     visible: false },
  { id: 'deaths',       label: 'Deaths',        visible: false },
  { id: 'connections',  label: 'Connections',   visible: false },
  { id: 'scripts',      label: 'Scripts',       visible: false },
  { id: 'lich',         label: 'Lich Log',      visible: false },
]

// Panel layout is per-character, stored in the shared settings.json under the
// character's `characters[name]` namespace (previously in localStorage — those
// legacy keys are migrated up on first load). A character with nothing saved
// falls back to DEFAULT_PANELS (app defaults).
const panelsKey  = (name: string) => `magiloom-panels-v4:${name.trim().toLowerCase()}`
const heightsKey = (name: string) => `magiloom-panel-heights-v1:${name.trim().toLowerCase()}`

// Drop panels that no longer exist (e.g. vitals moved to the top bar) and append
// any newly-added defaults, preserving the user's order/visibility.
function reconcilePanels(saved: PanelConfig[] | undefined): PanelConfig[] {
  if (!saved || saved.length === 0) return DEFAULT_PANELS
  const valid  = new Set(DEFAULT_PANELS.map(p => p.id))
  const kept   = saved.filter(p => valid.has(p.id))
  const have   = new Set(kept.map(p => p.id))
  for (const d of DEFAULT_PANELS) if (!have.has(d.id)) kept.push(d)
  return kept
}

function readLegacy<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); if (raw) return JSON.parse(raw) as T } catch {}
  return null
}

async function loadPanelLayout(name: string): Promise<{ panels: PanelConfig[]; heights: Record<string, number> }> {
  try {
    const c = await window.dr.settings.getChar(name)
    let panels  = c.panels as PanelConfig[] | undefined
    let heights = c.panelHeights as Record<string, number> | undefined

    // One-time migration from the old localStorage keys.
    if (!panels) {
      const legacy = readLegacy<PanelConfig[]>(panelsKey(name))
      if (legacy) { panels = legacy; window.dr.settings.patchChar(name, { panels: legacy }); try { localStorage.removeItem(panelsKey(name)) } catch {} }
    }
    if (!heights) {
      const legacy = readLegacy<Record<string, number>>(heightsKey(name))
      if (legacy) { heights = legacy; window.dr.settings.patchChar(name, { panelHeights: legacy }); try { localStorage.removeItem(heightsKey(name)) } catch {} }
    }
    return { panels: reconcilePanels(panels), heights: heights ?? {} }
  } catch {
    return { panels: DEFAULT_PANELS, heights: {} }
  }
}

function savePanels(name: string, panels: PanelConfig[]) {
  window.dr.settings.patchChar(name, { panels })
}

function saveHeights(name: string, heights: Record<string, number>) {
  window.dr.settings.patchChar(name, { panelHeights: heights })
}

// ── Single panel ───────────────────────────────────────────────────────────────
function Panel({
  config, children, onToggle, onClear,
  height, onResizeBottom, onResizeTop,
}: {
  config:          PanelConfig
  children:        React.ReactNode
  onToggle:        () => void
  onClear?:        () => void
  height:          number | null
  onResizeBottom:  (h: number) => void
  onResizeTop?:    (delta: number) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [ctxMenu,   setCtxMenu]   = useState<{ x: number; y: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const dragMode   = useRef<'top' | 'bottom' | null>(null)
  const startY     = useRef(0)
  const startH     = useRef(0)
  const onBottomCb = useRef(onResizeBottom)
  const onTopCb    = useRef(onResizeTop)
  useEffect(() => { onBottomCb.current = onResizeBottom }, [onResizeBottom])
  useEffect(() => { onTopCb.current    = onResizeTop    }, [onResizeTop])

  const beginDrag = (mode: 'top' | 'bottom', e: React.MouseEvent) => {
    e.preventDefault()
    dragMode.current = mode
    startY.current   = e.clientY
    startH.current   = bodyRef.current?.clientHeight ?? 120
    document.body.style.cursor     = 'ns-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragMode.current) return
      if (dragMode.current === 'bottom') {
        const newH = Math.max(48, startH.current + (e.clientY - startY.current))
        onBottomCb.current(newH)
      } else {
        const delta = e.clientY - startY.current
        startY.current = e.clientY
        onTopCb.current?.(delta)
      }
    }
    const onUp = () => {
      if (!dragMode.current) return
      dragMode.current = null
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [])

  return (
    <div className="panel-card" data-panel-id={config.id}>
      {onResizeTop && (
        <div
          className="panel-resize-handle panel-resize-handle-top"
          onMouseDown={e => beginDrag('top', e)}
          data-tooltip="Drag to resize"
        />
      )}
      <div
        className="panel-header"
        onDoubleClick={() => setCollapsed(c => !c)}
        onContextMenu={onClear ? (e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }) } : undefined}
      >
        <span className="panel-title">{config.label}</span>
        <div className="panel-header-actions">
          <Tooltip text={collapsed ? 'Expand' : 'Collapse'}>
            <button className="panel-collapse-btn" onClick={() => setCollapsed(c => !c)}>
              {collapsed ? '▸' : '▾'}
            </button>
          </Tooltip>
          <Tooltip text="Hide panel">
            <button className="panel-collapse-btn" onClick={onToggle} style={{ opacity: 0.5 }}>×</button>
          </Tooltip>
        </div>
      </div>
      {ctxMenu && (
        <>
          <div className="panel-ctx-backdrop" onClick={() => setCtxMenu(null)} />
          <div className="panel-ctx-menu" style={{ top: ctxMenu.y, left: ctxMenu.x }}>
            <div className="panel-ctx-item" onClick={() => { onClear?.(); setCtxMenu(null) }}>Clear</div>
          </div>
        </>
      )}
      {!collapsed && (
        <>
          <div
            ref={bodyRef}
            className="panel-content panel-content-scroll"
            style={height !== null
              ? { height, maxHeight: 'none', overflowY: 'auto' }
              : { maxHeight: 220, overflowY: 'auto' }}
          >
            {children}
          </div>
          <div
            className="panel-resize-handle"
            onMouseDown={e => beginDrag('bottom', e)}
            data-tooltip="Drag to resize"
          />
        </>
      )}
    </div>
  )
}

// ── Discord-style panel rail ────────────────────────────────────────────────────
// A narrow full-height rail beside the sidebar with one icon per open panel.
// Clicking an icon scrolls that panel into view. The conversation icon shows an
// unread dot when new lines arrive while its panel is off-screen; the dot clears
// once the panel scrolls back into view (by click or manual scroll).
// Every panel button auto-uses a custom image at public/panels/<id>.jpg if one
// exists (cover-cropped to fill the tile), else falls back to the panel's capital
// initial. So to give any panel a real icon, just drop `<panel-id>.jpg` into
// public/panels — no code change. Panel ids: room, map, experience, spells,
// combat, atmo, conversation, inventory, deaths, connections, scripts, lich.
function RailIcon({ id, label }: { id: PanelId; label: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="panel-rail-icon">{label.charAt(0).toUpperCase()}</span>
  return (
    <img
      className="panel-rail-img"
      src={`./panels/${id}.jpg`}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}

function PanelRail({ panels, scrollRef, onSelect, openPanel }: {
  panels:    PanelConfig[]                       // visible panels, in order
  scrollRef: React.RefObject<HTMLDivElement>     // the .panel-sidebar-scroll container
  onSelect:  (id: PanelId) => void               // desktop: scroll to it; mobile: open overlay
  openPanel: PanelId | null                      // mobile: which panel overlay is open
}) {
  const isMobile = useIsMobile()
  const convCount = useAtomValue(convLinesAtom).length
  const [convUnread, setConvUnread] = useState(false)
  const convVisibleRef = useRef(true)
  const prevCount      = useRef(convCount)
  const ids = panels.map(p => p.id).join(',')

  // Desktop: track whether the conversation panel is on-screen within the scroll
  // area (re-attaches only when the panel set changes). Skipped on mobile, where
  // the sidebar is hidden and the observer can't fire.
  useEffect(() => {
    if (isMobile) return
    const root   = scrollRef.current
    const target = root?.querySelector('[data-panel-id="conversation"]')
    if (!root || !target) { convVisibleRef.current = false; return }
    const io = new IntersectionObserver(([entry]) => {
      convVisibleRef.current = entry.isIntersecting
      if (entry.isIntersecting) setConvUnread(false)
    }, { root, threshold: 0.3 })
    io.observe(target)
    return () => io.disconnect()
  }, [ids, scrollRef, isMobile])

  // Mobile: the conversation "panel" is an overlay — count it visible only while
  // open, so unread accrues when it's closed and clears when opened.
  useEffect(() => {
    if (!isMobile) return
    const open = openPanel === 'conversation'
    convVisibleRef.current = open
    if (open) setConvUnread(false)
  }, [isMobile, openPanel])

  // A new conversation line while the panel is off-screen → show the dot.
  useEffect(() => {
    if (convCount > prevCount.current && !convVisibleRef.current) setConvUnread(true)
    prevCount.current = convCount
  }, [convCount])

  const select = (id: PanelId) => {
    if (id === 'conversation') setConvUnread(false)
    onSelect(id)
  }

  return (
    <nav className="panel-rail">
      {panels.map(p => (
        <Tooltip key={p.id} text={p.label} placement="left">
          <span className="panel-rail-slot">
            <button className="panel-rail-btn" onClick={() => select(p.id)} aria-label={p.label}>
              <RailIcon id={p.id} label={p.label} />
              {p.id === 'conversation' && convUnread && <span className="panel-rail-dot" />}
            </button>
          </span>
        </Tooltip>
      ))}
    </nav>
  )
}

// ── Panel manager popup ────────────────────────────────────────────────────────
function PanelManager({
  panels, onToggle, onClose, anchorRef
}: {
  panels: PanelConfig[]; onToggle: (id: PanelId) => void
  onClose: () => void; anchorRef: React.RefObject<HTMLButtonElement>
}) {
  const [pos, setPos] = useState({ top: 0, right: 0 })
  useEffect(() => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
  }, [anchorRef])

  return (
    <>
      <div className="panel-manager-backdrop" onClick={onClose} />
      <div className="panel-manager-popup" style={{ top: pos.top, right: pos.right, position: 'fixed' }}>
        <div className="panel-manager-title">Panels</div>
        {panels.map(p => (
          <label key={p.id} className="panel-manager-item">
            <input type="checkbox" checked={p.visible} onChange={() => onToggle(p.id)} />
            {p.label}
          </label>
        ))}
      </div>
    </>
  )
}

// ── Main sidebar ───────────────────────────────────────────────────────────────
export function PanelSidebar({ renderPanel, getClearFn, sidebarWidth, charName = '', footer }: {
  renderPanel:   (id: PanelId) => React.ReactNode
  getClearFn?:   (id: PanelId) => (() => void) | undefined
  sidebarWidth?: number | null
  charName?:     string
  footer?:       React.ReactNode   // docked at the bottom of the sidebar (e.g. status bar)
}) {
  const [panels,      setPanels]      = useState<PanelConfig[]>(DEFAULT_PANELS)
  const [heights,     setHeights]     = useState<Record<string, number>>({})
  const [showManager, setShowManager] = useState(false)
  const managerBtnRef = useRef<HTMLButtonElement>(null)
  const scrollRef     = useRef<HTMLDivElement>(null)

  // Load this character's layout (async, from settings.json) when the active
  // character changes. charRef tracks whose layout is loaded so the persist
  // effects always write to the right character (never the previous one's under
  // the new name). loadedRef gates persistence until the async load lands, so the
  // initial default state can't overwrite stored data.
  const charRef   = useRef(charName)
  const loadedRef = useRef(false)
  useEffect(() => {
    charRef.current = charName
    loadedRef.current = false
    let cancelled = false
    loadPanelLayout(charName).then(({ panels, heights }) => {
      if (cancelled) return
      setPanels(panels)
      setHeights(heights)
      loadedRef.current = true
    })
    return () => { cancelled = true }
  }, [charName])

  useEffect(() => { if (loadedRef.current) savePanels(charRef.current, panels)   }, [panels])
  useEffect(() => { if (loadedRef.current) saveHeights(charRef.current, heights) }, [heights])

  const togglePanel = useCallback((id: PanelId) => {
    setPanels(prev => prev.map(p => p.id === id ? { ...p, visible: !p.visible } : p))
  }, [])

  const setHeight = useCallback((id: string, h: number) => {
    setHeights(prev => ({ ...prev, [id]: h }))
  }, [])

  const visible = panels.filter(p => p.visible)

  // On mobile the panel list is hidden and a rail tap opens the panel as an
  // overlay; on desktop it scrolls the panel into view within the sidebar.
  const isMobile = useIsMobile()
  const [mobilePanel, setMobilePanel] = useState<PanelId | null>(null)
  const selectPanel = useCallback((id: PanelId) => {
    if (isMobile) { setMobilePanel(id); return }
    scrollRef.current?.querySelector(`[data-panel-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [isMobile])
  const mobileCfg = mobilePanel ? visible.find(p => p.id === mobilePanel) : undefined

  return (
    <div className="panel-sidebar-wrap" style={sidebarWidth && !isMobile ? { width: sidebarWidth, flex: 'none' } : {}}>
      <aside className="panel-sidebar">
      <div className="panel-sidebar-header">
        <button ref={managerBtnRef} className="panel-manager-toggle" onClick={() => setShowManager(v => !v)}>
          ⊞ Panels
        </button>
      </div>
      <div className="panel-sidebar-scroll" ref={scrollRef}>
        {visible.map((panel, i) => (
          <Panel
            key={panel.id}
            config={panel}
            height={heights[panel.id] ?? null}
            onResizeBottom={h => setHeight(panel.id, h)}
            onResizeTop={i > 0 ? (delta) => {
              const prevId = visible[i - 1].id
              setHeights(prev => ({
                ...prev,
                [prevId]: Math.max(48, (prev[prevId] ?? 220) + delta)
              }))
            } : undefined}
            onToggle={() => togglePanel(panel.id)}
            onClear={getClearFn?.(panel.id)}
          >
            {renderPanel(panel.id)}
          </Panel>
        ))}
        {visible.length === 0 && (
          <div className="panel-sidebar-empty">No panels — click ⊞ Panels to add some.</div>
        )}
      </div>
      {footer && <div className="panel-sidebar-footer">{footer}</div>}
      {showManager && (
        <PanelManager
          panels={panels} onToggle={togglePanel}
          onClose={() => setShowManager(false)} anchorRef={managerBtnRef}
        />
      )}
      </aside>
      {visible.length > 0 && <PanelRail panels={visible} scrollRef={scrollRef} onSelect={selectPanel} openPanel={mobilePanel} />}
      {mobileCfg && (
        <div className="panel-mobile-overlay" onClick={e => e.target === e.currentTarget && setMobilePanel(null)}>
          <div className="panel-mobile-sheet">
            <div className="panel-mobile-head">
              <span className="panel-title">{mobileCfg.label}</span>
              <button className="modal-close" onClick={() => setMobilePanel(null)}>×</button>
            </div>
            <div className="panel-mobile-body">{renderPanel(mobileCfg.id)}</div>
          </div>
        </div>
      )}
    </div>
  )
}
