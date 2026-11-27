# Goal Countdown widget: design

## Intent
Add a £100,000 revenue countdown to the Scriptable setup that already holds the Visa Countdown widget. The goal date is 31 Dec 2027. The widget shows how many days remain, how much revenue is banked, this month's target against actual, and this week's outreach count.

## Goals
- A home screen widget (small and medium) and a lock screen widget (circular, rectangular, inline), matching the visa widget's look.
- A second script, Log Progress, to record payments and weekly numbers in a few taps.
- All data stays on the phone. No server.

## Non-goals
- No change to the visa script.
- No sync between devices.
- No invoicing, no tax maths.
- No outreach list or scripts in the app. The plan document holds those.

## Anti-goals
- Entering a number takes longer than 20 seconds. The plan fails if logging feels like a chore.
- The widget hides a miss. A month below target shows in red.

## Decisions (yours)
- Approach 2: a separate script, "Goal Countdown", beside the visa script.
- The £100k is revenue, before tax.

## Decisions (my calls)
- Files live in `scriptable/` in this repo: `goal-countdown.js`, `log-progress.js`, `README.md`. You paste each into Scriptable.
- Data lives in one JSON file in Scriptable's local documents folder. It holds the target, a list of payments (date, amount, client) and weekly numbers (messages, replies, calls, paid clients).
- Monthly targets are the Part 2 table, held as a constant at the top of the script. Total is £108.5k, so £8.5k is buffer.
- Weeks run Monday to Sunday. The weekly message goal is 30. Day 1 is Monday 30 Nov 2026.
- Medium widget layout: days left, banked revenue against £100k, this month's target against actual, messages this week out of 30. A footer line reads "Visa ends 20 Nov 2027" so the clash with the goal date stays in view.
- Colours, refresh time (just after midnight) and fonts copy the visa script.
- Tapping the widget runs Log Progress.
- Log Progress menu: Log payment, Log week numbers, Undo last payment, Show summary. The summary shows the four checkpoints from Part 11.
- A month below half its target shows in red. The fallback rule in Part 11 is a text line in the summary, not an alert.

## Approaches considered
1. Edit the visa script: one widget, but a risk to the working one.
2. Second script (chosen): safe, two widgets side by side.
3. Dashboard on the artifact page: the widget cannot read the page's data, so numbers would be entered twice.

## Left to the builder
- Exact font sizes and spacing.
- Date maths around month and week boundaries.
- How the file is read if it is missing or damaged (start fresh, never crash the widget).

## Open risk (not a build item)
The visa expires 20 Nov 2027, 41 days before the goal date. Confirm that your visa allows self-employment before the first message. This is Part 13 of the plan.

## Update: daily tasks
- The widget shows today's tasks from the plan. Days 1 to 14 follow Part 4, with the Part 13 admin spread across them. From Day 15 the Part 9 weekly rhythm repeats.
- Before Day 1 (Mon 30 Nov 2026) it shows three preparation tasks, starting with the visa check.
- Tasks are ticked off in Log Progress. Ticks are stored per day in the data file.
- Shared settings, the schedule and file helpers moved into a third script, "Goal Plan", which the other two import.
- Medium widget: days left, banked revenue and four tasks. Large widget: adds this month, messages and the visa line.
