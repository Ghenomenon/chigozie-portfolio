// Log Progress for Scriptable. Name this script "Log Progress".
// Tick off today's tasks, log payments and weekly numbers, open the glow dashboard.
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
    a.message = "Tap a task to read the steps."
    tasks.forEach((t, i) => a.addAction((has(i) ? "✓ " : "○ ") + t.t))
    a.addCancelAction("Close")
    const i = await a.presentSheet()
    if (i < 0) break
    const d = new Alert()
    d.title = tasks[i].t
    d.message = tasks[i].d
    d.addAction(has(i) ? "Mark not done" : "Mark done")
    d.addCancelAction("Back")
    if ((await d.present()) === 0) {
      data.done[key] = has(i) ? done.filter(x => x !== i) : done.concat([i])
      P.save(data)
    }
  }
}

// Animated full-screen dashboard (runs inside the app, not on the Home Screen)
const DASH = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>
:root{--pk:#ff1f8e;--rose:#e6007a;--gr:#0e9f5a;--red:#d9042b;--plum:#4a0d33;--mauve:#a0467a}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;color:var(--plum);font-family:-apple-system,system-ui,sans-serif;
background:linear-gradient(135deg,#fff6fb,#ffdcee,#fbe4ff,#fff6fb);background-size:300% 300%;
animation:bg 14s ease infinite;padding:calc(env(safe-area-inset-top) + 18px) 18px 40px}
@keyframes bg{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
.top{display:flex;justify-content:space-between;align-items:center;font-size:15px;letter-spacing:.08em}
.tag{color:var(--rose);font-weight:800;text-shadow:0 0 12px rgba(255,31,142,.6)}
.ph{color:var(--pk);font-weight:800}
.ring{position:relative;width:280px;height:280px;margin:22px auto 8px}
.ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.track{fill:none;stroke:rgba(255,31,142,.15);stroke-width:12}
.prog{fill:none;stroke:var(--pk);stroke-width:12;stroke-linecap:round;stroke-dasharray:527.8;stroke-dashoffset:527.8;
transition:stroke-dashoffset 2.2s cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 0 8px var(--pk)) drop-shadow(0 0 18px rgba(255,92,176,.8))}
.halo{position:absolute;inset:18px;border-radius:50%;animation:pulse 3s ease-in-out infinite;
box-shadow:0 0 40px rgba(255,31,142,.3),inset 0 0 40px rgba(255,150,210,.4)}
@keyframes pulse{0%,100%{opacity:.5;transform:scale(.97)}50%{opacity:1;transform:scale(1.03)}}
.mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.days{font-size:96px;font-weight:900;color:var(--pk);text-shadow:0 0 16px rgba(255,31,142,.7),0 0 38px rgba(255,92,176,.7);line-height:1}
.dl{font-size:20px;font-weight:800;margin-top:4px}
.bank{text-align:center;font-size:24px;font-weight:800;color:var(--gr);text-shadow:0 0 12px rgba(14,159,90,.35);margin-bottom:18px}
.chips{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:22px}
.chip{border:1.5px solid rgba(255,31,142,.55);border-radius:16px;padding:12px 8px;text-align:center;
box-shadow:0 0 16px rgba(255,31,142,.3);background:rgba(255,255,255,.78);animation:rise .7s both}
.chip b{display:block;font-size:17px;white-space:nowrap;color:var(--plum)}
.chip span{font-size:12px;color:var(--mauve)}
.chip.bad{border-color:var(--red);box-shadow:0 0 16px rgba(217,4,43,.4)}
.chip.bad b{color:var(--red);text-shadow:0 0 10px rgba(217,4,43,.4)}
h2{font-size:15px;letter-spacing:.14em;color:var(--rose);text-shadow:0 0 10px rgba(255,31,142,.5);margin:0 0 10px}
.task{display:flex;gap:10px;align-items:flex-start;padding:14px 16px;margin-bottom:12px;border-radius:16px;
background:rgba(255,255,255,.85);border:1.5px solid rgba(255,31,142,.5);box-shadow:0 0 16px rgba(255,31,142,.28);
opacity:0;animation:slide .6s forwards}
.task.done{border-color:var(--gr);box-shadow:0 0 16px rgba(14,159,90,.35);color:var(--gr)}
.task i{font-style:normal;font-size:22px;line-height:1.1;color:var(--pk)}
.task.done i{color:var(--gr)}
.task b{display:block;font-size:18px}
.task small{display:block;font-size:14px;color:var(--mauve);margin-top:4px;line-height:1.35}
.task.done small{color:rgba(14,159,90,.85)}
@keyframes slide{from{opacity:0;transform:translateX(-26px)}to{opacity:1;transform:none}}
@keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.visa{text-align:center;font-size:13px;color:var(--mauve);margin-top:18px}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.task{opacity:1}}
</style></head><body>
<div class="top"><span class="tag">£100K GOAL</span><span class="ph" id="ph"></span></div>
<div class="ring"><div class="halo"></div>
<svg viewBox="0 0 200 200"><circle class="track" cx="100" cy="100" r="84"/><circle class="prog" id="prog" cx="100" cy="100" r="84"/></svg>
<div class="mid"><div class="days" id="days">0</div><div class="dl">days left</div></div></div>
<div class="bank" id="bank"></div>
<div class="chips" id="chips"></div>
<h2 id="th"></h2><div id="tasks"></div>
<div class="visa" id="visa"></div>
<script>
var D = __DATA__;
function esc(s){return String(s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c]})}
document.getElementById("ph").textContent = D.phase;
document.getElementById("bank").textContent = D.earnedText + " banked of £100k (" + D.pct + "%)";
document.getElementById("visa").textContent = "Visa ends 20 Nov 2027 (" + D.visaDays + " days)";
document.getElementById("th").textContent = "TODAY " + D.doneCount + " OF " + D.tasks.length;
var chips = [
 {b:D.monthText,s:"this month",bad:D.behind},
 {b:D.msgs + " of " + D.msgGoal,s:"messages",bad:false},
 {b:D.doneCount + " of " + D.tasks.length,s:"tasks done",bad:false}
];
document.getElementById("chips").innerHTML = chips.map(function(c,i){
 return '<div class="chip'+(c.bad?' bad':'')+'" style="animation-delay:'+(0.2+i*0.15)+'s"><b>'+esc(c.b)+'</b><span>'+c.s+'</span></div>'}).join("");
