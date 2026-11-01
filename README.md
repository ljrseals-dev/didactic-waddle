# Vocoder in a Room

The Dudley-style vocoder voice (see the Dudley Vocoder package) placed in a simulated room. Open `index.html`.

- Top-down plan: drag the voice and the listener. Width, depth, height, wall absorption, voice distance and azimuth are sliders too.
- Direct sound goes through a Web Audio HRTF `PannerNode`. Early reflections come from an image-source shoebox model (order 3) and the tail from an 8-line feedback delay network (hall) or a Dattorro-style plate. `src/worklets.js` holds both.
- Voice modes: Dudley 1940, modern chord, modern buzz, or no vocoder. Demo phrase or your own file.
- Readouts: distance, azimuth, RT60 (Eyring), critical distance, direct-to-reverb level. The standalone page can save the render as WAV.

Build: `python3 build.py`. Test: `NODE_PATH=$(npm root -g) node tests/browser.test.cjs` (Playwright, Chromium).

## Measured in headless Chromium
- Direct-to-reverberant ratio falls as the voice moves away: +0.8 dB at 1.5 m, -5.0 dB at 3 m, -10.3 dB at 6 m, -15.3 dB at 11 m (1/r predicts about 17 dB over that span; measured 16).
- An off-axis voice gives level and time differences between the ears: at 90 degrees about 7.9 dB and 0.75 ms, right ear louder and earlier; none at 0; mirror image at -90.
- Reverb time grows with room size and, with damping off, matches the Eyring formula within 15 percent (0.44 s measured vs 0.45 s formula small room, 0.86 vs 0.90 medium, 1.98 vs 2.16 large). The damping control shortens it further, as intended; Eyring does not model damping.
- The plate adds a tail longer than the dry signal.

## Not verified
- How it sounds. Nobody has listened to it.
- Whether the direct and diffuse levels cross at the drawn critical distance.
- The HRTF data is the browser's own, not a specific measured head.
- The plate coefficients are from memory of Dattorro's design and were not checked against the paper.
- The room is a plain box with one absorption value for every wall.

See CREDITS.md for citations.
