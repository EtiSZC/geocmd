
CREATE TABLE public.npc_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL,
  npc_id uuid NOT NULL,
  npc_name text NOT NULL,
  npc_faction text,
  trust_level text NOT NULL,
  message text NOT NULL,
  portrait_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.npc_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to npc_messages"
ON public.npc_messages
FOR ALL
TO public
USING (true)
WITH CHECK (true);

ALTER TABLE public.npc_relationships ADD COLUMN portrait_base64 text;
