SELECT cron.schedule(
  'theater-ready-notify',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ihzlmtlmxqucuwwrzuup.supabase.co/functions/v1/theater-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);