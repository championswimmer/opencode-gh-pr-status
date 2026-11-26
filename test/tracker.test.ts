import assert from "node:assert/strict"
import { test } from "node:test"
import { github, type Lookup, type RunCommand } from "../src/gh"
import { parsePr } from "../src/pr"
import { tracker, type View } from "../src/tracker"

const directory = "/tmp/worktree"
const raw = JSON.stringify({
  number: 1,
  url: "https://github.com/example/repository/pull/1",
  state: "OPEN",
  statusCheckRollup: [
    { __typename: "CheckRun", name: "ci", status: "COMPLETED", conclusion: "SUCCESS" },
  ],
})
const pr = parsePr(raw)
assert.ok(pr)
const found = { kind: "found", pr } as const

test("looks up the implicit branch with gh in the session cwd and distinguishes missing PR from failures", async () => {
  const signal = new AbortController().signal
  const requests: Array<{ command: string; args: string[] }> = []
  let response: Awaited<ReturnType<RunCommand>> = { stdout: raw, stderr: "", code: 0 }
  const gh = github(async (command, args, cwd, passedSignal) => {
    assert.equal(cwd, directory)
    assert.equal(passedSignal, signal)
    requests.push({ command, args })
    return command === "git" ? { stdout: "fix/ci\n", stderr: "", code: 0 } : response
  })
  assert.equal(await gh.branch(directory, signal), "fix/ci")
  assert.deepEqual(await gh.lookup(directory, signal), found)
  assert.deepEqual(requests[0], {
    command: "git",
    args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
  })
  assert.equal(requests[1]?.command, "gh")
  assert.deepEqual(requests[1]?.args.slice(0, 3), ["pr", "view", "--json"])
  assert.match(requests[1]?.args[3] ?? "", /statusCheckRollup/u)
  response = { stdout: "", stderr: 'no pull requests found for branch "fix/ci"', code: 1 }
  assert.deepEqual(await gh.lookup(directory, signal), { kind: "none" })
  response = { stdout: "", stderr: "To get started with GitHub CLI, run: gh auth login", code: 4 }
  assert.deepEqual(await gh.lookup(directory, signal), { kind: "unavailable" })
  response = { stdout: "", stderr: "", code: "ENOENT" }
  assert.deepEqual(await gh.lookup(directory, signal), { kind: "unavailable" })
  response = { stdout: "<not JSON>", stderr: "", code: 0 }
  assert.deepEqual(await gh.lookup(directory, signal), { kind: "unavailable" })
  assert.equal(await gh.open(directory, found.pr.url, signal), true)
  assert.deepEqual(requests.at(-1), {
    command: "gh",
    args: ["pr", "view", found.pr.url, "--web"],
  })
})

function harness() {
  let time = 0
  let branch: string | undefined = "fix/ci"
  let reply: () => Lookup = () => found
  let lookups = 0
  const views: View[] = []
  const cache = tracker(
    {
      branch: async () => branch,
      lookup: async () => {
        lookups++
        return reply()
      },
    },
    () => 30,
    () => time,
  )
  return {
    go: (signal = new AbortController().signal, cwd = directory) =>
      cache.refresh(cwd, signal, (view) => views.push(view)),
    set time(newTime: number) {
      time = newTime
    },
    set branch(newBranch: string | undefined) {
      branch = newBranch
    },
    set reply(newReply: () => Lookup) {
      reply = newReply
    },
    get lookups() {
      return lookups
    },
    views,
  }
}

test("caches by directory and branch, skips no-PR retries for two minutes, and handles detached HEAD", async () => {
  const h = harness()
  await h.go()
  assert.deepEqual(h.views.at(-1), { ...found, stale: false })
  h.time = 5_000
  await h.go()
  assert.equal(h.lookups, 1)
  h.branch = "no-pr"
  h.reply = () => ({ kind: "none" })
  await h.go()
  assert.deepEqual(h.views.slice(-2), [undefined, { kind: "none" }])
  h.time = 124_999
  await h.go()
  assert.equal(h.lookups, 2)
  h.time = 125_000
  await h.go()
  assert.equal(h.lookups, 3)
  await h.go(undefined, "/tmp/other-worktree")
  assert.equal(h.lookups, 4)
  h.branch = undefined
  await h.go()
  assert.equal(h.views.at(-1), undefined)
  assert.equal(h.lookups, 4)
})

test("backs off failures and shows a stale cached PR only for a bounded time", async () => {
  const h = harness()
  await h.go()
  h.reply = () => ({ kind: "unavailable" })
  h.time = 30_000
  await h.go()
  assert.deepEqual(h.views.at(-1), { ...found, stale: true })
  h.time = 60_000
  await h.go()
  h.time = 119_999
  await h.go()
  assert.equal(h.lookups, 3)
  h.time = 120_000
  await h.go()
  assert.equal(h.lookups, 4)
  h.time = 900_000
  await h.go()
  assert.equal(h.views.at(-1), undefined)
})

test("does not publish a result across a checkout or abort", async () => {
  const h = harness()
  h.reply = () => {
    h.branch = "different-branch"
    return found
  }
  await h.go()
  assert.deepEqual(h.views, [undefined, undefined])
  const controller = new AbortController()
  h.reply = () => {
    controller.abort()
    return found
  }
  await h.go(controller.signal)
  assert.deepEqual(h.views, [undefined, undefined, undefined])
})
