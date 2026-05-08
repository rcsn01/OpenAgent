export type FollowupDockItem = { id: string; text: string }

export function buildFollowupDockModel(items: FollowupDockItem[]) {
  return {
    total: items.length,
    items,
    hasMultiple: items.length > 1,
  }
}
