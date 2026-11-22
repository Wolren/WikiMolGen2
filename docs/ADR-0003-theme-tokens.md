# ADR 0003, Interface themes are tokens, custom themes are seeds

Status: **accepted** (2026-11-22)
Supersedes: nothing

## Context

The first theme system had three fixed palettes (Light, Paper and Dark), System, and a
four-option `<select>`. The page's colours were literal values scattered through
`styles.css`. That was fine for three palettes and awkward for more: every new palette
was a copy of twenty declarations, and there was no way for a user to choose their own.

The request is a more comprehensive theme system with custom themes. It has to keep the
existing property that the stored choice paints before the first frame, because a theme
flash is the most visible defect a theme system can have.

## Decision

### 1. Every surface reads one token set

The interface is defined by 21 CSS custom properties: `--ink`, `--muted`, `--faint`,
`--line`, `--line-strong`, `--surface` (three levels), `--stage-tint`, `--field`,
`--canvas`, `--code`, five accent values, two danger values and two shadows. A theme is
just a set of values for those properties, plus a mode.

### 2. Fixed palettes stay in CSS

Light, Paper, Contrast, Dark, Slate and Midnight are blocks in `styles.css` under
`[data-theme="..."]`. The head script sets that attribute from storage before the module
loads, so the first frame is already correct.

The picker needs miniatures of palettes that are not applied. The same blocks also match
`[data-theme-preview="..."]`, and the miniature's children read the inherited tokens.
A preview therefore cannot drift from the palette it offers.

### 3. A custom theme is five seeds and a derivation

The editor asks for a name and five colours: accent, page, panel, text and figure
backdrop. `deriveTheme` mixes them in OKLab and applies contrast floors: muted and faint
text reach 4.5:1 against the panel, and the accent is lifted toward black or white until
it reaches 4.5:1. Lines, fields, input backgrounds, soft accents, danger inks and shadows
are derived. The mode follows the panel's luminance, so a dark panel means a dark theme
without a second switch.

The resolved tokens are written inline on `<html>` and a copy is stored under
`wikimolgen2.theme-vars`. The head script applies that payload verbatim; it never carries
a copy of the derivation.

### 4. One attribute carries the mode

Most rules do not care whether a palette is light or dark. The two that do, the RDKit
black-ink overrides in `stage.css`, match `[data-scheme="dark"]`. Every dark theme, fixed
or custom, takes that path.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Put every palette in TypeScript and paint inline | A first visit would paint the default and then flip after the module loads, or the head script would have to duplicate every palette |
| Generate one stylesheet per custom theme | A `<style>` element cannot be applied before the module without duplicating the derivation, and revoking it needs the same token clearing |
| Expose all 21 values in the editor | A theme becomes a 21-field form, and most combinations are unreadable. Five seeds cover the useful space |
| CSS `light-dark()` and `color-mix()` only | They cannot express a user-chosen palette on the root element without inline values, and the contrast floors need measurement |
| Keep the `<select>` and add more options | The choice is visual; a name alone does not show paper from slate |

## Consequences

* A new fixed palette is one CSS block, one metadata entry and one preview selector. The
  selector list is the only place the two can drift, and the miniature makes drift visible.
* A custom theme cannot set an arbitrary token. This is deliberate: the derivation keeps
  lines, hovers, shadows and accents in proportion.
* The painted accent can differ from the accent the user picked, because of the contrast
  floor. The editor says so while the theme is open.
* A custom theme's first paint depends on the stored payload. Clearing site data returns
  the page to System, which is the documented fallback.
* The theme store is session-local until applied. Two tabs do not sync a new custom theme
  until a reload; the app has no cross-tab channel, and a theme is not shared state.
