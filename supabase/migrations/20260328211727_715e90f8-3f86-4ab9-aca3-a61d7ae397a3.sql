
ALTER TABLE public.flash_event_responses 
  ADD COLUMN IF NOT EXISTS risk_outcome text,
  ADD COLUMN IF NOT EXISTS actual_deltas jsonb;

ALTER TABLE public.flash_events
  ADD COLUMN IF NOT EXISTS parent_event_id uuid REFERENCES public.flash_events(id),
  ADD COLUMN IF NOT EXISTS parent_option_id text,
  ADD COLUMN IF NOT EXISTS target_player_id uuid REFERENCES public.players(id);
