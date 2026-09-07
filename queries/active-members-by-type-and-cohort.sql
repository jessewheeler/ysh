-- Active members for a season, broken down by membership type and new-vs-renewed.
--
-- Set the season in the `target` CTE below (WHERE id = ...). Period ids are NOT
-- chronological -- id 1 is the 2026-2027 season and id 2 is 2025-2026 -- which is why
-- the cohort test compares start_date rather than excluding an id.
--
-- Definitions:
--   * Membership is enrollment in membership_years, not members.status. status is written
--     by the nightly expiry job and lags reality between runs (see CLAUDE.md).
--   * The unit is the household (the primary member row). membership_type is stored on
--     every row including family sub-members, so grouping members directly would count a
--     family of four as four "family" members. The `people` column counts household
--     members actually enrolled in the period.
--   * new = no enrollment in any period that started before this one
--     renewed = has at least one such enrollment
--     Cross-checked against members.join_date on 2026-09-07: the two definitions agreed
--     on all 48 households, so the split is not an artifact of the primaries-only
--     enrollment backfill in db/migrate.js.
--
-- PostgreSQL (production). Uses ROLLUP for the subtotal and total rows.

WITH target AS (SELECT id, start_date
                FROM membership_periods
                WHERE id = 1),
     household AS (SELECT m.id, m.membership_type
                   FROM members m
                            JOIN membership_years my ON my.member_id = m.id
                            JOIN target t ON t.id = my.membership_period_id
                   WHERE m.primary_member_id IS NULL),
     classified AS (SELECT h.id,
                           h.membership_type,
                           CASE
                               WHEN EXISTS (SELECT 1
                                            FROM membership_years prior
                                                     JOIN membership_periods pp ON pp.id = prior.membership_period_id
                                                     CROSS JOIN target t
                                            WHERE prior.member_id = h.id
                                              AND pp.start_date < t.start_date) THEN 'renewed'
                               ELSE 'new' END                                 AS cohort,
                           (SELECT count(*)
                            FROM membership_years my2
                                     JOIN members f ON f.id = my2.member_id
                                     CROSS JOIN target t
                            WHERE my2.membership_period_id = t.id
                              AND COALESCE(f.primary_member_id, f.id) = h.id) AS people
                    FROM household h)
SELECT COALESCE(membership_type, 'ALL') AS membership_type,
       COALESCE(cohort, 'ALL')          AS cohort,
       count(*)                         AS households,
       sum(people)                      AS people
FROM classified
GROUP BY ROLLUP (membership_type, cohort)
ORDER BY membership_type, cohort;
