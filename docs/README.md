# Docs

Most of these files were written during the HackSprint NYC build on 2026-10-16, when the app ran in a Daytona sandbox. They are kept as a record of that day. Commands in them were updated for the `app/` layout, but URLs, sandbox paths and counts are as they were then. Treat the code, `README.md`, `AGENTS.md` and `repo.manifest.json` as the current source.

Current:

- `FRONTEND_INVENTORY.md`: every page, control, owning file and API route in `static/`, plus known clutter. Start here for frontend work.
- `V2_CHECKPOINT.md`: the v2 frontend decision, layout rules, the dark-default theme and what has been built so far.
- `continuity/cgm-pin.md`: which writing-helper commit this repo pins, what `.content-system/` holds, and how CI checks it.
- `continuity/oio-pin.md`: which OIO commit this repo pins, the installer layout under `.oio/`, and how CI checks it.
- `voice-and-data-model.md`: the TTS provider chain and queue, the local-then-Octo answer, retrieval and clip caches, and how the Octo tables are versioned and migrated.
- `issues/NETWORK_EGRESS_INFERHUB.md`: notes on the sandbox's blocked egress to InferHub, kept because it explains why model calls failed from the sandbox that day.

Hackathon records (historical):

- `PLAN.md`: the build plan and architecture sketch from the day.
- `HACKATHON_POLICY.md`: the short mirror of the team's working rules. Claiming tasks still works the same way, through `acs/claim.py`.
- `ABA_BUILD_LOG.md`: what was built with ABA and when.
- `ARIZE_SETUP.md`: what was created in Arize by API, and what had to be clicked by hand.
- `COPY.md`: presentation copy for the slides and landing page.
- `PRESENTER_GUIDE.md`: the 3-minute demo script and checklist.
- `UX_GUIDELINES.md`: UI rules for agents editing `static/`.
