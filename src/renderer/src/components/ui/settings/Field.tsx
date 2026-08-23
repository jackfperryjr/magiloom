import type { ReactNode } from 'react'

/**
 * The two primitives every Settings tab is built from.
 *
 * Before this, each setting was a `<label class="settings-row">` holding a native
 * checkbox, with its explanation as a loose sibling `<div class="settings-hint">`.
 * That put the description outside the thing it described, so nothing could lay the
 * pair out as a unit — which is exactly what a two-column settings page needs.
 *
 * `SettingRow` owns that pairing: name + description on the left, control on the
 * right. `Toggle` replaces the native checkbox everywhere in Settings, because a
 * checkbox reads as "part of a set you submit" while these each take effect on
 * their own.
 */

/** A pill switch. Rendered as a real button so it can be styled and still be a
 *  keyboard/AT switch — `<input type=checkbox>` can't be, cross-browser. */
export function Toggle({
  checked, onChange, disabled = false, label, size = 'md',
}: {
  checked:   boolean
  onChange:  (v: boolean) => void
  disabled?: boolean
  /** Accessible name. Required when the row's visible text isn't adjacent. */
  label?:    string
  size?:     'md' | 'sm'
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={'toggle' + (checked ? ' on' : '') + (size === 'sm' ? ' toggle-sm' : '')}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  )
}

/**
 * One setting: label (+ optional description) on the left, control on the right.
 *
 * `disabled` only dims the row — the control still owns its own disabled state, so
 * a dependent row reads as unavailable without this having to know why.
 */
export function SettingRow({
  label, hint, disabled = false, stacked = false, children,
}: {
  label:     ReactNode
  hint?:     ReactNode
  disabled?: boolean
  /** Put the control under the text instead of beside it — for wide controls
   *  (a path + Browse button) that would squeeze the description to nothing. */
  stacked?:  boolean
  children:  ReactNode
}) {
  return (
    <div className={'setting-row' + (stacked ? ' setting-row-stacked' : '') + (disabled ? ' setting-row-off' : '')}>
      <div className="setting-text">
        <span className="setting-name">{label}</span>
        {hint && <span className="setting-desc">{hint}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}
