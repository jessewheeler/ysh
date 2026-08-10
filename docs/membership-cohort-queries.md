# New vs. Renewed Member Queries (PostgreSQL)

> Ad-hoc reporting queries for the production Render Postgres. Not wired into the app — these are
> for answering "how many new members did we get this period, and how many renewed?"

## Definitions

- **Current period** — the `membership_periods` row where `start_date <= today <= end_date`. This is
  the same rule as `membershipPeriods.getCurrent()` in `db/repos/membershipPeriods.js`. Note that
  periods can overlap (see `docs/membership-periods.md`); `ORDER BY start_date DESC LIMIT 1` picks
  the most recently opened one.
- **Enrolled** — has a `membership_years` row for that period.
- **Renewed** — also has a `membership_years` row in a period whose `start_date` is earlier.
- **New** — enrolled in the current period with no earlier enrollment.

## Two rules these queries follow

**Dates are TEXT, compare them as TEXT.** `start_date` / `end_date` are `TEXT` columns in Postgres
too — `toPgSchema()` only rewrites `TEXT DEFAULT (NOW())`. Never compare them to `NOW()` or
`CURRENT_DATE` directly (this is what caused the PR #69 revert). ISO `YYYY-MM-DD` sorts
lexicographically, so `to_char(CURRENT_DATE, 'YYYY-MM-DD')` gives a correct text-to-text comparison.

**`$1` only works from app code.** Render's SQL console and plain `psql` don't bind parameters — a
query with `$1` fails with `bind message supplies 0 parameters, but prepared statement requires 1`.
The queries below compute the date in SQL via the `as_of` CTE so they run as-is. From
`db.get`/`db.all`, replace `as_of` with a bound `$1` holding `new Date().toISOString().slice(0, 10)`.

`CURRENT_DATE` resolves in the server timezone (UTC on Render), so on the first or last day of a
period it can be a day ahead of Mountain time. To pin it:

```sql
-- fixed date
SELECT '2026-08-10'::text AS d
-- or club-local
SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Denver', 'YYYY-MM-DD') AS d
```

## Shared CTE header

All three queries below start with this. `enrolled` is only needed by query 1.

```sql
WITH as_of AS (
  SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d
),
current_period AS (
  SELECT mp.id, mp.label, mp.start_date, mp.end_date
    FROM membership_periods mp
   CROSS JOIN as_of a
   WHERE mp.start_date <= a.d AND mp.end_date >= a.d
   ORDER BY mp.start_date DESC
   LIMIT 1
),
prior AS (
  SELECT DISTINCT my.member_id
    FROM membership_years my
    JOIN membership_periods mp ON mp.id = my.membership_period_id
   CROSS JOIN current_period cp
   WHERE mp.id <> cp.id
     AND mp.start_date < cp.start_date
)
```

## 1. Headline counts

```sql
WITH as_of AS (
  SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d
),
current_period AS (
  SELECT mp.id, mp.label, mp.start_date, mp.end_date
    FROM membership_periods mp
   CROSS JOIN as_of a
   WHERE mp.start_date <= a.d AND mp.end_date >= a.d
   ORDER BY mp.start_date DESC
   LIMIT 1
),
enrolled AS (
  SELECT my.member_id
    FROM membership_years my
    JOIN current_period cp ON cp.id = my.membership_period_id
),
prior AS (
  SELECT DISTINCT my.member_id
    FROM membership_years my
    JOIN membership_periods mp ON mp.id = my.membership_period_id
   CROSS JOIN current_period cp
   WHERE mp.id <> cp.id
     AND mp.start_date < cp.start_date
)
SELECT cp.label,
       cp.start_date,
       cp.end_date,
       COUNT(*) FILTER (WHERE p.member_id IS NULL)     AS new_members,
       COUNT(*) FILTER (WHERE p.member_id IS NOT NULL) AS renewed_members,
       COUNT(*)                                        AS total_enrolled
  FROM enrolled e
  LEFT JOIN prior p ON p.member_id = e.member_id
 CROSS JOIN current_period cp
 GROUP BY cp.label, cp.start_date, cp.end_date;
```

## 2. Split by membership type and person kind

`membership_years` holds one row per *person* — family sub-members get their own row at signup. Use
`person_kind = 'primary'` to count paying households.

```sql
-- shared CTE header (as_of, current_period, prior) goes here
SELECT m.membership_type,
       CASE WHEN m.primary_member_id IS NULL THEN 'primary' ELSE 'sub_member' END AS person_kind,
       COUNT(*) FILTER (WHERE p.member_id IS NULL)     AS new_members,
       COUNT(*) FILTER (WHERE p.member_id IS NOT NULL) AS renewed_members,
       COUNT(*)                                       AS total
  FROM membership_years my
  JOIN current_period cp ON cp.id = my.membership_period_id
  JOIN members m ON m.id = my.member_id
  LEFT JOIN prior p ON p.member_id = my.member_id
 WHERE m.status <> 'cancelled'
 GROUP BY 1, 2
 ORDER BY 1, 2;
```

This won't tie exactly to query 1: the `status <> 'cancelled'` filter drops members query 1 counts.
Add the same filter to query 1's `enrolled` CTE if the numbers need to reconcile.

## 3. Roster detail (spot-checking / export)

```sql
-- shared CTE header (as_of, current_period, prior) goes here
SELECT m.member_number,
       m.first_name,
       m.last_name,
       m.email,
       m.membership_type,
       m.status,
       m.join_date,
       my.created_at                                               AS enrolled_at,
       CASE WHEN p.member_id IS NULL THEN 'new' ELSE 'renewed' END  AS cohort,
       pay.amount_cents,
       ROUND(pay.amount_cents / 100.0, 2)                          AS amount_dollars,
       pay.payment_method,
       pay.status                                                   AS payment_status
  FROM membership_years my
  JOIN current_period cp ON cp.id = my.membership_period_id
  JOIN members m ON m.id = my.member_id
  LEFT JOIN prior p ON p.member_id = my.member_id
  LEFT JOIN payments pay ON pay.id = my.payment_id
 ORDER BY cohort, LOWER(m.last_name), LOWER(m.first_name), m.id;
```

`ORDER BY cohort` works as written — Postgres allows output-column aliases there. `pay.*` is NULL for
anyone enrolled without a linked payment (admin comps, backfills, lifetime members). The result set
carries member names and emails, so treat any export as member PII.

## Caveats to check before trusting the numbers

- **Backfill gap.** `membershipYears.listMembersByPeriod()` documents that older backfills enrolled
  only primaries. If prior periods were backfilled that way, family sub-members read as "new" even
  though the household renewed. Fix by attributing sub-members to the primary's history:
  `LEFT JOIN prior p ON p.member_id = COALESCE(m.primary_member_id, m.id)`.
- **Lifetime members.** `is_lifetime` members may never get a `membership_years` row, so they fall
  out of both buckets. Add `OR m.is_lifetime = 1` to the enrolled set if the board expects them in
  the total.
- **First period.** If the current period is the earliest in `membership_periods`, `prior` is empty
  and everyone reads as new. Accurate, but say so on any report.
- **"This year" is not the period.** Periods run April→July of the following year, so a
  calendar-year framing gives different numbers. `m.join_date >= cp.start_date` is the cheaper
  approximation if you want first-ever signups by date rather than by enrollment history.

## Verification

Query 1's cohort logic was checked against a scratch in-memory SQLite DB built from `db/schema.js`
with two periods, a renewing individual, a brand-new individual, a renewing family pair, and a
lapsed member: it returned 1 new / 3 renewed / 4 total, correctly excluding the lapsed member. The
queries have **not** been run against production Postgres.
