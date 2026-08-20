import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  bodyInjuriesAtom, patientBodyAtom, bodySubjectAtom, selfNameAtom, indicatorsAtom,
  beginTouchCaptureAtom, injuryModeAtom, setInjuryModeAtom, injuryPendingAtom,
  bodyTextModeAtom, setBodyTextModeAtom, type BodySubject, type PatientBody,
} from '../../store/game'
import {
  type BodyPart, type PartInjury, type Injuries, type InjuryLayer, type InjuryKind,
  isHealthy, woundCount, worstWound, BODY_PARTS,
  WOUND_COLOR, SCAR_COLOR, PART_LABEL, describePart, canTakePart,
  takeWoundCommand, takeAllCommand, sampleInjuries,
  INJURY_MODE_LABEL, injuryLayer, injuryKind, injuryMode,
} from '../../lib/injuries'
import { BodyFigure } from './BodyFigure'
import { Tooltip } from '../ui/Tooltip'

// Character names are capitalized (first letter up), as the game expects.
const capitalize = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s

// Send `touch <Patient>` and arm the response capture, so the assessment fills
// the Patient view. Used for the initial touch and the Refresh (link expires).
function useTouchPatient() {
  const beginTouch = useSetAtom(beginTouchCaptureAtom)
  return (rawName: string) => {
    const name = capitalize(rawName.trim())
    if (!name) return
    window.dr.game.send(`touch ${name}`)
    beginTouch(name)
  }
}

// ── Subject toggle (Character | Patient) ──────────────────────────────────────
function SubjectToggle({ subject, onChange }: { subject: BodySubject; onChange: (s: BodySubject) => void }) {
  return (
    <div className="body-toggle">
      {(['character', 'patient'] as BodySubject[]).map(s => (
        <button
          key={s}
          className={'body-toggle-btn' + (subject === s ? ' body-toggle-active' : '')}
          onClick={() => onChange(s)}
        >
          {s === 'character' ? 'Character' : 'Patient'}
        </button>
      ))}
    </div>
  )
}

// ── Injury view switch (which wounds the game reports) ───────────────────────
// DR's injury window shows one layer at a time, so this isn't a filter over data
// we already hold — picking a view re-asks the game. Internal wounds are only
// visible here.
function InjuryModeToggle() {
  const mode    = useAtomValue(injuryModeAtom)
  const setMode = useSetAtom(setInjuryModeAtom)
  const layer   = injuryLayer(mode)
  const kind    = injuryKind(mode)

  const row = <T extends string>(opts: [T, string][], current: T, pick: (v: T) => void) =>
    opts.map(([value, label]) => (
      <button
        key={value}
        className={'body-mode-btn' + (current === value ? ' body-mode-active' : '')}
        onClick={() => pick(value)}
      >{label}</button>
    ))

  return (
    <div className="body-mode" data-tooltip={`Showing: ${INJURY_MODE_LABEL[mode]}`}>
      <div className="body-mode-row">
        {row<InjuryLayer>([['external', 'Ext'], ['internal', 'Int']], layer, l => setMode(injuryMode(l, kind)))}
      </div>
      <span className="body-mode-sep" />
      <div className="body-mode-row">
        {row<InjuryKind>([['wound', 'Wounds'], ['scar', 'Scars'], ['both', 'Both']], kind, k => setMode(injuryMode(layer, k)))}
      </div>
    </div>
  )
}

// ── Text view ────────────────────────────────────────────────────────────────
// The same data as a list: readable by a screen reader, and legible in a panel
// too short for the figure. Locations stay clickable exactly as on the figure.
function BodyText({ injuries, onPartClick, tooltipFor }: {
  injuries: Injuries
  onPartClick?: (part: BodyPart) => void
  tooltipFor?: (part: BodyPart, pi?: PartInjury) => string
}) {
  const tip = tooltipFor ?? describePart
  const rows = (pick: (pi: PartInjury) => number) =>
    BODY_PARTS.map(p => ({ part: p, pi: injuries[p], rank: injuries[p] ? pick(injuries[p]!) : 0 }))
      .filter(r => r.rank > 0)

  const wounds = rows(pi => pi.wound)
  const scars  = rows(pi => pi.scar)
  if (wounds.length === 0 && scars.length === 0) return <p className="body-text-none">No injuries.</p>

  const section = (title: string, entries: ReturnType<typeof rows>, color: (rank: number) => string) =>
    entries.length > 0 && (
      <section className="body-text-section">
        <div className="body-text-head">{title}</div>
        <div className="body-text-list">
          {entries.map(({ part, pi, rank }) => (
            <button
              key={part}
              className={'body-text-item' + (onPartClick ? ' body-text-item-active' : '')}
              data-tooltip={tip(part, pi)}
              onClick={onPartClick ? () => onPartClick(part) : undefined}
            >
              {PART_LABEL[part]} <span style={{ color: color(rank) }}>({rank})</span>
            </button>
          ))}
        </div>
      </section>
    )

  return (
    <div className="body-text">
      {section('Wounds', wounds, r => WOUND_COLOR[r] || WOUND_COLOR[3])}
      {section('Scars',  scars,  () => SCAR_COLOR)}
    </div>
  )
}

