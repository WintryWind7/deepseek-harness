---
name: frontend-verify
description: Verify frontend work in a real browser, including visual inspection by reading screenshots with read_image, then fix findings and re-verify before completion.
---

# Frontend verification loop

After building or changing HTML, CSS, frontend JavaScript, a browser-rendered component, or a dev-server response, verify the real page before reporting completion. Do not ask the user to inspect defects that the available tools can inspect.

## Required loop

1. **Open the real target** — use `browser_open` with the actual localhost URL or built file/directory. Do not substitute source inspection for rendered-page verification. The result already includes load-time console errors.
2. **Check runtime health** — call `browser_console`, normally with `errorsOnly: true`. Investigate console errors and failed requests rather than dismissing an unidentified 4xx/5xx response.
3. **Read deterministic facts** — use `browser_read`:
   - `mode: text` for rendered copy, data, and visible states;
   - `mode: styles` for layout boxes, display, overflow, colors, typography, and alignment;
   - `mode: html` when the rendered DOM structure matters.
4. **Exercise user flows** — use `browser_interact` for the core clicks, input, keyboard actions, navigation, and state changes affected by the task. Recheck the console after interactions.
5. **Perform visual inspection** — capture the relevant final state with `browser_screenshot`, then immediately call `read_image` on the returned PNG path. A screenshot path alone is not visual verification. Inspect the image for clipping, overlap, overflow, broken responsive layout, weak hierarchy, inconsistent spacing, unreadable contrast, awkward empty states, and visibly unfinished composition.
6. **Fix findings and re-verify** — if any runtime, interaction, deterministic-layout, or visual problem appears, modify the source, rebuild or wait for the correct watcher, then start again with a fresh `browser_open`. Repeat the console, interaction, screenshot, and `read_image` checks needed to prove the issue is gone.
7. **Close browser pages** — call `browser_close` after verification to release resources.

## Screenshot policy

- Screenshots are temporary model inputs, not deliverables. Do not ask the user to review them and do not list screenshot paths in the final response unless the user requests screenshots or evidence files.
- Do not create screenshots for planning, backend-only, database-only, documentation-only, or non-rendered changes.
- Do not screenshot credentials, tokens, private personal data, or authenticated pages containing unnecessary secrets. Use safe test data and crop to the relevant element when possible.
- If `read_image` cannot read the screenshot, report that visual verification was unavailable; do not claim to have visually inspected it.

## Completion report

Report the exact pages and interactions verified, whether the console and network were clean, the visual issues found and fixed, and any browser behavior that could not be verified. Do not claim frontend completion after only taking a screenshot or only reading source code.
