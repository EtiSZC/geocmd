
-- Enable pg_net for HTTP requests from within the database
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- Enable pg_cron for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron SCHEMA pg_catalog;

-- Create a cron job that calls the flash-events edge function every 30 minutes
-- With 25% chance per call, this averages ~1 event every 2 hours
SELECT cron.schedule(
  'generate-flash-events',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ihzlmtlmxqucuwwrzuup.supabase.co/functions/v1/flash-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloemxtdGxteHF1Y3V3d3J6dXVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMTU5ODksImV4cCI6MjA4OTc5MTk4OX0.-Mfxg07v5pAOAL94YMBzR6uUvNcEqw6Sg19JfeDxNb8'
    ),
    body := '{"action":"generate"}'::jsonb
  );
  $$
);
