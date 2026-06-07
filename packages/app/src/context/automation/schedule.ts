export type AutomationSchedule =
  | { type: "interval"; minutes: number }
  | { type: "daily"; time: string }
  | { type: "weekday"; time: string }
  | { type: "weekly"; day: number; time: string }

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

function parseTime(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) return { hour: 9, minute: 0 }
  const hour = Math.max(0, Math.min(23, Number(match[1]) || 0))
  const minute = Math.max(0, Math.min(59, Number(match[2]) || 0))
  return { hour, minute }
}

function atLocalTime(base: number, time: string) {
  const { hour, minute } = parseTime(time)
  const result = new Date(base)
  result.setHours(hour, minute, 0, 0)
  return result.getTime()
}

function isWeekday(day: number) {
  return day >= 1 && day <= 5
}

export function nextAutomationRunAt(schedule: AutomationSchedule, after = Date.now()) {
  if (schedule.type === "interval") {
    const minutes = Math.max(1, Math.floor(schedule.minutes || 1))
    return after + minutes * MINUTE_MS
  }

  if (schedule.type === "daily") {
    const today = atLocalTime(after, schedule.time)
    return today > after ? today : atLocalTime(after + DAY_MS, schedule.time)
  }

  if (schedule.type === "weekday") {
    for (let offset = 0; offset < 8; offset++) {
      const candidate = atLocalTime(after + offset * DAY_MS, schedule.time)
      if (candidate <= after) continue
      if (isWeekday(new Date(candidate).getDay())) return candidate
    }
    return atLocalTime(after + DAY_MS, schedule.time)
  }

  const targetDay = Math.max(0, Math.min(6, Math.floor(schedule.day || 0)))
  for (let offset = 0; offset < 8; offset++) {
    const candidate = atLocalTime(after + offset * DAY_MS, schedule.time)
    if (candidate <= after) continue
    if (new Date(candidate).getDay() === targetDay) return candidate
  }
  return atLocalTime(after + 7 * DAY_MS, schedule.time)
}

export function advanceAutomationRunAt(schedule: AutomationSchedule, from: number, now = Date.now()) {
  let next = nextAutomationRunAt(schedule, from)
  while (next <= now) next = nextAutomationRunAt(schedule, next)
  return next
}
