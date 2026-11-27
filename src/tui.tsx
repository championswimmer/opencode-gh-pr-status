import { isAbsolute } from "node:path"
import { Plugin } from "@opencode/plugin/tui"
import {
  fg,
  link,
  MouseButton,
  t,
  underline,
  type MouseEvent,
  type StyledText,
  type TextRenderable,
} from "@opentui/core"
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  onCleanup,
  Show,
} from "solid-js"
import { readable } from "./color"
import { github } from "./gh"
import { footerTone, formatPr, mergeOptions, parseOptions, type Options } from "./pr"
import { openSettings } from "./settings"
import { BRANCH_POLL_MS, tracker, type View } from "./tracker"

type Github = ReturnType<typeof github>
type Tracker = ReturnType<typeof tracker>

function linkedContent(row: TextRenderable, content: () => StyledText) {
  // OpenTUI Solid 0.9.4 stringifies JSX `content` props; assign StyledText through Core instead.
  createRenderEffect(() => {
    row.content = content()
  })
}

function Widget(props: {
  context: Plugin.Context
  sessionID: string
  options: () => Options
  placement: Options["placement"]
  gh: Github
  tracker: Tracker
}) {
  const { context, options, gh, tracker } = props
  const theme = context.theme
  const success = () => readable(theme.text.feedback.success.base, context.themeMode)
  const [view, setView] = createSignal<View>()
  const [hover, setHover] = createSignal(false)
  const directory = createMemo(() => {
    const session = context.data.session.get(props.sessionID)
    const path =
      session?.location?.directory ??
      context.location?.directory ??
      context.data.location.default().directory
    return path && isAbsolute(path) ? path : undefined
  })
  const found = createMemo(() => {
    const value = view()
    return value?.kind === "found" ? value : undefined
  })
  const formatted = createMemo(() => {
    const value = found()
    return value && formatPr(value.pr, options().compact)
  })

  createEffect(() => {
    const cwd = directory()
    setView(undefined)
    if (!cwd) return

    let timer: ReturnType<typeof setTimeout> | undefined
    let active: AbortController | undefined
    function pause() {
      clearTimeout(timer)
      active?.abort()
      active = undefined
    }
    const poll = async () => {
      if (active) return
      const request = new AbortController()
      active = request
      try {
        await tracker.refresh(cwd, request.signal, setView)
      } catch {
        if (!request.signal.aborted) setView(undefined)
      } finally {
        if (active === request) {
          active = undefined
          timer = setTimeout(() => void poll(), BRANCH_POLL_MS)
        }
      }
    }
    const resume = () => {
      clearTimeout(timer)
      void poll()
    }
    context.renderer.on("focus", resume)
    context.renderer.on("blur", pause)
    onCleanup(() => {
      pause()
      context.renderer.off("focus", resume)
      context.renderer.off("blur", pause)
    })
    resume()
  })

  const lifetime = new AbortController()
  onCleanup(() => lifetime.abort())
  let opening = false
  async function openPr() {
    const cwd = directory()
    const url = found()?.pr.url
    if (!cwd || !url || opening) return
    opening = true
    try {
      if (!(await gh.open(cwd, url, lifetime.signal)) && !lifetime.signal.aborted) {
        context.ui.toast.show({
          message: "Could not open the pull request with gh.",
          variant: "warning",
        })
      }
    } finally {
      opening = false
    }
  }

  let pointer: { x: number; y: number } | undefined
  function startClick(event: MouseEvent) {
    if (event.button === MouseButton.LEFT) pointer = { x: event.x, y: event.y }
  }
  function cancelClick() {
    pointer = undefined
  }
  function openOnClick(event: MouseEvent) {
    const start = pointer
    cancelClick()
    if (
      event.button !== MouseButton.LEFT ||
      event.isDragging ||
      start?.x !== event.x ||
      start.y !== event.y
    )
      return
    event.stopPropagation()
    void openPr()
  }

  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "opencode-gh-pr-status.open",
        title: "Open current branch PR on GitHub",
        group: "GitHub",
        palette: true,
        enabled: () => Boolean(found()),
        run: openPr,
      },
    ],
  }))

  if (props.placement === "footer") {
    return (
      <Show when={found()}>
        {(value) => {
          const tone = () => footerTone(value().pr, value().stale)
          const color = () => {
            const status = tone()
            if (status === "muted") return theme.text.muted
            return status === "success" ? success() : theme.text.feedback[status].base
          }
          return (
            <text
              flexShrink={0}
              wrapMode="none"
              selectable={false}
              ref={(row) =>
                linkedContent(
                  row,
                  () => t`${link(value().pr.url)(underline(fg(color())(`#${value().pr.number}`)))}`,
                )
              }
              onMouseDown={startClick}
              onMouseDrag={cancelClick}
              onMouseUp={openOnClick}
            />
          )
        }}
      </Show>
    )
  }

  return (
    <>
      <Show when={options().showNoPr && view()?.kind === "none"}>
        <text fg={theme.text.muted}>No PR for this branch</text>
      </Show>
      <Show when={formatted()}>
        {(pr) => (
          <box flexDirection="column" flexShrink={0}>
            <Show when={!options().compact}>
              <text fg={theme.text.base}>
                <b>GitHub PR</b>
              </text>
            </Show>
            <box
              flexDirection="column"
              onMouseOver={() => setHover(true)}
              onMouseOut={() => setHover(false)}
              onMouseDown={startClick}
              onMouseDrag={cancelClick}
              onMouseUp={openOnClick}
            >
              <text
                fg={theme.text.muted}
                wrapMode="none"
                truncate
                selectable={false}
                ref={(row) =>
                  linkedContent(
                    row,
                    () =>
                      t`${options().compact ? "PR " : ""}${link(pr().url)(
                        underline(
                          fg(hover() ? theme.text.base : theme.text.feedback.info.base)(
                            pr().number,
                          ),
                        ),
                      )} ${pr().state}${found()?.stale ? " (stale)" : ""}`,
                  )
                }
              />
              <Show when={pr().title}>
                <text fg={theme.text.base} wrapMode="none" truncate selectable={false}>
                  {pr().title}
                </text>
              </Show>
            </box>
            <Show when={pr().detail}>
              <text fg={theme.text.muted} wrapMode="word">
                {pr().detail}
              </text>
            </Show>
            <Show
              when={pr().checks}
              fallback={<text fg={theme.text.muted}>No checks counted</text>}
            >
              {(checks) => (
                <text fg={theme.text.muted} wrapMode="word">
                  <span style={{ fg: success() }}>{checks().passed}</span>
                  {"  "}
                  <span style={{ fg: theme.text.feedback.error.base }}>{checks().failed}</span>
                  {"  "}
                  <span style={{ fg: theme.text.feedback.warning.base }}>{checks().running}</span>
                </text>
              )}
            </Show>
          </box>
        )}
      </Show>
    </>
  )
}

