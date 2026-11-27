// Goal Countdown widget for Scriptable (iPhone and iPad)
// Counts down to £100,000 of revenue by 31 Dec 2027 and shows today's tasks.
// Name this script "Goal Countdown". Needs the "Goal Plan" script.
// Tap the widget to open "Log Progress".

const P = importModule("Goal Plan")
const LOG_URL = "scriptable:///run?scriptName=Log%20Progress"

const today = P.midnight(new Date())
const data = P.load()

const days = Math.max(0, P.daysBetween(today, P.GOAL_DATE))
const visaDays = Math.max(0, P.daysBetween(today, P.VISA_DATE))
const earned = data.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
const pct = Math.min(100, Math.round((earned / P.TARGET) * 100))

const mk = P.monthKey(today)
const monthTarget = P.MONTHS[mk] || 0
const monthEarned = data.payments
  .filter(p => String(p.date).slice(0, 7) === mk)
  .reduce((s, p) => s + (Number(p.amount) || 0), 0)
const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
const behind = monthTarget > 0 && monthEarned < monthTarget * (today.getDate() / daysInMonth)

const wk = data.weeks[P.mondayKey(today)] || {}
const msgs = Number(wk.messages) || 0

const tasks = P.tasksFor(today)
const doneList = data.done[P.dayKey(today)] || []
const isDone = i => doneList.indexOf(i) >= 0
const doneCount = tasks.filter((t, i) => isDone(i)).length
const firstOpen = tasks.find((t, i) => !isDone(i))
const phase = P.phaseLabel(today)

const red = new Color("#c0262d")
const ink = Color.dynamic(new Color("#10302b"), new Color("#dcefe8"))
const soft = Color.dynamic(new Color("#4b6b64"), new Color("#93b3aa"))
const bg = Color.dynamic(new Color("#f3f9f5"), new Color("#162825"))

const w = new ListWidget()
w.url = LOG_URL

// Refresh just after midnight so the day and tasks change
const next = new Date(today)
next.setDate(next.getDate() + 1)
next.setMinutes(1)
w.refreshAfterDate = next

const family = config.widgetFamily

function line(stack, text, size, color, bold) {
  const t = stack.addText(text)
  t.font = bold ? Font.semiboldSystemFont(size) : Font.systemFont(size)
  t.textColor = color
  t.minimumScaleFactor = 0.6
  t.lineLimit = 1
  return t
}

// Open tasks first, then done ones
function taskLines(stack, max, size) {
  const items = tasks.map((t, i) => ({ t: t.t, done: isDone(i) }))
  items.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))
  if (doneCount === tasks.length) line(stack, "All done today. Log your numbers.", size, soft, false)
  items.slice(0, max).forEach(it => {
    line(stack, (it.done ? "✓ " : "○ ") + it.t, size, it.done ? soft : ink, !it.done)
    stack.addSpacer(3)
  })
  if (items.length > max) line(stack, "+" + (items.length - max) + " more", size - 1, soft, false)
}

function header(stack) {
  const row = stack.addStack()
  row.layoutHorizontally()
  const h = row.addText("£100K GOAL")
  h.font = Font.boldSystemFont(12)
  h.textColor = red
  row.addSpacer()
  line(row, phase + " · " + doneCount + "/" + tasks.length, 11, soft, false)
}

if (family === "accessoryCircular") {
  w.addAccessoryWidgetBackground = true
  const n = w.addText(String(days))
  n.font = Font.boldRoundedSystemFont(days > 99 ? 18 : 22)
  n.centerAlignText()
  const t = w.addText("days")
  t.font = Font.systemFont(10)
  t.centerAlignText()
} else if (family === "accessoryRectangular") {
  const t = w.addText("Goal: " + days + " days left")
  t.font = Font.boldSystemFont(14)
  const s = w.addText(firstOpen ? "Next: " + firstOpen.t : "Tasks done today")
  s.font = Font.systemFont(12)
  s.lineLimit = 2
} else if (family === "accessoryInline") {
  const t = w.addText(firstOpen ? "Next: " + firstOpen.t : "Goal " + days + "d · tasks done")
  t.font = Font.boldSystemFont(15)
} else {
  w.backgroundColor = bg
  w.setPadding(14, 14, 14, 14)

  if (family === "medium") {
    header(w)
    w.addSpacer(6)
    const row = w.addStack()
    row.layoutHorizontally()

    const left = row.addStack()
    left.layoutVertically()
    const n = left.addText(String(days))
    n.font = Font.heavyRoundedSystemFont(42)
    n.textColor = ink
    n.minimumScaleFactor = 0.5
    line(left, "days left", 13, ink, true)
    left.addSpacer(4)
    line(left, P.money(earned) + " of £100k", 11, behind ? red : soft, false)

    row.addSpacer(12)

    const right = row.addStack()
    right.layoutVertically()
    taskLines(right, 4, 12)
    row.addSpacer()
    w.addSpacer()
  } else if (family === "large") {
    header(w)
    w.addSpacer(8)
    const row = w.addStack()
    row.layoutHorizontally()

    const left = row.addStack()
    left.layoutVertically()
    const n = left.addText(String(days))
    n.font = Font.heavyRoundedSystemFont(54)
    n.textColor = ink
    n.minimumScaleFactor = 0.5
    line(left, "days left", 14, ink, true)

    row.addSpacer()

    const right = row.addStack()
    right.layoutVertically()
    line(right, "Banked  " + P.money(earned) + " (" + pct + "%)", 13, ink, true)
    right.addSpacer(4)
    line(right, "This month  " + P.money(monthEarned) + " of " + P.money(monthTarget), 13, behind ? red : ink, true)
    right.addSpacer(4)
    line(right, "Messages  " + msgs + " of " + P.WEEK_MSG_GOAL, 13, msgs >= P.WEEK_MSG_GOAL ? ink : soft, true)

    w.addSpacer(14)
    line(w, "TODAY", 11, red, true)
    w.addSpacer(4)
    taskLines(w, 7, 14)
    w.addSpacer()
    line(w, "Visa ends 20 Nov 2027 (" + visaDays + " days)", 11, soft, false)
  } else {
    const head = w.addText("£100K GOAL")
    head.font = Font.boldSystemFont(12)
    head.textColor = red
    w.addSpacer()
    const n = w.addText(String(days))
    n.font = Font.heavyRoundedSystemFont(44)
    n.textColor = ink
    n.minimumScaleFactor = 0.5
    line(w, "days left", 14, ink, true)
    w.addSpacer(6)
    line(w, doneCount + " of " + tasks.length + " tasks · " + P.money(earned), 11, behind ? red : soft, false)
  }
}

if (config.runsInWidget) {
  Script.setWidget(w)
} else {
  if (family === "medium") await w.presentMedium()
  else if (family === "large") await w.presentLarge()
  else await w.presentSmall()
}
Script.complete()