// Compact severity legend.
function BodyLegend() {
  return (
    <div className="body-legend">
      <span className="body-legend-item"><span className="body-legend-dot" style={{ background: WOUND_COLOR[1] }} />minor</span>
      <span className="body-legend-item"><span className="body-legend-dot" style={{ background: WOUND_COLOR[2] }} />moderate</span>
      <span className="body-legend-item"><span className="body-legend-dot" style={{ background: WOUND_COLOR[3] }} />severe</span>
      <span className="body-legend-item"><span className="body-legend-dot body-legend-scar" style={{ background: SCAR_COLOR }} />scar</span>
    </div>
  )
}

// One-line summary of a body's state ("Unharmed" / "3 wounds — 1 severe").
function bodySummary(inj: Injuries): string {
  if (isHealthy(inj)) return 'Unharmed'
  const n = woundCount(inj)
  const worst = worstWound(inj)
  if (n === 0) return 'Scarred'
  const worstWord = ['', 'minor', 'moderate', 'severe'][worst]
  return `${n} wound${n === 1 ? '' : 's'}${worst >= 2 ? ` — worst ${worstWord}` : ''}`
}

// In the Patient view the figure regions become "take this wound" buttons — the
// tooltip reads "Take chest wound" etc. Where the game supplied its own command
// for a location, show that verbatim; it's the authority on what will happen.
// Locations that can't be taken (nsys, feet) fall back to the state description.
function takeTooltip(part: BodyPart, pi?: PartInjury): string {
  if (!pi || (pi.wound === 0 && pi.scar === 0)) return describePart(part, pi)
  if (pi.cmd) return pi.cmd
  if (!canTakePart(part, pi)) return describePart(part, pi)
  return `Take ${PART_LABEL[part].toLowerCase()} ${pi.wound > 0 ? 'wound' : 'scar'}`
}

// Empath TAKE actions for the current patient. Clicking a location sends the
// game's own command for it when there is one, else `TAKE <patient> <part>`;
// "Take all" sends `TAKE <patient> everything`.
function usePatientTake(patient: PatientBody | null) {
  const [flash, setFlash] = useState('')
  const takePart = (part: BodyPart) => {
    if (!patient) return
    const pi = patient.injuries[part]
    const cmd = takeWoundCommand(patient.name, part, pi)
    if (!cmd) {
      setFlash(pi && (pi.wound > 0 || pi.scar > 0)
        ? `${PART_LABEL[part]} can't be taken by location.`
        : `${PART_LABEL[part]}: nothing to take.`)
      return
    }
    window.dr.game.send(cmd)
    setFlash(`Sent “${cmd}”`)
  }
  const takeAll = () => {
    if (!patient) return
    if (isHealthy(patient.injuries)) { setFlash('Nothing to take.'); return }
    const cmd = takeAllCommand(patient.name)
    window.dr.game.send(cmd)
    setFlash(`Sent “${cmd}”`)
  }
  return { flash, takePart, takeAll }
}

// Take-all / refresh / clear controls + the last-sent command echo, shown under a
// loaded patient in both the panel and the overlay.
function PatientActions({ patientName, flash, onTakeAll, onRefresh, onClear }: {
  patientName: string; flash: string; onTakeAll: () => void; onRefresh: () => void; onClear: () => void
}) {
  return (
    <div className="body-actions">
      <button className="body-take-all-btn" data-tooltip={`take ${patientName} everything`} onClick={onTakeAll}>Take all</button>
      <button className="body-patient-btn" data-tooltip={`touch ${patientName} — re-read wounds (the link expires)`} onClick={onRefresh}>Refresh</button>
      <button className="body-patient-btn" onClick={onClear}>Clear</button>
      {flash && <span className="body-flash">{flash}</span>}
    </div>
  )
}

// Whole-body conditions worth showing next to the figure. These come from the
// game's own indicator flags, so they're live regardless of the injury view.
const BODY_CONDITIONS: { id: string; label: string }[] = [
  { id: 'bleeding', label: 'Bleeding' },
  { id: 'poisoned', label: 'Poisoned' },
  { id: 'diseased', label: 'Diseased' },
]

