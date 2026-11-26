import assert from "node:assert/strict"
import { test } from "node:test"
import {
  aggregateChecks,
  footerTone,
  formatPr,
  parseBranch,
  mergeOptions,
  parseOptions,
  parsePr,
} from "../src/pr"

const older = "2026-11-10T09:00:00Z"
const newer = "2026-11-10T10:00:00Z"
const check = (name: string, conclusion: string, startedAt = older, workflowName = "CI") => ({
  __typename: "CheckRun",
  name,
  conclusion,
  startedAt,
  status: "COMPLETED",
  workflowName,
})
const status = (context: string, state: string, createdAt = older) => ({
  __typename: "StatusContext",
  context,
  state,
  createdAt,
})

test("counts the latest CheckRun per workflow and StatusContext per context", () => {
  const rollup = [
    check("test", "FAILURE"),
    check("test", "SUCCESS", newer),
    check("test", "ACTION_REQUIRED", newer, "Release"),
    check("neutral", "NEUTRAL"),
    check("skipped", "SUCCESS"),
    check("skipped", "SKIPPED", newer),
    check("unknown conclusion", "SOME_FUTURE_ENUM"),
    status("test", "ERROR"),
    status("test", "PENDING", newer),
    status("legacy failure", "FAILURE"),
    status("legacy passed", "SUCCESS"),
    status("legacy expected", "EXPECTED"),
    { ...check("queued", ""), startedAt: "0001-01-01T00:00:00Z", status: "QUEUED" },
    check("queued", "SUCCESS"),
    null,
    { __typename: "CheckRun", status: "COMPLETED" },
    {},
  ]
  const expected = { passed: 2, failed: 2, running: 4 }
  assert.deepEqual(aggregateChecks(rollup), expected)
  assert.deepEqual(aggregateChecks(rollup.toReversed()), expected)
  assert.deepEqual(aggregateChecks(null), { passed: 0, failed: 0, running: 0 })
})

test("orders Actions jobs when a rerun has no start time", () => {
  const job = (id: number) => `https://github.com/owner/repo/actions/runs/1/job/${id}`
  const passed = { ...check("build", "SUCCESS"), detailsUrl: job(12) }
  const queued = (id: number) => ({
    ...check("build", "", "0001-01-01T00:00:00Z"),
    status: "QUEUED",
    detailsUrl: job(id),
  })
  assert.deepEqual(aggregateChecks([passed, queued(13)]), { passed: 0, failed: 0, running: 1 })
  assert.deepEqual(aggregateChecks([queued(11), passed]), { passed: 1, failed: 0, running: 0 })
})

test("parses a GitHub PR, sanitizes the title and formats both layouts", () => {
  const pr = parsePr(
    JSON.stringify({
      number: 1234,
      url: "https://github.com/example/repo/pull/1234",
      title: "Fix\n\u001bterminal \u202elayout",
      state: "OPEN",
      isDraft: true,
      mergeable: "CONFLICTING",
      reviewDecision: "REVIEW_REQUIRED",
      statusCheckRollup: [check("build", "SUCCESS")],
    }),
  )
  assert.ok(pr)
  assert.deepEqual(formatPr(pr, false), {
    number: "#1234",
    url: "https://github.com/example/repo/pull/1234",
    state: "draft",
    title: "Fix  terminal  layout",
    detail: "conflict / review needed",
    checks: { passed: "1 pass", failed: "0 fail", running: "0 run" },
  })
  assert.deepEqual(formatPr(pr, true), {
    ...formatPr(pr, false),
    state: "draft / conflict",
    title: "",
    detail: "",
  })
  assert.equal(formatPr({ ...pr, state: "MERGED" }, false).state, "merged")
  assert.equal(formatPr({ ...pr, state: "CLOSED" }, false).detail, "")
  assert.equal(
    formatPr({ ...pr, checks: aggregateChecks([check("skip", "SKIPPED")]) }, false).checks,
    undefined,
  )
})

