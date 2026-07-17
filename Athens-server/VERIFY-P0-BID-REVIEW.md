# P0 Bid Review / Reject / Mark-fixed — Verification

Date: 2026-07-17

## Automated

- `node --test src/lib/bidResultStatus.test.mjs` — **9/9 pass**
  - Confirms `deriveBidUiStatus` prefers `reviewStatus` over `status=skipped`
  - Canonical résumé naming helpers also covered (P2)

## Live API (Athens-server on `:8979`, applier `Eli Taylor`)

| Criterion | Result | How |
|---|---|---|
| Pending Bid Ready stays Pending until Apply | Pass | 14 pending unchanged after reject/mark-fixed cycle |
| Submitted → Rejected; Bid-Monitor Rejected list only | Pass | `PATCH … status=rejected` → `GET /bid-results/rejected` includes item; main UI status `rejected` |
| Skipped → Rejected shows Rejected not Skipped | Pass | `rejectSource: "skipped"`, UI status `rejected` |
| Mark fixed → Submitted; leaves Rejected; Athens Submitted | Pass | `POST /mark-fixed` → `status=submitted`, gone from rejected list, `resubmitCount=1` |
| Reviewer undo does **not** bump `resubmitCount`; Mark fixed does | Pass | After mark-fixed `resubmitCount=1`; reject + undo kept `resubmitCount=1` while `rejectCount` increased |
| Optional `rejectReason` stored / listed | Pass | Reason returned on reject payload and rejected list |
| Timeline ordered history | Pass | `GET /bid-results/:id/events` → `reviewer_reject → vendor_mark_fixed → reviewer_reject → reviewer_undo` |
| Status mapping unit test / code path | Pass | `bidResultStatus.js` + tests; controller uses `deriveBidUiStatus` |

## Code paths verified by review

- Athens Bid Management: Skipped→Rejected (kanban drop / detail Reject / list Reject), optional reason prompt, badges, event timeline in `BidDetailPane`
- Bid-Monitor: workspace tabs **Bid Ready | Rejected**, `GET_REJECTED_BIDS` / `MARK_BID_FIXED`, mark-fixed does not re-queue Bid Ready (`reviewStatus`/`done` filtered out)
- Events persisted in `bid_review_events`

## Note

If endpoints 404 after pulling code, restart Athens-server so nodemon/node loads the new routes.

---

# P1 — Stats / bidding time (verified)

- `biddingDurationSec` set on complete/upload submit; `null` on skip (code path review)
- `GET /bid-results/stats?applierName=&since=&until=` returns rejection rate, real rejects, skip→reject, resubmits, avg bid time
- Live check (`Eli Taylor`): window filter works (`since=2099…` → `totalTasks:0`; `since=2020…` includes tasks)
- KPIs surfaced in Bid Management strip + Vendor Monitor Bid Analytics (period-aware `since`/`until`)

---

# P2 — Canonical résumé naming (verified)

- Unit tests: stem format, folder===file stem, case-sensitive mismatch, Windows reserved names
- `POST /bid-results/resume-audit` → mismatch true for `WrongName.pdf` vs `Company - Title - Profile - shortId.pdf`
- `GET /bid-results/resumes.zip?jobIds=…` → 200 zip; entries like `Motional - Senior Engineer - Eli Taylor - …/….pdf` (stem match)
- Bid-Monitor page-hook records original vs expected; still renames to profile for ATS; toast + Athens BidDetail mismatch banner

---

# P3 — Hook hardening (verified by code + light checks)

- Drag-drop + FormData patch + fetch FormData awareness in `page-hook.js`
- `inject-hook.js` + `content.js` `all_frames: true` for ATS iframes
- Iframe toast forwarded to top frame via `SHOW_TOAST` (manifest **2.17.1**)
- Empty states / error handling on Rejected page; badges for rejectSource / mismatch
- Optional reject push notifications: not shipped (left optional)
