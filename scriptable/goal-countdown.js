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

// Bright neon colours on a deep night gradient
const cyan = new Color("#00f0ff")
const magenta = new Color("#ff3df0")
const lime = new Color("#39ff88")
const hot = new Color("#ff4d6d")
const white = new Color("#ffffff")
const dim = new Color("#9fb4ff")
const red = hot
const ink = white
const soft = dim

const bgGradient = new LinearGradient()
bgGradient.colors = [new Color("#0a0f2e"), new Color("#2a0a4a"), new Color("#06323f")]
bgGradient.locations = [0, 0.6, 1]
bgGradient.startPoint = new Point(0, 0)
bgGradient.endPoint = new Point(1, 1)

const w = new ListWidget()
w.url = LOG_URL

// Refresh just after midnight so the day and tasks change
const next = new Date(today)
next.setDate(next.getDate() + 1)
next.setMinutes(1)
w.refreshAfterDate = next

const family = config.widgetFamily

function glow(t, color, radius) {
  t.shadowColor = color
  t.shadowRadius = radius || 6
  t.shadowOffset = new Point(0, 0)
}

function line(stack, text, size, color, bold, glowColor) {
  const t = stack.addText(text)
  t.font = bold ? Font.semiboldSystemFont(size) : Font.systemFont(size)
  t.textColor = color
  t.minimumScaleFactor = 0.6
  t.lineLimit = 1
  if (glowColor) glow(t, glowColor, 5)
  return t
}

// Open tasks first, then done ones
function taskLines(stack, max, size) {
  const items = tasks.map((t, i) => ({ t: t.t, done: isDone(i) }))
  items.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))
  if (doneCount === tasks.length) line(stack, "All done today. Log your numbers.", size, lime, true, lime)
  items.slice(0, max).forEach(it => {
    line(stack, (it.done ? "✓ " : "○ ") + it.t, size, it.done ? lime : white, !it.done, it.done ? lime : magenta)
    stack.addSpacer(3)
  })
  if (items.length > max) line(stack, "+" + (items.length - max) + " more", size - 1, soft, false)
}

function header(stack) {
  const row = stack.addStack()
  row.layoutHorizontally()
  const h = row.addText("£100K GOAL")
  h.font = Font.boldSystemFont(12)
  h.textColor = magenta
  glow(h, magenta, 6)
  row.addSpacer()
  line(row, phase + " · " + doneCount + "/" + tasks.length, 11, cyan, true)
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
  w.backgroundGradient = bgGradient
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
    n.textColor = cyan
    glow(n, cyan, 10)
    n.minimumScaleFactor = 0.5
    line(left, "days left", 13, white, true)
    left.addSpacer(4)
    line(left, P.money(earned) + " of £100k", 11, behind ? hot : lime, true, behind ? hot : lime)

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
    n.textColor = cyan
    glow(n, cyan, 12)
    n.minimumScaleFactor = 0.5
    line(left, "days left", 14, white, true)

    row.addSpacer()

    const right = row.addStack()
    right.layoutVertically()
    line(right, "Banked  " + P.money(earned) + " (" + pct + "%)", 13, lime, true, lime)
    right.addSpacer(4)
    line(right, "This month  " + P.money(monthEarned) + " of " + P.money(monthTarget), 13, behind ? hot : white, true, behind ? hot : null)
    right.addSpacer(4)
    line(right, "Messages  " + msgs + " of " + P.WEEK_MSG_GOAL, 13, msgs >= P.WEEK_MSG_GOAL ? lime : cyan, true)

    w.addSpacer(14)
    line(w, "TODAY", 11, magenta, true, magenta)
    w.addSpacer(4)
    taskLines(w, 7, 14)
    w.addSpacer()
    line(w, "Visa ends 20 Nov 2027 (" + visaDays + " days)", 11, dim, false)
  } else {
    const head = w.addText("£100K GOAL")
    head.font = Font.boldSystemFont(12)
    head.textColor = magenta
    glow(head, magenta, 6)
    w.addSpacer()
    const n = w.addText(String(days))
    n.font = Font.heavyRoundedSystemFont(44)
    n.textColor = cyan
    glow(n, cyan, 10)
    n.minimumScaleFactor = 0.5
    line(w, "days left", 14, white, true)
    w.addSpacer(6)
    line(w, doneCount + " of " + tasks.length + " tasks · " + P.money(earned), 11, behind ? hot : lime, true)
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
