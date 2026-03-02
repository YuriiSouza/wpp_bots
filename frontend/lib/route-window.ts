export type RouteShift = "AM" | "PM" | "PM2"

export function getCurrentRouteWindow(now = new Date()): {
  date: string
  shift: RouteShift
} {
  const hours = now.getHours()
  const shift: RouteShift = hours < 12 ? "AM" : hours < 18 ? "PM" : "PM2"

  return {
    date: now.toISOString().slice(0, 10),
    shift,
  }
}
