-- PrintDrop Phase 2: Isolated Partner Sales Portal RPCs (SECURITY DEFINER)
-- Ensures each marketing partner can ONLY authenticate and read their own sanitized business data.
-- Zero access to other partners, zero access to HWIDs/OTA/Settings/Admin credentials.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Partner Portal Login RPC (verifies salted SHA-256 password & ACTIVE status, issues session token)
CREATE OR REPLACE FUNCTION public.partner_portal_login(
  p_username TEXT,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_partner public.marketing_partners%ROWTYPE;
  v_computed TEXT;
  v_raw_token TEXT;
  v_token_hash TEXT;
BEGIN
  IF COALESCE(TRIM(p_username), '') = '' OR COALESCE(p_password, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Username and password are required.');
  END IF;

  SELECT * INTO v_partner
  FROM public.marketing_partners
  WHERE LOWER(username) = LOWER(TRIM(p_username))
     OR LOWER(partner_code) = LOWER(TRIM(p_username))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid username or password.');
  END IF;

  IF v_partner.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Your partner account is suspended. Please contact the Software Provider.');
  END IF;

  v_computed := encode(
    extensions.digest(convert_to(v_partner.password_salt || ':' || p_password, 'UTF8'), 'sha256'),
    'hex'
  );

  IF v_computed <> v_partner.password_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid username or password.');
  END IF;

  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(convert_to(v_raw_token, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.partner_sessions (partner_id, token_hash, expires_at)
  VALUES (v_partner.id, v_token_hash, NOW() + INTERVAL '7 days');

  RETURN jsonb_build_object(
    'ok', true,
    'token', v_raw_token,
    'partner', jsonb_build_object(
      'id', v_partner.id,
      'partner_code', v_partner.partner_code,
      'full_name', v_partner.full_name,
      'username', v_partner.username,
      'city', v_partner.city,
      'territory', v_partner.territory
    )
  );
END;
$$;

-- 2. Partner Portal Dashboard RPC (returns ONLY the authenticated partner's own shops, commissions & payouts)
CREATE OR REPLACE FUNCTION public.partner_portal_dashboard(
  p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token_hash TEXT;
  v_session public.partner_sessions%ROWTYPE;
  v_partner public.marketing_partners%ROWTYPE;
  v_rules JSONB;
  v_provider JSONB;
  v_plans_cfg JSONB;
  v_trial_days INTEGER := 30;
  v_eff_first NUMERIC(5,2);
  v_eff_renew NUMERIC(5,2);
  v_eff_wallet NUMERIC(5,2);
  v_active_paid_shops INTEGER := 0;
  v_tier_name TEXT := 'Bronze';
  v_tier_id TEXT := 'BRONZE';
  v_next_tier JSONB := NULL;
  v_tier_elem JSONB;
  v_shops JSONB;
  v_comms JSONB;
  v_payouts JSONB;
BEGIN
  IF COALESCE(TRIM(p_token), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'unauthorized', true, 'error', 'Missing session token.');
  END IF;

  v_token_hash := encode(extensions.digest(convert_to(TRIM(p_token), 'UTF8'), 'sha256'), 'hex');

  SELECT * INTO v_session
  FROM public.partner_sessions
  WHERE token_hash = v_token_hash
    AND revoked_at IS NULL
    AND expires_at > NOW()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'unauthorized', true, 'error', 'Session expired or logged out by Software Provider. Please sign in again.');
  END IF;

  SELECT * INTO v_partner
  FROM public.marketing_partners
  WHERE id = v_session.partner_id
  LIMIT 1;

  IF NOT FOUND OR v_partner.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'unauthorized', true, 'error', 'Account is suspended. Please contact the Software Provider.');
  END IF;

  -- Load dynamic global rules (never hardcoded)
  SELECT value INTO v_rules
  FROM public.system_config
  WHERE key = 'partner_commission_defaults'
  LIMIT 1;

  IF v_rules IS NULL THEN
    v_rules := '{"first_sale_rate": 0, "renewal_rate": 0, "deduction_percent": 0, "min_payout_threshold": 500, "payout_cycle_note": "Monthly on 5th"}'::jsonb;
  ELSIF jsonb_typeof(v_rules) = 'string' THEN
    v_rules := (v_rules #>> '{}')::jsonb;
  END IF;

  -- Load sanitized provider contact info only (no secrets/keys)
  SELECT value INTO v_provider
  FROM public.system_config
  WHERE key = 'provider_profile'
  LIMIT 1;

  IF v_provider IS NOT NULL AND jsonb_typeof(v_provider) = 'string' THEN
    v_provider := (v_provider #>> '{}')::jsonb;
  END IF;

  SELECT value INTO v_plans_cfg
  FROM public.system_config
  WHERE key = 'commercial_plans_config'
  LIMIT 1;

  IF v_plans_cfg IS NOT NULL AND jsonb_typeof(v_plans_cfg) = 'string' THEN
    v_plans_cfg := (v_plans_cfg #>> '{}')::jsonb;
  END IF;

  v_trial_days := COALESCE((v_plans_cfg->'trialPolicy'->>'defaultDays')::int, 30);

  -- Count active paid shops for dynamic tier calculation
  SELECT COUNT(*)::int INTO v_active_paid_shops
  FROM public.licenses
  WHERE partner_id = v_partner.id
    AND is_installed IS DISTINCT FROM false
    AND is_active IS DISTINCT FROM false
    AND plan_type IS DISTINCT FROM 'TRIAL'
    AND (expires_at IS NULL OR expires_at > NOW() OR COALESCE(pages_granted, 0) > 0);

  -- Resolve dynamic tier from system_config.tiers (sorted ascending by min_shops)
  v_eff_first := COALESCE((v_rules->>'first_sale_rate')::numeric, 40);
  v_eff_renew := COALESCE((v_rules->>'renewal_rate')::numeric, 20);
  v_eff_wallet := COALESCE((v_rules->>'wallet_rate')::numeric, v_eff_renew);

  IF v_rules->'tiers' IS NOT NULL AND jsonb_typeof(v_rules->'tiers') = 'array' THEN
    FOR v_tier_elem IN
      SELECT elem FROM jsonb_array_elements(v_rules->'tiers') AS elem
      ORDER BY COALESCE((elem->>'min_shops')::int, 0) ASC
    LOOP
      IF v_active_paid_shops >= COALESCE((v_tier_elem->>'min_shops')::int, 0) THEN
        v_tier_id := COALESCE(v_tier_elem->>'id', 'BRONZE');
        v_tier_name := COALESCE(v_tier_elem->>'name', 'Bronze');
        v_eff_first := COALESCE((v_tier_elem->>'first_sale_rate')::numeric, v_eff_first);
        v_eff_renew := COALESCE((v_tier_elem->>'renewal_rate')::numeric, v_eff_renew);
        v_eff_wallet := COALESCE((v_tier_elem->>'wallet_rate')::numeric, v_eff_renew);
      ELSIF v_next_tier IS NULL THEN
        v_next_tier := v_tier_elem;
      END IF;
    END LOOP;
  END IF;

  IF NOT v_partner.use_global_rates THEN
    v_tier_id := 'CUSTOM';
    v_tier_name := 'Custom';
    v_eff_first := COALESCE(v_partner.first_sale_rate, v_eff_first);
    v_eff_renew := COALESCE(v_partner.renewal_rate, v_eff_renew);
    v_eff_wallet := COALESCE(v_partner.wallet_rate, v_partner.renewal_rate, v_eff_wallet);
    v_next_tier := NULL;
  END IF;

  -- Sanitized shopkeepers list for THIS partner only (no HWID, no signature, no technical internals)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'shop_name', shop_name,
      'owner_name', owner_name,
      'phone', phone,
      'city', city,
      'plan_type', plan_type,
      'pages_granted', pages_granted,
      'amount_paid', COALESCE(amount_paid, 0),
      'payment_status', payment_status,
      'is_active', is_active,
      'issued_at', issued_at,
      'expires_at', expires_at,
      'partner_attributed_at', partner_attributed_at,
      'created_at', created_at
    ) ORDER BY created_at DESC
  ), '[]'::jsonb)
  INTO v_shops
  FROM public.licenses
  WHERE partner_id = v_partner.id
    AND is_installed IS DISTINCT FROM false;

  -- Immutable commission ledger for THIS partner only
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'shop_name', shop_name,
      'plan_code', plan_code,
      'plan_name', plan_name,
      'payment_type', payment_type,
      'payment_ref', payment_ref,
      'invoice_number', invoice_number,
      'gross_amount', gross_amount,
      'deduction_amount', deduction_amount,
      'net_amount', net_amount,
      'rate_percent', rate_percent,
      'commission_amount', commission_amount,
      'status', status,
      'created_at', created_at
    ) ORDER BY created_at DESC
  ), '[]'::jsonb)
  INTO v_comms
  FROM public.commission_ledger
  WHERE partner_id = v_partner.id
    AND status <> 'CANCELLED';

  -- Payout settlements for THIS partner only
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'amount', amount,
      'payment_mode', payment_mode,
      'utr_reference', utr_reference,
      'period_label', period_label,
      'notes', notes,
      'paid_at', paid_at
    ) ORDER BY paid_at DESC
  ), '[]'::jsonb)
  INTO v_payouts
  FROM public.partner_payouts
  WHERE partner_id = v_partner.id;

  RETURN jsonb_build_object(
    'ok', true,
    'partner', jsonb_build_object(
      'partner_code', v_partner.partner_code,
      'full_name', v_partner.full_name,
      'username', v_partner.username,
      'phone', v_partner.phone,
      'email', v_partner.email,
      'city', v_partner.city,
      'territory', v_partner.territory,
      'upi_id', v_partner.upi_id,
      'bank_details', v_partner.bank_details,
      'pan_number', v_partner.pan_number,
      'data_sync_status', v_partner.data_sync_status,
      'data_sync_requested_at', v_partner.data_sync_requested_at,
      'data_sync_request_note', v_partner.data_sync_request_note,
      'data_sync_approved_at', v_partner.data_sync_approved_at,
      'use_global_rates', v_partner.use_global_rates,
      'tier_id', v_tier_id,
      'tier_name', v_tier_name,
      'active_paid_shops', v_active_paid_shops,
      'next_tier', v_next_tier,
      'all_tiers', COALESCE(v_rules->'tiers', '[]'::jsonb),
      'effective_first_sale_rate', v_eff_first,
      'effective_renewal_rate', v_eff_renew,
      'effective_wallet_rate', v_eff_wallet,
      'deduction_percent', COALESCE((v_rules->>'deduction_percent')::numeric, 0),
      'min_payout_threshold', COALESCE((v_rules->>'min_payout_threshold')::numeric, 500),
      'payout_cycle_note', COALESCE(v_rules->>'payout_cycle_note', 'Monthly on 5th')
    ),
    'provider', jsonb_build_object(
      'business_name', COALESCE(v_provider->>'business_name', 'TechnoSoft Solution'),
      'phone', COALESCE(v_provider->>'phone', ''),
      'whatsapp', COALESCE(v_provider->>'whatsapp', ''),
      'email', COALESCE(v_provider->>'email', ''),
      'default_trial_days', v_trial_days,
      'plans', COALESCE(v_plans_cfg->'plans', '[]'::jsonb)
    ),
    'shops', v_shops,
    'commissions', v_comms,
    'payouts', v_payouts
  );
