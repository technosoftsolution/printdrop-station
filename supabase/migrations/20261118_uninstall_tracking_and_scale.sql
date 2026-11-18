-- PrintDrop: Uninstall/Reinstall Tracking & 50k+ Station Scaling Migration
-- Run this in Supabase Dashboard -> SQL Editor

-- 1. Soft-uninstall tracking columns (preserves orphan/audit/payment history)
ALTER TABLE public.licenses
  ADD COLUMN IF NOT EXISTS is_installed BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS uninstalled_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS removal_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS reinstalled_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS uninstall_count INTEGER NOT NULL DEFAULT 0;

-- 2. Performance indexes for 25,000 - 50,000+ stations
CREATE INDEX IF NOT EXISTS idx_licenses_hwid ON public.licenses (hwid);
CREATE INDEX IF NOT EXISTS idx_licenses_installed_created ON public.licenses (is_installed, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_licenses_payment_status ON public.licenses (payment_status);

-- 3. Fast server-side KPI aggregation RPC (avoids downloading 50,000 rows to the browser)
CREATE OR REPLACE FUNCTION public.get_admin_kpis()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'total_records', COUNT(*),
    'installed_count', COUNT(*) FILTER (WHERE is_installed IS DISTINCT FROM false),
    'uninstalled_count', COUNT(*) FILTER (WHERE is_installed = false),
    'pending_upgrades', COUNT(*) FILTER (WHERE payment_status = 'PAYMENT_SUBMITTED'),
    'active_commercial', COUNT(*) FILTER (
      WHERE is_installed IS DISTINCT FROM false
        AND is_active IS DISTINCT FROM false
        AND plan_type IS DISTINCT FROM 'TRIAL'
        AND (
          expires_at IS NULL
          OR expires_at > NOW()
          OR COALESCE(pages_granted, 0) > 0
        )
    ),
    'active_trials', COUNT(*) FILTER (
      WHERE is_installed IS DISTINCT FROM false
        AND is_active IS DISTINCT FROM false
        AND plan_type = 'TRIAL'
        AND (expires_at IS NULL OR expires_at > NOW())
    ),
    'total_revenue', COALESCE(SUM(COALESCE(amount_paid, 0)), 0),
    'lifetime_prints', COALESCE(SUM(COALESCE(pages_printed_lifetime, 0)), 0),
    'est_mrr', COALESCE(SUM(
      CASE
        WHEN is_installed IS DISTINCT FROM false AND is_active IS DISTINCT FROM false AND plan_type IS DISTINCT FROM 'TRIAL' THEN
          CASE plan_type
            WHEN 'SUB_MONTHLY' THEN 299
            WHEN 'SUB_QUARTERLY' THEN 250
            WHEN 'SUB_HALF_YEARLY' THEN 216
            WHEN 'SUB_ANNUAL' THEN 191
            WHEN 'WALLET_PAGES' THEN 149
            ELSE 0
          END
        ELSE 0
      END
    ), 0)
  )
  FROM public.licenses;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_kpis() TO anon, authenticated;
