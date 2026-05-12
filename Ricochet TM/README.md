# Ricochet Tampermonkey Counter

Install/update link:

```text
https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/Ricochet%20TM/ricochet-counters.user.js
```

Tampermonkey uses the same raw GitHub URL in `@updateURL` and `@downloadURL`.

Counters roll over at 3:20 PM California time so each counter day starts from zero.

Counts are stored in Tampermonkey storage, not Ricochet page storage, so clearing Ricochet cache/cookies should not reset them.

Report payloads include `submittedBy`, `reportSentBy`, `sentBy`, and `whoSentIt` for webhook table mapping.
