# Uptick evidence

Target date: 2026-10-23. Counts read 2026-10-21.

All four counts are zero. The `INTERVIEWS.md` log has no rows, `lois/holder/` and `lois/integration/` hold no PDFs, and no `INTEGRATIONS.md` row has a status other than `not contacted`. Nothing below is a claim until the artifact exists.

| Metric | Target by 2026-10-23 | Current | How the count is verified |
|---|---|---|---|
| Customer interviews | 10 | 0 | Number of rows in the `INTERVIEWS.md` log with a date, a handle and a URL, plus a verbatim top pain. A call with no URL or no note does not count. |
| Holder LOIs signed | 3 | 0 | Number of signed PDFs in `gtm/uptick/lois/holder/`, one per holder, named `<handle>-<YYYY-MM-DD>.pdf`. A verbal maybe does not count. |
| Integration conversations started | 6 | 0 | Number of rows in `INTEGRATIONS.md` whose status is not `not contacted` and whose reply URL is present. A sent DM is not a conversation. |
| Integration LOIs signed | 1 | 0 | Number of signed PDFs in `gtm/uptick/lois/integration/`, named `<project>-<YYYY-MM-DD>.pdf`. A public "we should integrate" reply does not count. |

## Instruments built 2026-10-21

Nothing has been sent. Every count above stays at 0 until a reply or a signed file exists.

| Instrument | What it holds | Where |
|---|---|---|
| Target list | 26 holders and LPs who posted between 2026-09-21 and 2026-10-21, each with a status URL and their words; 18 ecosystem projects with the named person, role source, post to cite and the integration asked for | `gtm/uptick/TARGETS.md` |
| Outreach batch | 44 drafted messages, one per target, each at most 400 characters, each citing the target's own post, each with one ask | `gtm/uptick/OUTREACH-BATCH-2026-10-21.md` |
| Batch check | Fails on length above 400, a dash, a missing URL, a number that is not a product fact, a banned phrase | `python3 gtm/uptick/check-batch.py` |
| Async interview | Five questions, optional X handle, consent line; answers stored in the `TALK` KV namespace; `POST /talk` and `GET /talk/count` on the evidence Worker | `web/app/talk/page.tsx`, `api/src/talk.ts` |

An async answer counts as an interview row when it carries an X handle and a verbatim answer to question 3, the same rule as a call: a date, a handle with its profile URL, and the top pain in the person's words. Read the stored answers with `npx wrangler kv key list --binding TALK --remote` and `npx wrangler kv key get --binding TALK --remote <key>`, copy the handle, the date and the answer into the `INTERVIEWS.md` log, and count only the row. An answer without a handle informs the pain themes and does not move the count.

## Two day execution plan

These rows are plan, not results. The `Current` column above moves only on artifacts.

| When | Do | Sent | Interviews | Holder LOIs | Integration conversations | Integration LOIs |
|---|---|---|---|---|---|---|
| Day 1, Wed 2026-10-21 | Deploy the Worker and the site; check `/talk/count` returns a `count`; send the 18 project messages and the 26 holder messages; log each reply the hour it arrives | 44 | 2 | 0 | 2 | 0 |
| Day 2, Thu 2026-10-22 | Reply publicly under the post of every non-responder (up to 20); run the same searches for a second pool and send 25 new holder messages; send the holder LOI template the same day to everyone who gives a size and a condition; book the integration calls | 69 cumulative | 6 | 1 | 4 | 0 |
| Gate, Fri 2026-10-23 morning | Chase open threads; count artifacts against the table at the top | 69 | 10 | 3 | 6 | 1 |

Planning rate: 44 cold messages at 10 to 15 percent reply give 4 to 7 replies, so the 10 interview gate needs the second pool of Day 2. Each integration conversation needs a named owner on their side and a reply URL in `INTEGRATIONS.md`.

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
