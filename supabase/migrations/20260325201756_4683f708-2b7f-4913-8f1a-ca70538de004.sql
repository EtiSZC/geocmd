
-- Flash events table
CREATE TABLE public.flash_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  region text NOT NULL,
  event_type text NOT NULL,
  urgency integer NOT NULL DEFAULT 4,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.flash_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all read flash_events" ON public.flash_events FOR SELECT TO public USING (true);

-- Flash event responses
CREATE TABLE public.flash_event_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.flash_events(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  chosen_option jsonb NOT NULL,
  score_deltas jsonb,
  responded_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(event_id, player_id)
);

ALTER TABLE public.flash_event_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all flash_event_responses" ON public.flash_event_responses FOR ALL TO public USING (true) WITH CHECK (true);

-- Push subscriptions
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  subscription jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(player_id)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all push_subscriptions" ON public.push_subscriptions FOR ALL TO public USING (true) WITH CHECK (true);
