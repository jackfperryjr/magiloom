import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  bodyInjuriesAtom, patientBodyAtom, bodySubjectAtom, selfNameAtom,
  beginTouchCaptureAtom, type BodySubject, type PatientBody,
} from '../../store/game'
import {
  type BodyPart, type PartInjury, type Injuries, isHealthy, woundCount, worstWound,
  WOUND_COLOR, SCAR_COLOR, PART_LABEL, describePart, canTakePart,
  takeWoundCommand, takeAllCommand, sampleInjuries,
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
// tooltip reads "Take chest wound" etc. Locations that can't be taken (nsys) fall
// back to the plain state description.
function takeTooltip(part: BodyPart, pi?: PartInjury): string {
  if (!pi || (pi.wound === 0 && pi.scar === 0)) return describePart(part, pi)
  if (!canTakePart(part)) return describePart(part, pi)
  return `Take ${PART_LABEL[part].toLowerCase()} ${pi.wound > 0 ? 'wound' : 'scar'}`
}

// Empath TAKE actions for the current patient. Clicking a location sends
// `TAKE <patient> <part>`; "Take all" sends `TAKE <patient> everything`.
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

// ── The patient/character figure block, shared by the panel and the overlay ───
function BodyView({ large = false }: { large?: boolean }) {
  const self       = useAtomValue(selfNameAtom)
  const injuries   = useAtomValue(bodyInjuriesAtom)
  const [patient, setPatient] = useAtom(patientBodyAtom)
  const subject    = useAtomValue(bodySubjectAtom)
  const take       = usePatientTake(patient)
  const touch      = useTouchPatient()

  const isPatient = subject === 'patient'
  if (isPatient && !patient) return <PatientEmpty />

  const showing = isPatient ? patient!.injuries : injuries
  const name    = isPatient ? patient!.name : (self || 'You')

  return (
    <>
      <div className={'body-subject-name' + (large ? ' body-subject-name-lg' : '')}>
        {name}{` — ${bodySummary(showing)}`}
      </div>
      <div className={large ? 'body-overlay-figure' : undefined}>
        <BodyFigure
          injuries={showing}
          interactive={isPatient}
          onRegionClick={isPatient ? take.takePart : undefined}
          tooltipFor={isPatient ? takeTooltip : undefined}
        />
      </div>
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

// ── The panel (sidebar) ───────────────────────────────────────────────────────
export function BodyPanel({ onExpand }: { onExpand?: () => void }) {
  const [subject, setSubject] = useAtom(bodySubjectAtom)
  return (
    <div className="body-panel">
      <div className="body-panel-head">
        <SubjectToggle subject={subject} onChange={setSubject} />
        {onExpand && (
          <Tooltip text="Enlarge">
            <button className="body-expand-btn" onClick={onExpand}>⤢</button>
          </Tooltip>
        )}
      </div>
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
      <button
        className="body-sample-link"
        data-tooltip="Preview the figure with sample wounds (no game command)"
        onClick={() => setPatient({ name: capitalize(trimmed) || 'Patient', injuries: sampleInjuries() })}
      >or load a sample</button>
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
          <div className="body-overlay-spacer" />
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="body-overlay-body">
          <BodyView large />
        </div>
      </div>
    </div>,
    document.body,
  )
}
