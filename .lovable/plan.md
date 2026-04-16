
Question de recherche, pas d'implémentation demandée. Je vérifie le code.

D'après ma connaissance du code (npc-message edge function et GeoCommand.tsx polling) : la fonction `npc-message` insère uniquement dans la table `npc_messages` et ne déclenche aucune notification push. Le polling client joue un son (`npc_message` SFX) uniquement si l'app est ouverte. Aucune souscription push, aucun appel à un envoi VAPID, aucun champ `notify_npc` dans `push_subscriptions`.

**Réponse : Non.**

Actuellement :
- Quand un PNJ envoie un message, il est inséré dans `npc_messages`.
- Le client le découvre uniquement via polling (au chargement + toutes les 30 min).
- Si l'app est ouverte, un son radio subtil + l'overlay s'affichent.
- Si l'app est fermée → aucune alerte système. Le joueur ne saura qu'il a un message qu'à sa prochaine ouverture.

**Ce qu'il faudrait ajouter pour avoir une notif push :**
1. Dans `supabase/functions/npc-message/index.ts` : après l'insert réussi, envoyer un push VAPID à toutes les `push_subscriptions` du joueur (même logique que `flash-events` / `theater-notify`), avec un `tag: "npc-${message.id}"` et `url: "/"`.
2. Dans `src/sw.ts` : le handler push existant gère déjà n'importe quel payload, rien à changer.
3. Dans `GeoCommand.tsx` : ajouter dans le listener `NOTIFICATION_CLICK` une branche pour `tag.startsWith("npc-")` qui recharge les messages NPC et ouvre le hub.
4. Optionnel : ajouter une colonne `notify_npc boolean default true` à `push_subscriptions` + un toggle dans les préférences de notification (pattern identique à `notify_flash`, `notify_theater`, `notify_community`).
5. Déclencheur côté serveur : actuellement `npc-message` n'est appelé que par le client en polling (donc app ouverte). Pour vraiment notifier hors-app, il faudrait un cron Supabase qui appelle `npc-message` pour chaque joueur ayant une subscription active, 1-2 fois par jour.

Veux-tu que j'implémente cette mécanique de notification push pour les messages PNJ (avec ou sans le toggle de préférence et/ou le cron) ?
