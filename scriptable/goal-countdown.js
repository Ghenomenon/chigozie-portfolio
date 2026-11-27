// Goal Countdown widget for Scriptable (iPhone and iPad)
// Counts down to £100,000 of revenue by 31 Dec 2027.
// Name this script "Goal Countdown". Tap the widget to open "Log Progress".

const GOAL_DATE = new Date(2027, 11, 31)
const VISA_DATE = new Date(2027, 10, 20)
const TARGET = 100000
const WEEK_MSG_GOAL = 30
const FILE = "goal-data.json"
const LOG_URL = "scriptable:///run?scriptName=Log%20Progress"

// Monthly revenue targets (Part 2 of the plan). Total £108.5k.
const MONTHS = {
  "2026-12": 0, "2027-01": 1500, "2027-02": 3000, "2027-03": 5000,
  "2027-04": 7000, "2027-05": 8000, "2027-06": 9000, "2027-07": 10000,
  "2027-08": 11000, "2027-09": 12000, "2027-10": 13000, "2027-11": 14000,
  "2027-12": 15000
}

function pad(n) { return n < 10 ? "0" + n : String(n) }
function dayKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) }
function monthKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) }
function mondayKey(d) {
  const m = new Date(d)
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return dayKey(m)
}
function money(n) {
  if (n >= 1000) return "£" + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "k"
  return "£" + Math.round(n)
}

function load() {
  try {
    const fm = FileManager.local()
    const path = fm.joinPath(fm.documentsDirectory(), FILE)
    if (fm.fileExists(path)) {
      const d = JSON.parse(fm.readString(path))
      return {
        payments: Array.isArray(d.payments) ? d.payments : [],
        weeks: d.weeks && typeof d.weeks === "object" ? d.weeks : {}
      }
    }
  } catch (e) {}
  return { payments: [], weeks: {} }
}

const today = new Date()
today.setHours(0, 0, 0, 0)
const data = load()

const days = Math.max(0, Math.round((GOAL_DATE - today) / 86400000))
const visaDays = Math.max(0, Math.round((VISA_DATE - today) / 86400000))
const earned = data.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
const pct = Math.min(100, Math.round((earned / TARGET) * 100))

const mk = monthKey(today)
const monthTarget = MONTHS[mk] || 0
const monthEarned = data.payments
  .filter(p => String(p.date).slice(0, 7) === mk)
  .reduce((s, p) => s + (Number(p.amount) || 0), 0)
const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
const expectedByNow = monthTarget * (today.getDate() / daysInMonth)
const behind = monthTarget > 0 && monthEarned < expectedByNow

const wk = data.weeks[mondayKey(today)] || {}
const msgs = Number(wk.messages) || 0

const red = new Color("#c0262d")
const ink = Color.dynamic(new Color("#10302b"), new Color("#dcefe8"))
const soft = Color.dynamic(new Color("#4b6b64"), new Color("#93b3aa"))
const bg = Color.dynamic(new Color("#f3f9f5"), new Color("#162825"))

const w = new ListWidget()
w.url = LOG_URL

// Refresh just after midnight so the number changes each day
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
  t.font = Font.boldSystemFont(15)
  const s = w.addText(money(earned) + " of £100k · " + pct + "%")
  s.font = Font.systemFont(12)
} else if (family === "accessoryInline") {
  const t = w.addText("Goal " + days + "d · " + money(earned) + " of £100k")
  t.font = Font.boldSystemFont(15)
} else {
  w.backgroundColor = bg
  w.setPadding(14, 14, 14, 14)

  const head = w.addText("£100K GOAL")
  head.font = Font.boldSystemFont(12)
  head.textColor = red

  if (family === "medium") {
    w.addSpacer(4)
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
    line(right, "Banked  " + money(earned) + " (" + pct + "%)", 13, ink, true)
    right.addSpacer(4)
    line(right, "This month  " + money(monthEarned) + " of " + money(monthTarget), 13, behind ? red : ink, true)
    right.addSpacer(4)
    line(right, "Messages  " + msgs + " of " + WEEK_MSG_GOAL, 13, msgs >= WEEK_MSG_GOAL ? ink : soft, true)

    w.addSpacer()
    line(w, "Visa ends 20 Nov 2027 (" + visaDays + " days)", 11, soft, false)
  } else {
    w.addSpacer()
    const n = w.addText(String(days))
    n.font = Font.heavyRoundedSystemFont(44)
    n.textColor = ink
    n.minimumScaleFactor = 0.5
    line(w, "days left", 14, ink, true)
    w.addSpacer(6)
    line(w, money(earned) + " of £100k", 11, behind ? red : soft, false)
  }
}

if (config.runsInWidget) {
  Script.setWidget(w)
} else {
  if (family === "medium") await w.presentMedium()
  else await w.presentSmall()
}
Script.complete()
