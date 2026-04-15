# Project Memory

## Core
GeoCommand: Real-time geopolitical simulation game. Present time strictly fixed to April 2026.
Theme: Dark with gold accents. External logo (neon green wireframe globe) NEVER used on internal screens.
Tech: Supabase (players, theaters, events) + Edge Functions (Gemini AI, 45s timeout, graceful fallback).
PWA: Vite (`injectManifest`), manual install prompt. Android notification icons must be transparent monochrome.
Game loop: 5h delay for theater actions (EN COURS -> PRÊT -> EN ATTENTE). 
Identity: Public callsign, private email. 4 roles (Diplomat, Military, Humanitarian, Analyst).
UX: Always reset scroll to top on navigation.

## Memories
- [Visual Identity](mem://style/visual-identity) — Dark/gold theme, specific rules for the neon green wireframe logo
- [Database Schema](mem://tech/database) — Supabase tables and JSONB usage for game data
- [AI Logic](mem://features/ai-logic) — Gemini Edge Functions for dynamic scenarios and flash events
- [Session Flow](mem://auth/session-flow) — Email-based access syncing game data via Supabase
- [Navigation UX](mem://ux/navigation-behavior) — Scroll-to-top reset behavior on phase transitions
- [Delayed Consequences](mem://features/delayed-consequences) — 5-hour theater cycle (EN COURS, PRÊT, EN ATTENTE)
- [Identity & Privacy](mem://auth/identity-privacy) — Callsign as public ID, email strictly private
- [Online Operators](mem://features/online-operators) — Community stats and influence scores view
- [PWA Support](mem://tech/pwa-support) — vite-plugin-pwa configuration and iOS optimizations
- [Influence Score](mem://features/influence-score) — 4-indicator scoring system (0-100) updated via AI
- [Flash Events](mem://features/flash-events) — 3h frequency crises, 2h lifespan, shockwaves mechanics
- [Web Push](mem://tech/web-push) — Native VAPID web push notifications via Service Worker
- [Theater Notifications](mem://features/theater-notifications) — Push alerts sent 5h after a decision (PRÊT status)
- [Notification Preferences](mem://features/notification-preferences) — User settings for PWA push alerts
- [Community Notifications](mem://features/community-notifications) — Alerts for theaters created in the same region
- [Theater Withdrawal](mem://features/theater-withdrawal) — Rules and animations for withdrawing from a theater
- [Player Roles](mem://features/player-roles) — 4 strategic roles influencing AI generation and options
- [PWA Service Worker](mem://tech/pwa-service-worker) — injectManifest config and background push handling
- [Test Notifications](mem://features/test-notifications) — Manual test push button in settings
- [Environment Constraints](mem://constraints/environment) — PWA and Service Workers restricted to production domain
- [PWA Install Behavior](mem://ux/pwa-install-behavior) — Manual install button intercepting native prompt
- [Notification Icons](mem://style/notification-icons) — Transparent monochrome requirement for Android badges
- [Chrome PWA Constraints](mem://constraints/chrome-pwa-notifications) — Native "Tap to copy URL" behavior on Android
- [Narrative Reactions](mem://features/narrative-reactions) — Post-flash event flavor text based on role and success
- [Seasonal Events](mem://features/seasonal-events) — Real-world summits injecting specific context into AI prompts
- [AI Timeout Constraints](mem://constraints/ai-timeout) — 45s Promise.race timeout for Gemini Edge Functions
- [Temporal Context](mem://constraints/contexte-temporel) — Strict AI prompt rule: present time is April 2026
- [Audio Engine](mem://tech/audio-engine) — Web Audio API procedural sound system with user preferences
- [AI Fallback](mem://tech/ai-fallback-safety) — Graceful degradation with static narratives on AI failure
- [Recurring NPCs](mem://features/recurring-npcs) — Persistent characters with trust scores across theaters
- [Declassified Dossiers](mem://features/declassified-dossiers) — Educational dossiers with real geopolitical context after each theater cycle
