export interface Options {
  enabled: boolean
  interval: number
  placement: "sidebar" | "footer"
  compact: boolean
  showNoPr: boolean
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || !value || Array.isArray(value)) return
  return value as Record<string, unknown>
}

export function parseOptions(value: unknown): Options {
  const options = record(value)
  const interval = options?.interval
  return {
    enabled: typeof options?.enabled === "boolean" ? options.enabled : true,
    interval:
      typeof interval === "number" && Number.isFinite(interval)
        ? Math.max(15, Math.min(600, Math.round(interval)))
        : 30,
    placement: options?.placement === "footer" ? "footer" : "sidebar",
    compact: options?.compact === true,
    showNoPr: options?.showNoPr === true,
  }
}

// git symbolic-ref --quiet --short HEAD reports detached HEAD via its exit status.
export function parseBranch(stdout: string): string | undefined {
  const name = stdout.replace(/\r?\n$/, "")
  return name && !/[\s\p{Cc}]/u.test(name) ? name : undefined
}

export interface CheckCounts {
  passed: number
  failed: number
  running: number
}

type Outcome = keyof CheckCounts | "ignored"
const PASSED = new Set(["SUCCESS"])
const FAILED = new Set([
  "FAILURE",
  "ERROR",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
  "STALE",
])
const IGNORED = new Set(["SKIPPED", "NEUTRAL"])

function outcome(value: unknown): Outcome {
  if (typeof value !== "string") return "running"
  if (PASSED.has(value)) return "passed"
  if (FAILED.has(value)) return "failed"
  if (IGNORED.has(value)) return "ignored"
  return "running"
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return
  const result = Date.parse(value)
  // gh encodes unset times as "0001-01-01T00:00:00Z".
  return Number.isFinite(result) && result > 0 ? result : undefined
}

interface Run {
  time: number | undefined
  job: { repository: string; id: bigint } | undefined
  outcome: Outcome
}

function job(value: unknown): Run["job"] {
  if (typeof value !== "string") return
  const match = /^(https:\/\/[^/]+\/[^/]+\/[^/]+)\/actions\/runs\/\d+\/job\/(\d+)(?:[?#]|$)/u.exec(
    value,
  )
  if (match?.[1] && match[2]) return { repository: match[1], id: BigInt(match[2]) }
}

function newer(candidate: Run, previous: Run): boolean {
  if (
    candidate.time !== undefined &&
    previous.time !== undefined &&
    candidate.time !== previous.time
  ) {
    return candidate.time > previous.time
  }
  if (candidate.job && previous.job && candidate.job.repository === previous.job.repository) {
    return candidate.job.id >= previous.job.id
  }
  // A pending rerun may not have started yet. Don't mistake an older success for its result.
  if (
    candidate.time === undefined &&
    candidate.outcome === "running" &&
    previous.time !== undefined
  )
    return true
  if (previous.time === undefined && previous.outcome === "running" && candidate.time !== undefined)
    return false
  if (candidate.time !== undefined) return true
  return previous.time === undefined
}

export function aggregateChecks(value: unknown): CheckCounts {
  const counts: CheckCounts = { passed: 0, failed: 0, running: 0 }
  if (!Array.isArray(value)) return counts
  const latest = new Map<string, Run>()
  for (const item of value) {
    const check = record(item)
    if (!check) continue
    const kind = check.__typename
    let key: string
    let run: Run
    if (kind === "CheckRun" && typeof check.name === "string" && check.name) {
      key = JSON.stringify([
        kind,
        typeof check.workflowName === "string" ? check.workflowName : "",
        check.name,
      ])
      run = {
        time: timestamp(check.startedAt) ?? timestamp(check.completedAt),
        job: job(check.detailsUrl),
        outcome: check.status === "COMPLETED" ? outcome(check.conclusion) : "running",
      }
    } else if (kind === "StatusContext" && typeof check.context === "string" && check.context) {
      key = JSON.stringify([kind, check.context])
      run = { time: timestamp(check.createdAt), job: undefined, outcome: outcome(check.state) }
    } else continue
    const previous = latest.get(key)
    if (!previous || newer(run, previous)) latest.set(key, run)
  }
  for (const { outcome } of latest.values()) {
    if (outcome !== "ignored") counts[outcome]++
  }
  return counts
}

export interface Pr {
  number: number
  url: string
  title: string
  state: "OPEN" | "MERGED" | "CLOSED"
  draft: boolean
  conflicts: boolean
  review: string | undefined
  checks: CheckCounts
}

function prUrl(value: unknown, number: number): string | undefined {
  // Accept GitHub Enterprise hosts too, but only HTTPS pull request URLs without credentials.
  if (
    typeof value !== "string" ||
    /[\s\p{Cc}]/u.test(value) ||
    !/^https:\/\/[\w.:[\]-]+\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*$/iu.test(value)
  )
    return
  try {
    const url = new URL(value)
    if (url.pathname.split("/").at(-1) === String(number)) return url.href
  } catch {
    return
  }
}

export function parsePr(stdout: string): Pr | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return
  }
  const data = record(parsed)
  const { number, state } = data ?? {}
  if (!data || typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return
  if (state !== "OPEN" && state !== "MERGED" && state !== "CLOSED") return
  const url = prUrl(data.url, number)
  if (!url) return
  const title =
    typeof data.title === "string"
      ? [
          ...data.title
            .replace(/[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, " ")
            .trim(),
        ]
          .slice(0, 200)
          .join("")
      : ""
  return {
    number,
    url,
    title,
    state,
    draft: data.isDraft === true,
    conflicts: data.mergeable === "CONFLICTING",
    review: typeof data.reviewDecision === "string" ? data.reviewDecision : undefined,
    checks: aggregateChecks(data.statusCheckRollup),
  }
}

export type FooterTone = "error" | "warning" | "success" | "muted"

export function footerTone(pr: Pr, stale: boolean): FooterTone {
  if (stale || pr.state !== "OPEN") return "muted"
  if (pr.conflicts || pr.checks.failed) return "error"
  if (pr.checks.running) return "warning"
  if (pr.draft || !pr.checks.passed) return "muted"
  return "success"
}

export function formatPr(pr: Pr, compact: boolean) {
  const state = pr.state === "OPEN" ? (pr.draft ? "draft" : "open") : pr.state.toLowerCase()
  const review =
    pr.review === "APPROVED"
      ? "approved"
      : pr.review === "CHANGES_REQUESTED"
        ? "changes requested"
        : pr.review === "REVIEW_REQUIRED"
          ? "review needed"
          : undefined
  const detail =
    pr.state === "OPEN"
      ? [pr.conflicts ? "conflict" : undefined, review].filter(Boolean).join(" / ")
      : ""
  const { passed, failed, running } = pr.checks
  return {
    number: `#${pr.number}`,
    url: pr.url,
    state: compact && pr.state === "OPEN" && pr.conflicts ? `${state} / conflict` : state,
    title: compact ? "" : pr.title,
    detail: compact ? "" : detail,
    checks:
      passed || failed || running
        ? { passed: `${passed} pass`, failed: `${failed} fail`, running: `${running} run` }
        : undefined,
  }
}