test("rejects malformed PRs and accepts an Enterprise URL", () => {
  const base = {
    number: 1234,
    url: "https://git.example.com/owner/repo/pull/1234",
    state: "CLOSED",
  }
  assert.ok(parsePr(JSON.stringify(base)))
  for (const bad of [
    { url: "javascript:alert(1)" },
    { url: "https://x@y.example.com/owner/repo/pull/1234" },
    { url: "https://github.com/owner/repo/pull/4321" },
    { url: "https://github.com/owner/repo/pull/1234?next=other" },
    { url: "https://github.com/owner/repo/pull/1234\n" },
    { number: 1.2 },
    { state: "UNKNOWN" },
  ]) {
    assert.equal(parsePr(JSON.stringify({ ...base, ...bad })), undefined)
  }
  assert.equal(parsePr("{broken"), undefined)
  assert.equal(parsePr("null"), undefined)
})

test("parses symbolic-ref output and defensively clamps option values", () => {
  assert.equal(parseBranch("team/feature\r\n"), "team/feature")
  assert.equal(parseBranch(""), undefined)
  assert.equal(parseBranch("a\nb\n"), undefined)
  assert.equal(parseBranch(" spaced \n"), undefined)
  const defaults = {
    enabled: true,
    interval: 30,
    placement: "sidebar",
    compact: false,
    showNoPr: false,
  }
  assert.deepEqual(parseOptions(null), defaults)
  assert.deepEqual(
    parseOptions({ enabled: 0, interval: "15", placement: "below", compact: "true", showNoPr: 1 }),
    defaults,
  )
  assert.equal(parseOptions({ placement: ["footer"] }).placement, "sidebar")
  assert.equal(parseOptions({ placement: "sidebar" }).placement, "sidebar")
  assert.deepEqual(
    parseOptions({
      enabled: false,
      interval: -4,
      placement: "footer",
      compact: true,
      showNoPr: true,
    }),
    {
      enabled: false,
      interval: 15,
      placement: "footer",
      compact: true,
      showNoPr: true,
    },
  )
  assert.equal(parseOptions({ interval: 1_000 }).interval, 600)
  assert.equal(parseOptions({ interval: Infinity }).interval, 30)
  assert.equal(parseOptions({ interval: 22.6 }).interval, 23)
})

test("merges a settings change over current values and re-sanitizes", () => {
  assert.deepEqual(mergeOptions({ placement: "footer", compact: true }, { interval: 1_000 }), {
    enabled: true,
    interval: 600,
    placement: "footer",
    compact: true,
    showNoPr: false,
  })
  assert.equal(mergeOptions(undefined, { enabled: false }).enabled, false)
  assert.equal(mergeOptions({ interval: 90 }, { showNoPr: true }).interval, 90)
})

test("derives footer color from conflicts, failures, pending checks and terminal PR states", () => {
  const base = parsePr(
    JSON.stringify({
      number: 1,
      url: "https://github.com/owner/repo/pull/1",
      state: "OPEN",
      statusCheckRollup: [check("build", "SUCCESS")],
    }),
  )
  assert.ok(base)
  const pending = { ...base, checks: { ...base.checks, running: 2 } }
  const failing = { ...pending, checks: { ...pending.checks, failed: 1 } }
  assert.equal(footerTone(base, false), "success")
  assert.equal(footerTone(pending, false), "warning")
  assert.equal(footerTone(failing, false), "error")
  assert.equal(footerTone({ ...pending, conflicts: true }, false), "error")
  assert.equal(footerTone({ ...failing, draft: true }, false), "error")
  assert.equal(footerTone({ ...pending, draft: true }, false), "warning")
  assert.equal(footerTone({ ...base, draft: true }, false), "muted")
  assert.equal(
    footerTone({ ...base, checks: { passed: 0, failed: 0, running: 0 } }, false),
    "muted",
  )
  assert.equal(footerTone({ ...failing, state: "MERGED" }, false), "muted")
  assert.equal(footerTone({ ...failing, state: "CLOSED" }, false), "muted")
  assert.equal(footerTone(failing, true), "muted")
})