document.getElementById("tasks").innerHTML = D.tasks.map(function(t,i){
 return '<div class="task'+(t.done?' done':'')+'" style="animation-delay:'+(0.5+i*0.18)+'s"><i>'+(t.done?'✓':'○')+'</i><div><b>'+esc(t.t)+'</b><small>'+esc(t.d)+'</small></div></div>'}).join("");
setTimeout(function(){document.getElementById("prog").style.strokeDashoffset = 527.8*(1-Math.min(1,D.pct/100))},150);
var el = document.getElementById("days"), t0 = null;
function tick(ts){ if(!t0) t0=ts; var p=Math.min(1,(ts-t0)/1400); el.textContent = Math.round(D.days*(1-Math.pow(1-p,3))); if(p<1) requestAnimationFrame(tick) }
requestAnimationFrame(tick);
</script></body></html>`

async function dashboard() {
  const tasks = P.tasksFor(today)
  const doneList = data.done[P.dayKey(today)] || []
  const earned = data.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const mk = P.monthKey(today)
  const monthTarget = P.MONTHS[mk] || 0
  const monthEarned = data.payments
    .filter(p => String(p.date).slice(0, 7) === mk)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const dim = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const wk = data.weeks[P.mondayKey(today)] || {}
  const info = {
    days: Math.max(0, P.daysBetween(today, P.GOAL_DATE)),
    visaDays: Math.max(0, P.daysBetween(today, P.VISA_DATE)),
    phase: P.phaseLabel(today),
    earnedText: P.gbp(earned),
    pct: Math.min(100, Math.round((earned / P.TARGET) * 100)),
    monthText: P.money(monthEarned) + " of " + P.money(monthTarget),
    behind: monthTarget > 0 && monthEarned < monthTarget * (today.getDate() / dim),
    msgs: Number(wk.messages) || 0,
    msgGoal: P.WEEK_MSG_GOAL,
    doneCount: tasks.filter((t, i) => doneList.indexOf(i) >= 0).length,
    tasks: tasks.map((t, i) => ({ t: t.t, d: t.d.split("\n")[0], done: doneList.indexOf(i) >= 0 }))
  }
  const html = DASH.replace("__DATA__", JSON.stringify(info).replace(/</g, "\\u003c"))
  const wv = new WebView()
  await wv.loadHTML(html)
  await wv.present(true)
}

const menu = new Alert()
menu.title = "Log Progress"
menu.addAction("Today's tasks")
menu.addAction("Log payment")
menu.addAction("Log week numbers")
menu.addAction("Undo last payment")
menu.addAction("Show summary")
menu.addAction("Glow dashboard")
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
} else if (choice === 5) {
  await dashboard()
}
Script.complete()
