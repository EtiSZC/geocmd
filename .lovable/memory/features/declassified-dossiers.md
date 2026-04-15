---
name: Declassified Dossiers
description: Educational dossiers generated after each theater consequence cycle, stored in theaters.dossier JSONB column
type: feature
---
After each theater consequence, the AI generates a "dossier déclassifié" with real geopolitical context:
- realContext: factual background behind the scenario
- keyFigures: real people with roles and significance
- hiddenStakes: lesser-known aspects of the situation
- historicalParallel: historical comparison
- sources: factual references

Stored in `theaters.dossier` JSONB column. Displayed via collapsible `DossierPanel` component in:
1. Theater idle view (after consequence)
2. Profile "📂 SECRETS" tab (collection of all unlocked dossiers)
