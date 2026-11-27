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

// Each task has a short title (t) and instructions (d).
// Line 1 of d is the time. The steps follow. The widget uses t, Log Progress shows d.
function L() { return Array.prototype.slice.call(arguments).join("\n") }

const SCRIPT_SELLERS = "Online sellers: Hi [name], I saw your shop sells [product type]. I built a dashboard that shows which products make profit after costs. In a sample of 240 orders it showed [your finding]. I can set up the same view with your numbers. Would a free 15-minute call this week help?"
const SCRIPT_STOCK = "Stock and delivery firms: Hi [name], late deliveries often start with stock that was not checked before dispatch. I studied this in a fulfilment case and built a simple report that flags the risk early. I can show you how it would look with your data. Do you have 15 minutes this week?"
const SCRIPT_CLINIC = "Clinics: Hi [name], I built a report that shows which patients most need follow-up when staff time is limited. It works on counts, with no patient names. Would 15 minutes this week be useful to see if the same idea fits your clinic?"

function sendMessages(pickLine) {
  return L(
    "Time: 30 minutes.",
    "",
    "1. " + pickLine,
    "2. Copy the script for that sector. Fill in the name, the product type and your finding.",
    "3. Send each one on LinkedIn, by email or on Instagram.",
    "4. Write today's date in the date messaged column.",
    "5. Open Log Progress, choose Log week numbers and update messages sent.",
    "",
    "Scripts, as written:",
    SCRIPT_SELLERS,
    SCRIPT_STOCK,
    SCRIPT_CLINIC
  )
}

const NUMBERS_TASK = {
  t: "Send your 4 numbers to your person",
  d: L(
    "Time: 5 minutes.",
    "",
    "1. Open Log Progress and choose Log week numbers. Check messages sent, replies, calls held and paid clients.",
    "2. Text them to your person. Example: Sent 30, replies 1, calls 0, paid 0."
  )
}

const REST_TASK = { t: "Rest day", d: "Time: none.\n\nDo nothing on the plan today. Rest keeps you sending next week." }

// Before Day 1
const PRE = [
  { t: "Check your visa allows self-employment", d: L(
    "Time: 30 minutes.",
    "",
    "1. Open your visa decision letter or eVisa. Find the conditions.",
    "2. Look for the words self-employment, business and work.",
    "3. Write down what it says and where you found it.",
    "4. If it is unclear, book a call with a regulated immigration adviser. Ask: Can I be self-employed on this visa?",
    "5. If the answer is no, stop here. Rework the plan before you message anyone."
  ) },
  { t: "Pick who gets your numbers", d: L(
    "Time: 5 minutes.",
    "",
    "1. Pick one person who will read them.",
    "2. Text them: Every Sunday I will send you four numbers. Will you read them?"
  ) },
  { t: "Block 2 hours on Tue and Thu", d: L(
    "Time: 5 minutes.",
    "",
    "1. Open your calendar.",
    "2. Block Tuesday 7pm to 9pm and Thursday 7pm to 9pm.",
    "3. Name both Goal work.",
    "4. Put your phone away during them."
  ) }
]

