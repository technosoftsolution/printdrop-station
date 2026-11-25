-- Allow Supabase Edge Functions (service_role) to verify registered station HWIDs
-- and active partner sessions for authenticated OTA updates and time-limited downloads.
GRANT SELECT ON TABLE public.licenses TO service_role;
GRANT SELECT ON TABLE public.partner_sessions TO service_role;
GRANT SELECT ON TABLE public.marketing_partners TO service_role;
