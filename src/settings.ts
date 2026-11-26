import type { Plugin } from "@opencode/plugin/tui"
import type { Options } from "./pr"

type Setting = keyof Options

const onOff = (value: boolean) => (value ? "On" : "Off")

export async function openSettings(
  context: Plugin.Context,
  read: () => Options,
  update: (change: Partial<Options>) => Promise<void>,
) {
  let selected: Setting | undefined
  for (;;) {
    const options = read()
    selected = await context.ui.dialog.select<Setting>({
      title: "GitHub PR status",
      current: selected,
      options: [
        {
          title: "Show PR status",
          value: "enabled",
          footer: onOff(options.enabled),
          description: "Turn the widget and all polling on or off",
        },
        {
          title: "Placement",
          value: "placement",
          footer: options.placement === "footer" ? "Prompt footer" : "Sidebar",
          description: "Where the PR is shown",
        },
        {
          title: "Compact",
          value: "compact",
          footer: onOff(options.compact),
          description: "Sidebar only: show just the number, state and counts",
        },
        {
          title: "Show “No PR” hint",
          value: "showNoPr",
          footer: onOff(options.showNoPr),
          description: "Sidebar only: show a hint when the branch has no PR",
        },
        {
          title: "Refresh interval",
          value: "interval",
          footer: `${options.interval}s`,
          description: "Seconds between open-PR refreshes (15–600)",
        },
      ],
    })
    if (!selected) return

    if (selected === "enabled") await update({ enabled: !options.enabled })
    else if (selected === "compact") await update({ compact: !options.compact })
    else if (selected === "showNoPr") await update({ showNoPr: !options.showNoPr })
    else if (selected === "placement")
      await update({ placement: options.placement === "footer" ? "sidebar" : "footer" })
    else {
      const input = await context.ui.dialog.prompt({
        title: "Refresh interval",
        description: "Seconds between open-PR refreshes, from 15 to 600.",
        value: String(options.interval),
      })
      if (input === undefined) continue
      const seconds = input.trim() ? Number(input) : Number.NaN
      if (!Number.isFinite(seconds)) {
        context.ui.toast.show({ message: "Enter a number of seconds.", variant: "warning" })
        continue
      }
      await update({ interval: seconds })
    }
  }
}
