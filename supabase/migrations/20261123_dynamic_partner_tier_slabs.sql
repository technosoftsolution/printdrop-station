-- PrintDrop: Dynamic 3-Tier Plan-Aware Partnership Share Slabs (Bronze / Silver / Gold)
-- All thresholds and percentages live in system_config (never hardcoded).

-- 1. Optional custom wallet_rate override on marketing_partners
ALTER TABLE public.marketing_partners
  ADD COLUMN IF NOT EXISTS wallet_rate NUMERIC(5,2) NULL;

-- 2. Allow 'WALLET_TOPUP' in commission_ledger.payment_type
ALTER TABLE public.commission_ledger
  DROP CONSTRAINT IF EXISTS commission_ledger_payment_type_check;
ALTER TABLE public.commission_ledger
  ADD CONSTRAINT commission_ledger_payment_type_check
  CHECK (payment_type IN ('FIRST_SALE', 'RENEWAL', 'WALLET_TOPUP', 'ADJUSTMENT'));

-- 3. Upgrade global partner_commission_defaults with dynamic 3-tier plan-aware slabs
INSERT INTO public.system_config (key, value, updated_at)
VALUES (
  'partner_commission_defaults',
  '{
    "first_sale_rate": 40,
    "renewal_rate": 20,
    "wallet_rate": 20,
    "deduction_percent": 2.5,
    "min_payout_threshold": 500,
    "payout_cycle_note": "Monthly on 5th",
    "tiers": [
      { "id": "BRONZE", "name": "Bronze", "min_shops": 0,  "first_sale_rate": 40, "renewal_rate": 20, "wallet_rate": 20 },
      { "id": "SILVER", "name": "Silver", "min_shops": 11, "first_sale_rate": 45, "renewal_rate": 25, "wallet_rate": 25 },
      { "id": "GOLD",   "name": "Gold",   "min_shops": 31, "first_sale_rate": 50, "renewal_rate": 30, "wallet_rate": 30 }
    ]
  }'::jsonb,
  NOW()
)
ON CONFLICT (key) DO UPDATE
SET value = CASE
  WHEN (public.system_config.value->'tiers') IS NULL THEN EXCLUDED.value
  ELSE public.system_config.value
END,
updated_at = NOW();
