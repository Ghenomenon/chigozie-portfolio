// Goal Countdown widget for Scriptable (iPhone and iPad)
// Counts down to £100,000 of revenue by 31 Dec 2027 and shows today's tasks.
// Name this script "Goal Countdown". Needs the "Goal Plan" script.
// Tap the widget to open "Goal Home".

const P = importModule("Goal Plan")
const LOG_URL = "scriptable:///run?scriptName=Goal%20Home"

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

// Light pink theme: soft pink background, glowing pink numbers, plum text
const glowPink = new Color("#ff1f8e")
const rose = new Color("#e6007a")
const green = new Color("#0e9f5a")
const alert = new Color("#d9042b")
const plum = new Color("#4a0d33")
const mauve = new Color("#a0467a")
const red = alert
const ink = plum
const soft = mauve

const bgGradient = new LinearGradient()
bgGradient.colors = [new Color("#fff6fb"), new Color("#ffdcee"), new Color("#fbe4ff")]
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
  if (glowColor) glow(t, glowColor, 7)
  return t
}

// Open tasks first, then done ones
function taskLines(stack, max, size) {
  const items = tasks.map((t, i) => ({ t: t.t, done: isDone(i) }))
  items.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))
  if (doneCount === tasks.length) line(stack, "All done today. Log your numbers.", size, green, true, green)
  items.slice(0, max).forEach(it => {
    line(stack, (it.done ? "✓ " : "○ ") + it.t, size, it.done ? green : plum, !it.done, it.done ? green : rose)
    stack.addSpacer(3)
  })
  if (items.length > max) line(stack, "+" + (items.length - max) + " more", size - 1, soft, false)
}

function header(stack) {
  const row = stack.addStack()
  row.layoutHorizontally()
  const h = row.addText("£100K GOAL")
  h.font = Font.boldSystemFont(14)
  h.textColor = rose
  glow(h, rose, 6)
  row.addSpacer()
  line(row, phase + " · " + doneCount + "/" + tasks.length, 12, glowPink, true)
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
    n.font = Font.heavyRoundedSystemFont(54)
    n.textColor = glowPink
    glow(n, glowPink, 14)
    n.minimumScaleFactor = 0.5
    line(left, "days left", 16, plum, true)
    left.addSpacer(4)
    line(left, P.money(earned) + " of £100k", 13, behind ? alert : green, true, behind ? alert : green)

    row.addSpacer(12)

    const right = row.addStack()
    right.layoutVertically()
    taskLines(right, 3, 14)
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
    n.font = Font.heavyRoundedSystemFont(66)
    n.textColor = glowPink
    glow(n, glowPink, 16)
    n.minimumScaleFactor = 0.5
    line(left, "days left", 17, plum, true)

    row.addSpacer()

    const right = row.addStack()
    right.layoutVertically()
    line(right, "Banked  " + P.money(earned) + " (" + pct + "%)", 15, green, true, green)
    right.addSpacer(4)
    line(right, "This month  " + P.money(monthEarned) + " of " + P.money(monthTarget), 15, behind ? alert : plum, true, behind ? alert : null)
    right.addSpacer(4)
    line(right, "Messages  " + msgs + " of " + P.WEEK_MSG_GOAL, 15, msgs >= P.WEEK_MSG_GOAL ? green : glowPink, true)

    w.addSpacer(14)
    line(w, "TODAY", 13, rose, true, rose)
    w.addSpacer(4)
    taskLines(w, 6, 16)
    w.addSpacer()
    line(w, "Visa ends 20 Nov 2027 (" + visaDays + " days)", 13, mauve, false)
  } else {
    const head = w.addText("£100K GOAL")
    head.font = Font.boldSystemFont(14)
    head.textColor = rose
    glow(head, rose, 6)
    w.addSpacer()
    const n = w.addText(String(days))
    n.font = Font.heavyRoundedSystemFont(60)
    n.textColor = glowPink
    glow(n, glowPink, 14)
    n.minimumScaleFactor = 0.5
    line(w, "days left", 17, plum, true)
    w.addSpacer(6)
    line(w, doneCount + " of " + tasks.length + " tasks · " + P.money(earned), 13, behind ? alert : green, true)
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
