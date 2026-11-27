// src/tui.tsx
import { insert as _$insert } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { isAbsolute } from "node:path";
import { Plugin } from "@opencode/plugin/tui";
import { fg, link, MouseButton, t, underline } from "@opentui/core";
import { createEffect, createMemo, createRenderEffect, createSignal, onCleanup, Show } from "solid-js";

// src/color.ts
import { RGBA } from "@opentui/core";
var LIGHT_MODE_DARKEN = 0.6;
function readable(color, mode) {
  if (mode !== "light") return color;
  return RGBA.fromValues(
    color.r * LIGHT_MODE_DARKEN,
    color.g * LIGHT_MODE_DARKEN,
    color.b * LIGHT_MODE_DARKEN,
    color.a
  );
}

// src/gh.ts
import { execFile } from "node:child_process";

// src/pr.ts
function record(value) {
  if (typeof value !== "object" || !value || Array.isArray(value)) return;
  return value;
}
function parseOptions(value) {
  const options = record(value);
  const interval = options?.interval;
  return {
    enabled: typeof options?.enabled === "boolean" ? options.enabled : true,
    interval: typeof interval === "number" && Number.isFinite(interval) ? Math.max(15, Math.min(600, Math.round(interval))) : 30,
    placement: options?.placement === "footer" ? "footer" : "sidebar",
    compact: options?.compact === true,
    showNoPr: options?.showNoPr === true
  };
}
function mergeOptions(current, change) {
  return parseOptions({ ...parseOptions(current), ...change });
}
function parseBranch(stdout) {
  const name = stdout.replace(/\r?\n$/, "");
  return name && !/[\s\p{Cc}]/u.test(name) ? name : void 0;
}
var PASSED = /* @__PURE__ */ new Set(["SUCCESS"]);
var FAILED = /* @__PURE__ */ new Set([
  "FAILURE",
  "ERROR",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
  "STALE"
]);
var IGNORED = /* @__PURE__ */ new Set(["SKIPPED", "NEUTRAL"]);
function outcome(value) {
  if (typeof value !== "string") return "running";
  if (PASSED.has(value)) return "passed";
  if (FAILED.has(value)) return "failed";
  if (IGNORED.has(value)) return "ignored";
  return "running";
}
function timestamp(value) {
  if (typeof value !== "string") return;
  const result = Date.parse(value);
  return Number.isFinite(result) && result > 0 ? result : void 0;
}
function job(value) {
  if (typeof value !== "string") return;
  const match = /^(https:\/\/[^/]+\/[^/]+\/[^/]+)\/actions\/runs\/\d+\/job\/(\d+)(?:[?#]|$)/u.exec(
    value
  );
  if (match?.[1] && match[2]) return { repository: match[1], id: BigInt(match[2]) };
}
function newer(candidate, previous) {
  if (candidate.time !== void 0 && previous.time !== void 0 && candidate.time !== previous.time) {
    return candidate.time > previous.time;
  }
  if (candidate.job && previous.job && candidate.job.repository === previous.job.repository) {
    return candidate.job.id >= previous.job.id;
  }
  if (candidate.time === void 0 && candidate.outcome === "running" && previous.time !== void 0)
    return true;
  if (previous.time === void 0 && previous.outcome === "running" && candidate.time !== void 0)
    return false;
  if (candidate.time !== void 0) return true;
  return previous.time === void 0;
}
function aggregateChecks(value) {
  const counts = { passed: 0, failed: 0, running: 0 };
  if (!Array.isArray(value)) return counts;
  const latest = /* @__PURE__ */ new Map();
  for (const item of value) {
    const check = record(item);
    if (!check) continue;
    const kind = check.__typename;
    let key;
    let run;
    if (kind === "CheckRun" && typeof check.name === "string" && check.name) {
      key = JSON.stringify([
        kind,
        typeof check.workflowName === "string" ? check.workflowName : "",
        check.name
      ]);
      run = {
        time: timestamp(check.startedAt) ?? timestamp(check.completedAt),
        job: job(check.detailsUrl),
        outcome: check.status === "COMPLETED" ? outcome(check.conclusion) : "running"
      };
    } else if (kind === "StatusContext" && typeof check.context === "string" && check.context) {
      key = JSON.stringify([kind, check.context]);
      run = { time: timestamp(check.createdAt), job: void 0, outcome: outcome(check.state) };
    } else continue;
    const previous = latest.get(key);
    if (!previous || newer(run, previous)) latest.set(key, run);
  }
  for (const { outcome: outcome2 } of latest.values()) {
    if (outcome2 !== "ignored") counts[outcome2]++;
  }
  return counts;
}
function prUrl(value, number) {
  if (typeof value !== "string" || /[\s\p{Cc}]/u.test(value) || !/^https:\/\/[\w.:[\]-]+\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*$/iu.test(value))
    return;
  try {
    const url = new URL(value);
    if (url.pathname.split("/").at(-1) === String(number)) return url.href;
  } catch {
    return;
  }
}
function parsePr(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return;
  }
  const data = record(parsed);
  const { number, state } = data ?? {};
  if (!data || typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return;
  if (state !== "OPEN" && state !== "MERGED" && state !== "CLOSED") return;
  const url = prUrl(data.url, number);
  if (!url) return;
  const title = typeof data.title === "string" ? [
    ...data.title.replace(/[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, " ").trim()
  ].slice(0, 200).join("") : "";
  return {
    number,
    url,
    title,
    state,
    draft: data.isDraft === true,
    conflicts: data.mergeable === "CONFLICTING",
    review: typeof data.reviewDecision === "string" ? data.reviewDecision : void 0,
    checks: aggregateChecks(data.statusCheckRollup)
  };
}
function footerTone(pr, stale) {
  if (stale || pr.state !== "OPEN") return "muted";
  if (pr.conflicts || pr.checks.failed) return "error";
  if (pr.checks.running) return "warning";
  if (pr.draft || !pr.checks.passed) return "muted";
  return "success";
}
function formatPr(pr, compact) {
  const state = pr.state === "OPEN" ? pr.draft ? "draft" : "open" : pr.state.toLowerCase();
  const review = pr.review === "APPROVED" ? "approved" : pr.review === "CHANGES_REQUESTED" ? "changes requested" : pr.review === "REVIEW_REQUIRED" ? "review needed" : void 0;
  const detail = pr.state === "OPEN" ? [pr.conflicts ? "conflict" : void 0, review].filter(Boolean).join(" / ") : "";
  const { passed, failed, running } = pr.checks;
  return {
    number: `#${pr.number}`,
    url: pr.url,
    state: compact && pr.state === "OPEN" && pr.conflicts ? `${state} / conflict` : state,
    title: compact ? "" : pr.title,
    detail: compact ? "" : detail,
    checks: passed || failed || running ? { passed: `${passed} pass`, failed: `${failed} fail`, running: `${running} run` } : void 0
  };
}

// src/gh.ts
var runCommand = (command, args, cwd, signal) => new Promise((resolve) => {
  if (signal.aborted) return resolve({ stdout: "", stderr: "", code: "aborted" });
  execFile(
    command,
    args,
    {
      cwd,
      signal,
      timeout: 8e3,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: "1",
        GH_NO_UPDATE_NOTIFIER: "1",
        GH_PAGER: "cat",
        NO_COLOR: "1"
      }
    },
    (error, stdout, stderr) => resolve({ stdout, stderr, code: error ? error.code ?? "error" : 0 })
  );
});
var FIELDS = "number,url,title,state,isDraft,mergeable,reviewDecision,statusCheckRollup";
function github(run = runCommand) {
  return {
    async branch(directory, signal) {
      const result = await run(
        "git",
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        directory,
        signal
      );
      return result.code === 0 ? parseBranch(result.stdout) : void 0;
    },
    async lookup(directory, signal) {
      const result = await run("gh", ["pr", "view", "--json", FIELDS], directory, signal);
      if (result.code !== 0) {
        return /(?:^|\n)no pull requests? found for branch\b/i.test(result.stderr) ? { kind: "none" } : { kind: "unavailable" };
      }
      const pr = parsePr(result.stdout);
      return pr ? { kind: "found", pr } : { kind: "unavailable" };
    },
    async open(directory, url, signal) {
      const result = await run("gh", ["pr", "view", url, "--web"], directory, signal);
      return result.code === 0;
    }
  };
}

// src/settings.ts
var onOff = (value) => value ? "On" : "Off";
async function openSettings(context, read, update) {
  let selected;
  for (; ; ) {
    const options = read();
    selected = await context.ui.dialog.select({
      title: "GitHub PR status",
      current: selected,
      options: [
        {
          title: "Show PR status",
          value: "enabled",
          footer: onOff(options.enabled),
          description: "Turn the widget and all polling on or off"
        },
        {
          title: "Placement",
          value: "placement",
          footer: options.placement === "footer" ? "Prompt footer" : "Sidebar",
          description: "Where the PR is shown"
        },
        {
          title: "Compact",
          value: "compact",
          footer: onOff(options.compact),
          description: "Sidebar only: show just the number, state and counts"
        },
        {
          title: "Show \u201CNo PR\u201D hint",
          value: "showNoPr",
          footer: onOff(options.showNoPr),
          description: "Sidebar only: show a hint when the branch has no PR"
        },
        {
          title: "Refresh interval",
          value: "interval",
          footer: `${options.interval}s`,
          description: "Seconds between open-PR refreshes (15\u2013600)"
        }
      ]
    });
    if (!selected) return;
    if (selected === "enabled") await update({ enabled: !options.enabled });
    else if (selected === "compact") await update({ compact: !options.compact });
    else if (selected === "showNoPr") await update({ showNoPr: !options.showNoPr });
    else if (selected === "placement")
      await update({ placement: options.placement === "footer" ? "sidebar" : "footer" });
    else {
      const input = await context.ui.dialog.prompt({
        title: "Refresh interval",
        description: "Seconds between open-PR refreshes, from 15 to 600.",
        value: String(options.interval)
      });
      if (input === void 0) continue;
      const seconds = input.trim() ? Number(input) : Number.NaN;
      if (!Number.isFinite(seconds)) {
        context.ui.toast.show({ message: "Enter a number of seconds.", variant: "warning" });
        continue;
      }
      await update({ interval: seconds });
    }
  }
}

// src/tracker.ts
var BRANCH_POLL_MS = 5e3;
var STALE_MS = 15 * 6e4;
var MAX_ENTRIES = 32;
function tracker(source, intervalSeconds, now = Date.now) {
  const entries = /* @__PURE__ */ new Map();
  function display(entry) {
    if (!entry || entry.failures && now() - entry.goodAt >= STALE_MS) return;
    return entry.view;
  }
  return {
    async refresh(directory, signal, publish) {
      const branch = await source.branch(directory, signal);
      if (signal.aborted) return;
      if (!branch) return publish(void 0);
      const key = JSON.stringify([directory, branch]);
      const previous = entries.get(key);
      publish(display(previous));
      if (previous && now() < previous.next) return;
      const result = await source.lookup(directory, signal);
      if (signal.aborted) return;
      if (await source.branch(directory, signal) !== branch) {
        if (!signal.aborted) publish(void 0);
        return;
      }
      if (signal.aborted) return;
      const time = now();
      const interval = intervalSeconds() * 1e3;
      let entry;
      if (result.kind === "found") {
        const cadence = result.pr.state === "OPEN" ? interval : Math.max(3e5, interval);
        entry = {
          view: { ...result, stale: false },
          goodAt: time,
          next: time + cadence,
          failures: 0
        };
      } else if (result.kind === "none") {
        entry = {
          view: result,
          goodAt: time,
          next: time + Math.max(interval, 12e4),
          failures: 0
        };
      } else {
        const failures = (previous?.failures ?? 0) + 1;
        const old = previous?.view;
        entry = {
          view: old?.kind === "found" ? { ...old, stale: true } : void 0,
          goodAt: previous?.goodAt ?? time,
          next: time + Math.min(9e5, Math.max(interval, 3e4) * 2 ** Math.min(failures - 1, 5)),
          failures
        };
      }
      entries.delete(key);
      entries.set(key, entry);
      if (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
      publish(display(entry));
    }
  };
}

// src/tui.tsx
function linkedContent(row, content) {
  createRenderEffect(() => {
    row.content = content();
  });
}
function Widget(props) {
  const {
    context,
    options,
    gh,
    tracker: tracker2
  } = props;
  const theme = context.theme;
  const success = () => readable(theme.text.feedback.success.base, context.themeMode);
  const [view, setView] = createSignal();
  const [hover, setHover] = createSignal(false);
  const directory = createMemo(() => {
    const session = context.data.session.get(props.sessionID);
    const path = session?.location?.directory ?? context.location?.directory ?? context.data.location.default().directory;
    return path && isAbsolute(path) ? path : void 0;
  });
  const found = createMemo(() => {
    const value = view();
    return value?.kind === "found" ? value : void 0;
  });
  const formatted = createMemo(() => {
    const value = found();
    return value && formatPr(value.pr, options().compact);
  });
  createEffect(() => {
    const cwd = directory();
    setView(void 0);
    if (!cwd) return;
    let timer;
    let active;
    function pause() {
      clearTimeout(timer);
      active?.abort();
      active = void 0;
    }
    const poll = async () => {
      if (active) return;
      const request = new AbortController();
      active = request;
      try {
        await tracker2.refresh(cwd, request.signal, setView);
      } catch {
        if (!request.signal.aborted) setView(void 0);
      } finally {
        if (active === request) {
          active = void 0;
          timer = setTimeout(() => void poll(), BRANCH_POLL_MS);
        }
      }
    };
    const resume = () => {
      clearTimeout(timer);
      void poll();
    };
    context.renderer.on("focus", resume);
    context.renderer.on("blur", pause);
    onCleanup(() => {
      pause();
      context.renderer.off("focus", resume);
      context.renderer.off("blur", pause);
    });
    resume();
  });
  const lifetime = new AbortController();
  onCleanup(() => lifetime.abort());
  let opening = false;
  async function openPr() {
    const cwd = directory();
    const url = found()?.pr.url;
    if (!cwd || !url || opening) return;
    opening = true;
    try {
      if (!await gh.open(cwd, url, lifetime.signal) && !lifetime.signal.aborted) {
        context.ui.toast.show({
          message: "Could not open the pull request with gh.",
          variant: "warning"
        });
      }
    } finally {
      opening = false;
    }
  }
  let pointer;
  function startClick(event) {
    if (event.button === MouseButton.LEFT) pointer = {
      x: event.x,
      y: event.y
    };
  }
  function cancelClick() {
    pointer = void 0;
  }
  function openOnClick(event) {
    const start = pointer;
    cancelClick();
    if (event.button !== MouseButton.LEFT || event.isDragging || start?.x !== event.x || start.y !== event.y) return;
    event.stopPropagation();
    void openPr();
  }
  context.keymap.layer(() => ({
    mode: "global",
    commands: [{
      id: "opencode-gh-pr-status.open",
      title: "Open current branch PR on GitHub",
      group: "GitHub",
      palette: true,
      enabled: () => Boolean(found()),
      run: openPr
    }]
  }));
  if (props.placement === "footer") {
    return _$createComponent(Show, {
      get when() {
        return found();
      },
      children: (value) => {
        const tone = () => footerTone(value().pr, value().stale);
        const color = () => {
          const status = tone();
          if (status === "muted") return theme.text.muted;
          return status === "success" ? success() : theme.text.feedback[status].base;
        };
        return (() => {
          var _el$ = _$createElement("text");
          _$use((row) => linkedContent(row, () => t`${link(value().pr.url)(underline(fg(color())(`#${value().pr.number}`)))}`), _el$);
          _$setProp(_el$, "flexShrink", 0);
          _$setProp(_el$, "wrapMode", "none");
          _$setProp(_el$, "selectable", false);
          _$setProp(_el$, "onMouseDown", startClick);
          _$setProp(_el$, "onMouseDrag", cancelClick);
          _$setProp(_el$, "onMouseUp", openOnClick);
          return _el$;
        })();
      }
    });
  }
  return [_$createComponent(Show, {
    get when() {
      return _$memo(() => !!options().showNoPr)() && view()?.kind === "none";
    },
    get children() {
      var _el$2 = _$createElement("text");
      _$insertNode(_el$2, _$createTextNode(`No PR for this branch`));
      _$effect((_$p) => _$setProp(_el$2, "fg", theme.text.muted, _$p));
      return _el$2;
    }
  }), _$createComponent(Show, {
    get when() {
      return formatted();
    },
    children: (pr) => (() => {
      var _el$4 = _$createElement("box"), _el$8 = _$createElement("box"), _el$9 = _$createElement("text");
      _$insertNode(_el$4, _el$8);
      _$setProp(_el$4, "flexDirection", "column");
      _$setProp(_el$4, "flexShrink", 0);
      _$insert(_el$4, _$createComponent(Show, {
        get when() {
          return !options().compact;
        },
        get children() {
          var _el$5 = _$createElement("text"), _el$6 = _$createElement("b");
          _$insertNode(_el$5, _el$6);
          _$insertNode(_el$6, _$createTextNode(`GitHub PR`));
          _$effect((_$p) => _$setProp(_el$5, "fg", theme.text.base, _$p));
          return _el$5;
        }
      }), _el$8);
      _$insertNode(_el$8, _el$9);
      _$setProp(_el$8, "flexDirection", "column");
      _$setProp(_el$8, "onMouseOver", () => setHover(true));
      _$setProp(_el$8, "onMouseOut", () => setHover(false));
      _$setProp(_el$8, "onMouseDown", startClick);
      _$setProp(_el$8, "onMouseDrag", cancelClick);
      _$setProp(_el$8, "onMouseUp", openOnClick);
      _$use((row) => linkedContent(row, () => t`${options().compact ? "PR " : ""}${link(pr().url)(underline(fg(hover() ? theme.text.base : theme.text.feedback.info.base)(pr().number)))} ${pr().state}${found()?.stale ? " (stale)" : ""}`), _el$9);
      _$setProp(_el$9, "wrapMode", "none");
      _$setProp(_el$9, "truncate", true);
      _$setProp(_el$9, "selectable", false);
      _$insert(_el$8, _$createComponent(Show, {
        get when() {
          return pr().title;
        },
        get children() {
          var _el$0 = _$createElement("text");
          _$setProp(_el$0, "wrapMode", "none");
          _$setProp(_el$0, "truncate", true);
          _$setProp(_el$0, "selectable", false);
          _$insert(_el$0, () => pr().title);
          _$effect((_$p) => _$setProp(_el$0, "fg", theme.text.base, _$p));
          return _el$0;
        }
      }), null);
      _$insert(_el$4, _$createComponent(Show, {
        get when() {
          return pr().detail;
        },
        get children() {
          var _el$1 = _$createElement("text");
          _$setProp(_el$1, "wrapMode", "word");
          _$insert(_el$1, () => pr().detail);
          _$effect((_$p) => _$setProp(_el$1, "fg", theme.text.muted, _$p));
          return _el$1;
        }
      }), null);
      _$insert(_el$4, _$createComponent(Show, {
        get when() {
          return pr().checks;
        },
        get fallback() {
          return (() => {
            var _el$10 = _$createElement("text");
            _$insertNode(_el$10, _$createTextNode(`No checks counted`));
            _$effect((_$p) => _$setProp(_el$10, "fg", theme.text.muted, _$p));
            return _el$10;
          })();
        },
        children: (checks) => (() => {
          var _el$12 = _$createElement("text"), _el$13 = _$createElement("span"), _el$14 = _$createTextNode(`  `), _el$15 = _$createElement("span"), _el$16 = _$createTextNode(`  `), _el$17 = _$createElement("span");
          _$insertNode(_el$12, _el$13);
          _$insertNode(_el$12, _el$14);
          _$insertNode(_el$12, _el$15);
          _$insertNode(_el$12, _el$16);
          _$insertNode(_el$12, _el$17);
          _$setProp(_el$12, "wrapMode", "word");
          _$insert(_el$13, () => checks().passed);
          _$insert(_el$15, () => checks().failed);
          _$insert(_el$17, () => checks().running);
          _$effect((_p$) => {
            var _v$ = theme.text.muted, _v$2 = {
              fg: success()
            }, _v$3 = {
              fg: theme.text.feedback.error.base
            }, _v$4 = {
              fg: theme.text.feedback.warning.base
            };
            _v$ !== _p$.e && (_p$.e = _$setProp(_el$12, "fg", _v$, _p$.e));
            _v$2 !== _p$.t && (_p$.t = _$setProp(_el$13, "style", _v$2, _p$.t));
            _v$3 !== _p$.a && (_p$.a = _$setProp(_el$15, "style", _v$3, _p$.a));
            _v$4 !== _p$.o && (_p$.o = _$setProp(_el$17, "style", _v$4, _p$.o));
            return _p$;
          }, {
            e: void 0,
            t: void 0,
            a: void 0,
            o: void 0
          });
          return _el$12;
        })()
      }), null);
      _$effect((_$p) => _$setProp(_el$9, "fg", theme.text.muted, _$p));
      return _el$4;
    })()
  })];
}
var tui_default = Plugin.define({
  id: "opencode-gh-pr-status",
  setup(context) {
    const [stored, mutate] = context.storage.store("settings", {
      initial: parseOptions(void 0)
    });
    const options = () => parseOptions(stored);
    const update = (change) => mutate((draft) => {
      Object.assign(draft, mergeOptions(draft, change));
    });
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "opencode-gh-pr-status.settings",
        title: "GitHub PR status settings",
        group: "GitHub",
        palette: true,
        run: () => void openSettings(context, options, update)
      }]
    }));
    const gh = github();
    const cache = tracker(gh, () => options().interval);
    const widget = (sessionID, placement) => _$createComponent(Widget, {
      context,
      sessionID,
      options,
      placement,
      gh,
      tracker: cache
    });
    const footer = context.ui.slot({
      append: "prompt.footer.status",
      render: (props) => _$createComponent(Show, {
        get when() {
          return _$memo(() => !!(options().enabled && options().placement === "footer"))() && props.sessionID;
        },
        keyed: true,
        children: (sessionID) => widget(sessionID, "footer")
      })
    });
    const sidebar = context.ui.slot({
      append: "sidebar.content",
      render: (props) => _$createComponent(Show, {
        get when() {
          return _$memo(() => !!options().enabled)() && options().placement === "sidebar";
        },
        get children() {
          return widget(props.sessionID, "sidebar");
        }
      })
    });
    return () => {
      footer();
      sidebar();
    };
  }
});
export {
  tui_default as default
};
