# Seeding the demo Worker Group

Only Cribl Enterprise can create extra Worker Groups, so the demo lives in the `default` group of a **separate, spare Cribl.Cloud workspace** (a free org). Steve's lab workspace is never seeded.

The definition lives in [`seed.ts`](./seed.ts). The same data is the "bad" fixture in the unit tests, so the demo and the tests can't drift apart. Everything in it is fake: `example.com` hosts, `FAKE` tokens, and Datagen sources only.

## 1. Set up the demo workspace (once)

1. Sign up for a free Cribl.Cloud org with a different email and open its Stream workspace.
2. **Capture the "clean" fixture before seeding.** A fresh `default` group is the zero-findings check.
   1. Run Live Preview there (step 2, items 1–2).
   2. Open **Show dev tools** and click **Download raw config**.
   3. Hand the file to Claude, who sanitizes it into `test/fixtures/workspace-clean.json`.

## 2. Seed it (Blueprint Live Preview)

1. In the demo workspace, open **Apps > Create App**, use the App ID `cc-blueprint`, and start **Live Preview**.
2. Restart `npm run dev` first if it was last used with another workspace or org.
   - If the app loads but shows `Unknown App "__dev__cc-blueprint"`, the Cribl page didn't register the dev app. Hard-refresh the Live Preview page (Cmd+Shift+R). Use a separate browser profile rather than a private window, which can block Local Network Access.
3. Pick `default`, click **Show dev tools**, then **Seed default**, then **Confirm**.

The seeder:

- Shows the workspace host so you can see which workspace you are about to change.
- Checks the Routing table first. If it has any route the seed doesn't own (i.e. real config), it shows a red warning and makes you type the workspace host to continue. On a fresh workspace, only the Default route exists, so no typing is needed.
- Reads the group's available Datagen samples instead of assuming file names.
- Creates or overwrites 6 pipelines, 3 destinations, and 4 sources, then replaces the whole Routing table.
- Does not commit or deploy. Commit in Cribl if you want a clean "before" state for the demo.

Re-running is safe: it converges the group back to the seed.

## 3. What should fire

| Seeded object | Rule |
| --- | --- |
| Route 2 `catch_all_early` is Final with filter `true` | L01 |
| The same route sends everything unmatched to devnull | L02 (still true after the L01 fix; suppress it with a reason in the demo) |
| Pipeline `legacy_cleanup` is referenced by nothing | L03 |
| Destination `old_s3_archive` is referenced by nothing | L04 |
| Destination `splunk_example` has backpressure set to drop | L05 |
| Pipeline `all_disabled` has every function disabled | L06 |
| Pipeline `enrich_auth` evals a `token=FAKE…` literal | L07 |
| Pipeline `parse_auth` regex starts with `.*` | L08 |
| Source `gen_metrics_qc` uses QuickConnect to `webhook_example` | No false L03/L04; dotted path in the diagram |

## Manual fallback

If the seeder can't run, create the objects listed in `seed.ts` by hand in the Cribl UI, keeping the IDs and route order exactly as written.
