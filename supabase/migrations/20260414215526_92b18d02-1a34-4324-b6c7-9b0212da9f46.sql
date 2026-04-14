
CREATE TABLE public.npc_relationships (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  faction TEXT NOT NULL,
  trust_score INTEGER NOT NULL DEFAULT 0,
  origin_theater_id UUID REFERENCES public.theaters(id) ON DELETE SET NULL,
  origin_region TEXT NOT NULL,
  interactions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.npc_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to npc_relationships"
ON public.npc_relationships
FOR ALL
TO public
USING (true)
WITH CHECK (true);

CREATE INDEX idx_npc_player ON public.npc_relationships(player_id);
CREATE INDEX idx_npc_status ON public.npc_relationships(player_id, status);
