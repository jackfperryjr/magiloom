// Short random id for new alias/trigger/rule rows.
export function uid() { return Math.random().toString(36).slice(2, 9) }
