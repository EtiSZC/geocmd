

# Messages du Réseau — Plan d'implémentation

## Concept

Ajouter une mécanique de "messages entrants" provenant des PNJ (contacts réseau) du joueur. Ces messages sont purement narratifs (aucun impact sur les scores), générés par IA en tenant compte de la relation (allié/neutre/hostile) et des actions récentes. Fréquence : 1-2 par jour max. Chaque contact a un portrait en pixel art généré par IA et persisté.

## Design visuel

Overlay flottant par-dessus la UI principale, style "terminal message" avec coin biseauté (clip-path), fond sombre semi-transparent. Contient :
- Portrait pixel art du PNJ (32x32 ou 48x48, généré une fois puis stocké)
- Nom + faction + indicateur de relation (allié vert, neutre gris, hostile rouge)
- Corps du message (2-4 phrases)
- Bouton "FERMER" discret

L'overlay persiste jusqu'à fermeture explicite (pas de timeout). Les messages fermés sont trackés dans localStorage pour ne pas réapparaître.

## Architecture technique

### 1. Table `npc_messages`

```sql
CREATE TABLE public.npc_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL,
  npc_id uuid NOT NULL,
  npc_name text NOT NULL,
  npc_faction text,
  trust_level text NOT NULL, -- 'allié', 'neutre', 'hostile'
  message text NOT NULL,
  portrait_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.npc_messages ENABLE ROW LEVEL SECURITY;
-- RLS: public read/write (same pattern as other tables)
```

### 2. Edge Function `npc-message` 

Nouvelle Edge Function qui :
1. Reçoit `{ player_id }`
2. Vérifie le cooldown : pas de message créé dans les 12 dernières heures pour ce joueur
3. Charge les NPCs actifs du joueur (`npc_relationships`)
4. Sélectionne un NPC au hasard
5. Charge les 3 dernières actions du joueur (depuis `theaters.history` + `flash_event_responses`)
6. Appelle l'IA (Gemini Flash) avec un prompt qui inclut le trust_score, la faction, et les actions récentes → génère un message court en français
7. Appelle l'IA image (Gemini Flash Image) pour générer un portrait pixel art 48x48 si le NPC n'en a pas déjà un (stocké dans un champ `portrait_base64` sur `npc_relationships`)
8. Insère le message dans `npc_messages`
9. Retourne le message

### 3. Polling client (GeoCommand.tsx)

- Au chargement + toutes les 30 minutes, appeler `npc-message` 
- Probabilité de déclenchement côté serveur (~50%) pour garder l'aspect aléatoire
- Charger les messages non-lus depuis `npc_messages` (pas dans localStorage dismissed list)
- Afficher l'overlay si un message est disponible

### 4. Composant `NpcMessageOverlay`

Nouveau composant inline dans GeoCommand.tsx :
- Fenêtre avec clip-path biseauté (style gc-panel existant mais avec un coin coupé)
- Position : fixed bottom-right, z-index élevé
- Animation d'entrée slide-up
- Portrait pixel art à gauche, texte à droite
- Bouton fermer → ajoute l'id à localStorage `gc_dismissed_npc_messages`

### 5. Migration `npc_relationships`

Ajouter une colonne `portrait_base64 text` à `npc_relationships` pour persister le portrait pixel art de chaque NPC.

## Fichiers modifiés/créés

1. **Migration SQL** — table `npc_messages` + colonne `portrait_base64` sur `npc_relationships`
2. **`supabase/functions/npc-message/index.ts`** — nouvelle Edge Function
3. **`src/components/GeoCommand.tsx`** — polling + composant overlay + styles CSS

## Détails du prompt IA

Le message sera contextualisé :
- **Allié (trust > 30)** : ton chaleureux, partage d'info, encouragements
- **Neutre (-30 < trust < 30)** : ton professionnel, observations détachées
- **Hostile (trust < -30)** : ton menaçant, avertissements, provocations

Le portrait pixel art : prompt type "pixel art portrait, 48x48, [faction] [role], dark background, retro game style"

