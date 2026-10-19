# Uptick evidence

Target date: 2026-10-23. Counts read 2026-10-19.

All four counts are zero. The kit has no interview rows, no signed LOIs and no logged integration replies. Nothing below is a claim until the artifact exists.

| Metric | Target by 2026-10-23 | Current | How the count is verified |
|---|---|---|---|
| Customer interviews | 10 | 0 | Number of rows in the `INTERVIEWS.md` log with a date, a handle and a URL, plus a verbatim top pain. A call with no URL or no note does not count. |
| Holder LOIs signed | 3 | 0 | Number of signed PDFs in `gtm/uptick/lois/holder/`, one per holder, named `<handle>-<YYYY-MM-DD>.pdf`. A verbal maybe does not count. |
| Integration conversations started | 6 | 0 | Number of rows in `INTEGRATIONS.md` whose status is not `not contacted` and whose reply URL is present. A sent DM is not a conversation. |
| Integration LOIs signed | 1 | 0 | Number of signed PDFs in `gtm/uptick/lois/integration/`, named `<project>-<YYYY-MM-DD>.pdf`. A public "we should integrate" reply does not count. |

## Daily check

At the end of each day:

1. Count the log rows in `INTERVIEWS.md`. Count only rows with a date, a handle, a URL and a verbatim pain.
2. Count the PDFs in `gtm/uptick/lois/holder/` and `gtm/uptick/lois/integration/`.
3. Count the `INTEGRATIONS.md` rows with a status other than `not contacted` and a reply URL.
4. If a count did not move, write one line on what was sent, to whom, and on which channel. A zero with no outreach line is a lost day.

## What does not count

- Someone saying "interesting" or "cool".
- A DM reply with no named owner, no scope and no date.
- A call with no notes and no URL.
- An LOI with no honest size or no condition.
- An integration compliment with no owner on their side.
- A count copied from a plan instead of an artifact.

## Artifact paths

- Interviews: `gtm/uptick/INTERVIEWS.md`
- Holder LOIs: `gtm/uptick/lois/holder/`
- Integration LOIs: `gtm/uptick/lois/integration/`
- Integration replies: `gtm/uptick/INTEGRATIONS.md`
