

# Améliorer la visibilité du bouton d'installation PWA

## Constat actuel
- Le bouton `InstallPWAButton` existe déjà mais est enfoui dans les **Paramètres**
- Il ne gère pas la détection du mode standalone (app déjà installée et ouverte)
- Pas de message spécifique pour iOS (installation manuelle requise)

## Plan

### 1. Détecter le mode standalone
Ajouter une vérification `window.matchMedia('(display-mode: standalone)').matches` dans `InstallPWAButton` pour afficher "✓ APPLICATION INSTALLÉE" quand l'app tourne déjà en mode installé.

### 2. Ajouter le bouton d'installation sur le Hub (écran principal)
Afficher une bannière d'installation discrète en bas du `HubScreen` quand :
- L'app n'est pas en mode standalone
- Le prompt d'installation est disponible (Android) **OU** on est sur iOS Safari (avec instructions manuelles)

### 3. Instructions spécifiques iOS
Quand on détecte iOS Safari (pas de `beforeinstallprompt`), afficher un message :
> "Appuyez sur Partager puis 'Sur l'écran d'accueil' pour installer GeoCommand"

### 4. Masquer automatiquement
- En mode standalone → afficher "✓ INSTALLÉE" dans les paramètres uniquement
- Sur le Hub → ne plus afficher la bannière une fois installée ou si l'utilisateur la ferme (localStorage)

### Fichiers modifiés
- `src/components/GeoCommand.tsx` : modifier `InstallPWAButton`, ajouter bannière dans `HubScreen`

