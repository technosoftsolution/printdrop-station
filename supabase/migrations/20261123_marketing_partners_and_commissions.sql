-- PrintDrop: Marketing Partners, Commission Ledger & Payouts Migration (Phase 1 & Phase 2 Foundation)
-- Dynamic commission rates (never hardcoded), immutable ledger, and partner attribution on licenses.

-- 1. Marketing Partners Directory & Credentials
CREATE TABLE IF NOT EXISTS public.marketing_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT NULL,
  email TEXT NULL,
  city TEXT NULL,
  territory TEXT NULL,
  username TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  use_global_rates BOOLEAN NOT NULL DEFAULT true,
  first_sale_rate NUMERIC(5,2) NULL,
  renewal_rate NUMERIC(5,2) NULL,
  upi_id TEXT NULL,
  bank_details TEXT NULL,
  pan_number TEXT NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_partners_code ON public.marketing_partners (partner_code);
CREATE INDEX IF NOT EXISTS idx_marketing_partners_status ON public.marketing_partners (status);

-- 2. Partner Auth Sessions (for Phase 2 Partner Sales Portal & Instant Force-Logout)
CREATE TABLE IF NOT EXISTS public.partner_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES public.marketing_partners(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_partner_sessions_partner ON public.partner_sessions (partner_id);

-- 3. Partner Payout Settlements
CREATE TABLE IF NOT EXISTS public.partner_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES public.marketing_partners(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  payment_mode TEXT NOT NULL DEFAULT 'UPI',
  utr_reference TEXT NULL,
  period_label TEXT NULL,
  notes TEXT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_payouts_partner ON public.partner_payouts (partner_id, paid_at DESC);

-- 4. Immutable Commission Ledger (one snapshot row per payment/adjustment)
CREATE TABLE IF NOT EXISTS public.commission_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES public.marketing_partners(id) ON DELETE CASCADE,
  license_hwid TEXT NOT NULL,
  shop_name TEXT NOT NULL,
  plan_code TEXT NULL,
  plan_name TEXT NULL,
  payment_type TEXT NOT NULL DEFAULT 'FIRST_SALE' CHECK (payment_type IN ('FIRST_SALE', 'RENEWAL', 'ADJUSTMENT')),
  payment_ref TEXT NULL,
  invoice_number TEXT NULL,
  gross_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  deduction_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  rate_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'PAID', 'CANCELLED')),
  payout_id UUID NULL REFERENCES public.partner_payouts(id) ON DELETE SET NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_ledger_partner ON public.commission_ledger (partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commission_ledger_hwid ON public.commission_ledger (license_hwid);
CREATE INDEX IF NOT EXISTS idx_commission_ledger_status ON public.commission_ledger (status);

-- 5. Attribute Shopkeeper Licenses to a Marketing Partner
ALTER TABLE public.licenses
  ADD COLUMN IF NOT EXISTS partner_id UUID NULL REFERENCES public.marketing_partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partner_attributed_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_licenses_partner_id ON public.licenses (partner_id);

-- 6. Seed Dynamic Global Commission Defaults (editable anytime from Admin Portal)
INSERT INTO public.system_config (key, value, updated_at)
VALUES (
  'partner_commission_defaults',
  '{"first_sale_rate": 0, "renewal_rate": 0, "deduction_percent": 0, "min_payout_threshold": 500, "payout_cycle_note": "Monthly on 5th"}'::jsonb,
  NOW()
)
ON CONFLICT (key) DO NOTHING;

-- 7. Grants for PostgREST (matching existing Admin Portal access model)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_partners TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_sessions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_payouts TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commission_ledger TO anon, authenticated;
