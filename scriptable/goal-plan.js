// Goal Plan: shared settings, schedule and data helpers.
// Name this script exactly "Goal Plan". The other two scripts import it.

const START = new Date(2026, 10, 30)      // Day 1 is Monday 30 Nov 2026
const GOAL_DATE = new Date(2027, 11, 31)
const VISA_DATE = new Date(2027, 10, 20)
const TARGET = 100000
const WEEK_MSG_GOAL = 30
const FILE = "goal-data.json"

// Monthly revenue targets (Part 2 of the plan). Total £108.5k.
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

const M15 = "Use the Part 5 scripts as written. 30 minutes. Log the count."

// Before Day 1
const PRE = [
  { t: "Check your visa allows self-employment", d: "Read your visa letter or ask an adviser. One question: can I be self-employed? Settle this before message one." },
  { t: "Pick who gets your numbers", d: "One person. You send them your four numbers every Sunday." },
  { t: "Block 2 hours on Tue and Thu", d: "Fix the time. Tuesday at 7pm works. When I have time does not." }
]

// Days 1 to 14 (Part 4, plus the Part 13 admin spread across the fortnight)
const DAYS = [
  [ { t: "Write your offer sentence", d: "I help [online sellers] see which products make money, using Power BI and SQL. 20 minutes." },
    { t: "Confirm visa allows self-employment", d: "Do not message firms until you know." } ],
  [ { t: "Pick your 2 best case studies", d: "Pricing and cost suits online sellers. Fulfilment suits stock and delivery firms. Readmissions suits clinics. 30 minutes." },
    { t: "Check your contract on side work", d: "Look for outside work or conflict rules." } ],
  [ { t: "Build a list of 30 firms", d: "Spreadsheet columns: name, contact, sector, date messaged, reply, next step. Use Google Maps, LinkedIn and people you know. 45 minutes." } ],
  [ { t: "Send 15 messages", d: M15 } ],
  [ { t: "Send 15 more messages", d: M15 } ],
  [ { t: "Rest day", d: "No tasks. Rest counts." } ],
  [ { t: "Rest day", d: "No tasks. Rest counts." },
    { t: "Send your 4 numbers to your person", d: "Messages sent, replies, calls held, paid clients." } ],
  [ { t: "Add Work with me to your portfolio", d: "Your offer, your three packages and a contact button. 1 hour." },
    { t: "Register as a sole trader with HMRC", d: "Confirm your visa allows this first." } ],
  [ { t: "Follow up with anyone who has not replied", d: "Send the 4-day follow-up script from Part 5. 30 minutes." },
    { t: "Open a business bank account", d: "Keep business money separate." } ],
  [ { t: "Send 15 new messages", d: M15 },
    { t: "Choose an invoicing tool", d: "Pick one and set up your details." } ],
  [ { t: "Send 15 new messages", d: M15 },
    { t: "Write one agreement template", d: "Scope, price, 50% upfront, payment in 14 days, extra work at an hourly rate, client owns the dashboard, how you handle data." } ],
  [ { t: "Send 15 new messages", d: M15 },
    { t: "Check insurance and ICO", d: "Look at professional indemnity insurance. Check whether you must register with the ICO." } ],
  [ { t: "Review the numbers", d: "How many messages sent, replies, calls booked? 30 minutes." } ],
  [ { t: "Hold your first calls", d: "Use the 15-minute discovery script from Part 6. Send a fixed price and a one-page scope by the next morning." },
    { t: "Send your 4 numbers to your person", d: "Messages sent, replies, calls held, paid clients." } ]
]

// Weekly rhythm from Day 15 (Part 9). Monday first.
const WEEKLY = [
  [ { t: "Build list and send 15 messages", d: "1 hour. Add new firms to the list, then send 15 messages." } ],
  [ { t: "Client work, 2 hours", d: "Deliver the current project. No client yet? Improve a case study or build a sample dashboard." } ],
  [ { t: "Hold discovery calls, 1 hour", d: "Ask the Part 6 questions in order. Send a fixed price and one-page scope by the next morning." } ],
  [ { t: "Client work, 2 hours", d: "Deliver the current project. Ask for a testimonial at handover." } ],
  [ { t: "Follow up and send 15 messages", d: "1 hour. Follow up after 4 days with the Part 5 script, then send 15 new messages." } ],
  [ { t: "Post one case study finding", d: "2 hours: one LinkedIn post, then offers and admin." } ],
  [ { t: "Weekly review, send your numbers", d: "1 hour. Log your four numbers in Log Progress and send them to your person." } ]
]

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
function gbp(n) { return "£" + Math.round(n).toLocaleString("en-GB") }
function daysBetween(a, b) { return Math.round((b - a) / 86400000) }
function midnight(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

// Day 1 is START. Zero or below means before the plan starts.
function dayNumber(today) { return daysBetween(START, midnight(today)) + 1 }

function tasksFor(today) {
  const n = dayNumber(today)
  if (n < 1) return PRE
  if (n <= 14) return DAYS[n - 1]
  return WEEKLY[(today.getDay() + 6) % 7]
}

function phaseLabel(today) {
  const n = dayNumber(today)
  if (n < 1) return "Before Day 1"
  if (n <= 14) return "Day " + n + " of 14"
  return "Week " + (Math.floor((n - 1) / 7) + 1)
}

function path() {
  const fm = FileManager.local()
  return fm.joinPath(fm.documentsDirectory(), FILE)
}
function load() {
  try {
    const fm = FileManager.local()
    const p = path()
    if (fm.fileExists(p)) {
      const d = JSON.parse(fm.readString(p))
      return {
        payments: Array.isArray(d.payments) ? d.payments : [],
        weeks: d.weeks && typeof d.weeks === "object" ? d.weeks : {},
        done: d.done && typeof d.done === "object" ? d.done : {}
      }
    }
  } catch (e) {}
  return { payments: [], weeks: {}, done: {} }
}
function save(d) { FileManager.local().writeString(path(), JSON.stringify(d)) }

function cumulativeTarget(endKey) {
  return Object.keys(MONTHS).filter(k => k <= endKey).reduce((s, k) => s + MONTHS[k], 0)
}

module.exports = {
  START, GOAL_DATE, VISA_DATE, TARGET, WEEK_MSG_GOAL, MONTHS, CHECKPOINTS,
  pad, dayKey, monthKey, mondayKey, money, gbp, daysBetween, midnight,
  dayNumber, tasksFor, phaseLabel, load, save, cumulativeTarget
}
