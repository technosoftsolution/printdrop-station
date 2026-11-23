-- PrintDrop: Partner Customer Data Sync / Restore Request Workflow
-- Adds lightweight request tracking columns to marketing_partners and a secure Partner RPC.

ALTER TABLE public.marketing_partners
  ADD COLUMN IF NOT EXISTS data_sync_status TEXT NOT NULL DEFAULT 'IDLE' CHECK (data_sync_status IN ('IDLE', 'REQUESTED', 'SYNCED', 'DISMISSED')),
  ADD COLUMN IF NOT EXISTS data_sync_requested_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS data_sync_request_note TEXT NULL,
  ADD COLUMN IF NOT EXISTS data_sync_approved_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_partners_sync_status ON public.marketing_partners (data_sync_status);

-- Partner RPC: Request Customer Data Restore / Sync from Software Provider
CREATE OR REPLACE FUNCTION public.partner_portal_request_data_sync(
  p_token TEXT,
  p_note TEXT DEFAULT NULL
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
  SET data_sync_status = 'REQUESTED',
      data_sync_requested_at = NOW(),
      data_sync_request_note = LEFT(NULLIF(TRIM(COALESCE(p_note, '')), ''), 240),
      updated_at = NOW()
  WHERE id = v_partner.id;

  RETURN jsonb_build_object('ok', true, 'data_sync_status', 'REQUESTED', 'requested_at', NOW());
END;
$$;

GRANT EXECUTE ON FUNCTION public.partner_portal_request_data_sync(TEXT, TEXT) TO anon, authenticated;
