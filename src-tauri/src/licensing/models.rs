use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LicensePlanType {
    Trial,
    WalletPages,
    SubMonthly,
    SubQuarterly,
    SubHalfYearly,
    SubAnnual,
}

impl LicensePlanType {
    pub fn display_name(&self) -> &str {
        match self {
            LicensePlanType::Trial => "Free Trial Evaluation",
            LicensePlanType::WalletPages => "Pay-As-You-Go Page Wallet",
            LicensePlanType::SubMonthly => "1 Month Unlimited Plan (₹299/mo)",
            LicensePlanType::SubQuarterly => "3 Months Unlimited Plan (₹749)",
            LicensePlanType::SubHalfYearly => "6 Months Unlimited Plan (₹1,299)",
            LicensePlanType::SubAnnual => "1 Year Unlimited Plan (₹2,299)",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LicenseStatus {
    TrialActive,
    TrialExpired,
    Active,
    Expired,
    Revoked,
    ClockTampered,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicensePayload {
    pub hwid: String,
    pub shop_name: String,
    pub owner_name: Option<String>,
    #[serde(default)]
    pub city: Option<String>,
    pub phone: Option<String>,
    pub plan_type: LicensePlanType,
    pub pages_granted: Option<u64>,
    pub issued_at: String,
    pub expires_at: Option<String>,
    pub signature: String,
    #[serde(default)]
    pub plan_name: Option<String>,
    #[serde(default)]
    pub amount_paid: Option<f64>,
    #[serde(default)]
    pub payment_mode: Option<String>,
    #[serde(default)]
    pub payment_reference: Option<String>,
    #[serde(default)]
    pub invoice_number: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStateDto {
    pub hwid: String,
    pub is_valid: bool,
    pub status: LicenseStatus,
    pub plan_type: LicensePlanType,
    pub plan_display_name: String,
    pub shop_name: String,
    pub owner_name: Option<String>,
    pub city: Option<String>,
    pub phone: Option<String>,
    pub profile_configured: bool,
    pub profile_updated_at: Option<String>,
    pub start_date: String,
    pub expiry_date: Option<String>,
    pub days_remaining: i64,
    pub active_tenure_days: i64,
    pub wallet_pages_remaining: Option<u64>,
    pub lifetime_prints: u64,
    pub today_prints: u64,
    pub clock_tampered: bool,
    pub is_offline_grace_active: bool,
    pub offline_grace_hours_remaining: Option<i64>,
    pub is_license_grace_active: bool,
    pub license_grace_hours_remaining: Option<i64>,
    pub license_grace_prints_remaining: Option<u64>,
    pub provider_company_name: Option<String>,
    pub provider_contact_phone: Option<String>,
    pub provider_whatsapp_number: Option<String>,
    pub provider_support_email: Option<String>,
    pub status_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationRequest {
    pub activation_key: String,
    pub shop_name: Option<String>,
    pub owner_name: Option<String>,
    pub phone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicensePaymentClaim {
    pub hwid: String,
    pub requested_plan: String,
    pub requested_pages: Option<u64>,
    pub amount_paid: f64,
    pub payment_mode: String,
    pub payment_reference: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicensePaymentRecord {
    pub id: String,
    pub hwid: String,
    pub plan_code: String,
    pub plan_name: String,
    pub amount_paid: f64,
    pub pages_granted: Option<u64>,
    pub duration_days: Option<i64>,
    pub payment_mode: String,
    pub payment_reference: String,
    pub invoice_number: String,
    pub status: String, // "VERIFIED_PAID" | "PENDING_VERIFICATION" | "FAILED"
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyPrintUsageRecord {
    pub date: String,             // "2026-11-17"
    pub display_date: String,     // "17 Nov 2026"
    pub is_today: bool,
    pub time_range: Option<String>, // "09:15 AM - 08:30 PM"
    pub day_pages: u64,           // 142
    pub day_orders_count: u64,    // 19
    pub cumulative_pages: u64,    // 480
    pub quota_remaining_pages: Option<i64>, // 875 (for per-page wallet)
    pub days_left: Option<i64>,   // 27 (for monthly subscription)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentUsageSummaryDto {
    pub payment_id: String,
    pub plan_code: String,
    pub plan_name: String,
    pub is_wallet_plan: bool,
    pub total_quota_granted: Option<u64>,
    pub total_duration_days: Option<i64>,
    pub total_pages_consumed: u64,
    pub pages_remaining: Option<i64>,
    pub days_remaining: Option<i64>,
    pub purchase_date: String,
    pub daily_records: Vec<DailyPrintUsageRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPaymentConfig {
    pub business_name: String,
    pub upi_id: String,
    pub online_payment_url: String,
    pub qr_payload: String,
    pub qr_image_url: String,
    pub mcc_code: String,
    pub qr_mode: String,
    pub razorpay_key_id: Option<String>,
    pub contact_phone: Option<String>,
    pub whatsapp_number: Option<String>,
    pub support_email: Option<String>,
}

impl ProviderPaymentConfig {
    pub fn from_json_value(val: &serde_json::Value) -> Self {
        let mut def = Self::default();
        if let Some(obj) = val.as_object() {
            if let Some(v) = obj.get("businessName").or_else(|| obj.get("business_name")).and_then(|v| v.as_str()) {
                def.business_name = v.to_string();
            }
            if let Some(v) = obj.get("upiId").or_else(|| obj.get("upi_id")).and_then(|v| v.as_str()) {
                def.upi_id = v.to_string();
            }
            if let Some(v) = obj.get("onlinePaymentUrl").or_else(|| obj.get("online_payment_url")).and_then(|v| v.as_str()) {
                def.online_payment_url = v.to_string();
            }
            if let Some(v) = obj.get("qrPayload").or_else(|| obj.get("qr_payload")).and_then(|v| v.as_str()) {
                def.qr_payload = v.to_string();
            }
            if let Some(v) = obj.get("qrImageUrl").or_else(|| obj.get("qr_image_url")).and_then(|v| v.as_str()) {
                def.qr_image_url = v.to_string();
            }
            if let Some(v) = obj.get("mccCode").or_else(|| obj.get("mcc_code")).and_then(|v| v.as_str()) {
                def.mcc_code = v.to_string();
            }
            if let Some(v) = obj.get("qrMode").or_else(|| obj.get("qr_mode")).and_then(|v| v.as_str()) {
                def.qr_mode = v.to_string();
            }
            if let Some(v) = obj.get("razorpayKeyId").or_else(|| obj.get("razorpay_key_id")).and_then(|v| v.as_str()) {
                if !v.trim().is_empty() {
                    def.razorpay_key_id = Some(v.trim().to_string());
                }
            }
            if let Some(v) = obj.get("contactPhone").or_else(|| obj.get("contact_phone")).and_then(|v| v.as_str()) {
                if !v.trim().is_empty() {
                    def.contact_phone = Some(v.trim().to_string());
                }
            }
            if let Some(v) = obj.get("whatsappNumber").or_else(|| obj.get("whatsapp_number")).and_then(|v| v.as_str()) {
                if !v.trim().is_empty() {
                    def.whatsapp_number = Some(v.trim().to_string());
                }
            }
            if let Some(v) = obj.get("supportEmail").or_else(|| obj.get("support_email")).and_then(|v| v.as_str()) {
                if !v.trim().is_empty() {
                    def.support_email = Some(v.trim().to_string());
                }
            }
        }
        def
    }
}

impl Default for ProviderPaymentConfig {
    fn default() -> Self {
        Self {
            business_name: "TechnoSoft Solution".to_string(),
            upi_id: "satishharilalpa302866.rzp@rxairtel".to_string(),
            online_payment_url: "https://razorpay.me/@techsoftsolution".to_string(),
            qr_payload: "upi://pay?cu=INR&mc=7338&mode=19&pa=satishharilalpa302866.rzp@rxairtel&tn=Payment%20To%20TechnoSoft%20Solution&tr=TvmnkaSBVCD0Okqrv2".to_string(),
            qr_image_url: "https://rzp.io/rzp/4DH7ll4d".to_string(),
            mcc_code: "7338".to_string(),
            qr_mode: "19".to_string(),
            razorpay_key_id: Some("rzp_live_TvfyWRnZVTnIbK".to_string()),
            contact_phone: Some("+91 94220 00000".to_string()),
            whatsapp_number: Some("+91 94220 00000".to_string()),
            support_email: Some("support@technosoftsolution.com".to_string()),
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommercialPlanItemDto {
    pub code: String,
    pub name: String,
    pub category: String, // "UNLIMITED" | "WALLET"
    pub amount: f64,
    pub duration_days: Option<u32>,
    pub pages: Option<u32>,
    pub rate_per_page: Option<f64>,
    pub description: String,
    pub badge: Option<String>,
    pub per_month_or_page: Option<String>,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomPageRateRulesDto {
    pub min_pages: u32,
    pub tier1_max_pages: u32,
    pub tier1_rate: f64,
    pub tier2_max_pages: u32,
    pub tier2_rate: f64,
    pub tier3_max_pages: u32,
    pub tier3_rate: f64,
    #[serde(default = "default_tier4_max_pages")]
    pub tier4_max_pages: u32,
    pub tier4_rate: f64,
    #[serde(default = "default_tier5_rate")]
    pub tier5_rate: f64,
    pub quick_picks: Vec<u32>,
}

fn default_tier4_max_pages() -> u32 {
    9999
}

fn default_tier5_rate() -> f64 {
    0.10
}

impl Default for CustomPageRateRulesDto {
    fn default() -> Self {
        Self {
            min_pages: 200,
            tier1_max_pages: 499,
            tier1_rate: 0.40,
            tier2_max_pages: 1999,
            tier2_rate: 0.30,
            tier3_max_pages: 4999,
            tier3_rate: 0.20,
            tier4_max_pages: 9999,
            tier4_rate: 0.15,
            tier5_rate: 0.10,
            quick_picks: vec![200, 500, 2000, 5000, 10000],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommercialPlansCatalogDto {
    pub plans: Vec<CommercialPlanItemDto>,
    pub custom_rules: CustomPageRateRulesDto,
    pub updated_at: Option<String>,
}

impl Default for CommercialPlansCatalogDto {
    fn default() -> Self {
        Self {
            plans: vec![
                CommercialPlanItemDto {
                    code: "SUB_MONTHLY".to_string(),
                    name: "1 Month Unlimited".to_string(),
                    category: "UNLIMITED".to_string(),
                    amount: 299.0,
                    duration_days: Some(30),
                    pages: None,
                    rate_per_page: None,
                    description: "Unlimited Prints for 30 Days".to_string(),
                    badge: None,
                    per_month_or_page: Some("₹299/mo".to_string()),
                    is_active: true,
                },
                CommercialPlanItemDto {
                    code: "SUB_QUARTERLY".to_string(),
                    name: "3 Months Unlimited".to_string(),
                    category: "UNLIMITED".to_string(),
                    amount: 749.0,
                    duration_days: Some(90),
                    pages: None,
                    rate_per_page: None,
                    description: "Unlimited Prints for 90 Days".to_string(),
                    badge: Some("Popular".to_string()),
                    per_month_or_page: Some("₹250/mo (Save 15%)".to_string()),
                    is_active: true,
                },
                CommercialPlanItemDto {
                    code: "SUB_HALF_YEARLY".to_string(),
                    name: "6 Months Unlimited".to_string(),
                    category: "UNLIMITED".to_string(),
                    amount: 1299.0,
                    duration_days: Some(180),
                    pages: None,
                    rate_per_page: None,
                    description: "Unlimited Prints for 180 Days".to_string(),
                    badge: None,
                    per_month_or_page: Some("₹216/mo (Save 25%)".to_string()),
                    is_active: true,
                },
                CommercialPlanItemDto {
                    code: "SUB_ANNUAL".to_string(),
                    name: "1 Year Unlimited".to_string(),
                    category: "UNLIMITED".to_string(),
                    amount: 2299.0,
                    duration_days: Some(365),
                    pages: None,
                    rate_per_page: None,
                    description: "Unlimited Prints for 1 Full Year".to_string(),
                    badge: Some("Best Value".to_string()),
                    per_month_or_page: Some("₹191/mo (Save 36%)".to_string()),
                    is_active: true,
                },
                CommercialPlanItemDto {
                    code: "WALLET_200".to_string(),
                    name: "Micro Starter Pack (200 Pgs)".to_string(),
                    category: "WALLET".to_string(),
                    amount: 80.0,
                    duration_days: None,
                    pages: Some(200),
                    rate_per_page: Some(0.40),
                    description: "200 Prepaid Pages • Minimum Starter Pack • No Expiration Date".to_string(),
                    badge: Some("Min Pack".to_string()),
                    per_month_or_page: Some("40p per page".to_string()),
                    is_active: true,
                },
                CommercialPlanItemDto {
                    code: "WALLET_500".to_string(),
                    name: "Starter Pack (500 Pgs)".to_string(),
                    category: "WALLET".to_string(),
                    amount: 150.0,
                    duration_days: None,
                    pages: Some(500),
                    rate_per_page: Some(0.30),
                    description: "500 Prepaid Pages • No Expiration Date".to_string(),
                    badge: Some("Popular".to_string()),
                    per_month_or_page: Some("30p per page".to_string()),
                    is_active: true,
                },
                CommercialPlanItemDto {
                    code: "WALLET_2000".to_string(),
                    name: "Value Pack (2,000 Pgs)".to_string(),
                    category: "WALLET".to_string(),
                    amount: 400.0,
                    duration_days: None,
                    pages: Some(2000),
                    rate_per_page: Some(0.20),
                    description: "2,000 Prepaid Pages • No Expiration Date".to_string(),
                    badge: Some("Value".to_string()),
                    per_month_or_page: Some("20p per page".to_string()),
                    is_active: true,
                },
                CommercialPlanItemDto {
                    code: "WALLET_5000".to_string(),
                    name: "Commercial Pack (5,000 Pgs)".to_string(),
                    category: "WALLET".to_string(),
                    amount: 750.0,
                    duration_days: None,
                    pages: Some(5000),
                    rate_per_page: Some(0.15),
                    description: "5,000 Prepaid Pages • No Expiration Date".to_string(),
                    badge: Some("Recommended".to_string()),
                    per_month_or_page: Some("15p per page".to_string()),
                    is_active: true,
                },
                CommercialPlanItemDto {
                    code: "WALLET_10000".to_string(),
                    name: "Jumbo Pack (10,000 Pgs)".to_string(),
                    category: "WALLET".to_string(),
                    amount: 1000.0,
                    duration_days: None,
                    pages: Some(10000),
                    rate_per_page: Some(0.10),
                    description: "10,000 Prepaid Pages • Bulk Wholesale Rate • No Expiration Date".to_string(),
                    badge: Some("Best Value".to_string()),
                    per_month_or_page: Some("10p per page".to_string()),
                    is_active: true,
                },
            ],
            custom_rules: CustomPageRateRulesDto::default(),
            updated_at: None,
        }
    }
}
