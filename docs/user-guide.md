# User guide

## The workflow

1. **Start a ChatGPT conversation with context.** In the tracker, go to
   **Data → Copy context** and paste it as your first message. ChatGPT then
   knows the JSON format, the rules, your targets and your recent progress.
2. **Tell ChatGPT what you ate, trained and weighed**, in plain language, and
   on which day. The context is dated: in a conversation that continues the
   next day, make sure ChatGPT uses the new date. The import preview warns
   when records will be saved on a day other than today.
3. **ChatGPT replies with JSON.** Copy it.
4. **In the tracker: Data → Import.** Paste the JSON (or drop a `.json` file),
   select **Validate & preview**, review what will happen, then select **Confirm import**.
5. Check **Today** for the verdict, totals and timeline.

An import can be up to **10 MB**; anything larger is refused with a message naming the limit
(split it into smaller imports). Nothing is saved until you confirm, and the confirm step checks everything again
on the server. If anything changed between preview and confirm, you get a
fresh preview instead of a surprise.

## How imports work

### The envelope

Every import is one JSON object. Only `schema_version` is required; include
just the parts you need.

```json
{
  "schema_version": "1.0",
  "date": "2026-10-27",
  "food_entries": [ … ],
  "workouts": [ … ],
  "exercise_sets": [ … ],
  "cardio_sessions": [ … ],
  "daily_activity": [ … ],
  "body_measurements": [ … ],
  "daily_notes": [ … ],
  "targets": [ … ],
  "profile": { … },
  "delete": { "food_entries": ["id-1"], "workouts": ["id-2"] }
}
```

- Each collection may be an array or, for convenience, a single object.
- `summary` and `export_meta` blocks are accepted but ignored. **Daily totals
  are always calculated from the entries**, never imported.

### Dates

