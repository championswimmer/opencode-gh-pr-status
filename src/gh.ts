import { execFile } from "node:child_process"
import { parseBranch, parsePr, type Pr } from "./pr"

type ProcessResult = { stdout: string; stderr: string; code: string | number }
export type RunCommand = (
  command: string,
  args: string[],
  directory: string,
  signal: AbortSignal,
) => Promise<ProcessResult>

export const runCommand: RunCommand = (command, args, cwd, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve({ stdout: "", stderr: "", code: "aborted" })
    execFile(
      command,
      args,
      {
        cwd,
        signal,
        timeout: 8_000,
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          GH_PROMPT_DISABLED: "1",
          GH_NO_UPDATE_NOTIFIER: "1",
          GH_PAGER: "cat",
          NO_COLOR: "1",
        },
      },
      (error, stdout, stderr) =>
        resolve({ stdout, stderr, code: error ? (error.code ?? "error") : 0 }),
    )
  })

export type Lookup = { kind: "found"; pr: Pr } | { kind: "none" } | { kind: "unavailable" }

const FIELDS = "number,url,title,state,isDraft,mergeable,reviewDecision,statusCheckRollup"

export function github(run: RunCommand = runCommand) {
  return {
    async branch(directory: string, signal: AbortSignal) {
      const result = await run(
        "git",
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        directory,
        signal,
      )
      return result.code === 0 ? parseBranch(result.stdout) : undefined
    },
    async lookup(directory: string, signal: AbortSignal): Promise<Lookup> {
      // An implicit `gh pr view` understands upstream remotes and fork PRs.
      const result = await run("gh", ["pr", "view", "--json", FIELDS], directory, signal)
      if (result.code !== 0) {
        return /(?:^|\n)no pull requests? found for branch\b/i.test(result.stderr)
          ? { kind: "none" }
          : { kind: "unavailable" }
      }
      const pr = parsePr(result.stdout)
      return pr ? { kind: "found", pr } : { kind: "unavailable" }
    },
    async open(directory: string, url: string, signal: AbortSignal) {
      const result = await run("gh", ["pr", "view", url, "--web"], directory, signal)
      return result.code === 0
    },
  }
}
