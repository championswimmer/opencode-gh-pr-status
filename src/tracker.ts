import type { Lookup } from "./gh"
import type { Pr } from "./pr"

export type View = { kind: "found"; pr: Pr; stale: boolean } | { kind: "none" } | undefined

interface Entry {
  view: View
  goodAt: number
  next: number
  failures: number
}

interface Source {
  branch(directory: string, signal: AbortSignal): Promise<string | undefined>
  lookup(directory: string, signal: AbortSignal): Promise<Lookup>
}

export const BRANCH_POLL_MS = 5_000
const STALE_MS = 15 * 60_000
const MAX_ENTRIES = 32

export function tracker(source: Source, intervalSeconds: number, now = Date.now) {
  const entries = new Map<string, Entry>()
  const interval = intervalSeconds * 1_000

  function display(entry: Entry | undefined): View {
    if (!entry || (entry.failures && now() - entry.goodAt >= STALE_MS)) return
    return entry.view
  }

  return {
    async refresh(directory: string, signal: AbortSignal, publish: (view: View) => void) {
      const branch = await source.branch(directory, signal)
      if (signal.aborted) return
      if (!branch) return publish(undefined)

      const key = JSON.stringify([directory, branch])
      const previous = entries.get(key)
      publish(display(previous))
      if (previous && now() < previous.next) return
      const result = await source.lookup(directory, signal)
      if (signal.aborted) return
      // gh infers the branch when it runs; don't publish or cache a result across a checkout.
      if ((await source.branch(directory, signal)) !== branch) {
        if (!signal.aborted) publish(undefined)
        return
      }
      if (signal.aborted) return

      const time = now()
      let entry: Entry
      if (result.kind === "found") {
        const cadence = result.pr.state === "OPEN" ? interval : Math.max(300_000, interval)
        entry = {
          view: { ...result, stale: false },
          goodAt: time,
          next: time + cadence,
          failures: 0,
        }
      } else if (result.kind === "none") {
        entry = {
          view: result,
          goodAt: time,
          next: time + Math.max(interval, 120_000),
          failures: 0,
        }
      } else {
        const failures = (previous?.failures ?? 0) + 1
        const old = previous?.view
        entry = {
          view: old?.kind === "found" ? { ...old, stale: true } : undefined,
          goodAt: previous?.goodAt ?? time,
          next:
            time + Math.min(900_000, Math.max(interval, 30_000) * 2 ** Math.min(failures - 1, 5)),
          failures,
        }
      }

      entries.delete(key)
      entries.set(key, entry)
      if (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next()
        if (!oldest.done) entries.delete(oldest.value)
      }
      publish(display(entry))
    },
  }
}