- The top-level `date` is the default for **new** records that don't have their own `date`.
- A record's own `date` always wins.
- A new record with neither is rejected with a clear message. The rest of the import still applies.
- The top-level `date` never moves an **existing** record. To move one, send
  its `id` with a new `date` (see [Move an entry to another day](#move-an-entry-to-another-day)).
- Dates are calendar days in your profile's timezone (default `Asia/Kolkata`).

### Stable IDs

Every record has an ID. This is what makes imports safe to repeat.

| You send | Result |
|---|---|
| A new ID | The record is created with that ID |
| An existing ID | That record is updated |
| An existing ID with identical content | Reported as *unchanged*; nothing is written |
| No ID | A new record with a generated UUID. The ID is shown after confirming |
| Nothing about a record | It stays exactly as it is. Leaving something out never deletes it |

- IDs are 1–100 characters: letters, digits, `.`, `_`, `:`, `-`, starting with
  a letter or digit. For example `food-a12` or a UUID.
- IDs are unique per record type. `x1` can be both a food entry and a cardio session.
- Two identical foods on the same day are two records with two IDs.
- The same ID appearing twice in one import (same type) is rejected, because the
  intent is ambiguous.

**Best practice:** let ChatGPT invent an ID for every new record (the context
prompt tells it to). Then pasting the same JSON twice changes nothing.

### Updating: omitted fields vs `null`

- A field you **omit** keeps its stored value.
- A field set to **`null`** is cleared, if it is optional.
- `null` on a required field (for example a food's `name`) rejects that record.

### Unknown values are `null`, never `0`

If you don't know a food's calories, leave `calories` out or set it to `null`.
The entry shows a **Needs details** badge, the day's totals are marked
**partial**, and the verdict won't call a nutrient "low" when the shortfall
could just be missing data. Add the value later by re-importing the entry's ID
with `calories`.

### One-per-day records

`daily_activity` (steps, weight), `daily_notes` and `targets` (keyed by
`effective_from`) hold at most one record per date. Sent **without an ID**,
they update that date's existing record instead of creating a second one. So
`{"daily_activity": {"steps": 9000}}` and later `{"daily_activity": {"weight_kg": 78.4}}`
for the same date end up as one record with both values.

### Targets are versioned

A targets record applies from its `effective_from` date until the next one.
Past days keep being judged against the targets that applied then. A new
version **copies forward** any value you leave out from the previous version;
the preview shows a warning listing what was copied.

### Several records for the same date in one import

For `daily_activity`, `daily_notes` and `targets` (one per date), records for
the same date in one import are combined into one: `{"steps": 5000}` and
`{"weight_kg": 80}` for the same date create one record with both. If two
records give **different** values for the same field, the later one is rejected
with a message naming the field, so nothing is silently overwritten. Two
different IDs can't claim the same date.

### Unknown fields are rejected

Field names are strict, to catch typos:

- An unknown field inside a record rejects **that record**, with a hint:
  `unknown field "protien_g" (did you mean "protein_g"?)`.
- An unknown top-level key (e.g. `food_entry`) rejects **the whole import**,
  because otherwise a whole section would be silently skipped.

### Deleting

Only the `delete` block deletes, and only the IDs it lists:

```json
{ "schema_version": "1.0", "delete": { "food_entries": ["food-a12"], "workouts": ["wo-legs-1"] } }
```

- Deleting a workout also deletes its sets.
- Deleting an ID that doesn't exist is reported as *unchanged* with a
  warning, so running the same delete twice is harmless.
- The same ID can't be deleted and created/updated in one import.

## Preview and confirm

The preview lists every record with one of these outcomes:

| Outcome | Meaning |
|---|---|
| **Create** | A new record. "new id on confirm" means the tracker will generate the ID |
| **Update** | An existing record changes. *Changes* lists the fields; *moved from* shows a date change |
| **Unchanged** | Already stored exactly like this |
| **Delete** | Will be deleted |
| **Rejected** | Won't be applied. The error says why. Other records still apply |

Use the filter to show changes only, everything, rejected only or unchanged
only, and the search box to find a name or ID. **Confirm import** applies all
valid records in one transaction: either all of them are saved or none are.

After confirming you'll see the result, links to the affected days, and any
**IDs the tracker generated**. Use **Copy IDs for ChatGPT** to paste them back
into the conversation so ChatGPT can correct those records later.

If confirming says **your data changed since the preview**, something modified
the same records in between (another tab, or a different paste). Review the
refreshed preview and confirm again.

## Examples

### Log a meal

```json
{
  "schema_version": "1.0",
  "date": "2026-10-27",
  "food_entries": [
    { "id": "food-k3x9q1", "name": "Chicken breast", "meal": "Post-workout meal", "time": "19:30",
      "quantity": 150, "unit": "g", "weight_basis": "raw",
      "calories": 180, "protein_g": 34, "carbs_g": 0, "fat_g": 4, "fiber_g": 0, "estimated": true },
    { "id": "food-p0w2e7", "name": "Office biryani", "meal": "office lunch", "notes": "nutrition unknown" }
  ]
}
```

`meal` is free text ("midnight snack", "post-workout meal", anything). The
Today page groups entries by meal label and orders them by `time`.

### Correct an entry

Send the ID and only what changes:

```json
{ "schema_version": "1.0", "food_entries": [{ "id": "food-p0w2e7", "calories": 650, "protein_g": 22, "carbs_g": 85, "fat_g": 24, "fiber_g": 3 }] }
```

**Don't know the ID?** Don't guess, because a wrong or new ID creates a
duplicate. First use **Data → Copy day JSON** (or **Copy month JSON**), paste it
into ChatGPT, and let it use the IDs from that export.

### Move an entry to another day

```json
{ "schema_version": "1.0", "food_entries": [{ "id": "food-k3x9q1", "date": "2026-10-26" }] }
```

The preview shows *moved from 2026-10-27*. Both days' totals update.

### Log a workout with sets

```json
{
  "schema_version": "1.0",
  "date": "2026-10-27",
  "workouts": [{
    "id": "wo-push-1027", "name": "Push day", "start_time": "18:00", "duration_min": 65, "estimated_calories": 320,
    "sets": [
      { "id": "set-a1", "exercise": "Bench Press", "set_number": 1, "reps": 8, "weight_kg": 60, "rpe": 7.5 },
      { "id": "set-a2", "exercise": "Bench Press", "set_number": 2, "reps": 8, "weight_kg": 60, "rpe": 8 },
      { "id": "set-a3", "exercise": "Dips", "set_number": 1, "reps": 12 }
    ]
  }]
}
```

A missing `weight_kg` means bodyweight or unknown load. Exercise names are
grouped case- and punctuation-insensitively ("Bench Press", "bench-press"),
while your spelling is kept for display.

### Add a set to an existing workout

```json
{ "schema_version": "1.0", "exercise_sets": [{ "id": "set-a4", "workout_id": "wo-push-1027", "exercise": "Bench Press", "set_number": 3, "reps": 6, "weight_kg": 62.5 }] }
```

### Move a set to another workout

Reusing an existing set's ID under a *different* workout would move it, so the
importer refuses unless you confirm with `"allow_move": true` on that set (not
stored, never exported). The preview shows the old and new workout.

```json
{
  "schema_version": "1.0",
  "date": "2026-10-27",
  "workouts": [{ "id": "wo-pull-1027", "name": "Pull day" }],
  "exercise_sets": [{ "id": "set-a4", "workout_id": "wo-pull-1027", "allow_move": true }]
}
```

Updating a set in the workout it already belongs to needs no permission, and
changing its `exercise` to a different exercise is allowed but flagged in the
preview ("exercise changed from … to …").

### Steps, weight and a note

```json
{ "schema_version": "1.0", "date": "2026-10-27", "daily_activity": { "steps": 9420, "weight_kg": 78.6 }, "daily_notes": { "text": "Slept 6h, felt flat." } }
```

### New targets from today

```json
{ "schema_version": "1.0", "targets": [{ "effective_from": "2026-10-27", "calories": 2100, "protein_g": 160 }] }
```

Carbs, fat, fiber, steps and goal weight are copied from the previous version.

### Profile

```json
{ "schema_version": "1.0", "profile": { "height_cm": 178, "goal": "Lean bulk", "timezone": "Asia/Kolkata" } }
```

## Exports and moving between conversations

| Data page control | Gives you | Use it for |
|---|---|---|
| **Copy context** | A short prompt: purpose, import rules, ID rules, current targets, today's and recent progress | The first message of a new ChatGPT conversation |
| **Copy day JSON** / **Copy month JSON** (pick the month and year from the two lists) | Exact records with their IDs, plus daily totals | When ChatGPT needs to correct records or review details |
| **Complete history** | Everything: profile, all target versions, all records | Archive, or moving to another tool |
| **Selected range** | Records between two dates | Sharing a specific period |

The context prompt deliberately **leaves out your detailed history** to stay
short. It tells ChatGPT to ask you for an export when it needs past entries
or IDs.

Every export uses the import format. Re-importing an export changes nothing
(everything comes back *unchanged*), and importing it into a fresh
installation reproduces the data with the same IDs.

## Settings: profile and targets

Open **Settings** (or **Set targets** on the Today page).

- **Profile:** name, height, fitness goal (body recomposition, fat loss,
  muscle gain or maintenance), activity level, sex, birth date and timezone
  (default `Asia/Kolkata`). Every field is optional except the timezone. An
  empty field clears that value. The birth date can't be in the future. If a
  goal or activity level came from an import in your own words (for example
  "recomp", "lean bulk", "moderate"), it is kept exactly as written and shown
  with how it is understood ("counts as Body recomposition"); saving the
  profile doesn't rewrite it.
- **Body weight:** a weight is a dated measurement, so it has its own form:
  pick the **date** (it follows today until you choose one) and the weight, then
  **Record weigh-in**. The confirmation names the date, and says if it replaced
  an earlier weight for that day (one weigh-in per day; steps and notes on the
  day are kept). Future dates are refused. Saving your profile never creates or
  repeats a weigh-in.
- **Daily targets:** calories, protein, carbohydrates, fat, fiber, steps and
  goal weight. Fill in only what you know. Saving creates a target version
  that applies from the chosen **Effective from** date; earlier days keep their
  targets. Blank fields copy the value from the version before it, and the
  confirmation message says what was copied. Saving again for the same date
  updates that version. The **Target history** table lists every version.
- **Suggest targets** (optional) fills the form with estimates and shows the
  calculation: Mifflin-St Jeor resting energy × an activity factor × a goal
  adjustment; protein 1.6–2.0 g per kg; fat 27% of calories; carbs the
  remainder; fiber 14 g per 1,000 kcal. It needs sex, birth date (age 14–100),
  height, your latest recorded weigh-in, activity level and goal, and lists any
  that are missing or not recognised instead of guessing. It shows the weight
  and date it used, and warns when that weigh-in is more than 30 days old.
  Nothing is saved until you edit and save.

Settings are written through the same engine as JSON imports, so the same
validation and history rules apply.

## How totals are calculated

- Every total is the sum of the stored food entries for that date. Daily
  totals are never stored and never imported.
- **Unknown is not zero.** An entry without calories (or a macro) adds nothing
  to that total, and the total is marked **partial** (shown with a `+`, a
  "Partial" note, or "(partial)"). Today, History, Trends and exports all use
  this rule.
- **Each nutrient is judged on its own.** A missing fiber value makes only the
  *fiber* total partial: calories, protein, carbs and fat for that day stay exact
  and still count everywhere (verdict, adherence, averages, charts). Nutrients are
  never treated as a group.
- **A day with no food is never "complete".** It is reported as "No food logged"
  (confidence *none*), not as complete totals; exports show `nutrition_complete: null`.
- **Calories are used as listed.** The app never recalculates a food's
  calories from its macros or overwrites them, even when the two disagree; it
  shows what you logged.
- **Averages** (Trends tiles, weekly table, History, the ChatGPT context) use
  only days where *that nutrient* is exact, because partial days would pull them
  down. Each average says how many days it covers.
- **One rule for "within target"** everywhere (verdict, History, Trends):
  calories 90–110% of target; protein at least 90%; carbs and fat 80–120%; fiber
  at least 80%; **steps at least 90%**. Boundaries are inclusive (exactly 90%
  counts). Trends' "goal hit" percentages use these same thresholds.
- **Exercise calories** are estimates, shown separately, and never added back
  to the food budget.
- **Targets** come from the version in effect on each date, never just the
  latest one.
- Rounding: totals are kept to 0.1 and displayed as whole numbers; bars and
  percentages use the same values.

## Themes

Choose a look with the theme buttons at the bottom of the sidebar (in the top bar
on a phone):

| Theme | Look |
|---|---|
| **Light** | Soft tinted background, white cards, indigo accent |
| **Dark** | Near-black, sky-blue accent |
| **Aurora** | Deep indigo-to-violet background, dark glass cards with a glowing edge, cyan, violet and pink accents, glowing progress rings |
| **System** | Follows your device: Light or Dark, switching live when the device does |

The choice is remembered **on each device** (it is stored in that browser, not in
your account), applies before the page first paints, and also themes the sign-in
page. Chart colours, text and status colours were checked for readability in all
three themes (text at least 4.5:1, chart colours checked for colour-blind
separation); a test keeps those values from changing by accident. Animations are
off if your device asks for reduced motion.

## Reading the dashboard

The Today page shows the date in its heading and is labelled **Today**,
**Past day** or **Upcoming day**. **Today** in the menu always opens the
current date in your timezone. A page left open overnight refreshes itself at
midnight, and also when you come back to the tab. The arrows, the date
picker and links like `/?date=2026-10-26` open exactly that date.

**Daily verdict.** Rules are applied in this order:

| Status | When |
|---|---|
| Upcoming | The date is in the future |
| No data | Nothing recorded on the date (no food, training, steps, weight, measurements or notes) |
| In progress | No targets are set for the date, or no calorie target; or the date is today and nothing is already over target |
| Incomplete data | A metric that has a target is unknown because some entries lack that nutrient (judged per metric: missing fiber never makes calories or protein unreliable), or a past day has activity but no food |
| Under target | On a finished day, one or more reliably measured values are below their range and none are above. The headline names every one, e.g. "Calories and protein are under target." |
| Over target | One or more values are above their range (any day, including today) and none are below |
| Mixed | Some values are under and others over, e.g. "Calories are under target; fat is over target." |
| On target | A finished day with complete nutrition, a calorie target, and every measure that has a target within range |

Ranges are the shared rule above. A value that is below target while some
entries are unknown is reported as **unknown**, never as a shortfall. A value
already over target counts even with unknown entries, because the true total
can only be higher. Something reliably outside its range is still reported
even when an unrelated nutrient is unknown, and the headline adds that the unknown
total is incomplete. **On target** is never given just because nothing was flagged.
The status describes the whole day and never a single nutrient: a one-letter strip
under it (Cal, Pro, Carb, Fat, Fib, Steps) shows ↓ under, ✓ on target, ↑ over,
? incomplete, – no target or nothing logged for each measure, with the same words
available to screen readers. Today's shortfalls show as "In progress" (still to go), not as under. The verdict also lists **next steps** (set targets, add missing
nutrition details, log steps) and explains when estimates lower confidence.

**History** lists only days with records by default. **Show all dates**
includes empty days. A day counts as logged if it has food, training, steps,
weight, measurements or a note.

**Trends** charts leave days without data empty; they're never drawn as zero.
A chart needs at least two days with data, and the weight trend needs at
least two weigh-ins. Adherence percentages show their denominator and only
count days with complete nutrition and a target.

**Logging steps without ChatGPT.** On Today there is a **Log steps** card with
one field. It saves steps for the day you are viewing, so go to yesterday and
the same card logs or updates yesterday. Whole numbers 0–200,000; saving
replaces that day's count and keeps weight and notes. Future days are disabled.

**History rows** open the day when you click anywhere on the row.

**Names in the ChatGPT context.** *Copy context* now includes the exercise
(up to 40) and cardio (up to 15) names you already use, most recent first, with
the rule to reuse them exactly so new logs join the same group.

**Exercises** shows personal records: max weight, estimated 1RM (Epley,
sets of 1–12 reps) and max reps, with each session that set a record marked
**PR**. Workouts logged without sets are reported as such; nothing is invented.
Tap the ⓘ next to **Est. 1RM** for what it means (1RM = one-rep max; the estimate
is worked out from weight × reps, it is not a tested max). There are no
per-exercise graphs: with about one session a week they say little, so each
exercise shows its records and a session list instead.

Use the **Strength | Cardio** switch at the top of the page for cardio.
Cardio sessions are grouped by activity name (case and punctuation ignored,
so "Running" and "running" are one group): total distance and time, longest
session, and best pace. Pace is only shown when a session has both distance
and time. Grouping happens when the page is shown; your stored records are
never changed.

## Field reference

All fields except `schema_version` are optional unless marked **yes**. Units
are metric: kg, cm, g, kcal, km, minutes. The same rules are enforced by the
importer; these tables are generated from its schema.

#### `targets` (one per date)

| Field | Type | Required on create | `null` allowed |
|---|---|---|---|
| `id` | id (letters, digits, `. _ : -`, max 100) | no (generated) | no |
| `effective_from` | date `YYYY-MM-DD` | if no top-level `date` | no |
| `calories` | number 0–20000 | no | yes |
| `protein_g` | number 0–2000 | no | yes |
| `carbs_g` | number 0–2000 | no | yes |
| `fat_g` | number 0–2000 | no | yes |
| `fiber_g` | number 0–2000 | no | yes |
| `steps` | integer 0–200000 | no | yes |
| `goal_weight_kg` | number 20–500 | no | yes |
| `notes` | text, 1–2000 chars | no | yes |

#### `food_entries`

| Field | Type | Required on create | `null` allowed |
|---|---|---|---|
| `id` | id (letters, digits, `. _ : -`, max 100) | no (generated) | no |
| `date` | date `YYYY-MM-DD` | if no top-level `date` | no |
| `name` | text, 1–200 chars | **yes** | no |
| `meal` | text, 1–100 chars | no | yes |
| `time` | time `HH:MM` (24-hour) | no | yes |
| `quantity` | number 0–100000 | no | yes |
| `unit` | text, 1–30 chars | no | yes |
| `weight_basis` | `"raw"` or `"cooked"` | no | yes |
| `calories` | number 0–20000 | no | yes |
| `protein_g` | number 0–2000 | no | yes |
| `carbs_g` | number 0–2000 | no | yes |
| `fat_g` | number 0–2000 | no | yes |
| `fiber_g` | number 0–2000 | no | yes |
| `source` | text, 1–100 chars | no | yes |
| `estimated` | true / false | no | yes |
| `notes` | text, 1–2000 chars | no | yes |

#### `workouts`

| Field | Type | Required on create | `null` allowed |
|---|---|---|---|
| `id` | id (letters, digits, `. _ : -`, max 100) | no (generated) | no |
| `date` | date `YYYY-MM-DD` | if no top-level `date` | no |
| `name` | text, 1–200 chars | no | yes |
| `start_time` | time `HH:MM` (24-hour) | no | yes |
| `duration_min` | number 0–1440 | no | yes |
| `estimated_calories` | number 0–10000 | no | yes |
| `notes` | text, 1–2000 chars | no | yes |
| `sets` | array of exercise sets (without `workout_id`) | no | no |

#### `exercise_sets`

| Field | Type | Required on create | `null` allowed |
|---|---|---|---|
| `id` | id (letters, digits, `. _ : -`, max 100) | no (generated) | no |
| `workout_id` | id (letters, digits, `. _ : -`, max 100) | **yes** | no |
| `exercise` | text, 1–200 chars | **yes** | no |
| `set_number` | integer 1–1000 | **yes** | no |
| `reps` | integer 0–10000 | no | yes |
| `weight_kg` | number 0–1000 | no | yes |
| `rpe` | number 0–10 | no | yes |
| `duration_s` | integer 0–86400 | no | yes |
| `allow_move` | true / false: confirms moving an *existing* set to a different workout. Not stored, not exported | no | no |
| `notes` | text, 1–2000 chars | no | yes |

#### `cardio_sessions`

| Field | Type | Required on create | `null` allowed |
|---|---|---|---|
| `id` | id (letters, digits, `. _ : -`, max 100) | no (generated) | no |
| `date` | date `YYYY-MM-DD` | if no top-level `date` | no |
| `activity` | text, 1–100 chars | **yes** | no |
| `start_time` | time `HH:MM` (24-hour) | no | yes |
| `duration_min` | number 0–1440 | no | yes |
| `distance_km` | number 0–1000 | no | yes |
| `avg_heart_rate` | integer 20–250 | no | yes |
| `estimated_calories` | number 0–10000 | no | yes |
| `notes` | text, 1–2000 chars | no | yes |

#### `daily_activity` (one per date)

| Field | Type | Required on create | `null` allowed |
|---|---|---|---|
| `id` | id (letters, digits, `. _ : -`, max 100) | no (generated) | no |
| `date` | date `YYYY-MM-DD` | if no top-level `date` | no |
| `steps` | integer 0–200000 | no | yes |
| `weight_kg` | number 20–500 | no | yes |
| `notes` | text, 1–2000 chars | no | yes |

#### `body_measurements`

| Field | Type | Required on create | `null` allowed |
|---|---|---|---|
| `id` | id (letters, digits, `. _ : -`, max 100) | no (generated) | no |
| `date` | date `YYYY-MM-DD` | if no top-level `date` | no |
| `waist_cm` | number 1–300 | no | yes |
| `chest_cm` | number 1–300 | no | yes |
| `hips_cm` | number 1–300 | no | yes |
| `neck_cm` | number 1–300 | no | yes |
| `arm_cm` | number 1–300 | no | yes |
| `thigh_cm` | number 1–300 | no | yes |
| `body_fat_pct` | number 0–100 | no | yes |
| `notes` | text, 1–2000 chars | no | yes |

#### `daily_notes` (one per date)

| Field | Type | Required on create | `null` allowed |
|---|---|---|---|
| `id` | id (letters, digits, `. _ : -`, max 100) | no (generated) | no |
| `date` | date `YYYY-MM-DD` | if no top-level `date` | no |
| `text` | text, 1–10000 chars | **yes** | no |

#### `profile` (single object, partial updates)

| Field | Type | Required on create | `null` allowed |
|---|---|---|---|
| `name` | text, 1–100 chars | no | yes |
| `sex` | text, 1–30 chars | no | yes |
| `birth_date` | date `YYYY-MM-DD` | no | yes |
| `height_cm` | number 50–300 | no | yes |
| `timezone` | IANA timezone, e.g. `Asia/Kolkata` | no | no |
| `activity_level` | text, 1–100 chars | no | yes |
| `goal` | text, 1–500 chars | no | yes |
| `notes` | text, 1–2000 chars | no | yes |
