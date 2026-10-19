# Map parity checklist for the v3 rewrite

The map and tour are rewritten, not wrapped. This checklist defines "preserved". Every item is either asserted by a test or reviewed by hand, and the golden capture (`tests/fixtures/tour_parity.json`) is produced from the current map before any old file is deleted.

If an item cannot be reproduced, the rewrite stops and the difference is reported. A silent loss of behaviour is the failure mode this document exists to prevent.

## Golden capture

`tools/parity_dump.py` loads the current `/map` with `tests/fixtures/run-parity.json` and records:

- `order()` — the tour stop order for that run
- `explainText(k)` — the spoken text of every stop
- each citation's resolved location key, category and coordinates
- pin groups: location, category, member count
- county heat counts
- arc counts by type (`cc`, `cs`, `st`, `fed`, `other`)
- county and state totals

The new map must match every recorded value. Coordinates match within 0.01 projected units; text matches after whitespace normalisation.

## Behaviour

| # | Behaviour | Source | How it is verified |
|---|---|---|---|
| 1 | United States extruded as states; Colorado raised above the rest; the county layer is a separate mesh set | `map3d.js:91-97`, `115-121` | county and state totals match the golden; one manual screenshot at 1440 |
| 2 | Projection and placement: Albers USA with the map origin fixed, county and state geometry from the vendored projected JSON | `map3d.js:45`, `67`, `115` | pin coordinates within tolerance of the golden |
| 3 | Camera: national view on load, close view on focus, distance chosen by category, return to national on reset | `map3d.js` camera lerp | debug `state().camera` after `focus(i)` |
| 4 | Reduced motion: camera jumps instead of animating | camera lerp guard | `matchMedia` emulation; camera settles immediately |
| 5 | Pins per citation group, colour by category, height scaled by count, federal pins raised | `map3d.js:133` | pin groups and heights vs golden |
| 6 | Pin tag collision avoidance: labels hide when they would overlap or leave the viewport; labels are brighter on counties with cases | `map3d.js:224-229` | hover/zoom sequence; no overlapping labels |
| 7 | County heat: colour and opacity by retrieved-case count, maximum normalised | `map3d.js:123-127` | county counts vs golden |
| 8 | Arcs between cited jurisdictions, typed `cc/cs/st/fed/other`, capped at 48 | `map3d.js:63`, `76` | arc counts by type vs golden |
| 9 | Legend states county, jurisdiction and link counts | legend markup | text assertion |
| 10 | Hover a pin: tooltip lists up to six titles; hover a county: name, FIPS and count; both clear on leave | county/pin hover handlers | Playwright hover at computed screen coordinates |
| 11 | Click or tap a pin or county focuses it; a drag is never a tap; a click outside clears the selection | pointer handlers | Playwright pointer sequence |
| 12 | Basemap: Esri dark tiles reprojected to the map plane, attribution shown, silent fallback when tiles fail; can be turned off | `map3d.js:100-113` | block the tile host and assert the map still renders; `?basemap=off` |
| 13 | Tour order: memo citation order, filtered to citations that resolve to a map location | `map3d.js:order` | `order()` vs golden |
| 14 | Stop text: title, court, year, holding or cited-by, and the memo line that cites it; no citation badges spoken aloud | `map3d.js:235-258` | `explainText(i)` vs golden |
| 15 | Narration: server audio when available, browser voice as fallback, captions advanced by `starts` timings or by duration when timings are absent | `map3d.js:277-310` | stub `/api/tts_ts`; assert caption index tracks `currentTime` |
| 16 | Failure behaviour: a failed clip makes the rest of the tour caption-only; a manual skip holds the voice; dragging or scrolling stops the tour | `map3d.js:272`, `touring` guards | stubbed 429 and timeout; pointer drag mid-tour |
| 17 | Controls: previous, play/pause, next, "Stop n of N", stop and replay, 44px targets, aria-labels, Escape closes overlays | tour bar | Playwright button sequence, `small_tap_targets()`, label assertions |
| 18 | Sequence: after a memo, the summary finishes before stop 1 begins; the tour never speaks over the memo | `v2.js:538-569` | stubbed audio; assert order of play |
| 19 | Prefetch: the next stop's clip is requested before the current one ends | `map3d.js:275` | network log assertion |
| 20 | Fallback rendering: where the 3D renderer is unavailable, a flat map still shows counties, pins and the legend | `map3d.js:69-77` | launch with WebGL disabled |

## Explicitly dropped

- Case links and citation cards on the map (`D6`). Sources remain reachable from the memo's Sources panel (`D4`).
- The document preview panel that opened from a citation tap on the map.

## Not required to match

- Pixel-level appearance. The rewrite may look different; it may not behave differently.
- Internal function names, file layout and markup structure.
