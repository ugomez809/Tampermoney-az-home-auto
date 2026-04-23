# Agent Instructions

**Read this before making ANY change to a file in `files/`.**

This repo ships Tampermonkey userscripts to production operators via auto-update
(`@updateURL` pointing at raw GitHub). A single accidental rename or header edit
silently breaks auto-update for everyone — operators stop receiving fixes with
no error surfaced. These rules exist to prevent that.

## Hard rules — do not break these

### 1. NEVER rename a file in `files/`

Filenames are permanent URL identifiers. The `@updateURL` installed on every
operator's machine points at the exact current filename. Rename the file and
the URL 404s — every operator is orphaned forever (or until they manually
reinstall, which they won't notice they need to do).

This applies to any form of rename:
- Changing spaces to hyphens
- Changing case
- Adding or removing a version number
- "Cleaning up" the name
- Moving the file to a subdirectory

If you think a file needs renaming, STOP and ask the human first. Renames
require a full operator rollout and must be coordinated.

### 2. NEVER modify `@name`, `@namespace`, `@updateURL`, or `@downloadURL`

Tampermonkey identifies an installed script by `@name` + `@namespace`. Change
either and Tampermonkey treats the edited script as a brand-new install — the
operator ends up with two versions running simultaneously.

`@updateURL` and `@downloadURL` were set up to match the stable filename.
Editing them breaks update delivery.

These four headers are locked. If you believe one needs to change, STOP and
ask the human.

### 3. ALWAYS bump `@version` when changing a script's code

Tampermonkey polls `@updateURL` and compares remote `@version` to installed
`@version`. If remote is not higher, it does not update. If you push a fix
without bumping `@version`, operators never receive it — and nobody will
notice until a bug report comes in for the "fixed" issue.

Acceptable version bumps:
- `1.7` → `1.7.1` (patch)
- `1.7` → `1.8` (minor)
- `1.7` → `2.0` (major)

Semver-ish comparison; any monotonic increase works. Patch-level is fine for
almost all fixes.

### 4. Version numbers belong ONLY in `@version`

Do not embed version numbers in:
- Filenames (`foo-v1.8.user.js` ❌ → `foo.user.js` ✅)
- `@name` (`"Home Bot: Foo V1.8"` ❌ → `"Home Bot: Foo"` ✅)
- `@namespace` (`homebot.foo.v1_8` ❌ → `homebot.foo` ✅)
- Inline `const SCRIPT_NAME = 'Foo V1.8'` ❌ → `const SCRIPT_NAME = 'Foo'` ✅
- Log prefixes / panel titles that concatenate a hard-coded version

Tampermonkey's dashboard already displays `@version` next to `@name` in the
UI. Embedding it anywhere else creates drift.

### 5. Don't commit PII

`*.storage.json` and `*.options.json` are gitignored (see `.gitignore`).
These are Tampermonkey export files that contain real customer data — names,
addresses, DOBs, emails, DLs, VINs. Never add a `.gitignore` exception or
commit them any other way. If you find one in a working tree, delete it
immediately and don't stage it.

## Standard change workflow

A typical edit to a userscript looks like:

```
1. Locate the file: files/<stable-id>.user.js
2. Make your code change
3. Bump @version in the file's header (only that header — NOT @name, NOT
   @namespace, NOT @updateURL, NOT @downloadURL, NOT the filename)
4. git add files/<stable-id>.user.js
5. git commit -m "..."
6. git push origin main
```

That's it. Operators receive the update on their next Tampermonkey poll
(default ~7 days, configurable per-operator).

## Allowed vs not-allowed edits inside a userscript

**Allowed:**
- Any code change (logic, selectors, CFG constants, storage key values)
- `@version` bump
- `@description` rewrite
- `@match`, `@grant`, `@connect`, `@run-at`, `@noframes` header changes
- Internal comments

**Not allowed without explicit human approval:**
- `@name` edit
- `@namespace` edit
- `@updateURL` edit
- `@downloadURL` edit
- Filename change (this is a `git mv`, obvious in the diff)

## Where to find the rules for operators

`UPDATE.md` — install links and operator-facing documentation. If you update
the set of scripts (new file, removed file), you must also update `UPDATE.md`'s
group list. Do not manually edit the install URLs in `UPDATE.md` — they are
derived from filenames and must match.

## What to do when you're unsure

Stop and ask the human. These rules exist because a prior violation caused
production breakage (a script was renamed, which silently orphaned every
install). Treat the hard rules as invariants.
