# NewAutomaticQuoteSystem

Organized Tampermonkey workspace for the next quote system migration.

This folder is a clean duplicate of the current Info Gather / quote automation
project, reorganized by the site where each script starts running:

- `AgencyZoom/` - AgencyZoom scripts and shared controls that start from AZ.
- `Apex-LEX/` - Salesforce Lightning / APEX / LEX scripts.
- `Alta/` - current GWPC-side scripts kept as the migration surface for Alta.

Each userscript has its own folder. The copied script behavior, `@name`, and
`@namespace` values were left alone so existing script identities stay stable.
Only `@updateURL` and `@downloadURL` were repointed to the new online
`NewAutomaticQuoteSystem/` paths.

## Script Layout

### AgencyZoom

| Folder | Script |
|---|---|
| `az-pipeline-keeper/` | `az-pipeline-keeper.user.js` |
| `az-stage-runner/` | `az-stage-runner.user.js` |
| `az-ticket-finisher-tagger/` | `az-ticket-finisher-tagger.user.js` |
| `az-zillow-ticket-enricher/` | `az-zillow-ticket-enricher.user.js` |
| `global-clear-launcher/` | `global-clear-launcher.user.js` |
| `shared-ticket-handoff/` | `shared-ticket-handoff.user.js` |
| `storage-tools/` | `storage-tools.user.js` |

### Apex-LEX

| Folder | Script |
|---|---|
| `apex-continue-new-quote/` | `apex-continue-new-quote.user.js` |
| `apex-duplicates-continue/` | `apex-duplicates-continue.user.js` |
| `apex-multi-agency-continue/` | `apex-multi-agency-continue.user.js` |
| `shared-failure-selector/` | `shared-failure-selector.user.js` |

### Alta

| Folder | Script |
|---|---|
| `aqb-drivers/` | `aqb-drivers.user.js` |
| `aqb-specialty-product/` | `aqb-specialty-product.user.js` |
| `aqb-vehicles/` | `aqb-vehicles.user.js` |
| `auto-quote-grabber/` | `auto-quote-grabber.user.js` |
| `dwelling-water-rule/` | `dwelling-water-rule.user.js` |
| `gwpc-discard-unsaved-change/` | `gwpc-discard-unsaved-change.user.js` |
| `gwpc-disclosure-qualification/` | `gwpc-disclosure-qualification.user.js` |
| `gwpc-header-timeout/` | `gwpc-header-timeout.user.js` |
| `gwpc-home-coverages-risk-analysis/` | `gwpc-home-coverages-risk-analysis.user.js` |
| `gwpc-policy-info/` | `gwpc-policy-info.user.js` |
| `gwpc-popup-blocker/` | `gwpc-popup-blocker.user.js` |
| `gwpc-start-auto-quote/` | `gwpc-start-auto-quote.user.js` |
| `home-quote-grabber/` | `home-quote-grabber.user.js` |
| `payload-mirror-non-az-tab-closer/` | `payload-mirror-non-az-tab-closer.user.js` |
| `ui-dock-organizer/` | `ui-dock-organizer.user.js` |
| `webhook-submission/` | `webhook-submission.user.js` |

## Migration Note

AgencyZoom and Apex-LEX scripts should keep their page behavior. The scripts in
`Alta/` are the former GWPC-side automation pieces and are the ones expected to
change as the quote flow moves to Alta.
