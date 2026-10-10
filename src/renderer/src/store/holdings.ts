import { atom } from 'jotai'
import { EMPTY_HOLDINGS, type HoldingsCapture, type HoldingsDoc } from '../lib/holdings'

// ── Account inventory ────────────────────────────────────────────────────────
// Every character's last INVENTORY LIST / VAULT report (see lib/holdings). The
// document is owned by the store behind window.dr.holdings — a file on the desktop,
// the signed-in account's on the server — and mirrored here for the viewer.
export const holdingsAtom = atom<HoldingsDoc>(EMPTY_HOLDINGS)

// A report the stream reader has just finished, waiting to be filed. The reader
// lives in store/game, which knows the text but not whose it is; useHoldingsSync
// knows the character and account, and files it. `seq` makes two identical reports
// in a row two distinct values.
export const holdingsCaptureAtom = atom<(HoldingsCapture & { seq: number }) | null>(null)