export default Plugin.define({
  id: "opencode-gh-pr-status",
  setup(context) {
    const [stored, mutate] = context.storage.store<Options>("settings", {
      initial: parseOptions(undefined),
    })
    const options = () => parseOptions(stored)
    const update = (change: Partial<Options>) =>
      mutate((draft) => {
        Object.assign(draft, mergeOptions(draft, change))
      })

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "opencode-gh-pr-status.settings",
          title: "GitHub PR status settings",
          group: "GitHub",
          palette: true,
          run: () => void openSettings(context, options, update),
        },
      ],
    }))

    const gh = github()
    const cache = tracker(gh, () => options().interval)
    const widget = (sessionID: string, placement: Options["placement"]) => (
      <Widget
        context={context}
        sessionID={sessionID}
        options={options}
        placement={placement}
        gh={gh}
        tracker={cache}
      />
    )
    const footer = context.ui.slot({
      append: "prompt.footer.status",
      render: (props) => (
        <Show when={options().enabled && options().placement === "footer" && props.sessionID} keyed>
          {(sessionID) => widget(sessionID, "footer")}
        </Show>
      ),
    })
    const sidebar = context.ui.slot({
      append: "sidebar.content",
      render: (props) => (
        <Show when={options().enabled && options().placement === "sidebar"}>
          {widget(props.sessionID, "sidebar")}
        </Show>
      ),
    })
    return () => {
      footer()
      sidebar()
    }
  },
})
