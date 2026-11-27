// Goal Home for Scriptable. Name this script "Goal Home".
// The widget opens this page. It shows your goal, today's tasks and checkpoints,
// and it holds Log Progress: tick tasks, log payments, log week numbers, undo.
// Needs the "Goal Plan" script.

const P = importModule("Goal Plan")
const data = P.load()
const today = P.midnight(new Date())

const HOME = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>
:root{--pk:#ff1f8e;--rose:#e6007a;--gr:#0e9f5a;--red:#d9042b;--plum:#4a0d33;--mauve:#a0467a}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;min-height:100vh;color:var(--plum);font-family:-apple-system,system-ui,sans-serif;
background:linear-gradient(135deg,#fff6fb,#ffdcee,#fbe4ff,#fff6fb);background-size:300% 300%;
animation:bg 14s ease infinite;padding:calc(env(safe-area-inset-top) + 18px) 18px 60px}
@keyframes bg{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
.top{display:flex;justify-content:space-between;align-items:center;font-size:15px;letter-spacing:.08em}
.tag{color:var(--rose);font-weight:800;text-shadow:0 0 12px rgba(255,31,142,.6)}
.ph{color:var(--pk);font-weight:800}
.ring{position:relative;width:168px;height:168px;margin:10px auto 6px}
.ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.track{fill:none;stroke:rgba(255,31,142,.15);stroke-width:12}
.prog{fill:none;stroke:var(--pk);stroke-width:12;stroke-linecap:round;stroke-dasharray:527.8;
transition:stroke-dashoffset 2.2s cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 0 8px var(--pk)) drop-shadow(0 0 18px rgba(255,92,176,.8))}
.halo{position:absolute;inset:18px;border-radius:50%;animation:pulse 3s ease-in-out infinite;
box-shadow:0 0 40px rgba(255,31,142,.3),inset 0 0 40px rgba(255,150,210,.4)}
@keyframes pulse{0%,100%{opacity:.5;transform:scale(.97)}50%{opacity:1;transform:scale(1.03)}}
.mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.days{font-size:58px;font-weight:900;color:var(--pk);text-shadow:0 0 16px rgba(255,31,142,.7),0 0 38px rgba(255,92,176,.7);line-height:1}
.dl{font-size:15px;font-weight:800;margin-top:2px}
.bank{text-align:center;font-size:19px;font-weight:800;color:var(--gr);text-shadow:0 0 12px rgba(14,159,90,.35);margin-bottom:12px}
.chips{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:4px}
.chip{border:1.5px solid rgba(255,31,142,.55);border-radius:14px;padding:8px 6px;text-align:center;
box-shadow:0 0 16px rgba(255,31,142,.3);background:rgba(255,255,255,.78)}
.chip b{display:block;font-size:15px;white-space:nowrap}
.chip span{font-size:11px;color:var(--mauve)}
.chip.bad{border-color:var(--red);box-shadow:0 0 16px rgba(217,4,43,.4)}
.chip.bad b{color:var(--red)}
h2{font-size:15px;letter-spacing:.14em;color:var(--rose);text-shadow:0 0 10px rgba(255,31,142,.5);margin:22px 0 10px}
.task{padding:14px 16px;margin-bottom:12px;border-radius:16px;background:rgba(255,255,255,.85);
border:1.5px solid rgba(255,31,142,.5);box-shadow:0 0 16px rgba(255,31,142,.28)}
.task.done{border-color:var(--gr);box-shadow:0 0 16px rgba(14,159,90,.35)}
.head{display:flex;gap:10px;align-items:flex-start;cursor:pointer}
.task i{font-style:normal;font-size:22px;line-height:1.1;color:var(--pk)}
.task.done i,.task.done b{color:var(--gr)}
.task b{display:block;font-size:18px}
.task small{display:block;font-size:14px;color:var(--mauve);margin-top:4px}
.steps{white-space:pre-wrap;font-size:15px;line-height:1.45;margin:12px 0;padding-top:12px;border-top:1px solid rgba(255,31,142,.25)}
.btn{display:inline-block;border:0;border-radius:14px;padding:13px 16px;font-size:16px;font-weight:800;
background:var(--pk);color:#fff;box-shadow:0 0 16px rgba(255,31,142,.55);font-family:inherit}
.btn.ghost{background:#fff;color:var(--pk);border:1.5px solid var(--pk);box-shadow:0 0 12px rgba(255,31,142,.25)}
.btn.good{background:var(--gr);box-shadow:0 0 14px rgba(14,159,90,.45)}
.btn.warn{background:var(--red);box-shadow:0 0 14px rgba(217,4,43,.45)}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.card{padding:14px 16px;margin-bottom:12px;border-radius:16px;background:rgba(255,255,255,.88);
border:1.5px solid rgba(255,31,142,.5);box-shadow:0 0 16px rgba(255,31,142,.28)}
.card label{display:block;font-size:13px;color:var(--mauve);margin:10px 0 4px}
.card input{width:100%;font-size:17px;padding:11px 12px;border-radius:12px;border:1.5px solid rgba(255,31,142,.5);
background:#fff;color:var(--plum);font-family:inherit}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.toast{margin:0 0 12px;font-weight:800;color:var(--gr);text-shadow:0 0 10px rgba(14,159,90,.3);min-height:20px}
.cp{font-size:15px;line-height:1.5;margin-bottom:6px}
.cp.bad{color:var(--red);font-weight:800}
.pay{display:flex;justify-content:space-between;font-size:15px;padding:6px 0;border-bottom:1px solid rgba(255,31,142,.2)}
.visa{text-align:center;font-size:13px;color:var(--mauve);margin-top:22px}
.anim .chip{animation:rise .7s both}.anim .task{animation:slide .6s both}
@keyframes slide{from{opacity:0;transform:translateX(-26px)}to{opacity:1;transform:none}}
@keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style></head><body><div id="app"></div>
<script>
var NL = String.fromCharCode(10);
var S = null, first = true, openIdx = -1, showPay = false, showWeek = false, askUndo = false, q = [], wake = null;
function send(a){ if (wake){ var w = wake; wake = null; w(a) } else q.push(a) }
function waitAction(cb){ if (q.length) cb(q.shift()); else wake = cb }
function esc(s){ return String(s).replace(/[&<>]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c] }) }
function el(id){ return document.getElementById(id) }
function setToast(m){ if (el("toast")) el("toast").textContent = m }
function setState(s){
  if (first) { openIdx = -1; for (var i = 0; i < s.tasks.length; i++) { if (!s.tasks[i].done) { openIdx = i; break } } }
  S = s; render(); first = false;
}
function toggleOpen(i){ openIdx = openIdx === i ? -1 : i; render() }
function mark(i){ send({type:"toggle", i:i}) }
function togglePay(){ showPay = !showPay; showWeek = false; askUndo = false; render() }
function toggleWeek(){ showWeek = !showWeek; showPay = false; askUndo = false; render() }
function undoAsk(){ askUndo = !askUndo; showPay = false; showWeek = false; render() }
function savePay(){
  var a = parseFloat(String(el("amt").value).replace(/[^0-9.]/g, ""));
  if (!(a > 0)) { setToast("Enter an amount above zero."); return }
  send({type:"pay", amount:a, client:el("cli").value}); showPay = false;
}
function saveWeek(){
  function n(id){ return Math.max(0, parseInt(el(id).value, 10) || 0) }
  send({type:"week", messages:n("w0"), replies:n("w1"), calls:n("w2"), paid:n("w3")}); showWeek = false;
}
function doUndo(){ send({type:"undo"}); askUndo = false }
function render(){
  var h = "";
  h += '<div class="top"><span class="tag">£100K GOAL</span><span class="ph">' + esc(S.phase) + '</span></div>';
  h += '<div class="ring"><div class="halo"></div><svg viewBox="0 0 200 200"><circle class="track" cx="100" cy="100" r="84"/>';
  h += '<circle class="prog" id="prog" cx="100" cy="100" r="84" style="stroke-dashoffset:' + (first ? 527.8 : 527.8 * (1 - Math.min(1, S.pct / 100))) + '"/></svg>';
  h += '<div class="mid"><div class="days" id="days">' + (first ? 0 : S.days) + '</div><div class="dl">days left</div></div></div>';
  h += '<div class="bank">' + esc(S.earnedText) + ' banked of £100k (' + S.pct + '%)</div>';
  var chips = [
    {b:S.monthText, s:"this month", bad:S.behind},
    {b:S.msgs + " of " + S.msgGoal, s:"messages this week", bad:false},
    {b:S.doneCount + " of " + S.tasks.length, s:"tasks done", bad:false}
  ];
  h += '<div class="chips">' + chips.map(function(c, i){
    return '<div class="chip' + (c.bad ? ' bad' : '') + '" style="animation-delay:' + (0.2 + i * 0.15) + 's"><b>' + esc(c.b) + '</b><span>' + c.s + '</span></div>' }).join("") + '</div>';
  h += '<h2 id="today">TODAY ' + S.doneCount + ' OF ' + S.tasks.length + '</h2>';
  S.tasks.forEach(function(t, i){
    var lines = t.d.split(NL), time = lines[0], steps = lines.slice(1).join(NL).trim();
    h += '<div class="task' + (t.done ? ' done' : '') + '" style="animation-delay:' + (0.5 + i * 0.18) + 's">';
    h += '<div class="head" onclick="toggleOpen(' + i + ')"><i>' + (t.done ? '✓' : '○') + '</i><div><b>' + esc(t.t) + '</b><small>' + esc(time) + ' Tap for the steps.</small></div></div>';
    if (openIdx === i) {
      h += '<div class="steps">' + esc(steps) + '</div>';
      h += '<button class="btn ' + (t.done ? 'ghost' : 'good') + '" onclick="mark(' + i + ')">' + (t.done ? 'Mark not done' : 'Mark done') + '</button>';
    }
    h += '</div>';
  });
  h += '<h2>LOG PROGRESS</h2><div class="toast" id="toast">' + esc(S.toast || "") + '</div>';
  h += '<div class="row"><button class="btn" onclick="togglePay()">Log payment</button>';
  h += '<button class="btn ghost" onclick="toggleWeek()">Week numbers</button>';
  h += '<button class="btn ghost" onclick="undoAsk()">Undo last payment</button></div>';
  if (showPay) {
    h += '<div class="card"><label>Amount in £, revenue before tax</label><input id="amt" type="number" inputmode="decimal" placeholder="750">';
    h += '<label>Client</label><input id="cli" type="text" placeholder="Client name">';
    h += '<div style="margin-top:14px"><button class="btn good" onclick="savePay()">Save payment</button></div></div>';
  }
  if (showWeek) {
    h += '<div class="card"><div class="grid2">';
    var f = [["w0","Messages sent",S.week.messages],["w1","Replies",S.week.replies],["w2","Calls held",S.week.calls],["w3","Paid clients",S.week.paid]];
    f.forEach(function(x){ h += '<div><label>' + x[1] + '</label><input id="' + x[0] + '" type="number" inputmode="numeric" value="' + (x[2] || 0) + '"></div>' });
    h += '</div><div style="margin-top:14px"><button class="btn good" onclick="saveWeek()">Save week</button></div></div>';
  }
  if (askUndo) {
    if (S.lastPayment) {
      h += '<div class="card">Remove ' + esc(S.lastPayment) + '?<div class="row" style="margin:12px 0 0"><button class="btn warn" onclick="doUndo()">Remove it</button><button class="btn ghost" onclick="undoAsk()">Keep it</button></div></div>';
    } else {
      h += '<div class="card">No payments are logged.</div>';
    }
  }
  h += '<h2>CHECKPOINTS</h2>';
  S.checkpoints.forEach(function(c){ h += '<div class="cp' + (c.bad ? ' bad' : '') + '">' + esc(c.text) + '</div>' });
  if (S.fallback) h += '<div class="cp bad">' + esc(S.fallback) + '</div>';
  if (S.recent.length) {
    h += '<h2>RECENT PAYMENTS</h2>';
    S.recent.forEach(function(p){ h += '<div class="pay"><span>' + esc(p.date) + (p.client ? ' · ' + esc(p.client) : '') + '</span><b>' + esc(p.amount) + '</b></div>' });
  }
  h += '<div class="visa">Visa ends 20 Nov 2027 (' + S.visaDays + ' days)</div>';
  el("app").className = first ? "anim" : "";
  el("app").innerHTML = h;
  var prog = el("prog");
  if (first) {
    setTimeout(function(){ prog.style.strokeDashoffset = 527.8 * (1 - Math.min(1, S.pct / 100)) }, 150);
    var d = el("days"), t0 = null;
    var tick = function(ts){ if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / 1400); d.textContent = Math.round(S.days * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick) };
    requestAnimationFrame(tick);
  }
}
</script></body></html>`

function build(toast) {
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

  let flagged = false
  const checkpoints = P.CHECKPOINTS.map(c => {
    const goal = P.cumulativeTarget(c.end)
    let state = "ahead or on track"
    if (c.end < mk) {
      state = earned >= goal ? "met" : earned < goal / 2 ? "under half" : "missed"
    } else if (c.end === mk && earned < goal / 2) {
      state = "under half so far"
    }
    const bad = state.indexOf("under half") === 0
    if (bad) flagged = true
    return { text: c.end + ": " + P.gbp(goal) + ", " + c.note + " (" + state + ")", bad: bad }
  })
  const last = data.payments[data.payments.length - 1]

  return {
    days: Math.max(0, P.daysBetween(today, P.GOAL_DATE)),
    visaDays: Math.max(0, P.daysBetween(today, P.VISA_DATE)),
    phase: P.phaseLabel(today),
    earnedText: P.gbp(earned),
    pct: Math.min(100, Math.round((earned / P.TARGET) * 100)),
    monthText: P.money(monthEarned) + " of " + P.money(monthTarget),
    behind: monthTarget > 0 && monthEarned < monthTarget * (today.getDate() / dim),
    msgs: Number(wk.messages) || 0,
    msgGoal: P.WEEK_MSG_GOAL,
    week: { messages: wk.messages || 0, replies: wk.replies || 0, calls: wk.calls || 0, paid: wk.paid || 0 },
    doneCount: tasks.filter((t, i) => doneList.indexOf(i) >= 0).length,
    tasks: tasks.map((t, i) => ({ t: t.t, d: t.d, done: doneList.indexOf(i) >= 0 })),
    checkpoints: checkpoints,
    fallback: flagged ? "Under half a checkpoint. Switch to idea 3: contract analyst work through agencies, and keep the service running on the side." : "",
    lastPayment: last ? P.gbp(last.amount) + " on " + last.date + (last.client ? " from " + last.client : "") : "",
    recent: data.payments.slice(-5).reverse().map(p => ({ date: p.date, client: p.client || "", amount: P.gbp(p.amount) })),
    toast: toast || ""
  }
}

function handle(a) {
  const key = P.dayKey(today)
  if (a.type === "toggle") {
    const done = data.done[key] || []
    const has = done.indexOf(a.i) >= 0
    data.done[key] = has ? done.filter(x => x !== a.i) : done.concat([a.i])
    P.save(data)
    return has ? "Marked not done." : "Done. Well done."
  }
  if (a.type === "pay") {
    const amount = Number(a.amount)
    if (!(amount > 0)) return "Not saved. Enter an amount above zero."
    data.payments.push({ date: P.dayKey(today), amount: amount, client: String(a.client || "").trim() })
    P.save(data)
    return P.gbp(amount) + " saved."
  }
  if (a.type === "week") {
    const num = v => Math.max(0, parseInt(v, 10) || 0)
    data.weeks[P.mondayKey(today)] = { messages: num(a.messages), replies: num(a.replies), calls: num(a.calls), paid: num(a.paid) }
    P.save(data)
    return "Week saved."
  }
  if (a.type === "undo") {
    if (data.payments.length === 0) return "Nothing to undo."
    data.payments.pop()
    P.save(data)
    return "Last payment removed."
  }
  return ""
}

function J(x) {
  return JSON.stringify(x).replace(/</g, "\\u003c").split(String.fromCharCode(8232)).join("\\u2028").split(String.fromCharCode(8233)).join("\\u2029")
}

const wv = new WebView()
await wv.loadHTML(HOME)
let closed = false
const presented = wv.present(true).then(() => { closed = true })
await wv.evaluateJavaScript("setState(" + J(build("")) + ")", false)
while (!closed) {
  const act = await Promise.race([
    wv.evaluateJavaScript("waitAction(completion)", true),
    presented.then(() => null)
  ])
  if (!act) break
  const toast = handle(act)
  await wv.evaluateJavaScript("setState(" + J(build(toast)) + ")", false)
}
Script.complete()
