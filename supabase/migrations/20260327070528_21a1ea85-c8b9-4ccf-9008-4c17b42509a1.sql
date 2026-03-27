ALTER TABLE public.push_subscriptions
ADD COLUMN notify_flash boolean NOT NULL DEFAULT true,
ADD COLUMN notify_theater boolean NOT NULL DEFAULT true;