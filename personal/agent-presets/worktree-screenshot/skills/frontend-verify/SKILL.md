---
name: frontend-verify
description: Verify every user-visible frontend change in a real browser, inspect its screenshot, fix findings, and re-verify before completion.
---

# Frontend verification

Every user-visible frontend change requires verification in the real target page. Source inspection or a successful build does not replace rendered-page verification.

Use the available browser tools to exercise the affected user flow, inspect relevant runtime or network failures, and judge the final visual result. Capture the relevant state and read the returned image with `read_image`; a screenshot path alone is not visual inspection. Choose the tools, order, pages, interactions, and verification depth according to the change.

Fix any relevant runtime, interaction, layout, or visual issue you find, then re-verify the affected result. Close browser pages after verification.

Screenshots are temporary model inputs, not deliverables. Do not expose credentials, tokens, private data, or unrelated authenticated content. Do not ask the user to inspect screenshots or list their paths unless the user requests evidence files. If the browser or `read_image` is unavailable, report the unverified result instead of claiming visual verification.

Include relevant browser verification and any remaining limitation in the normal completion report; do not use a separate fixed evidence checklist.
