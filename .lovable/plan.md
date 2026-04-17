
Implémenter les deux améliorations pour les conséquences en mode dégradé (fallback IA).

## 1. Metrics dérivées dans le fallback

Dans `src/components/GeoCommand.tsx`, modifier `FALLBACK_CONSEQUENCE` (lignes ~494-499) : transformer `metrics: []` en metrics dérivées des `scoreDeltas`, exprimées en pourcentages cohérents avec le reste de l'UI.

Comme `FALLBACK_CONSEQUENCE` est un objet statique mais que les deltas sont fixes (`stability:2, diplomacy:-1, military:3, intelligence:1`), on peut :
- Soit garder un objet statique avec metrics pré-calculées (ex. `Stabilité régionale +2%`, `Activité diplomatique −1%`, `Posture militaire +3%`, `Renseignement +1%`).
- Soit en faire une **fonction** `buildFallbackConsequence(action, theater)` qui dérive les metrics et personnalise légèrement le headline avec le nom du théâtre.

Choix : **fonction**, pour rendre le fallback un peu moins générique (headline = `Effets observés sur ${theater.scenarioTitle}`) tout en restant safe.

Format des metrics aligné sur le rendu existant (ligne ~1109) : `{ label: string, value: string, trend: "up"|"down"|"neutral" }` (à confirmer en lisant le bloc de rendu réel).

## 2. Marqueur visuel "Rapport préliminaire"

Ajouter un flag `degraded: true` dans l'objet retourné par `buildFallbackConsequence`. Dans le rendu de la conséquence (HubScreen / TheaterView, autour de la ligne 1109), si `theater.consequence.degraded === true`, afficher un petit badge discret au-dessus du headline :

```
[ ⚠ RAPPORT PRÉLIMINAIRE ]
```

Style : bordure 1px ambre/orange (`#c8a84b` atténué ou `#b8862a`), fond transparent, font monospace, taille 9-10px, uppercase, letter-spacing — cohérent avec le reste de l'UI dorée. Tooltip/hint en dessous : `Synthèse automatique — données IA indisponibles au moment de la décision.`

## Étapes d'implémentation

1. **Lire** le bloc de rendu metrics dans `GeoCommand.tsx` (autour ligne 1100-1130) pour confirmer la forme exacte attendue (`label/value/trend` ou autre).
2. **Remplacer** `FALLBACK_CONSEQUENCE` constante par `buildFallbackConsequence(theater)` qui retourne :
   - `headline: "Effets observés sur " + (theater?.scenarioTitle || "le théâtre")`
   - `narrative` inchangé
   - `metrics`: 4 entrées dérivées de scoreDeltas (Stabilité/Diplomatie/Militaire/Renseignement, valeurs `+2%`/`−1%`/`+3%`/`+1%`, trend up/down/neutral selon signe)
   - `scoreDeltas` inchangé
   - `degraded: true`
3. **Mettre à jour** le(s) appelant(s) du fallback (catch du `callAI` type consequence) pour passer le `theater` courant.
4. **Ajouter** dans le rendu de `theater.consequence` (HubScreen, là où headline + metrics sont affichés) un badge conditionnel `theater.consequence.degraded && <BadgeRapportPreliminaire />`.
5. **Migration de données** : optionnel, on ne touche pas aux conséquences déjà sauvegardées (elles n'ont pas `degraded:true`). Donc les anciens fallbacks (comme celui d'etis12) resteront sans badge mais auront toujours metrics vides. Si tu veux qu'on backfille rétroactivement les conséquences détectées comme fallback (matching sur `headline === "Effets observés sur..."` ou `narrative` exact), je peux ajouter une migration SQL qui :
   - détecte les `theaters.consequence` matchant le fallback historique,
   - injecte les metrics dérivées + `degraded: true`.

À confirmer si tu veux ce backfill ou seulement la correction pour les futures actions.

## Ce qui ne change pas

- Le délai 5h, le flow briefing → action → conséquence.
- Les conséquences IA réussies (rendu identique).
- Aucun retry automatique (point 3 de la reco initiale écarté).

## Questions implicites
Je pars sur :
- Pas de backfill SQL des anciens théâtres (laisser etis12 tel quel).
- Badge texte simple, pas d'icône SVG nouvelle.
- Pas de toggle de préférence : le badge s'affiche pour tout le monde.

Si tu veux le backfill ou un autre style de badge, dis-le après approbation.
