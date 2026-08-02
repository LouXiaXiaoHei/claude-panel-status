# Claude Panel Status Icon Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and install a new 128×128 PNG icon using the approved “Status Lens / Soft 3D” design.

**Architecture:** Use the built-in image generation tool to create one high-resolution square source, visually gate that source against the approved specification, then use FFmpeg Lanczos scaling to produce the repository’s final RGBA `icon.png`. Create temporary 64px and 32px derivatives solely for visual QA; the extension continues consuming the existing `package.json` path.

**Tech Stack:** Built-in image generation tool, FFmpeg, macOS `sips`, npm test runner

## Global Constraints

- Do not use Claude or Anthropic official marks, wordmarks, initials, or official-looking shapes.
- Do not include text, numbers, watermarks, scenery, or decorative objects.
- Use a centered composition with safe padding and a complete silhouette.
- Use a dark rounded-square base, a central signal chip, a cyan/purple/gold segmented status ring, and a green online indicator at upper right.
- Use restrained highlights, shallow shadows, and limited glow; no strong neon, complex textures, or photorealistic scene.
- Final output must be exactly 128×128 RGBA PNG at repository root `icon.png`.
- Do not change `package.json`, README screenshots, extension UI, status styling, naming, publishing configuration, or runtime behavior.

---

### Task 1: Generate, install, and verify the replacement icon

**Files:**
- Create temporarily: `tmp/imagegen/status-lens-source.png`
- Create temporarily: `tmp/imagegen/icon-64.png`
- Create temporarily: `tmp/imagegen/icon-32.png`
- Modify: `icon.png`
- Verify: `package.json`
- Test: `test/patch-core.test.js`

**Interfaces:**
- Consumes: approved design specification at `docs/superpowers/specs/2026-08-02-icon-redesign-design.md`
- Produces: `icon.png`, an exact 128×128 RGBA PNG consumed by `package.json` through `"icon": "icon.png"`

- [ ] **Step 1: Generate the high-resolution source with the built-in image tool**

Use the built-in image generation tool in generation mode with this exact production prompt:

```text
Use case: logo-brand
Asset type: VS Code extension marketplace icon, square source for a final 128×128 PNG
Primary request: Create an original “Status Lens” icon for an unofficial developer-tool extension that continuously monitors panel status.
Scene/backdrop: A self-contained dark charcoal rounded-square icon base, viewed straight on, with generous internal safe padding and no environment outside the icon.
Subject: A compact central signal chip surrounded by one bold segmented circular gauge. The gauge has three clearly separated colored segments: cyan, violet, and warm gold. Add one small green online-status dot at the upper right of the gauge.
Style/medium: Polished soft 3D app icon, clean geometric construction, subtle enamel-like materials, restrained bevels, crisp edges, professional developer-tool aesthetic.
Composition/framing: Perfectly centered, symmetrical overall balance, large simple shapes, readable at 32×32, no cropped elements, no thin lines.
Lighting/mood: Soft controlled studio highlights and shallow shadows, limited subtle glow only around the status elements.
Color palette: Charcoal and near-black base; cyan, violet, warm gold, and a small fresh green accent.
Constraints: Original independent brand mark; strong silhouette; the central chip, three gauge segments, and green status point must remain distinct when reduced; no transparency requirement for the source.
Avoid: Claude logo, Anthropic logo, official brand shapes, letters, words, numbers, typography, watermark, robot, face, animal, scenery, extra UI panels, tiny details, strong neon bloom, glass transparency, photorealistic scene, gradients that muddy segment boundaries.
```

Expected: one high-resolution square image with no text or trademark-like elements. Record the returned image path as `GENERATED_IMAGE_PATH`.

- [ ] **Step 2: Inspect the generated source before touching the repository icon**

Open `GENERATED_IMAGE_PATH` with the local image viewer and compare it with every global constraint.

Expected: the central chip, three ring segments, and green status dot are visually distinct; the base is a complete dark rounded square; there are no letters, official marks, faces, scenery, or excessive bloom. If exactly one constraint fails, make one targeted image-generation edit and recheck; do not broaden the design.

- [ ] **Step 3: Copy the approved source into the project’s temporary workspace**

Run, substituting the exact absolute path returned by the built-in image tool for `GENERATED_IMAGE_PATH`:

```bash
mkdir -p tmp/imagegen
cp "GENERATED_IMAGE_PATH" tmp/imagegen/status-lens-source.png
```

Expected: `file tmp/imagegen/status-lens-source.png` reports PNG image data.

- [ ] **Step 4: Render the final icon and QA sizes with deterministic RGBA output**

```bash
ffmpeg -y -loglevel error -i tmp/imagegen/status-lens-source.png -vf scale=128:128:flags=lanczos -pix_fmt rgba icon.png
ffmpeg -y -loglevel error -i tmp/imagegen/status-lens-source.png -vf scale=64:64:flags=lanczos -pix_fmt rgba tmp/imagegen/icon-64.png
ffmpeg -y -loglevel error -i tmp/imagegen/status-lens-source.png -vf scale=32:32:flags=lanczos -pix_fmt rgba tmp/imagegen/icon-32.png
```

Expected: all three commands exit 0 without FFmpeg errors.

- [ ] **Step 5: Verify file metadata and package linkage**

```bash
sips -g pixelWidth -g pixelHeight -g hasAlpha icon.png tmp/imagegen/icon-64.png tmp/imagegen/icon-32.png
node -e 'const p=require("./package.json"); if(p.icon!=="icon.png") process.exit(1); console.log(p.icon)'
```

Expected: widths and heights are respectively `128`, `64`, and `32`; every file reports `hasAlpha: yes`; Node prints `icon.png` and exits 0.

- [ ] **Step 6: Visually inspect the final icon at all target sizes**

Open `icon.png`, `tmp/imagegen/icon-64.png`, and `tmp/imagegen/icon-32.png` with the local image viewer.

Expected: the 32px result still separates the central chip, ring, and green point; edges are crisp; the colored ring does not merge into a single blurred band; the dark rounded-square silhouette remains complete.

- [ ] **Step 7: Run the existing automated tests**

```bash
npm test
```

Expected: all tests pass with zero failures.

- [ ] **Step 8: Review the scoped diff and commit the asset replacement**

```bash
git status --short
git diff --stat -- icon.png
git add icon.png
git commit -m "feat: redesign extension icon"
```

Expected: the commit contains only `icon.png`; the user’s pre-existing `.gitignore` modification and temporary `tmp/imagegen/` files remain uncommitted.
