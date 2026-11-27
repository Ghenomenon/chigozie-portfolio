// Log Progress for Scriptable. Name this script "Log Progress".
// Record payments and weekly outreach numbers for the Goal Countdown widget.

const TARGET = 100000
const GOAL_DATE = new Date(2027, 11, 31)
const FILE = "goal-data.json"
const MONTHS = {
  "2026-12": 0, "2027-01": 1500, "2027-02": 3000, "2027-03": 5000,
  "2027-04": 7000, "2027-05": 8000, "2027-06": 9000, "2027-07": 10000,
  "2027-08": 11000, "2027-09": 12000, "2027-10": 13000, "2027-11": 14000,
  "2027-12": 15000
}
// Part 11 checkpoints: end of month, total revenue by then.
const CHECKPOINTS = [
  { end: "2027-02", note: "2 paid clients" },
  { end: "2027-06", note: "3 retainers" },
  { end: "2027-09", note: "6 retainers" }
]

function pad(n) { return n < 10 ? "0" + n : String(n) }
function dayKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) }
function monthKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) }
function mondayKey(d) {
  const m = new Date(d)
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return dayKey(m)
}
function gbp(n) { return "£" + Math.round(n).toLocaleString("en-GB") }

const fm = FileManager.local()
const path = fm.joinPath(fm.documentsDirectory(), FILE)

function load() {
  try {
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
function save(d) { fm.writeString(path, JSON.stringify(d)) }

function cumulativeTarget(endKey) {
  return Object.keys(MONTHS).filter(k => k <= endKey).reduce((s, k) => s + MONTHS[k], 0)
}

async function note(title, message) {
  const a = new Alert()
  a.title = title
  a.message = message
  a.addAction("OK")
  await a.present()
}

const data = load()
const today = new Date()
today.setHours(0, 0, 0, 0)

const menu = new Alert()
menu.title = "Log Progress"
menu.addAction("Log payment")
menu.addAction("Log week numbers")
menu.addAction("Undo last payment")
menu.addAction("Show summary")
menu.addCancelAction("Close")
const choice = await menu.presentSheet()

if (choice === 0) {
  const a = new Alert()
  a.title = "Log payment"
  a.message = "Revenue before tax. Today's date is used."
  a.addTextField("Amount in £, for example 750", "")
  a.addTextField("Client", "")
  a.addAction("Save")
  a.addCancelAction("Cancel")
  if ((await a.present()) === 0) {
    const amount = parseFloat(a.textFieldValue(0).replace(/[£,\s]/g, ""))
    if (!(amount > 0)) {
      await note("Not saved", "Enter an amount above zero.")
    } else {
      data.payments.push({ date: dayKey(today), amount: amount, client: a.textFieldValue(1).trim() })
      save(data)
      const total = data.payments.reduce((s, p) => s + p.amount, 0)
      await note("Saved", gbp(amount) + " logged. Total: " + gbp(total) + " of " + gbp(TARGET) + ".")
    }
  }
} else if (choice === 1) {
  const key = mondayKey(today)
  const cur = data.weeks[key] || {}
  const a = new Alert()
  a.title = "Week of " + key
  a.message = "Totals for this week so far."
  a.addTextField("Messages sent", String(cur.messages || 0))
  a.addTextField("Replies", String(cur.replies || 0))
  a.addTextField("Calls held", String(cur.calls || 0))
  a.addTextField("Paid clients", String(cur.paid || 0))
  a.addAction("Save")
  a.addCancelAction("Cancel")
  if ((await a.present()) === 0) {
    const num = i => Math.max(0, parseInt(a.textFieldValue(i), 10) || 0)
    data.weeks[key] = { messages: num(0), replies: num(1), calls: num(2), paid: num(3) }
    save(data)
    await note("Saved", "Messages " + num(0) + ", replies " + num(1) + ", calls " + num(2) + ", paid clients " + num(3) + ".")
  }
} else if (choice === 2) {
  if (data.payments.length === 0) {
    await note("Nothing to undo", "No payments are logged.")
  } else {
    const last = data.payments[data.payments.length - 1]
    const a = new Alert()
    a.title = "Undo last payment?"
    a.message = gbp(last.amount) + " on " + last.date + (last.client ? " from " + last.client : "")
    a.addDestructiveAction("Remove it")
    a.addCancelAction("Keep it")
    if ((await a.present()) === 0) {
      data.payments.pop()
      save(data)
      await note("Removed", "The payment is gone.")
    }
  }
} else if (choice === 3) {
  const earned = data.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const days = Math.max(0, Math.round((GOAL_DATE - today) / 86400000))
  const mk = monthKey(today)
  const monthEarned = data.payments
    .filter(p => String(p.date).slice(0, 7) === mk)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const lines = []
  lines.push("Days left: " + days)
  lines.push("Banked: " + gbp(earned) + " of " + gbp(TARGET))
  lines.push("This month: " + gbp(monthEarned) + " of " + gbp(MONTHS[mk] || 0))
  const wk = data.weeks[mondayKey(today)] || {}
  lines.push("This week: " + (wk.messages || 0) + " messages, " + (wk.replies || 0) + " replies, " + (wk.calls || 0) + " calls, " + (wk.paid || 0) + " paid")
  lines.push("")
  lines.push("Checkpoints")
  let flagged = false
  for (const c of CHECKPOINTS) {
    const goal = cumulativeTarget(c.end)
    let state = "ahead or on track"
    if (c.end < mk) {
      state = earned >= goal ? "met" : earned < goal / 2 ? "under half" : "missed"
    } else if (c.end === mk && earned < goal / 2) {
      state = "under half so far"
    }
    if (state.indexOf("under half") === 0) flagged = true
    lines.push(c.end + ": " + gbp(goal) + ", " + c.note + " (" + state + ")")
  }
  if (flagged) {
    lines.push("")
    lines.push("Under half a checkpoint. Switch to idea 3: contract analyst work through agencies, and keep the service running on the side.")
  }
  await note("Summary", lines.join("\n"))
}
Script.complete()