// Days 1 to 14 (Part 4, plus the Part 13 admin spread across the fortnight)
const DAYS = [
  // Day 1
  [ { t: "Write your offer sentence", d: L(
      "Time: 20 minutes.",
      "",
      "1. Open a notes file.",
      "2. Write this shape: I help [who] [get what], using [your tools].",
      "3. Fill it in: I help online sellers see which products make money, using Power BI and SQL.",
      "4. Read it as a stranger. Do they know who you help and what they get? If not, cut words until they do."
    ) },
    { t: "Confirm visa allows self-employment", d: L(
      "Time: 5 minutes.",
      "",
      "1. Re-read your visa answer from before Day 1.",
      "2. Do not message anyone until it says you may work for yourself."
    ) } ],
  // Day 2
  [ { t: "Pick your 2 best case studies", d: L(
      "Time: 30 minutes.",
      "",
      "1. Open your pricing and cost case study. Write one sentence about what it found. Shape: In a sample of 240 orders, [category] made less profit than it looked.",
      "2. Pick a second case study. Choose fulfilment for stock and delivery firms. Choose readmissions for clinics.",
      "3. Write one finding sentence for the second one.",
      "4. Save both sentences in your notes file."
    ) },
    { t: "Check your contract on side work", d: L(
      "Time: 15 minutes.",
      "",
      "1. Open your employment contract.",
      "2. Search for outside work, conflict of interest and other employment.",
      "3. Write down what you must tell your employer and what you must not do."
    ) } ],
  // Day 3
  [ { t: "Build a list of 30 firms", d: L(
      "Time: 45 minutes.",
      "",
      "1. Open a spreadsheet. Add columns: name, contact, sector, date messaged, reply, next step.",
      "2. Search Google Maps for online shops. Add 10 rows. A row needs a name and one way to reach them.",
      "3. Search LinkedIn for founder or owner plus ecommerce. Add 10 rows.",
      "4. Add 10 people you know who run or work in small firms.",
      "5. Stop at 30 rows. Do not tidy them."
    ) } ],
  // Day 4
  [ { t: "Send 15 messages", d: sendMessages("Open your list and pick 15 rows.") } ],
  // Day 5
  [ { t: "Send 15 more messages", d: sendMessages("Pick the next 15 rows on your list.") } ],
  // Day 6
  [ REST_TASK ],
  // Day 7
  [ REST_TASK, NUMBERS_TASK ],
  // Day 8
  [ { t: "Add Work with me to your portfolio", d: L(
      "Time: 60 minutes.",
      "",
      "1. Open your portfolio. Add a section called Work with me.",
      "2. Write your offer sentence at the top.",
      "3. Add three packages. Starter, £1,500: one data source, 5 to 8 charts, done in 1 week. Standard, £3,000: several data sources, cleaned data, automatic refresh, done in 2 weeks. Full, £5,000 and up: a SQL data model, a dashboard and a training session.",
      "4. Add a contact button that opens an email to you."
    ) },
    { t: "Register as a sole trader with HMRC", d: L(
      "Time: 30 minutes.",
      "",
      "1. Do this only if your visa answer allows self-employment.",
      "2. Register as a sole trader on gov.uk.",
      "3. Save the confirmation."
    ) } ],
  // Day 9
  [ { t: "Follow up with anyone who has not replied", d: L(
      "Time: 30 minutes.",
      "",
      "1. Open your spreadsheet. Filter for rows with no reply.",
      "2. Send each one: Hi [name], a quick follow-up. I can send a one-page example of the dashboard if that is easier than a call.",
      "3. Write the follow-up date in the next step column."
    ) },
    { t: "Open a business bank account", d: L(
      "Time: 30 minutes.",
      "",
      "1. Pick a bank that takes sole traders.",
      "2. Have your ID and proof of address ready.",
      "3. Keep all business money in this account."
    ) } ],
  // Day 10
  [ { t: "Send 15 new messages", d: sendMessages("Pick 15 new rows. Add 10 new rows first if your list is running low.") },
    { t: "Choose an invoicing tool", d: L(
      "Time: 20 minutes.",
      "",
      "1. Pick one tool that sends invoices and shows who has paid.",
      "2. Add your business name and bank details.",
      "3. Set payment terms to 14 days."
    ) } ],
  // Day 11
  [ { t: "Send 15 new messages", d: sendMessages("Pick 15 new rows. Do not message the same person twice.") },
    { t: "Write one agreement template", d: L(
      "Time: 45 minutes.",
      "",
      "1. Write one page. Include what is included and what is not.",
      "2. Add the price, 50% upfront and payment within 14 days.",
      "3. Add extra work at an agreed hourly rate.",
      "4. Add that the client owns the dashboard and you may show an anonymised version.",
      "5. Add how you handle data. Ask for aggregate data where you can.",
      "6. Save it as your template."
    ) } ],
  // Day 12
  [ { t: "Send 15 new messages", d: sendMessages("Pick 15 new rows. Do not message the same person twice.") },
    { t: "Check insurance and ICO", d: L(
      "Time: 30 minutes.",
      "",
      "1. Get two quotes for professional indemnity insurance. Expect a few hundred pounds a year.",
      "2. On the ICO website, check whether you must register for the data you handle."
    ) } ],
  // Day 13
  [ { t: "Review the numbers", d: L(
      "Time: 30 minutes.",
      "",
      "1. Count messages sent, replies and calls booked.",
      "2. Work out your reply rate. Replies divided by messages. The plan expects about 8 in 100.",
      "3. If it is far lower, change one thing. Try a new first line or a different finding."
    ) } ],
  // Day 14
  [ { t: "Hold your first calls", d: L(
      "Time: 15 minutes per call, plus 30 minutes after.",
      "",
      "1. Open your notes before each call.",
      "2. Ask in this order. What decision is hard to make with your numbers today? Where does your data live? Who reads the reports, and how often? How long does the current report take to produce? What would a good result look like in 3 months? Who else approves spending?",
      "3. End with: I will send a fixed price and a one-page scope by tomorrow.",
      "4. After the call, write the price and scope while it is fresh.",
      "5. Send it the next morning.",
      "6. Your first two clients get 30% off. Ask them for a testimonial and permission to show the work."
    ) },
    NUMBERS_TASK ]
]

// Weekly rhythm from Day 15 (Part 9). Monday first.
const WEEKLY = [
  [ { t: "Build list and send 15 messages", d: L(
      "Time: 1 hour.",
      "",
      "1. Add 10 new firms to your list.",
      "2. Send 15 messages using the sector scripts.",
      "3. Update your count in Log week numbers."
    ) } ],
  [ { t: "Client work, 2 hours", d: L(
      "Time: 2 hours.",
      "",
      "1. Work on the client project.",
      "2. With no client yet, improve one case study or build a sample dashboard for your offer."
    ) } ],
  [ { t: "Hold discovery calls, 1 hour", d: L(
      "Time: 1 hour.",
      "",
      "1. Hold your discovery calls using the six questions.",
      "2. Write each fixed price and scope after the call.",
      "3. Send them the next morning."
    ) } ],
  [ { t: "Client work, 2 hours", d: L(
      "Time: 2 hours.",
      "",
      "1. Work on the client project.",
      "2. At handover, ask for a testimonial and 2 names for referrals."
    ) } ],
  [ { t: "Follow up and send 15 messages", d: L(
      "Time: 1 hour.",
      "",
      "1. Follow up with anyone you messaged 4 days ago.",
      "2. Send 15 new messages.",
      "3. Update your count in Log week numbers."
    ) } ],
  [ { t: "Post one case study finding", d: L(
      "Time: 2 hours.",
      "",
      "1. Post one case study finding on LinkedIn.",
      "2. Reply to any offers.",
      "3. Do any admin: invoices, receipts and your agreement."
    ) } ],
  [ { t: "Weekly review, send your numbers", d: L(
      "Time: 1 hour.",
      "",
      "1. Open Log week numbers. Enter your four numbers.",
      "2. Text them to your person.",
      "3. Write the first task for Monday on the first line of your notes file."
    ) } ]
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