// ── The patient/character figure block, shared by the panel and the overlay ───
function BodyView({ large = false }: { large?: boolean }) {
  const self       = useAtomValue(selfNameAtom)
  const injuries   = useAtomValue(bodyInjuriesAtom)
  const [patient, setPatient] = useAtom(patientBodyAtom)
  const subject    = useAtomValue(bodySubjectAtom)
  const indicators = useAtomValue(indicatorsAtom)
  const textMode   = useAtomValue(bodyTextModeAtom)
  const pending    = useAtomValue(injuryPendingAtom)
  const mode       = useAtomValue(injuryModeAtom)
  const take       = usePatientTake(patient)
  const touch      = useTouchPatient()

  const isPatient = subject === 'patient'
  if (isPatient && !patient) return <PatientEmpty />

  const showing = isPatient ? patient!.injuries : injuries
  const name    = isPatient ? patient!.name : (self || 'You')
  // Mid-switch the figure is empty because we're waiting on the game, not
  // because the body is unhurt — say so rather than claiming "Unharmed".
  const summary = !isPatient && pending && isHealthy(showing)
    ? `reading ${INJURY_MODE_LABEL[mode].toLowerCase()}…`
    : bodySummary(showing)
  // Indicators describe our own character, so they'd be a lie over a patient.
  const conditions = isPatient ? [] : BODY_CONDITIONS.filter(c => indicators[c.id])
  const onPart     = isPatient ? take.takePart : undefined

  return (
    <>
      <div className={'body-subject-name' + (large ? ' body-subject-name-lg' : '')}>
        {name}{` — ${summary}`}
      </div>
      {textMode ? (
        <>
          <BodyText
            injuries={showing}
            onPartClick={onPart}
            tooltipFor={isPatient ? takeTooltip : undefined}
          />
          {conditions.length > 0 && (
            <div className="body-text-conds">{conditions.map(c => c.label).join(' · ')}</div>
          )}
        </>
      ) : (
        <div className={large ? 'body-overlay-figure' : undefined}>
          <BodyFigure
            injuries={showing}
            interactive={isPatient}
            onRegionClick={onPart}
            tooltipFor={isPatient ? takeTooltip : undefined}
            conditions={conditions}
            resetKey={`${subject}:${name}:${mode}`}
          />
        </div>
      )}
      <BodyLegend />
      {isPatient && patient && (
        <PatientActions
          patientName={patient.name} flash={take.flash}
          onTakeAll={take.takeAll} onRefresh={() => touch(patient.name)}
          onClear={() => setPatient(null)}
        />
      )}
      {isPatient && patient && large && (
        <p className="body-overlay-hint">
          Click a wounded location to take it onto yourself (<code>TAKE {patient.name} &lt;part&gt;</code>),
          or <b>Take all</b> for everything. <b>Refresh</b> re-touches if the link has expired.
        </p>
      )}
    </>
  )
}

// Figure ⇄ list switch, shared by the panel head and the overlay head.
function ViewModeButton() {
  const textMode = useAtomValue(bodyTextModeAtom)
  const setText  = useSetAtom(setBodyTextModeAtom)
  return (
    <Tooltip text={textMode ? 'Show the figure' : 'Show as a list'}>
      <button className="body-expand-btn" onClick={() => setText(!textMode)}>{textMode ? '⛹' : '☰'}</button>
    </Tooltip>
  )
}

// ── The panel (sidebar) ───────────────────────────────────────────────────────
export function BodyPanel({ onExpand }: { onExpand?: () => void }) {
  const [subject, setSubject] = useAtom(bodySubjectAtom)
  return (
    <div className="body-panel">
      <div className="body-panel-head">
        <SubjectToggle subject={subject} onChange={setSubject} />
        <ViewModeButton />
        {onExpand && (
          <Tooltip text="Enlarge">
            <button className="body-expand-btn" onClick={onExpand}>⤢</button>
          </Tooltip>
        )}
      </div>
      {subject === 'character' && <InjuryModeToggle />}
      <BodyView />
    </div>
  )
}

// Empty state for the empath Patient view: enter a name and TOUCH them to pull
// their wounds, or load a sample to preview the figure.
function PatientEmpty() {
  const setPatient = useSetAtom(patientBodyAtom)
  const touch = useTouchPatient()
  const [name, setName] = useState('')
  const trimmed = name.trim()
  const submit = () => { if (trimmed) touch(trimmed) }
  return (
    <div className="body-patient-empty">
      <p className="panel-empty" style={{ margin: '4px 0 10px' }}>
        Enter a patient and <b>Touch</b> to read their wounds. Empath-only; the diagnostic link expires.
      </p>
      <div className="body-patient-load">
        <input
          className="body-patient-input"
          placeholder="Patient name"
          value={name}
          onChange={e => setName(capitalize(e.target.value))}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
        />
        <button
          className="body-take-all-btn"
          data-tooltip={trimmed ? `touch ${capitalize(trimmed)}` : 'Enter a name first'}
          disabled={!trimmed}
          onClick={submit}
        >Touch</button>
      </div>
      {import.meta.env.DEV && (
        <button
          className="body-sample-link"
          data-tooltip="Preview the figure with sample wounds (no game command)"
          onClick={() => setPatient({ name: capitalize(trimmed) || 'Patient', injuries: sampleInjuries() })}
        >or load a sample</button>
      )}
    </div>
  )
}

// ── The pop-out overlay (enlarged, like the Map) ──────────────────────────────
export function BodyOverlay({ onClose }: { onClose: () => void }) {
  const [subject, setSubject] = useAtom(bodySubjectAtom)
  return createPortal(
    <div className="body-overlay-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="body-overlay">
        <div className="body-overlay-head">
          <span className="body-overlay-title">Body</span>
          <SubjectToggle subject={subject} onChange={setSubject} />
          <ViewModeButton />
          <div className="body-overlay-spacer" />
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="body-overlay-body">
          {subject === 'character' && <InjuryModeToggle />}
          <BodyView large />
        </div>
      </div>
    </div>,
    document.body,
  )
}
