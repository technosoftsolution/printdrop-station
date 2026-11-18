# PrintDrop Customer License Registry: Zero-Cost Cloud Setup (Supabase)

This runbook guides you through setting up a **100% free forever** cloud license registry and remote management database using Supabase Free Tier.

---

## 1. Why Supabase Free Tier?
- **Zero Cost**: ₹0 forever (500 MB PostgreSQL database, 50,000 monthly active users, unlimited API requests).
- **No Server to Manage**: Generates automatic HTTPS REST APIs out of the box (`https://<project-ref>.supabase.co/rest/v1/...`).
- **No Purchased Domain / Static IP Needed**: Runs over secure global HTTPS provided by Supabase.
- **Built-in Web Table Editor**: You can edit or inspect customer licenses directly from the Supabase web dashboard on your phone or PC.

---

## 2. Step-by-Step Setup (Takes ~3 minutes)

### Step 1: Create Free Account & Project
1. Go to [https://supabase.com](https://supabase.com) and click **Start your project** (Sign in with GitHub or Email).
2. Click **New Project**:
   - **Name**: `printdrop-license-registry`
   - **Database Password**: Choose a strong password and save it in a password manager.
   - **Region**: Select `South Asia (Mumbai)` or closest region.
   - **Pricing Plan**: `Free Tier` (Default).
3. Click **Create new project** and wait ~60 seconds for provisioning.

---

### Step 2: Run Database Schema SQL
1. In the Supabase left navigation bar, click on **SQL Editor**.
2. Click **New Query**, paste the following SQL script, and click **Run**:

```sql
-- =========================================================================
-- PrintDrop Commercial Customer Licenses & Heartbeat Telemetry Table
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.licenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hwid TEXT UNIQUE NOT NULL,
    shop_name TEXT NOT NULL,
    owner_name TEXT,
    phone TEXT,
    plan_type TEXT NOT NULL CHECK (plan_type IN ('TRIAL', 'WALLET_PAGES', 'SUB_MONTHLY', 'SUB_QUARTERLY', 'SUB_HALF_YEARLY', 'SUB_ANNUAL')),
    pages_granted INTEGER,
    pages_printed_lifetime BIGINT NOT NULL DEFAULT 0,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    expires_at TIMESTAMPTZ,
    signature TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    revocation_reason TEXT,
    client_version TEXT DEFAULT '1.0.0',
    last_ping_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Index for instant lookup by Hardware ID during station heartbeat
CREATE INDEX IF NOT EXISTS idx_licenses_hwid ON public.licenses(hwid);
CREATE INDEX IF NOT EXISTS idx_licenses_phone ON public.licenses(phone);

-- Auto-update updated_at timestamp on edit
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trigger_licenses_updated_at ON public.licenses;
CREATE TRIGGER trigger_licenses_updated_at
    BEFORE UPDATE ON public.licenses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

-- Allow public read & heartbeat update via anon key
CREATE POLICY "Allow public read licenses" ON public.licenses
    FOR SELECT TO anon USING (true);

CREATE POLICY "Allow public insert new station registration" ON public.licenses
    FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow public heartbeat telemetry update" ON public.licenses
    FOR UPDATE TO anon USING (true) WITH CHECK (true);
```

---

### Step 3: Copy Project URL & Public Anon Key
1. In Supabase left navigation bar, click **Project Settings** (gear icon) -> **API**.
2. Copy two values:
   - **Project URL**: (e.g., `https://abcdefghijklm.supabase.co`)
   - **Project API Keys** -> `anon` / `public`: (a long JWT string)

---

### Step 4: Configure Admin Portal & Desktop Stations

1. **Admin Portal**:
   - Open `admin-portal/index.html` in your web browser.
   - Click **Connect Supabase**, paste your **Project URL** and **Anon Key**, and click **Save & Connect**.
   - Your customer station directory will load immediately!

2. **PrintDrop Desktop Stations**:
   - On the shopkeeper's desktop app, open **Settings > Station License & HWID**.
   - Under **Cloud Synchronization Settings**, paste the **Project URL** and **Anon Key**.
   - The desktop app will now automatically ping the cloud registry once daily and enable remote kill-switch and auto-renewal without manual key entry.
