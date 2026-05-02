import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme/context"
import { createMemo } from "solid-js"

type ThemeItem =
  | { id: string; title: string; group: "Theme"; onSelect: () => void }
  | { id: ColorScheme; title: string; group: "Color scheme"; onSelect: () => void }

export function DialogThemeList() {
  const dialog = useDialog()
  const theme = useTheme()

  const items = createMemo<ThemeItem[]>(() => [
    ...theme.ids().map((id) => ({
      id,
      title: theme.name(id),
      group: "Theme" as const,
      onSelect: () => theme.setTheme(id),
    })),
    ...(["system", "light", "dark"] as ColorScheme[]).map((id) => ({
      id,
      title: id[0]?.toUpperCase() + id.slice(1),
      group: "Color scheme" as const,
      onSelect: () => theme.setColorScheme(id),
    })),
  ])

  return (
    <Dialog title="Themes">
      <List
        class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: "Search themes", autofocus: true }}
        emptyMessage="No themes found."
        key={(item) => `${item.group}:${item.id}`}
        items={items}
        filterKeys={["title", "group"]}
        groupBy={(item) => item.group}
        onSelect={(item) => {
          if (!item) return
          item.onSelect()
          dialog.close()
        }}
      >
        {(item) => <div class="w-full truncate">{item.title}</div>}
      </List>
    </Dialog>
  )
}
