-- Synchronise tous les portraits npc_messages avec le portrait actuel du PNJ
-- Garantit qu'un PNJ a toujours le même visuel (le dernier généré)
UPDATE public.npc_messages m
SET portrait_url = r.portrait_base64
FROM public.npc_relationships r
WHERE m.npc_id = r.id
  AND r.portrait_base64 IS NOT NULL
  AND m.portrait_url IS DISTINCT FROM r.portrait_base64;