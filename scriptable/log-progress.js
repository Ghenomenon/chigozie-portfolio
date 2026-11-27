// Log Progress for Scriptable. Name this script "Log Progress".
// Tick off today's tasks, log payments and weekly numbers.
// Needs the "Goal Plan" script.

const P = importModule("Goal Plan")

async function note(title, message) {
  const a = new Alert()
  a.title = title
  a.message = message
  a.addAction("OK")
  await a.present()
}

const data = P.load()
const today = P.midnight(new Date())

async function tasksScreen() {
  const key = P.dayKey(today)
  while (true) {
    const tasks = P.tasksFor(today)
    const done = data.done[key] || []
    const has = i => done.indexOf(i) >= 0
    const a = new Alert()
    a.title = P.phaseLabel(today) + ": " + done.filter(i => i < tasks.length).length + " of " + tasks.length + " done"
    a.message = tasks.map((t, i) => (has(i) ? "✓ " : "○ ") + t.t + "\n" + t.d).join("\n\n")
    tasks.forEach((t, i) => a.addAction((has(i) ? "Undo: " : "Done: ") + t.t))
    a.addCancelAction("Close")
    const i = await a.presentSheet()
    if (i < 0) break
    data.done[key] = has(i) ? done.filter(x => x !== i) : done.concat([i])
    P.save(data)
  }
}

const menu = new Alert()
menu.title = "Log Progress"
menu.addAction("Today's tasks")
menu.addAction("Log payment")
menu.addAction("Log week numbers")
menu.addAction("Undo last payment")
menu.addAction("Show summary")
menu.addCancelAction("Close")
const choice = await menu.presentSheet()

if (choice === 0) {
  await tasksScreen()
} else if (choice === 1) {
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
      data.payments.push({ date: P.dayKey(today), amount: amount, client: a.textFieldValue(1).trim() })
      P.save(data)
      const total = data.payments.reduce((s, p) => s + p.amount, 0)
      await note("Saved", P.gbp(amount) + " logged. Total: " + P.gbp(total) + " of " + P.gbp(P.TARGET) + ".")
    }
  }
} else if (choice === 2) {
  const key = P.mondayKey(today)
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
    P.save(data)
    await note("Saved", "Messages " + num(0) + ", replies " + num(1) + ", calls " + num(2) + ", paid clients " + num(3) + ".")
  }
} else if (choice === 3) {
  if (data.payments.length === 0) {
    await note("Nothing to undo", "No payments are logged.")
  } else {
    const last = data.payments[data.payments.length - 1]
    const a = new Alert()
    a.title = "Undo last payment?"
    a.message = P.gbp(last.amount) + " on " + last.date + (last.client ? " from " + last.client : "")
    a.addDestructiveAction("Remove it")
    a.addCancelAction("Keep it")
    if ((await a.present()) === 0) {
      data.payments.pop()
      P.save(data)
      await note("Removed", "The payment is gone.")
    }
  }
} else if (choice === 4) {
  const earned = data.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const days = Math.max(0, P.daysBetween(today, P.GOAL_DATE))
  const mk = P.monthKey(today)
  const monthEarned = data.payments
    .filter(p => String(p.date).slice(0, 7) === mk)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const tasks = P.tasksFor(today)
  const doneToday = (data.done[P.dayKey(today)] || []).filter(i => i < tasks.length).length
  const lines = []
  lines.push("Days left: " + days)
  lines.push("Banked: " + P.gbp(earned) + " of " + P.gbp(P.TARGET))
  lines.push("This month: " + P.gbp(monthEarned) + " of " + P.gbp(P.MONTHS[mk] || 0))
  const wk = data.weeks[P.mondayKey(today)] || {}
  lines.push("This week: " + (wk.messages || 0) + " messages, " + (wk.replies || 0) + " replies, " + (wk.calls || 0) + " calls, " + (wk.paid || 0) + " paid")
  lines.push("Today: " + doneToday + " of " + tasks.length + " tasks done")
  lines.push("")
  lines.push("Checkpoints")
  let flagged = false
  for (const c of P.CHECKPOINTS) {
    const goal = P.cumulativeTarget(c.end)
    let state = "ahead or on track"
    if (c.end < mk) {
      state = earned >= goal ? "met" : earned < goal / 2 ? "under half" : "missed"
    } else if (c.end === mk && earned < goal / 2) {
      state = "under half so far"
    }
    if (state.indexOf("under half") === 0) flagged = true
    lines.push(c.end + ": " + P.gbp(goal) + ", " + c.note + " (" + state + ")")
  }
  if (flagged) {
    lines.push("")
    lines.push("Under half a checkpoint. Switch to idea 3: contract analyst work through agencies, and keep the service running on the side.")
  }
  await note("Summary", lines.join("\n"))
}
Script.complete()