END;
$$;

-- 3. Partner Portal Logout RPC (revokes current session token)
CREATE OR REPLACE FUNCTION public.partner_portal_logout(
  p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token_hash TEXT;
BEGIN
  IF COALESCE(TRIM(p_token), '') <> '' THEN
    v_token_hash := encode(extensions.digest(convert_to(TRIM(p_token), 'UTF8'), 'sha256'), 'hex');
    UPDATE public.partner_sessions
    SET revoked_at = NOW()
    WHERE token_hash = v_token_hash AND revoked_at IS NULL;
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.partner_portal_login(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_portal_dashboard(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_portal_logout(TEXT) TO anon, authenticated;

-- 4. Partner Change Password RPC (verifies current password, writes fresh random salt + SHA-256 hash)
CREATE OR REPLACE FUNCTION public.partner_portal_change_password(
  p_token TEXT,
  p_current_password TEXT,
  p_new_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token_hash TEXT;
  v_session public.partner_sessions%ROWTYPE;
  v_partner public.marketing_partners%ROWTYPE;
  v_cur_hash TEXT;
  v_new_salt TEXT;
  v_new_hash TEXT;
BEGIN
  IF COALESCE(TRIM(p_token), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'unauthorized', true, 'error', 'Missing session token.');
  END IF;
  IF COALESCE(p_current_password, '') = '' OR COALESCE(p_new_password, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Current and new passwords are required.');
  END IF;
  IF length(p_new_password) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'New password must be at least 6 characters.');
  END IF;

  v_token_hash := encode(extensions.digest(convert_to(TRIM(p_token), 'UTF8'), 'sha256'), 'hex');
  SELECT * INTO v_session
  FROM public.partner_sessions
  WHERE token_hash = v_token_hash AND revoked_at IS NULL AND expires_at > NOW()
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'unauthorized', true, 'error', 'Session expired. Please sign in again.');
  END IF;

  SELECT * INTO v_partner FROM public.marketing_partners WHERE id = v_session.partner_id LIMIT 1;
  IF NOT FOUND OR v_partner.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'unauthorized', true, 'error', 'Account is not active.');
  END IF;

  v_cur_hash := encode(extensions.digest(convert_to(v_partner.password_salt || ':' || p_current_password, 'UTF8'), 'sha256'), 'hex');
  IF v_cur_hash <> v_partner.password_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Current password is incorrect.');
  END IF;

  v_new_salt := encode(extensions.gen_random_bytes(16), 'hex');
  v_new_hash := encode(extensions.digest(convert_to(v_new_salt || ':' || p_new_password, 'UTF8'), 'sha256'), 'hex');

  UPDATE public.marketing_partners
  SET password_salt = v_new_salt, password_hash = v_new_hash, updated_at = NOW()
  WHERE id = v_partner.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 5. Partner Self-Service Profile & Payout Details RPC (never touches Partner ID, Status, or Share Rates)
CREATE OR REPLACE FUNCTION public.partner_portal_update_profile(
  p_token TEXT,
  p_phone TEXT,
  p_email TEXT,
  p_upi_id TEXT,
  p_bank_details TEXT,
  p_pan_number TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token_hash TEXT;
  v_session public.partner_sessions%ROWTYPE;
  v_partner public.marketing_partners%ROWTYPE;
BEGIN
  IF COALESCE(TRIM(p_token), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'unauthorized', true, 'error', 'Missing session token.');
  END IF;

  v_token_hash := encode(extensions.digest(convert_to(TRIM(p_token), 'UTF8'), 'sha256'), 'hex');
  SELECT * INTO v_session
  FROM public.partner_sessions
  WHERE token_hash = v_token_hash AND revoked_at IS NULL AND expires_at > NOW()
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'unauthorized', true, 'error', 'Session expired. Please sign in again.');
  END IF;

  SELECT * INTO v_partner FROM public.marketing_partners WHERE id = v_session.partner_id LIMIT 1;
  IF NOT FOUND OR v_partner.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'unauthorized', true, 'error', 'Account is not active.');
  END IF;

  UPDATE public.marketing_partners
  SET phone = NULLIF(TRIM(COALESCE(p_phone, '')), ''),
      email = NULLIF(TRIM(COALESCE(p_email, '')), ''),
      upi_id = NULLIF(TRIM(COALESCE(p_upi_id, '')), ''),
      bank_details = NULLIF(TRIM(COALESCE(p_bank_details, '')), ''),
      pan_number = NULLIF(UPPER(TRIM(COALESCE(p_pan_number, ''))), ''),
      updated_at = NOW()
  WHERE id = v_partner.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 6. Partner Sign Out All Devices RPC (revokes all active sessions for this partner only)
CREATE OR REPLACE FUNCTION public.partner_portal_logout_all(
  p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token_hash TEXT;
  v_session public.partner_sessions%ROWTYPE;
BEGIN
  IF COALESCE(TRIM(p_token), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'unauthorized', true, 'error', 'Missing session token.');
  END IF;

  v_token_hash := encode(extensions.digest(convert_to(TRIM(p_token), 'UTF8'), 'sha256'), 'hex');
  SELECT * INTO v_session
  FROM public.partner_sessions
  WHERE token_hash = v_token_hash AND revoked_at IS NULL AND expires_at > NOW()
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'unauthorized', true, 'error', 'Session expired.');
  END IF;

  UPDATE public.partner_sessions
  SET revoked_at = NOW()
  WHERE partner_id = v_session.partner_id AND revoked_at IS NULL;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.partner_portal_change_password(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_portal_update_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_portal_logout_all(TEXT) TO anon, authenticated;
