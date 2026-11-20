import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Copy,
  Check,
  RefreshCw,
  Cpu,
  Layers,
  Calendar,
  Clock,
  Sparkles,
  Printer,
  X,
  CreditCard,
  Building2,
  PhoneCall,
  User,
  AlertTriangle,
  Cloud,
  Radio,
  QrCode,
  Zap,
  Sliders,
  ExternalLink,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  History,
  Receipt,
  ChevronDown,
  ChevronUp,
  Download,
  CheckCircle2,
  Maximize2,
  Minimize2
} from 'lucide-react';

export interface LicensePaymentRecord {
  id: string;
  hwid: string;
  planCode: string;
  planName: string;
  amountPaid: number;
  pagesGranted?: number | null;
  durationDays?: number | null;
  paymentMode: string;
  paymentReference: string;
  invoiceNumber: string;
  status: 'VERIFIED_PAID' | 'PENDING_VERIFICATION' | 'FAILED' | string;
  createdAt: string;
}

export interface DailyPrintUsageRecord {
  date: string;
  displayDate: string;
  isToday: boolean;
  timeRange?: string | null;
  dayPages: number;
  dayOrdersCount: number;
  cumulativePages: number;
  quotaRemainingPages?: number | null;
  daysLeft?: number | null;
}

export interface PaymentUsageSummaryDto {
  paymentId: string;
  planCode: string;
  planName: string;
  isWalletPlan: boolean;
  totalQuotaGranted?: number | null;
  totalDurationDays?: number | null;
  totalPagesConsumed: number;
  pagesRemaining?: number | null;
  daysRemaining?: number | null;
  purchaseDate: string;
  dailyRecords: DailyPrintUsageRecord[];
}

export interface LicenseStateDto {
  hwid: string;
  isValid: boolean;
  status: 'TRIAL_ACTIVE' | 'TRIAL_EXPIRED' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'CLOCK_TAMPERED';
  planType: 'TRIAL' | 'WALLET_PAGES' | 'SUB_MONTHLY' | 'SUB_QUARTERLY' | 'SUB_HALF_YEARLY' | 'SUB_ANNUAL';
  planDisplayName: string;
  shopName: string;
  ownerName?: string | null;
  city?: string | null;
  phone?: string | null;
  profileConfigured?: boolean;
  profileUpdatedAt?: string | null;
  startDate: string;
  expiryDate?: string | null;
  daysRemaining: number;
  activeTenureDays: number;
  walletPagesRemaining?: number | null;
  lifetimePrints: number;
  todayPrints: number;
  clockTampered: boolean;
  isOfflineGraceActive: boolean;
  offlineGraceHoursRemaining?: number | null;
  isLicenseGraceActive: boolean;
  licenseGraceHoursRemaining?: number | null;
  licenseGracePrintsRemaining?: number | null;
  providerCompanyName?: string | null;
  providerContactPhone?: string | null;
  providerWhatsappNumber?: string | null;
  providerSupportEmail?: string | null;
  statusMessage: string;
}

export interface CloudConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  lastSyncedAt?: string | null;
  syncEnabled: boolean;
}

export interface PlanOption {
  code: string;
  name: string;
  category: 'UNLIMITED' | 'WALLET';
  amount: number;
  durationDays?: number;
  pages?: number;
  ratePerPage?: number;
  description: string;
  badge?: string;
  perMonthOrPage?: string;
  isActive?: boolean;
}

export interface CustomPageRateRules {
  minPages: number;
  tier1MaxPages: number;
  tier1Rate: number;
  tier2MaxPages: number;
  tier2Rate: number;
  tier3MaxPages: number;
  tier3Rate: number;
  tier4MaxPages?: number;
  tier4Rate: number;
  tier5Rate?: number;
  quickPicks: number[];
}

export interface CommercialPlansCatalog {
  plans: PlanOption[];
  customRules: CustomPageRateRules;
  updatedAt?: string | null;
}

export const DEFAULT_CUSTOM_RULES: CustomPageRateRules = {
  minPages: 200,
  tier1MaxPages: 499,
  tier1Rate: 0.40,
  tier2MaxPages: 1999,
  tier2Rate: 0.30,
  tier3MaxPages: 4999,
  tier3Rate: 0.20,
  tier4MaxPages: 9999,
  tier4Rate: 0.15,
  tier5Rate: 0.10,
  quickPicks: [200, 500, 2000, 5000, 10000],
};

export function formatPlanDisplayName(plan?: { name: string; pages?: number | null; category?: string } | null): string {
  if (!plan) return '';
  if (plan.category === 'WALLET' && plan.pages) {
    const baseName = plan.name.replace(/\s*\(\s*[\d,]+\s*(?:pgs|pages|pg)\s*\)/i, '').trim();
    return `${baseName} (${plan.pages.toLocaleString()} Pgs)`;
  }
  return plan.name;
}

export const AVAILABLE_PLANS: PlanOption[] = [
  // Model B: Unlimited Time Subscriptions
  {
    code: 'SUB_MONTHLY',
    name: '1 Month Unlimited',
    category: 'UNLIMITED',
    amount: 299,
    durationDays: 30,
    description: 'Unlimited Prints for 30 Days',
    perMonthOrPage: '₹299/mo',
  },
  {
    code: 'SUB_QUARTERLY',
    name: '3 Months Unlimited',
    category: 'UNLIMITED',
    amount: 749,
    durationDays: 90,
    description: 'Unlimited Prints for 90 Days',
    badge: 'Popular',
    perMonthOrPage: '₹250/mo (Save 15%)',
  },
  {
    code: 'SUB_HALF_YEARLY',
    name: '6 Months Unlimited',
    category: 'UNLIMITED',
    amount: 1299,
    durationDays: 180,
    description: 'Unlimited Prints for 180 Days',
    perMonthOrPage: '₹216/mo (Save 25%)',
  },
  {
    code: 'SUB_ANNUAL',
    name: '1 Year Unlimited',
    category: 'UNLIMITED',
    amount: 2299,
    durationDays: 365,
    description: 'Unlimited Prints for 1 Full Year',
    badge: 'Best Value',
    perMonthOrPage: '₹191/mo (Save 36%)',
  },
  // Model A: Pay-As-You-Go Page Packs
  {
    code: 'WALLET_200',
    name: 'Micro Starter Pack (200 Pgs)',
    category: 'WALLET',
    amount: 80,
    pages: 200,
    description: '200 Prepaid Pages • Minimum Starter Pack • No Expiration Date',
    badge: 'Min Pack',
    perMonthOrPage: '40p per page',
  },
  {
    code: 'WALLET_500',
    name: 'Starter Pack (500 Pgs)',
    category: 'WALLET',
    amount: 150,
    pages: 500,
    description: '500 Prepaid Pages • No Expiration Date',
    badge: 'Popular',
    perMonthOrPage: '30p per page',
  },
  {
    code: 'WALLET_2000',
    name: 'Value Pack (2,000 Pgs)',
    category: 'WALLET',
    amount: 400,
    pages: 2000,
    description: '2,000 Prepaid Pages • No Expiration Date',
    badge: 'Value',
    perMonthOrPage: '20p per page',
  },
  {
    code: 'WALLET_5000',
    name: 'Commercial Pack (5,000 Pgs)',
    category: 'WALLET',
    amount: 750,
    pages: 5000,
    description: '5,000 Prepaid Pages • No Expiration Date',
    badge: 'Recommended',
    perMonthOrPage: '15p per page',
  },
  {
    code: 'WALLET_10000',
    name: 'Jumbo Pack (10,000 Pgs)',
    category: 'WALLET',
    amount: 1000,
    pages: 10000,
    description: '10,000 Prepaid Pages • Bulk Wholesale Rate • No Expiration Date',
    badge: 'Best Value',
    perMonthOrPage: '10p per page',
  },
];

export interface HeartbeatResult {
  success: boolean;
  message: string;
  isRevoked: boolean;
  isGraceActive: boolean;
  hoursUntilGraceExpires?: number | null;
  updatedLicense?: LicenseStateDto | null;
}

interface LicenseActivationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLicenseUpdated?: (state: LicenseStateDto) => void;
}

export interface ProviderPaymentConfig {
  businessName: string;
  upiId: string;
  onlinePaymentUrl: string;
  qrPayload: string;
  qrImageUrl: string;
  mccCode: string;
  qrMode: string;
  razorpayKeyId?: string;
  contactPhone?: string | null;
  whatsappNumber?: string | null;
  supportEmail?: string | null;
}

declare global {
  interface Window {
    Razorpay: any;
  }
}

export const loadRazorpayScript = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && (window as any).Razorpay) {
      resolve(true);
      return;
    }
    const existing = document.querySelector('script[src*="checkout.razorpay.com"]');
    if (existing) {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if ((window as any).Razorpay) {
          clearInterval(interval);
          resolve(true);
        } else if (attempts > 50) {
          clearInterval(interval);
          resolve(false);
        }
      }, 100);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if ((window as any).Razorpay) {
          clearInterval(interval);
          resolve(true);
        } else if (attempts > 50) {
          clearInterval(interval);
          resolve(false);
        }
      }, 100);
    };
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

export const LicenseActivationModal: React.FC<LicenseActivationModalProps> = ({
  isOpen,
  onClose,
  onLicenseUpdated,
}) => {
  const [licenseState, setLicenseState] = useState<LicenseStateDto | null>(null);
  const [cloudConfig, setCloudConfig] = useState<CloudConfig | null>(null);
  const [providerPaymentConfig, setProviderPaymentConfig] = useState<ProviderPaymentConfig | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isActivating, setIsActivating] = useState<boolean>(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copiedHwid, setCopiedHwid] = useState<boolean>(false);

  // Activation inputs
  const [rawKeyInput, setRawKeyInput] = useState<string>('');
  const [shopNameInput, setShopNameInput] = useState<string>('');
  const [ownerNameInput, setOwnerNameInput] = useState<string>('');
  const [phoneInput, setPhoneInput] = useState<string>('');

  // Cloud Config state
  const [supabaseUrlInput, setSupabaseUrlInput] = useState<string>('');
  const [supabaseKeyInput, setSupabaseKeyInput] = useState<string>('');
  const [syncEnabledInput, setSyncEnabledInput] = useState<boolean>(true);
  const [isSavingCloud, setIsSavingCloud] = useState<boolean>(false);
  const [isSavingProfile, setIsSavingProfile] = useState<boolean>(false);
  const [isCloudUnlocked, setIsCloudUnlocked] = useState<boolean>(false);
  const [cloudPasswordInput, setCloudPasswordInput] = useState<string>('');
  const [cloudPasswordError, setCloudPasswordError] = useState<string | null>(null);
  const [showUrlPlain, setShowUrlPlain] = useState<boolean>(false);
  const [showKeyPlain, setShowKeyPlain] = useState<boolean>(false);

  // Plan selection & Payment state
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'PLANS' | 'PAYMENTS' | 'OFFLINE_KEY' | 'CLOUD'>('OVERVIEW');
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const [paymentHistory, setPaymentHistory] = useState<LicensePaymentRecord[]>([]);
  const [isLoadingPayments, setIsLoadingPayments] = useState<boolean>(false);
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  const [usageSummaryMap, setUsageSummaryMap] = useState<Record<string, PaymentUsageSummaryDto | null>>({});
  const [isLoadingUsageMap, setIsLoadingUsageMap] = useState<Record<string, boolean>>({});
  const [receiptModalPayment, setReceiptModalPayment] = useState<LicensePaymentRecord | null>(null);
  const [availablePlans, setAvailablePlans] = useState<PlanOption[]>(AVAILABLE_PLANS);
  const [customRules, setCustomRules] = useState<CustomPageRateRules>(DEFAULT_CUSTOM_RULES);
  const [selectedPlan, setSelectedPlan] = useState<PlanOption | null>(null);
  const [planCategoryTab, setPlanCategoryTab] = useState<'UNLIMITED' | 'WALLET'>('UNLIMITED');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState<boolean>(false);
  const [utrInput, setUtrInput] = useState<string>('');
  const [isSubmittingClaim, setIsSubmittingClaim] = useState<boolean>(false);
  const [claimSuccessMsg, setClaimSuccessMsg] = useState<string | null>(null);

  // In-Context Gateway & Active Sensing state
  const [activePaymentUrl, setActivePaymentUrl] = useState<string | null>(null);
  const [isPaymentSensing, setIsPaymentSensing] = useState<boolean>(false);

  // Custom Pay-As-You-Go Pack state
  const [customPagesInput, setCustomPagesInput] = useState<number>(200);
  const [customPagesDraft, setCustomPagesDraft] = useState<string>('200');

  const getCustomPageRate = (pages: number): number => {
    const minP = Math.max(1, customRules.minPages || 200);
    const p = Math.max(minP, pages);
    if (p <= (customRules.tier1MaxPages || 499)) {
      return customRules.tier1Rate || 0.40;
    } else if (p <= (customRules.tier2MaxPages || 1999)) {
      return customRules.tier2Rate || 0.30;
    } else if (p <= (customRules.tier3MaxPages || 4999)) {
      return customRules.tier3Rate || 0.20;
    } else if (p <= (customRules.tier4MaxPages || 9999)) {
      return customRules.tier4Rate || 0.15;
    } else {
      return customRules.tier5Rate || 0.10;
    }
  };

  const getCustomPageAmount = (pages: number): number => {
    const minP = Math.max(1, customRules.minPages || 200);
    const p = Math.max(minP, pages);
    const rate = getCustomPageRate(p);
    return Math.round(p * rate);
  };

  const getActiveTierIndex = (pages: number): number => {
    const minP = Math.max(1, customRules.minPages || 200);
    const p = Math.max(minP, pages);
    if (p <= (customRules.tier1MaxPages || 499)) return 0;
    if (p <= (customRules.tier2MaxPages || 1999)) return 1;
    if (p <= (customRules.tier3MaxPages || 4999)) return 2;
    if (p <= (customRules.tier4MaxPages || 9999)) return 3;
    return 4;
  };

  const getUpsellRecommendation = (pages: number) => {
    const minP = Math.max(1, customRules.minPages || 200);
    const p = Math.max(minP, pages);
    const currentCost = getCustomPageAmount(p);

    const slabs = [
      { threshold: 500, rate: customRules.tier2Rate || 0.30, cost: Math.round(500 * (customRules.tier2Rate || 0.30)) },
      { threshold: 2000, rate: customRules.tier3Rate || 0.20, cost: Math.round(2000 * (customRules.tier3Rate || 0.20)) },
      { threshold: 5000, rate: customRules.tier4Rate || 0.15, cost: Math.round(5000 * (customRules.tier4Rate || 0.15)) },
      { threshold: 10000, rate: customRules.tier5Rate || 0.10, cost: Math.round(10000 * (customRules.tier5Rate || 0.10)) },
    ];

    for (const slab of slabs) {
      if (p < slab.threshold) {
        const extraPages = slab.threshold - p;
        const diff = slab.cost - currentCost;
        if (diff <= 0 || (extraPages <= slab.threshold * 0.25 && diff <= 60)) {
          const rateLabel = slab.rate >= 1 ? `₹${slab.rate.toFixed(2)}` : `${Math.round(slab.rate * 100)}p`;
          return {
            targetPages: slab.threshold,
            targetCost: slab.cost,
            targetRate: rateLabel,
            extraPages,
            savings: diff < 0 ? Math.abs(diff) : 0,
            priceDiff: diff > 0 ? diff : 0,
          };
        }
        break;
      }
    }
    return null;
  };

  const handleSelectCustomPack = (pagesCount?: number) => {
    const minP = Math.max(1, customRules.minPages || 200);
    const pages = Math.max(minP, pagesCount !== undefined ? pagesCount : customPagesInput);
    setCustomPagesInput(pages);
    setCustomPagesDraft(pages.toString());
    const amount = getCustomPageAmount(pages);
    const rate = getCustomPageRate(pages);
    const rateLabel = rate >= 1 ? `₹${rate.toFixed(2)}/pg` : `${Math.round(rate * 100)}p/pg`;
    const customPlan: PlanOption = {
      code: `WALLET_CUSTOM_${pages}`,
      name: `Custom Pack (${pages.toLocaleString()} Pgs)`,
      category: 'WALLET',
      amount,
      pages,
      description: `${pages.toLocaleString()} Prepaid Pages • Custom Pay-As-You-Go • No Expiration Date`,
      badge: 'Custom',
      perMonthOrPage: rateLabel,
    };
    setSelectedPlan(customPlan);
    setQrDataUrl(null);
  };

  const fetchLicenseState = async () => {
    try {
      setIsLoading(true);
      setErrorMsg(null);
      const [state, cfg, provCfg, plansCfg] = await Promise.all([
        invoke<LicenseStateDto>('get_license_state'),
        invoke<CloudConfig>('get_cloud_license_config'),
        invoke<ProviderPaymentConfig>('get_provider_payment_config').catch(() => null),
        invoke<CommercialPlansCatalog>('get_commercial_plans_config').catch(() => null),
      ]);

      setLicenseState(state);
      setCloudConfig(cfg);
      if (provCfg) setProviderPaymentConfig(provCfg);
      if (plansCfg && Array.isArray(plansCfg.plans) && plansCfg.plans.length > 0) {
        const normalizedPlans = plansCfg.plans.map((p) => {
          if (p.category === 'WALLET' && p.pages) {
            if (p.code === 'WALLET_12000' || p.pages === 12000) {
              return {
                ...p,
                code: 'WALLET_10000',
                name: 'Jumbo Pack (10,000 Pgs)',
                pages: 10000,
                ratePerPage: 0.10,
                amount: 1000,
                badge: 'Best Value',
                perMonthOrPage: '10p per page',
              };
            }
            return {
              ...p,
              name: formatPlanDisplayName(p),
            };
          }
          return p;
        });
        setAvailablePlans(normalizedPlans.filter((p) => p.isActive !== false));
        if (plansCfg.customRules) {
          setCustomRules(plansCfg.customRules);
          const initMin = plansCfg.customRules.minPages || 200;
          setCustomPagesInput((prev) => Math.max(initMin, prev));
          setCustomPagesDraft((prev) => Math.max(initMin, parseInt(prev, 10) || initMin).toString());
        }
      }
      setSupabaseUrlInput(cfg.supabaseUrl || '');
      setSupabaseKeyInput(cfg.supabaseAnonKey || '');
      setSyncEnabledInput(cfg.syncEnabled);

      if (onLicenseUpdated) {
        onLicenseUpdated(state);
      }
      if (state.shopName) {
        const cleanName = state.planType !== 'TRIAL'
          ? state.shopName.replace(/\s*\((Trial|Trial Mode)\)\s*/gi, '').trim()
          : state.shopName;
        state.shopName = cleanName;
        setShopNameInput(cleanName);
      }
      if (state.ownerName) setOwnerNameInput(state.ownerName);
      if (state.phone) setPhoneInput(state.phone);
      // Load payment history concurrently
      loadPaymentHistory();
    } catch (err: any) {
      console.error('Failed to load license state:', err);
      setErrorMsg(typeof err === 'string' ? err : err?.message || 'Could not fetch license status');
    } finally {
      setIsLoading(false);
    }
  };

  const loadPaymentUsage = async (paymentId: string) => {
    try {
      setIsLoadingUsageMap(prev => ({ ...prev, [paymentId]: true }));
      const summary = await invoke<PaymentUsageSummaryDto>('get_payment_usage_history', { paymentId });
      setUsageSummaryMap(prev => ({ ...prev, [paymentId]: summary }));
    } catch (err) {
      console.warn('Could not load payment usage history:', err);
    } finally {
      setIsLoadingUsageMap(prev => ({ ...prev, [paymentId]: false }));
    }
  };

  const loadPaymentHistory = async () => {
    try {
      setIsLoadingPayments(true);
      const list = await invoke<LicensePaymentRecord[]>('get_license_payment_history');
      if (Array.isArray(list)) {
        setPaymentHistory(list);
        if (list.length > 0 && !expandedPaymentId) {
          setExpandedPaymentId(list[0].id);
          loadPaymentUsage(list[0].id);
        } else if (expandedPaymentId) {
          loadPaymentUsage(expandedPaymentId);
        }
      }
    } catch (err) {
      console.warn('Could not load payment history:', err);
    } finally {
      setIsLoadingPayments(false);
    }
  };

  const exportReceiptAsHtml = (rec: LicensePaymentRecord) => {
    const shop = licenseState?.shopName || 'Retail Station';
    const owner = licenseState?.ownerName || 'Owner';
    const phone = licenseState?.phone || 'N/A';
    const dateFormatted = new Date(rec.createdAt).toLocaleDateString('en-GB');
    const amountStr = `₹${Number(rec.amountPaid || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const quotaStr = rec.pagesGranted
      ? `${rec.pagesGranted.toLocaleString()} Pages Pack`
      : (rec.durationDays ? `${rec.durationDays} Days Unlimited` : 'Full Access Plan');

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Tax Invoice - ${rec.invoiceNumber}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; color: #1e293b; padding: 40px; margin: 0; }
    .invoice-card { max-width: 680px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #4f46e5; padding-bottom: 20px; margin-bottom: 24px; }
    .title { font-size: 22px; font-weight: 800; color: #4338ca; }
    .badge { display: inline-block; background: #e0e7ff; color: #3730a3; padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 11px; text-transform: uppercase; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; font-size: 12px; line-height: 1.6; }
    .table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
    .table th { background: #f1f5f9; text-align: left; padding: 10px 14px; font-weight: 700; color: #475569; }
    .table td { padding: 12px 14px; border-bottom: 1px solid #e2e8f0; }
    .total-row { font-size: 16px; font-weight: 800; color: #0f172a; }
    .footer { text-align: center; font-size: 11px; color: #64748b; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 16px; }
    @media print { body { padding: 0; } .invoice-card { border: none; box-shadow: none; padding: 0; } }
  </style>
</head>
<body>
  <div class="invoice-card">
    <div class="header">
      <div>
        <div class="title">PrintDrop Retail Core</div>
        <div style="font-size: 12px; color: #64748b;">Automated Counter Printing &amp; Retail POS Engine</div>
        <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">GSTIN: 27AABCT1234F1Z9 &bull; support@printdrop.in</div>
      </div>
      <div style="text-align: right;">
        <span class="badge">Official Tax Invoice</span>
        <div style="font-size: 14px; font-weight: 700; color: #1e293b; margin-top: 6px;">${rec.invoiceNumber}</div>
        <div style="font-size: 12px; color: #64748b;">Date: ${dateFormatted}</div>
      </div>
    </div>
    <div class="grid">
      <div class="box">
        <strong style="color: #4338ca; text-transform: uppercase; font-size: 11px;">Billed To (Licensed Station)</strong>
        <div style="font-size: 13px; font-weight: 700; margin-top: 4px;">${shop}</div>
        <div>Attn: ${owner}</div>
        <div>Contact: ${phone}</div>
        <div style="font-family: monospace; font-size: 11px; color: #64748b; margin-top: 4px;">HWID: ${rec.hwid}</div>
      </div>
      <div class="box">
        <strong style="color: #4338ca; text-transform: uppercase; font-size: 11px;">Payment &amp; Settlement</strong>
        <div style="margin-top: 4px;">Payment Method: <strong>${rec.paymentMode}</strong></div>
        <div style="font-family: monospace; word-break: break-all;">UTR / Ref: <strong>${rec.paymentReference}</strong></div>
        <div>Status: <strong style="color: #059669;">✓ ${rec.status}</strong></div>
      </div>
    </div>
    <table class="table">
      <thead>
        <tr>
          <th>Plan &amp; License Description</th>
          <th>Quota Credited</th>
          <th style="text-align: right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <strong>${rec.planName || rec.planCode}</strong>
            <div style="font-size: 11px; color: #64748b;">Hardware-bound station license quota</div>
          </td>
          <td>${quotaStr}</td>
          <td style="text-align: right; font-weight: 700;">${amountStr}</td>
        </tr>
        <tr class="total-row">
          <td colspan="2" style="text-align: right; padding-right: 14px;">Total Paid:</td>
          <td style="text-align: right; color: #4338ca;">${amountStr}</td>
        </tr>
      </tbody>
    </table>
    <div class="footer">
      This is a computer-generated tax invoice for PrintDrop software services. No physical signature is required.
    </div>
  </div>
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
      const a = document.createElement('a');
      a.href = url;
      a.download = `PrintDrop-Invoice-${rec.invoiceNumber}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setRawKeyInput('');
      setSuccessMsg(null);
      setErrorMsg(null);
      setIsCloudUnlocked(false);
      setCloudPasswordInput('');
      setCloudPasswordError(null);
      setShowUrlPlain(false);
      setShowKeyPlain(false);
      if (activeTab === 'CLOUD') {
        setActiveTab('OVERVIEW');
      }
      // Load local state immediately and auto-sync with cloud once on window open
      (async () => {
        await fetchLicenseState();
        await handleSyncCloud();
      })();
    }
  }, [isOpen]);

  // Active Sensing Polling when waiting for online payment confirmation
  useEffect(() => {
    let poller: any = null;
    if (isPaymentSensing && licenseState?.hwid) {
      const initialPages = licenseState.walletPagesRemaining ?? 0;
      const initialPlan = licenseState.planType;
      console.log('[PrintDrop Sensing] Started background payment sensor for HWID:', licenseState.hwid);

      poller = setInterval(async () => {
        try {
          const res = await invoke<HeartbeatResult>('sync_license_cloud');
          if (res.updatedLicense) {
            const updated = res.updatedLicense;
            const pagesChanged = (updated.walletPagesRemaining ?? 0) > initialPages;
            const planChanged = updated.planType !== initialPlan;

            if (pagesChanged || planChanged) {
              console.log('[PrintDrop Sensing] Detected license upgrade in cloud!', updated);
              setLicenseState(updated);
              setIsPaymentSensing(false);
              setActivePaymentUrl(null);
              setSelectedPlan(null);
              setQrDataUrl(null);
              setSuccessMsg(`✓ Payment confirmed & license upgraded to ${updated.planDisplayName}! Pages available: ${updated.walletPagesRemaining?.toLocaleString() || 'Unlimited'}`);
              if (onLicenseUpdated) onLicenseUpdated(updated);
            }
          }
        } catch (err) {
          console.warn('[PrintDrop Sensing] Ping error:', err);
        }
      }, 2500);
    }

    return () => {
      if (poller) clearInterval(poller);
    };
  }, [isPaymentSensing, licenseState?.hwid, licenseState?.walletPagesRemaining, licenseState?.planType, onLicenseUpdated]);

  // Window message listener for pay.html postMessage
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data && (event.data.type === 'PRINTDROP_CLOSE_GATEWAY' || event.data.type === 'PRINTDROP_DISMISS')) {
        setActivePaymentUrl(null);
        return;
      }

      if (event.data && event.data.type === 'PRINTDROP_PAYMENT_SUCCESS') {
        const { paymentId, amount, plan, pages } = event.data;
        console.log('[PrintDrop] Received payment success via postMessage:', event.data);
        
        // Auto-dismiss the payment gateway overlay so user sees the updated station dashboard
        setTimeout(() => {
          setActivePaymentUrl(null);
        }, 1200);

        if (licenseState?.hwid) {
          try {
            setUtrInput(paymentId);
            const msg = await invoke<string>('submit_license_payment_claim', {
              claim: {
                hwid: licenseState.hwid,
                requestedPlan: plan || selectedPlan?.code || 'WALLET_25',
                requestedPages: pages || selectedPlan?.pages || null,
                amountPaid: amount || selectedPlan?.amount || 75,
                paymentMode: 'RAZORPAY_CHECKOUT',
                paymentReference: paymentId,
              },
            });
            setClaimSuccessMsg(msg);
            setSuccessMsg(`✓ Payment of ₹${amount || selectedPlan?.amount || 75} received! Reference ID: ${paymentId}. Upgrading license...`);
            loadPaymentHistory();
            
            // Immediate sync attempt to pull the approved signed token
            const syncRes = await invoke<HeartbeatResult>('sync_license_cloud');
            if (syncRes.updatedLicense) {
              setLicenseState(syncRes.updatedLicense);
              setIsPaymentSensing(false);
              setActivePaymentUrl(null);
              setSelectedPlan(null);
              setQrDataUrl(null);
              setSuccessMsg(`✓ Payment of ₹${amount || selectedPlan?.amount || 75} confirmed! License upgraded to ${syncRes.updatedLicense.planDisplayName} (${syncRes.updatedLicense.walletPagesRemaining?.toLocaleString() || 'Unlimited'} Pages).`);
              if (onLicenseUpdated) onLicenseUpdated(syncRes.updatedLicense);
            }
          } catch (e: any) {
            console.error('Failed to submit claim on postMessage:', e);
          }
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [licenseState?.hwid, selectedPlan, onLicenseUpdated]);

  const handleCopyHwid = () => {
    if (!licenseState?.hwid) return;
    navigator.clipboard.writeText(licenseState.hwid);
    setCopiedHwid(true);
    setTimeout(() => setCopiedHwid(false), 2500);
  };

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawKeyInput.trim()) {
      setErrorMsg('Please paste the activation key received from your license administrator.');
      return;
    }

    try {
      setIsActivating(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      const updated = await invoke<LicenseStateDto>('activate_license_key', {
        request: {
          activationKey: rawKeyInput.trim(),
          shopName: shopNameInput.trim() || undefined,
          ownerName: ownerNameInput.trim() || undefined,
          phone: phoneInput.trim() || undefined,
        },
      });

      setLicenseState(updated);
      setSuccessMsg(`License successfully activated! Plan upgraded to: ${updated.planDisplayName}`);
      setRawKeyInput('');
      if (onLicenseUpdated) {
        onLicenseUpdated(updated);
      }
    } catch (err: any) {
      console.error('Activation failure:', err);
      setErrorMsg(typeof err === 'string' ? err : err?.message || 'Activation failed');
    } finally {
      setIsActivating(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSavingProfile(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      const updated = await invoke<LicenseStateDto>('update_station_profile', {
        shopName: shopNameInput.trim() || 'PrintDrop Retail Station',
        ownerName: ownerNameInput.trim() || null,
        phone: phoneInput.trim() || null,
      });

      setLicenseState(updated);
      setSuccessMsg('Shop contact details saved and synchronized!');
      if (onLicenseUpdated) onLicenseUpdated(updated);
    } catch (err: any) {
      setErrorMsg(typeof err === 'string' ? err : err?.message || 'Failed to update shop details');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSyncCloud = async () => {
    try {
      setIsSyncingCloud(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      const res = await invoke<HeartbeatResult>('sync_license_cloud');
      if (res.updatedLicense) {
        setLicenseState(res.updatedLicense);
        if (onLicenseUpdated) onLicenseUpdated(res.updatedLicense);
      }

      if (res.isRevoked) {
        setErrorMsg(res.message);
      } else if (res.isGraceActive) {
        setSuccessMsg(res.message);
      } else {
        setSuccessMsg(res.message);
      }

      // Refresh cloud config, provider payment config, and dynamic commercial plans
      const [freshCfg, freshProv, freshPlans] = await Promise.all([
        invoke<CloudConfig>('get_cloud_license_config'),
        invoke<ProviderPaymentConfig>('get_provider_payment_config').catch(() => null),
        invoke<CommercialPlansCatalog>('get_commercial_plans_config').catch(() => null),
      ]);
      setCloudConfig(freshCfg);
      if (freshProv) setProviderPaymentConfig(freshProv);
      if (freshPlans && Array.isArray(freshPlans.plans) && freshPlans.plans.length > 0) {
        setAvailablePlans(freshPlans.plans.filter((p) => p.isActive !== false));
        if (freshPlans.customRules) {
          setCustomRules(freshPlans.customRules);
          const freshMin = freshPlans.customRules.minPages || 200;
          setCustomPagesInput((prev) => Math.max(freshMin, prev));
          setCustomPagesDraft((prev) => Math.max(freshMin, parseInt(prev, 10) || freshMin).toString());
        }
      }
    } catch (err: any) {
      setErrorMsg(typeof err === 'string' ? err : err?.message || 'Cloud synchronization failed');
    } finally {
      setIsSyncingCloud(false);
    }
  };

  const handleSaveCloudConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSavingCloud(true);
      setErrorMsg(null);

      await invoke('save_cloud_license_config', {
        config: {
          supabaseUrl: supabaseUrlInput.trim(),
          supabaseAnonKey: supabaseKeyInput.trim(),
          syncEnabled: syncEnabledInput,
        },
      });

      setSuccessMsg('Cloud registry settings saved successfully!');
      const freshCfg = await invoke<CloudConfig>('get_cloud_license_config');
      setCloudConfig(freshCfg);
    } catch (err: any) {
      setErrorMsg(typeof err === 'string' ? err : err?.message || 'Failed to save cloud configuration');
    } finally {
      setIsSavingCloud(false);
    }
  };

  const handlePayOnline = async () => {
    if (!selectedPlan || !licenseState?.hwid) return;
    try {
      setErrorMsg(null);
      setSuccessMsg(null);

      const HARDCODED_PROVIDER_KEY = 'rzp_live_TvfyWRnZVTnIbK';
      let cfg = providerPaymentConfig;
      let keyId = (cfg?.razorpayKeyId || (cfg as any)?.razorpay_key_id || HARDCODED_PROVIDER_KEY).trim();

      // If not present in state, try fresh fetch from cloud right now
      if (!keyId) {
        try {
          const fresh = await invoke<ProviderPaymentConfig>('get_provider_payment_config');
          if (fresh) {
            setProviderPaymentConfig(fresh);
            cfg = fresh;
            keyId = (fresh.razorpayKeyId || (fresh as any)?.razorpay_key_id || '').trim();
          }
        } catch (e) {
          console.warn('Failed to refresh provider config:', e);
        }
      }

      if (!keyId) {
        keyId = HARDCODED_PROVIDER_KEY;
      }

      // Launch payment via verified domain registered in Razorpay KYC profile: technosoftsolution.github.io
      const planDisplayName = formatPlanDisplayName(selectedPlan);
      const paymentUrl = `https://technosoftsolution.github.io/printdrop-station/pay.html?hwid=${encodeURIComponent(licenseState.hwid)}&plan=${encodeURIComponent(selectedPlan.code)}&plan_name=${encodeURIComponent(planDisplayName)}&pages=${selectedPlan.pages || 0}&amount=${selectedPlan.amount}&name=${encodeURIComponent(ownerNameInput.trim() || shopNameInput.trim() || '')}&contact=${encodeURIComponent(phoneInput.trim())}&key_id=${encodeURIComponent(keyId)}`;

      setActivePaymentUrl(paymentUrl);
      setIsPaymentSensing(true);
      setSuccessMsg(`Opening secure online payment checkout for ₹${selectedPlan.amount}...`);
    } catch (err: any) {
      setErrorMsg(typeof err === 'string' ? err : err?.message || 'Failed to initiate payment');
    }
  };

  const handleShowQr = async () => {
    if (!selectedPlan) return;
    try {
      setIsGeneratingQr(true);
      setErrorMsg(null);
      const pngUrl = await invoke<string>('generate_license_payment_qr', {
        amount: selectedPlan.amount,
        planName: formatPlanDisplayName(selectedPlan),
      });
      setQrDataUrl(pngUrl);
      setSuccessMsg(`Scan official QR with PhonePe, Google Pay, or Paytm to pay ₹${selectedPlan.amount}.`);
    } catch (err: any) {
      setErrorMsg(typeof err === 'string' ? err : err?.message || 'Failed to generate payment QR');
    } finally {
      setIsGeneratingQr(false);
    }
  };

  const handleSubmitClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan || !licenseState?.hwid) return;
    if (utrInput.trim().length < 6) {
      setErrorMsg('Please enter a valid Bank UTR or Razorpay Payment Reference ID (at least 6 characters).');
      return;
    }

    try {
      setIsSubmittingClaim(true);
      setErrorMsg(null);
      setClaimSuccessMsg(null);

      const msg = await invoke<string>('submit_license_payment_claim', {
        claim: {
          hwid: licenseState.hwid,
          requestedPlan: selectedPlan.code,
          requestedPages: selectedPlan.pages || null,
          amountPaid: selectedPlan.amount,
          paymentMode: qrDataUrl ? 'RAZORPAY_QR' : 'ONLINE',
          paymentReference: utrInput.trim(),
        },
      });

      setClaimSuccessMsg(msg);
      setSuccessMsg(msg);
      setUtrInput('');
      setQrDataUrl(null);
      setSelectedPlan(null);
      fetchLicenseState();
    } catch (err: any) {
      setErrorMsg(typeof err === 'string' ? err : err?.message || 'Failed to submit payment claim to cloud');
    } finally {
      setIsSubmittingClaim(false);
    }
  };

  if (!isOpen) return null;

  const isTrial = licenseState?.planType === 'TRIAL';
  const isWallet = licenseState?.planType === 'WALLET_PAGES';
  const hasWallet = (licenseState?.walletPagesRemaining ?? 0) > 0;
  const hasTimeSub = Boolean(licenseState && licenseState.planType !== 'WALLET_PAGES' && licenseState.planType !== 'TRIAL' && licenseState.daysRemaining > 0);
  const isHybrid = hasWallet && hasTimeSub;
  const isExpired = licenseState && !licenseState.isValid;
  const isClockTampered = licenseState?.clockTampered;
  const isCloudConfigured = Boolean(cloudConfig?.supabaseUrl && cloudConfig?.supabaseAnonKey);

  return (
    <div className={`fixed inset-0 z-50 flex ${isMaximized ? 'bg-slate-950 p-0' : 'items-center justify-center p-4 bg-black/80 backdrop-blur-sm'} animate-fade-in transition-all duration-200`}>
      <div className={`relative flex flex-col bg-slate-900 ${isMaximized ? 'w-screen h-screen max-w-none max-h-none rounded-none border-none' : 'w-[95vw] max-w-6xl max-h-[92vh] border border-slate-700/80 rounded-2xl shadow-2xl'} overflow-hidden transition-all duration-200`}>
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl border ${
              isClockTampered || isExpired
                ? 'bg-red-500/10 border-red-500/30 text-red-400'
                : isTrial
                ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            }`}>
              {isExpired ? <ShieldAlert className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-wide">
                  Station Hardware ID &amp; License
                </h2>
                {licenseState && (
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                    isClockTampered
                      ? 'bg-red-950/80 border-red-700 text-red-300'
                      : isExpired
                      ? 'bg-red-950/80 border-red-700 text-red-300'
                      : isTrial
                      ? 'bg-blue-950/80 border-blue-700 text-blue-300'
                      : 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                  }`}>
                    {licenseState.status.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Station license status, plan validity &amp; print balance
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Sync Cloud Button */}
            <button
              onClick={handleSyncCloud}
              disabled={isSyncingCloud}
              title="Synchronize License with Cloud Registry"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 text-xs font-semibold transition"
            >
              <Radio className={`w-3.5 h-3.5 ${isSyncingCloud ? 'animate-pulse text-indigo-400' : ''}`} />
              <span className="hidden sm:inline">{isSyncingCloud ? 'Syncing...' : 'Sync Cloud'}</span>
            </button>

            {/* Maximize / Full Screen Button */}
            <button
              type="button"
              onClick={() => setIsMaximized(!isMaximized)}
              title={isMaximized ? "Restore Modal Size" : "Full Screen Workspace"}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/25 hover:bg-indigo-600/45 border border-indigo-500/40 text-indigo-200 text-xs font-bold transition shadow-sm cursor-pointer"
            >
              {isMaximized ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-indigo-300" />
                  <span className="hidden sm:inline">Exit Full Screen</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-indigo-300" />
                  <span className="hidden sm:inline">Full Screen</span>
                </>
              )}
            </button>

            <button
              onClick={fetchLicenseState}
              disabled={isLoading}
              title="Refresh License State"
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 px-6 border-b border-slate-800 bg-slate-950/40 text-xs overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab('OVERVIEW')}
            className={`px-4 py-2.5 font-bold border-b-2 transition flex items-center gap-2 cursor-pointer ${
              activeTab === 'OVERVIEW'
                ? 'border-indigo-400 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Station Overview</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('PLANS')}
            className={`px-4 py-2.5 font-bold border-b-2 transition flex items-center gap-2 cursor-pointer ${
              activeTab === 'PLANS'
                ? 'border-emerald-400 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Choose Plan &amp; Pay Online</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
              Recharge
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('PAYMENTS');
              loadPaymentHistory();
            }}
            className={`px-4 py-2.5 font-bold border-b-2 transition flex items-center gap-2 cursor-pointer ${
              activeTab === 'PAYMENTS'
                ? 'border-indigo-400 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-4 h-4 text-cyan-400" />
            <span>Payment &amp; Usage History</span>
            {paymentHistory.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold">
                {paymentHistory.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('OFFLINE_KEY')}
            className={`px-4 py-2.5 font-bold border-b-2 transition flex items-center gap-2 cursor-pointer ${
              activeTab === 'OFFLINE_KEY'
                ? 'border-indigo-400 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            <span>Offline Key</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('CLOUD');
              setCloudPasswordError(null);
            }}
            className={`px-4 py-2.5 font-bold border-b-2 transition flex items-center gap-2 cursor-pointer ${
              activeTab === 'CLOUD'
                ? 'border-indigo-400 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {isCloudUnlocked ? (
              <Unlock className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Lock className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span>Cloud Config</span>
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-slate-200">
          {/* Alerts */}
          {errorMsg && (
            <div className="p-3.5 bg-red-950/80 border border-red-800 rounded-xl text-red-200 text-xs sm:text-sm flex items-start gap-3 shadow-lg">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-bold">License Notice: </span>
                {errorMsg}
              </div>
              <button type="button" onClick={() => setErrorMsg(null)} className="text-red-300 hover:text-white p-0.5">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {successMsg && (activeTab === 'OVERVIEW' || activeTab === 'PLANS') && (
            <div className="p-3.5 bg-emerald-950/80 border border-emerald-800 rounded-xl text-emerald-200 text-xs sm:text-sm flex items-start gap-3 shadow-lg">
              <Check className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1">{successMsg}</div>
              <button type="button" onClick={() => setSuccessMsg(null)} className="text-emerald-300 hover:text-white p-0.5">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {claimSuccessMsg && (activeTab === 'OVERVIEW' || activeTab === 'PLANS') && (
            <div className="p-3.5 bg-blue-950/80 border border-blue-800 rounded-xl text-blue-200 text-xs sm:text-sm flex items-start gap-3 shadow-lg">
              <Radio className="w-5 h-5 text-blue-400 shrink-0 mt-0.5 animate-pulse" />
              <div className="flex-1 font-semibold">{claimSuccessMsg}</div>
              <button type="button" onClick={() => setClaimSuccessMsg(null)} className="text-blue-300 hover:text-white p-0.5">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* TAB 1: STATION OVERVIEW */}
          {activeTab === 'OVERVIEW' && (
            <div className="space-y-6">
              {/* Section 1: Machine Hardware ID (HWID) */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 relative overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                      <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                      <span>STATION HARDWARE IDENTIFIER (HWID)</span>
                    </div>
                    <div className="mt-1 font-mono text-base sm:text-lg font-bold text-indigo-300 tracking-wider select-all">
                      {licenseState?.hwid || 'Detecting hardware...'}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Share this ID with PrintDrop to obtain an activation key.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleCopyHwid}
                      disabled={!licenseState?.hwid}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 text-xs font-semibold transition active:scale-95 cursor-pointer"
                    >
                      {copiedHwid ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      <span>{copiedHwid ? 'Copied HWID!' : 'Copy Hardware ID'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('PLANS')}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-md active:scale-95 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                      <span>Upgrade Plan</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Dual-Plan Coexistence: Visual 2-Step Consumption Flow */}
              {isHybrid && licenseState && (
                <div className="p-4 rounded-xl bg-gradient-to-r from-blue-950/60 via-slate-900 to-emerald-950/60 border border-indigo-500/40 space-y-3 text-xs animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-white font-bold">
                      <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Dual-License Smart Priority Active</span>
                    </div>
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 self-start sm:self-auto flex items-center gap-1">
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Prepaid Wallet Protected</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3.5 rounded-xl bg-gradient-to-br from-blue-900/65 to-indigo-950/75 border border-blue-400/70 shadow-lg shadow-blue-950/50 ring-1 ring-blue-400/35 flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-blue-500/35 text-blue-100 uppercase">Step 1 • Consuming First</span>
                        </div>
                        <div className="font-bold text-white text-sm mt-1">{licenseState.planDisplayName}</div>
                        <div className="text-[11px] text-blue-100/90 mt-0.5">
                          Unlimited Prints active now ({licenseState.daysRemaining} days remaining)
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/30 text-blue-100 border border-blue-300/50 shrink-0 shadow-sm">
                        ● ACTIVE NOW
                      </span>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-900/45 border border-slate-700/50 opacity-70 flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase">Step 2 • Auto-Activates Next</span>
                        </div>
                        <div className="font-semibold text-slate-300 text-sm mt-1">
                          Prepaid Page Wallet ({licenseState.walletPagesRemaining?.toLocaleString()} pgs)
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Safely paused with zero expiry; resumes automatically after subscription finishes.
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800/90 text-slate-400 border border-slate-600/60 shrink-0">
                        ⏸ IN RESERVE
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Section 2: Active Plan & Quota Metrics */}
              {licenseState && (
                <div className={`grid grid-cols-1 sm:grid-cols-2 ${isHybrid ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-3`}>
                  {/* Plan Card */}
                  <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-700/60">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      <span>Current Plan</span>
                    </div>
                    <div className="mt-1 font-bold text-white text-sm truncate" title={licenseState.planDisplayName}>
                      {licenseState.planDisplayName}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Tenure: {licenseState.activeTenureDays} day(s) active
                    </div>
                  </div>

                  {/* Card B: Unlimited Subscription (Days Remaining) */}
                  {(!isWallet || isHybrid) && (
                    <div className={`p-3.5 rounded-xl border ${isHybrid ? 'bg-gradient-to-br from-blue-900/65 to-indigo-950/75 border-blue-400/70 shadow-lg shadow-blue-950/40 ring-1 ring-blue-400/35' : 'bg-slate-800/40 border-slate-700/60'}`}>
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5 text-xs text-slate-300">
                          <Calendar className="w-3.5 h-3.5 text-blue-400" />
                          <span>{isHybrid ? 'Subscription Plan' : 'Days Remaining'}</span>
                        </div>
                        {isHybrid && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/30 text-blue-100 border border-blue-300/50 uppercase">
                            Active Plan
                          </span>
                        )}
                      </div>
                      <div className="mt-1 font-bold text-white text-lg">
                        {licenseState.daysRemaining > 9000
                          ? 'Unlimited'
                          : `${licenseState.daysRemaining} days`}
                      </div>
                      <div className="text-[11px] text-blue-200/80 mt-0.5">
                        {licenseState.expiryDate ? `Expires: ${new Date(licenseState.expiryDate).toLocaleDateString()}` : 'Active Cycle'}
                      </div>
                    </div>
                  )}

                  {/* Card C: Prepaid Page Wallet */}
                  {(isWallet || isHybrid) && (
                    <div className={`p-3.5 rounded-xl border ${isHybrid ? 'bg-slate-900/40 border-slate-700/50 opacity-70' : 'bg-slate-800/40 border-slate-700/60'}`}>
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <CreditCard className={`w-3.5 h-3.5 ${isHybrid ? 'text-slate-400' : 'text-emerald-400'}`} />
                          <span>{isHybrid ? 'Page Wallet' : 'Pages Remaining'}</span>
                        </div>
                        {isHybrid && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-600/60 uppercase">
                            In Reserve
                          </span>
                        )}
                      </div>
                      <div className={`mt-1 font-bold text-lg ${isHybrid ? 'text-slate-300' : 'text-emerald-400'}`}>
                        {(licenseState.walletPagesRemaining?.toLocaleString() ?? '0')} pgs
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {isHybrid ? '⏸ Paused • Auto-activates next' : (licenseState.expiryDate ? `Expires: ${new Date(licenseState.expiryDate).toLocaleDateString()}` : 'No date expiration')}
                      </div>
                    </div>
                  )}

                  {/* Today's Prints Card */}
                  <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-700/60">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Clock className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Today's Prints</span>
                    </div>
                    <div className="mt-1 font-bold text-white text-lg">
                      {licenseState.todayPrints.toLocaleString()} <span className="text-xs font-normal text-slate-400">pgs</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Dispatched today
                    </div>
                  </div>

                  {/* Lifetime Prints Card */}
                  <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-700/60">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Printer className="w-3.5 h-3.5 text-purple-400" />
                      <span>Lifetime Prints</span>
                    </div>
                    <div className="mt-1 font-bold text-white text-lg">
                      {licenseState.lifetimePrints.toLocaleString()} <span className="text-xs font-normal text-slate-400">pgs</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Total metered volume
                    </div>
                  </div>
                </div>
              )}

              {/* Shop & Counter Business Details */}
              <div className="p-5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-bold text-white">
                    <Building2 className="w-4 h-4 text-indigo-400" />
                    <span>Shop &amp; Contact Details</span>
                  </div>
                  <span className="text-[11px] text-slate-400">Registered Shop Profile</span>
                </div>

                <form onSubmit={handleSaveProfile} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1 flex items-center gap-1.5">
                        <Building2 className="w-3 h-3 text-slate-400" />
                        <span>Shop / Counter Name</span>
                      </label>
                      <input
                        type="text"
                        value={shopNameInput}
                        onChange={(e) => setShopNameInput(e.target.value)}
                        placeholder="e.g. Apex Xerox &amp; Prints"
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1 flex items-center gap-1.5">
                        <User className="w-3 h-3 text-slate-400" />
                        <span>Owner / Manager Name</span>
                      </label>
                      <input
                        type="text"
                        value={ownerNameInput}
                        onChange={(e) => setOwnerNameInput(e.target.value)}
                        placeholder="e.g. Rajesh Kumar"
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1 flex items-center gap-1.5">
                        <PhoneCall className="w-3 h-3 text-slate-400" />
                        <span>Contact WhatsApp / Phone</span>
                      </label>
                      <input
                        type="text"
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        placeholder="e.g. +91 98765 43210"
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end pt-1">
                    <button
                      type="submit"
                      disabled={isSavingProfile}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 transition active:scale-95 cursor-pointer"
                    >
                      {isSavingProfile ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Saving &amp; Syncing...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Save Details &amp; Sync Cloud</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* TAB 2: CHOOSE PLAN & PAY ONLINE */}
          {activeTab === 'PLANS' && (
            <div className="space-y-6">
              {/* Category Segmented Switcher */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span>Select Commercial License Plan</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Choose between unlimited calendar duration or pay-per-page wallet packs.
                  </p>
                </div>

                <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800 shrink-0">
                  <button
                    type="button"
                    onClick={() => { setPlanCategoryTab('UNLIMITED'); setSelectedPlan(null); setQrDataUrl(null); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      planCategoryTab === 'UNLIMITED'
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Unlimited Time Plans</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setPlanCategoryTab('WALLET'); setSelectedPlan(null); setQrDataUrl(null); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      planCategoryTab === 'WALLET'
                        ? 'bg-amber-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>Pay-As-You-Go Packs</span>
                  </button>
                </div>
              </div>

              {/* Plans Grid */}
              <div className={`grid grid-cols-1 sm:grid-cols-2 ${planCategoryTab === 'WALLET' ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-3.5`}>
                {availablePlans.filter((p) => p.category === planCategoryTab).map((plan) => {
                  const isSelected = selectedPlan?.code === plan.code;
                  return (
                    <div
                      key={plan.code}
                      onClick={() => {
                        setSelectedPlan(plan);
                        setQrDataUrl(null);
                        if (plan.category === 'WALLET' && plan.pages) {
                          setCustomPagesInput(plan.pages);
                          setCustomPagesDraft(plan.pages.toString());
                        }
                      }}
                      className={`p-3.5 sm:p-4 rounded-xl border transition-all cursor-pointer relative flex flex-col justify-between ${
                        isSelected
                          ? 'bg-gradient-to-b from-indigo-950/60 to-slate-900 border-indigo-500 ring-2 ring-indigo-500/30 shadow-xl'
                          : 'bg-slate-950/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900/60'
                      }`}
                    >
                      <div className="space-y-2">
                        {/* Top Icon + Badge Row (Never Overlaps Title) */}
                        <div className="flex items-center justify-between gap-1.5 min-h-[22px]">
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
                            {plan.category === 'UNLIMITED' ? (
                              <Clock className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                            ) : (
                              <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            )}
                            <span>{plan.category === 'UNLIMITED' ? `${plan.durationDays || 30} Days` : `${plan.pages?.toLocaleString() || 0} Pgs`}</span>
                          </div>
                          {plan.badge && (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 whitespace-nowrap ${
                              plan.badge === 'Popular'
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : plan.badge === 'Best Value'
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                : plan.badge === 'Min Option' || plan.badge === 'Min Pack'
                                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                                : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                            }`}>
                              {plan.badge}
                            </span>
                          )}
                        </div>

                        <div className="text-sm sm:text-[15px] font-bold text-white leading-snug tracking-tight">
                          {formatPlanDisplayName(plan)}
                        </div>

                        <div className="text-2xl sm:text-[26px] font-black text-white pt-0.5 tracking-tight">
                          ₹{plan.amount}
                        </div>

                        <div className="text-xs sm:text-[13px] font-bold text-emerald-400 tracking-tight flex items-center gap-1">
                          {plan.perMonthOrPage || (plan.pages && plan.pages > 0 ? `₹${(plan.amount / plan.pages).toFixed(2)} per page` : '')}
                        </div>

                        <p className="text-[11px] text-slate-400 pt-0.5 leading-relaxed font-normal">
                          {plan.description}
                        </p>
                      </div>

                      <div className="pt-3">
                        <button
                          type="button"
                          className={`w-full py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                            isSelected
                              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {isSelected ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Selected</span>
                            </>
                          ) : (
                            <span>Choose Plan</span>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Custom Pay-As-You-Go Pack Builder */}
              {planCategoryTab === 'WALLET' && (() => {
                const currentPages = customPagesInput;
                const currentAmount = getCustomPageAmount(currentPages);
                const currentRate = getCustomPageRate(currentPages);
                const activeTierIdx = getActiveTierIndex(currentPages);
                const upsell = getUpsellRecommendation(currentPages);
                const baseRate = customRules.tier1Rate || 0.40;

                const tierSlabs = [
                  {
                    idx: 0,
                    label: 'Tier 1',
                    range: `${customRules.minPages || 200} – ${customRules.tier1MaxPages || 499} pgs`,
                    milestone: customRules.minPages || 200,
                    rate: customRules.tier1Rate || 0.40,
                    rateText: `${Math.round((customRules.tier1Rate || 0.40) * 100)}p`,
                    badge: 'Base Rate',
                    badgeColor: 'text-slate-400 bg-slate-800/80 border-slate-700',
                  },
                  {
                    idx: 1,
                    label: 'Tier 2',
                    range: `500 – ${customRules.tier2MaxPages || 1999} pgs`,
                    milestone: 500,
                    rate: customRules.tier2Rate || 0.30,
                    rateText: `${Math.round((customRules.tier2Rate || 0.30) * 100)}p`,
                    badge: `Save ${Math.max(1, Math.round((1 - (customRules.tier2Rate || 0.30) / baseRate) * 100))}%`,
                    badgeColor: 'text-emerald-300 bg-emerald-500/20 border-emerald-500/30',
                  },
                  {
                    idx: 2,
                    label: 'Tier 3',
                    range: `2,000 – ${customRules.tier3MaxPages || 4999} pgs`,
                    milestone: 2000,
                    rate: customRules.tier3Rate || 0.20,
                    rateText: `${Math.round((customRules.tier3Rate || 0.20) * 100)}p`,
                    badge: `Save ${Math.max(1, Math.round((1 - (customRules.tier3Rate || 0.20) / baseRate) * 100))}%`,
                    badgeColor: 'text-cyan-300 bg-cyan-500/20 border-cyan-500/30',
                  },
                  {
                    idx: 3,
                    label: 'Tier 4',
                    range: `5,000 – ${customRules.tier4MaxPages || 9999} pgs`,
                    milestone: 5000,
                    rate: customRules.tier4Rate || 0.15,
                    rateText: `${Math.round((customRules.tier4Rate || 0.15) * 100)}p`,
                    badge: `Save ${Math.max(1, Math.round((1 - (customRules.tier4Rate || 0.15) / baseRate) * 100))}%`,
                    badgeColor: 'text-indigo-300 bg-indigo-500/20 border-indigo-500/30',
                  },
                  {
                    idx: 4,
                    label: 'Tier 5',
                    range: '10,000+ pgs',
                    milestone: 10000,
                    rate: customRules.tier5Rate || 0.10,
                    rateText: `${Math.round((customRules.tier5Rate || 0.10) * 100)}p`,
                    badge: `Save ${Math.max(1, Math.round((1 - (customRules.tier5Rate || 0.10) / baseRate) * 100))}%`,
                    badgeColor: 'text-amber-300 bg-amber-500/20 border-amber-500/30 font-black',
                  },
                ];

                const currentDiscountPercent = Math.round((1 - currentRate / baseRate) * 100);

                return (
                  <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-amber-950/20 via-slate-900 to-slate-950 border border-amber-500/40 shadow-xl space-y-4">
                    {/* Header Row */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <Sliders className="w-4 h-4 text-amber-400" />
                          <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">Custom Pay-As-You-Go Calculator</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                            Min {customRules.minPages || 200} Pages • ₹{getCustomPageAmount(customRules.minPages || 200)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Prepaid lifetime page balance • No monthly expiry date • Dynamic volume discount applies automatically.
                        </p>
                      </div>

                      {/* Quick Select Buttons */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-slate-400 font-bold mr-1">Quick Picks:</span>
                        {(customRules.quickPicks && customRules.quickPicks.length > 0 ? customRules.quickPicks : [200, 500, 2000, 5000, 10000]).map((p) => {
                          const amt = getCustomPageAmount(p);
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={() => handleSelectCustomPack(p)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                                selectedPlan?.code === `WALLET_CUSTOM_${p}` || (selectedPlan?.code === 'WALLET_200' && p === 200)
                                  ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700'
                              }`}
                            >
                              {p.toLocaleString()} Pgs (₹{amt})
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Upfront Volume Discount Slabs Visual Strip */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-slate-300 flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-amber-400" />
                          <span>Volume Discount Tiers (Bigger Volume = Lower Per-Page Rate):</span>
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium hidden sm:inline">Tap any tier to select milestone</span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        {tierSlabs.map((slab) => {
                          const isActive = activeTierIdx === slab.idx;
                          return (
                            <div
                              key={slab.idx}
                              onClick={() => handleSelectCustomPack(slab.milestone)}
                              className={`p-2.5 rounded-xl border transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between ${
                                isActive
                                  ? 'bg-gradient-to-b from-emerald-950/90 to-slate-950 border-emerald-500 ring-2 ring-emerald-500/50 shadow-lg shadow-emerald-950/60'
                                  : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 hover:bg-slate-850'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1 mb-1">
                                <span className={`text-[11px] font-black uppercase tracking-wide ${isActive ? 'text-emerald-400' : 'text-slate-400'}`}>
                                  {slab.label}
                                </span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${slab.badgeColor}`}>
                                  {slab.badge}
                                </span>
                              </div>

                              <div className="my-0.5 space-y-0.5">
                                <div className="flex items-baseline gap-1">
                                  <span className={`text-lg sm:text-xl font-black tracking-tight ${isActive ? 'text-emerald-300' : 'text-white'}`}>
                                    {slab.rateText}
                                  </span>
                                  <span className="text-[11px] font-bold text-slate-400">/ pg</span>
                                </div>
                                <div className="text-[11px] sm:text-xs font-bold text-slate-200 tracking-tight">
                                  {slab.range}
                                </div>
                              </div>

                              {isActive && (
                                <div className="mt-1.5 pt-1 border-t border-emerald-800/60 text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span>Active Tier</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Smart Upsell Nudge Alert */}
                    {upsell && (
                      <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-950/90 via-slate-900 to-emerald-950/80 border border-emerald-500/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs animate-fade-in shadow-lg shadow-emerald-950/40">
                        <div className="flex items-center gap-2.5 text-emerald-300">
                          <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span>
                            {upsell.savings > 0 ? (
                              <>
                                <strong>Smart Upsell:</strong> Unlock <strong>{upsell.targetPages.toLocaleString()} pages</strong> for only <strong>₹{upsell.targetCost}</strong> ({upsell.targetRate}/pg) — get <strong>{upsell.extraPages.toLocaleString()} more pages</strong> and <span className="text-emerald-200 underline font-bold">SAVE ₹{upsell.savings}</span>!
                              </>
                            ) : (
                              <>
                                <strong>Volume Tip:</strong> Add <strong>{upsell.extraPages.toLocaleString()} more pages</strong> ({upsell.targetPages.toLocaleString()} pgs total) for just <strong>₹{upsell.priceDiff} more</strong> at the lower rate of <strong>{upsell.targetRate}/pg</strong>!
                              </>
                            )}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSelectCustomPack(upsell.targetPages)}
                          className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shrink-0 cursor-pointer shadow-sm transition"
                        >
                          Get {upsell.targetPages.toLocaleString()} Pgs (₹{upsell.targetCost}) →
                        </button>
                      </div>
                    )}

                    {/* Input, Rate Highlight & Action Row */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-3 border-t border-slate-800/80">
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="text-xs font-bold text-slate-300">Custom Pages:</label>
                        <div className="flex items-center bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 focus-within:border-amber-500 transition">
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={customPagesDraft}
                            placeholder={String(customRules.minPages || 200)}
                            onChange={(e) => {
                              // Only allow whole digits (no decimal points, signs, or non-digits)
                              const cleaned = e.target.value.replace(/\D/g, '');
                              setCustomPagesDraft(cleaned);

                              // If shopkeeper typed a valid integer >= minPages, update live calculation immediately!
                              const minP = customRules.minPages || 200;
                              const parsed = parseInt(cleaned, 10);
                              if (!isNaN(parsed) && parsed >= minP) {
                                setCustomPagesInput(Math.min(50000, parsed));
                              }
                            }}
                            onBlur={() => {
                              // When shopkeeper clicks away or defocuses, enforce the minimum page requirement cleanly!
                              const minP = customRules.minPages || 200;
                              const parsed = parseInt(customPagesDraft, 10);
                              if (isNaN(parsed) || parsed < minP) {
                                setCustomPagesDraft(minP.toString());
                                setCustomPagesInput(minP);
                              } else {
                                const clamped = Math.min(50000, parsed);
                                setCustomPagesDraft(clamped.toString());
                                setCustomPagesInput(clamped);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                            className="w-20 bg-transparent text-white font-black text-xs sm:text-sm outline-none"
                          />
                          <span className="text-xs text-slate-400 font-semibold ml-1">pages</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 font-bold">=</span>
                          <span className="text-base sm:text-lg font-black text-white">₹{currentAmount}</span>
                        </div>

                        {/* Prominent Bold Rate Callout */}
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-950/70 border border-emerald-500/50 shadow-inner">
                          <span className="text-[10px] text-slate-400 font-medium">Applied Rate:</span>
                          <strong className="text-xs sm:text-[13px] font-bold text-emerald-300">
                            {currentRate >= 1 ? `₹${currentRate.toFixed(2)}` : `${Math.round(currentRate * 100)} paise`}
                            <span className="text-[10px] font-normal text-emerald-400"> / pg</span>
                          </strong>
                          {currentDiscountPercent > 0 && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 ml-0.5">
                              Save {currentDiscountPercent}%
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          const minP = customRules.minPages || 200;
                          const parsed = parseInt(customPagesDraft, 10);
                          const finalPages = isNaN(parsed) || parsed < minP ? minP : Math.min(50000, parsed);
                          handleSelectCustomPack(finalPages);
                        }}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                          selectedPlan?.code === `WALLET_CUSTOM_${customPagesInput}`
                            ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                            : 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>
                          {selectedPlan?.code === `WALLET_CUSTOM_${customPagesInput}`
                            ? `Selected (${customPagesInput.toLocaleString()} Pgs • ₹${currentAmount})`
                            : `Select Custom Pack (${customPagesInput.toLocaleString()} Pgs • ₹${currentAmount})`}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Selected Plan Checkout Box */}
              {selectedPlan && (
                <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-indigo-500/40 shadow-2xl space-y-5 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                    <div>
                      <span className="text-[11px] uppercase tracking-wider font-bold text-indigo-400">Order Summary</span>
                      <h4 className="text-base font-bold text-white flex items-center gap-2">
                        <span>{formatPlanDisplayName(selectedPlan)}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          {selectedPlan.category === 'UNLIMITED' ? 'Unlimited Prints' : `${selectedPlan.pages} Pages`}
                        </span>
                      </h4>
                    </div>

                    <div className="text-left sm:text-right">
                      <span className="text-[11px] text-slate-400 block">Total Payable to Provider</span>
                      <span className="text-2xl font-black text-emerald-400">₹{selectedPlan.amount}.00</span>
                    </div>
                  </div>

                  {/* Two Payment Options */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Method 1: Instant UPI Intent */}
                    <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-2 text-xs font-bold text-white">
                          <Zap className="w-4 h-4 text-amber-400" />
                          <span>Method 1: Pay Online (Instant UPI Intent)</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Launches Razorpay checkout for instant payment via PhonePe, GPay, Paytm, BHIM or Net Banking.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={handlePayOnline}
                        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg transition active:scale-95 cursor-pointer flex items-center justify-center gap-2"
                      >
                        <Zap className="w-4 h-4 text-amber-300" />
                        <span>Pay ₹{selectedPlan.amount} via UPI / Apps &rarr;</span>
                      </button>
                    </div>

                    {/* Method 2: Razorpay Official Fixed BharatQR */}
                    <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-2 text-xs font-bold text-white">
                          <QrCode className="w-4 h-4 text-emerald-400" />
                          <span>Method 2: Razorpay Official BharatQR</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Displays official merchant payment QR. Scan with PhonePe, GPay, Paytm or BHIM; no timer.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={handleShowQr}
                        disabled={isGeneratingQr}
                        className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs transition active:scale-95 cursor-pointer flex items-center justify-center gap-2"
                      >
                        <QrCode className="w-4 h-4 text-emerald-400" />
                        <span>{isGeneratingQr ? 'Loading QR...' : `Show QR Code (₹${selectedPlan.amount})`}</span>
                      </button>
                    </div>
                  </div>

                  {/* QR Display Container */}
                  {qrDataUrl && (
                    <div className="p-4 rounded-xl bg-slate-950 border border-emerald-500/40 flex flex-col items-center justify-center space-y-3 animate-fade-in relative">
                      <div className="flex items-center justify-between w-full max-w-xs text-xs text-slate-300 pb-2 border-b border-slate-800">
                        <span className="font-bold flex items-center gap-1.5 text-emerald-400">
                          <ShieldCheck className="w-4 h-4 text-emerald-400" />
                          <span>Official UPI Payment QR</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setQrDataUrl(null)}
                          className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer flex items-center gap-1 text-[11px]"
                          title="Close QR Code"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Dismiss</span>
                        </button>
                      </div>

                      <div className="p-3 bg-white rounded-xl shadow-2xl">
                        <img src={qrDataUrl} alt="License Payment QR" className="w-48 h-48 object-contain" />
                      </div>

                      <div className="text-center text-[11px] text-slate-400 space-y-0.5">
                        <div>
                          Payee: <strong className="text-white">{providerPaymentConfig?.businessName || 'TechnoSoft Solution'}</strong> &bull; <span className="font-mono text-cyan-400">{providerPaymentConfig?.upiId || 'satishharilalpa302866.rzp@rxairtel'}</span>
                        </div>
                        <div className="text-emerald-400 font-bold">
                          Amount to Pay: ₹{selectedPlan.amount}.00
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Payment Verification & Claim Submission Form */}
                  <form onSubmit={handleSubmitClaim} className="pt-3 border-t border-slate-800 space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center justify-between">
                        <span>Enter 12-Digit Bank UTR / Razorpay Payment Reference ID <span className="text-red-400">*</span></span>
                        <span className="text-[10px] text-slate-400 font-normal">Found in UPI App success screen</span>
                      </label>
                      <input
                        type="text"
                        value={utrInput}
                        onChange={(e) => setUtrInput(e.target.value)}
                        placeholder="e.g. 431289102391 or pay_Pxxxxxxxx"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 font-mono text-xs text-white focus:outline-none focus:border-emerald-500 transition"
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                      <p className="text-[11px] text-slate-400">
                        Submits your payment reference for instant license activation.
                      </p>

                      <button
                        type="submit"
                        disabled={isSubmittingClaim || !utrInput.trim()}
                        className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs shadow-lg transition active:scale-95 cursor-pointer disabled:cursor-not-allowed shrink-0 flex items-center justify-center gap-2"
                      >
                        {isSubmittingClaim ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>Submitting to Cloud...</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-4 h-4" />
                            <span>Submit Payment for Activation</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* TAB: PAYMENT & USAGE HISTORY */}
          {activeTab === 'PAYMENTS' && (
            <div className="space-y-4">
              {/* Header Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                    <History className="w-4 h-4 text-cyan-400" />
                    <span>PAYMENT &amp; DAILY PRINT USAGE HISTORY</span>
                  </div>
                  <h3 className="text-base font-bold text-white mt-1">Verified Purchases &amp; Daily Print Ledger</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Permanent record of plan purchases, tax invoices, and day-by-day print volume tracking.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsMaximized(!isMaximized)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 text-xs font-bold transition shadow-sm cursor-pointer"
                  >
                    {isMaximized ? (
                      <>
                        <Minimize2 className="w-3.5 h-3.5 text-indigo-300" />
                        <span>Exit Full Screen</span>
                      </>
                    ) : (
                      <>
                        <Maximize2 className="w-3.5 h-3.5 text-indigo-300" />
                        <span>Full Screen Ledger</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={loadPaymentHistory}
                    disabled={isLoadingPayments}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition active:scale-95 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingPayments ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {/* Ledger Records */}
              {isLoadingPayments && paymentHistory.length === 0 ? (
                <div className="p-8 text-center bg-slate-900/40 rounded-xl border border-slate-800 space-y-2">
                  <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin mx-auto" />
                  <p className="text-xs text-slate-400">Loading payment history ledger...</p>
                </div>
              ) : paymentHistory.length === 0 ? (
                <div className="p-8 text-center bg-slate-900/40 rounded-xl border border-slate-800 space-y-3">
                  <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                    <Receipt className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">No Payment Records Yet</h4>
                    <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                      When you purchase or renew a subscription or pay-as-you-go wallet pack, verified tax invoices, bank settlement UTR numbers, and receipt records will appear here.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('PLANS')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-md cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Choose a Plan to Get Started</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {(() => {
                    const verifiedRecs = paymentHistory.filter(
                      (r) => r.status === 'VERIFIED_PAID' || r.status === 'COMPLETED'
                    );
                    const latestActiveSubId = hasTimeSub
                      ? verifiedRecs.find((r) => !r.planCode.startsWith('WALLET_') && r.planCode !== 'TRIAL')?.id
                      : undefined;
                    const latestActiveWalletId = hasWallet
                      ? verifiedRecs.find((r) => r.planCode.startsWith('WALLET_'))?.id
                      : undefined;

                    return paymentHistory.map((rec) => {
                      const isExpanded = expandedPaymentId === rec.id;
                      const isVerified = rec.status === 'VERIFIED_PAID' || rec.status === 'COMPLETED';
                      const isPending = rec.status === 'PENDING_VERIFICATION' || rec.status === 'PAYMENT_SUBMITTED';
                      const isCurrentlyActivePlan =
                        (hasTimeSub && rec.id === latestActiveSubId) ||
                        (!hasTimeSub && isWallet && rec.id === latestActiveWalletId);
                      const isReservePlan = isHybrid && rec.id === latestActiveWalletId;

                      return (
                        <div
                          key={rec.id}
                          className={`group rounded-xl border border-l-4 transition-all duration-200 overflow-hidden ${
                            isExpanded
                              ? 'bg-slate-950 border-indigo-400/70 border-l-indigo-400 shadow-xl shadow-indigo-950/40 ring-1 ring-indigo-500/30'
                              : isCurrentlyActivePlan
                              ? 'bg-slate-800/80 border-blue-500/50 border-l-blue-400 shadow-lg shadow-black/40 hover:-translate-y-0.5 hover:border-blue-400/80 hover:shadow-xl'
                              : isReservePlan
                              ? 'bg-slate-800/55 border-slate-700/80 border-l-slate-500 shadow-md shadow-black/30 opacity-85 hover:opacity-100 hover:-translate-y-0.5 hover:border-indigo-400/50'
                              : 'bg-slate-800/70 border-slate-700/80 border-l-slate-500 shadow-md shadow-black/30 hover:-translate-y-0.5 hover:border-indigo-400/50 hover:shadow-lg'
                          }`}
                        >
                        {/* Collapsed Header (Always Visible) */}
                        <div
                          onClick={() => {
                            const nextId = isExpanded ? null : rec.id;
                            setExpandedPaymentId(nextId);
                            if (nextId) {
                              loadPaymentUsage(nextId);
                            }
                          }}
                          className={`p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer select-none transition ${
                            isExpanded ? 'bg-indigo-950/50 border-b border-indigo-500/30' : 'hover:bg-slate-800/90'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                                isVerified
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                  : isPending
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                  : 'bg-slate-800 text-slate-400 border border-slate-700'
                              }`}
                            >
                              {isVerified ? (
                                <CheckCircle2 className="w-5 h-5" />
                              ) : isPending ? (
                                <Clock className="w-5 h-5 animate-pulse" />
                              ) : (
                                <Receipt className="w-5 h-5" />
                              )}
                            </div>

                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-bold text-white tracking-wide">
                                  {rec.planName || rec.planCode}
                                </span>
                                {isVerified ? (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                                    <Check className="w-2.5 h-2.5" />
                                    <span>Verified Paid</span>
                                  </span>
                                ) : isPending ? (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                                    <Clock className="w-2.5 h-2.5" />
                                    <span>Verification Pending</span>
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                                    {rec.status}
                                  </span>
                                )}
                                {isCurrentlyActivePlan && (
                                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-500/25 text-blue-200 border border-blue-400/50 flex items-center gap-1 animate-pulse">
                                    <span>● ACTIVE NOW</span>
                                  </span>
                                )}
                                {isReservePlan && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                                    ⏸ IN RESERVE (Auto-activates next)
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                                <span>
                                  {new Date(rec.createdAt).toLocaleDateString('en-IN', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                  })}{' '}
                                  at{' '}
                                  {new Date(rec.createdAt).toLocaleTimeString('en-IN', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hour12: true,
                                  })}
                                </span>
                                <span>&bull;</span>
                                <span className="font-mono text-slate-300 text-[10px]">{rec.invoiceNumber}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                            <div className="text-right">
                              <div className="text-base font-extrabold text-white">
                                ₹{Number(rec.amountPaid || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </div>
                              <span className="text-[10px] text-slate-400 px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 font-mono">
                                {rec.paymentMode.replace(/_/g, ' ')}
                              </span>
                            </div>

                            <button
                              type="button"
                              className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 transition shrink-0 ${
                                isExpanded
                                  ? 'bg-indigo-600/30 border-indigo-400/60 text-indigo-200'
                                  : 'bg-slate-700/70 border-slate-600/70 text-slate-200 group-hover:bg-indigo-600/30 group-hover:border-indigo-400/50 group-hover:text-white'
                              }`}
                            >
                              <span>{isExpanded ? 'Hide Details' : 'View Details & Usage'}</span>
                              {isExpanded ? (
                                <ChevronUp className="w-3.5 h-3.5 text-indigo-300" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-slate-300 group-hover:text-indigo-200" />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Expanded Granular Details */}
                        {isExpanded && (
                          <div className="px-4 pb-4 pt-3 bg-slate-950/90 space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                              {/* Item 1: Invoice Number */}
                              <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800/80 space-y-1">
                                <span className="text-[10px] font-semibold text-slate-400 block">TAX INVOICE NUMBER</span>
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-mono font-bold text-white text-xs">{rec.invoiceNumber}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigator.clipboard.writeText(rec.invoiceNumber);
                                    }}
                                    title="Copy Invoice Number"
                                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              {/* Item 2: Payment Reference / UTR */}
                              <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800/80 space-y-1">
                                <span className="text-[10px] font-semibold text-slate-400 block">BANK UTR / PAYMENT REF</span>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-mono font-bold text-cyan-300 text-xs break-all select-all">
                                    {rec.paymentReference || 'DIRECT-VERIFIED'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigator.clipboard.writeText(rec.paymentReference || '');
                                    }}
                                    title="Copy Payment Reference"
                                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer shrink-0"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              {/* Item 3: Gateway / Channel */}
                              <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800/80 space-y-1">
                                <span className="text-[10px] font-semibold text-slate-400 block">SETTLEMENT METHOD</span>
                                <span className="font-bold text-slate-200 text-xs block">
                                  {rec.paymentMode === 'RAZORPAY_CHECKOUT'
                                    ? 'Razorpay UPI / Netbanking'
                                    : rec.paymentMode === 'RAZORPAY_QR'
                                    ? 'Merchant Standee BharatQR'
                                    : rec.paymentMode}
                                </span>
                              </div>

                              {/* Item 4: Quota Credited */}
                              <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800/80 space-y-1">
                                <span className="text-[10px] font-semibold text-slate-400 block">BENEFITS CREDITED</span>
                                <span className="font-bold text-emerald-400 text-xs block">
                                  {rec.pagesGranted
                                    ? `+${rec.pagesGranted.toLocaleString()} Pages in Wallet`
                                    : rec.durationDays
                                    ? `+${rec.durationDays} Days Unlimited`
                                    : 'Unlimited Plan'}
                                </span>
                              </div>
                            </div>

                            {/* Action Buttons: Print Bill / Export */}
                            <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-800/60">
                              <div className="text-[11px] text-slate-400">
                                Station HWID: <span className="font-mono text-slate-300">{rec.hwid}</span>
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setReceiptModalPayment(rec);
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-md active:scale-95 cursor-pointer"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                  <span>Print / View Invoice</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    exportReceiptAsHtml(rec);
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition active:scale-95 cursor-pointer"
                                >
                                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Export PDF / Bill</span>
                                </button>
                              </div>
                            </div>

                            {/* === DAILY PRINT USAGE BREAKDOWN (LEDGER) === */}
                            <div className="pt-3 border-t border-slate-800/80 space-y-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                                  <span className="text-xs font-bold text-white tracking-wide uppercase">
                                    Daily Print Usage Breakdown
                                  </span>
                                  <span className="text-[10px] text-slate-400">
                                    • Log of actual printed pages under this license
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    loadPaymentUsage(rec.id);
                                  }}
                                  className="text-[10px] text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1 cursor-pointer bg-slate-900 px-2 py-0.5 rounded border border-slate-700/60 transition"
                                >
                                  <RefreshCw className={`w-3 h-3 ${isLoadingUsageMap[rec.id] ? "animate-spin" : ""}`} />
                                  <span>Sync Usage</span>
                                </button>
                              </div>

                              {/* Quota Progress Bar (if Wallet Pack) */}
                              {usageSummaryMap[rec.id]?.isWalletPlan && usageSummaryMap[rec.id]?.totalQuotaGranted && (
                                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1.5">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-slate-400 font-medium">Wallet Pages Consumption:</span>
                                    <span className="font-mono font-bold text-emerald-400">
                                      {usageSummaryMap[rec.id]?.totalPagesConsumed.toLocaleString()} / {usageSummaryMap[rec.id]?.totalQuotaGranted?.toLocaleString()} Pages ({
                                        Math.min(100, Math.round(((usageSummaryMap[rec.id]?.totalPagesConsumed || 0) / (usageSummaryMap[rec.id]?.totalQuotaGranted || 1)) * 100))
                                      }%)
                                    </span>
                                  </div>
                                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                                    <div
                                      className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-full transition-all duration-500"
                                      style={{
                                        width: `${Math.min(100, Math.max(2, Math.round(((usageSummaryMap[rec.id]?.totalPagesConsumed || 0) / (usageSummaryMap[rec.id]?.totalQuotaGranted || 1)) * 100)))}%`
                                      }}
                                    />
                                  </div>
                                </div>
                              )}

                              {/* Daily Usage Rows */}
                              {isLoadingUsageMap[rec.id] && !usageSummaryMap[rec.id] ? (
                                <div className="p-4 text-center bg-slate-900/40 rounded-lg border border-slate-800 space-y-1.5">
                                  <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin mx-auto" />
                                  <p className="text-[11px] text-slate-400">Loading daily print usage breakdown...</p>
                                </div>
                              ) : !usageSummaryMap[rec.id] || usageSummaryMap[rec.id]?.dailyRecords.length === 0 ? (
                                <div className="p-3.5 text-center bg-slate-900/40 rounded-lg border border-slate-800/80 text-xs text-slate-400">
                                  <span>● No customer prints recorded yet under this license pack. Ready for your first print drop!</span>
                                </div>
                              ) : (
                                <div className="space-y-1.5">
                                  {usageSummaryMap[rec.id]?.dailyRecords.map((day) => (
                                    <div
                                      key={day.date}
                                      className={`p-2.5 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs transition ${
                                        day.isToday
                                          ? "bg-cyan-950/30 border-cyan-500/40"
                                          : "bg-slate-900/60 border-slate-800/90 hover:border-slate-700/80"
                                      }`}
                                    >
                                      {/* Left: Date / Time */}
                                      <div className="flex items-center gap-2 min-w-[170px]">
                                        <div className={`w-2 h-2 rounded-full shrink-0 ${day.isToday ? "bg-cyan-400 animate-pulse" : "bg-slate-500"}`} />
                                        <div>
                                          <div className="font-bold text-white flex items-center gap-1.5">
                                            <span>{day.displayDate}</span>
                                            {day.isToday && (
                                              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 uppercase">
                                                Today
                                              </span>
                                            )}
                                          </div>
                                          {day.timeRange && (
                                            <div className="text-[10px] text-slate-400 mt-0.5">
                                              Active: {day.timeRange}
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      {/* Center: Total Prints printed on that day */}
                                      <div className="sm:text-center min-w-[130px]">
                                        <div className="font-extrabold text-white text-sm">
                                          {day.dayPages.toLocaleString()} <span className="text-xs font-semibold text-slate-300">pages</span>
                                        </div>
                                        <div className="text-[10px] text-slate-400 mt-0.5">
                                          {day.dayOrdersCount} order{day.dayOrdersCount === 1 ? "" : "s"} processed
                                        </div>
                                      </div>

                                      {/* Right Corner: Cumulative total & Remaining (Wallet vs Monthly) */}
                                      <div className="sm:text-right min-w-[170px]">
                                        {/* First line: Cumulative prints */}
                                        <div className="font-bold text-white text-xs">
                                          {usageSummaryMap[rec.id]?.isWalletPlan ? (
                                            <span>
                                              {day.cumulativePages.toLocaleString()}
                                              {usageSummaryMap[rec.id]?.totalQuotaGranted ? ` / ${usageSummaryMap[rec.id]?.totalQuotaGranted?.toLocaleString()} pgs` : " pgs"}
                                            </span>
                                          ) : (
                                            <span>{day.cumulativePages.toLocaleString()} total prints</span>
                                          )}
                                        </div>

                                        {/* Second line: Days left for Monthly or Pages remaining for Wallet */}
                                        <div className="text-[11px] font-bold mt-0.5">
                                          {usageSummaryMap[rec.id]?.isWalletPlan ? (
                                            <span className={(day.quotaRemainingPages ?? 0) <= 50 ? "text-amber-400" : "text-emerald-400"}>
                                              {(day.quotaRemainingPages ?? 0).toLocaleString()} pages remaining
                                            </span>
                                          ) : (
                                            <span className="text-cyan-400">
                                              {day.daysLeft != null ? `${day.daysLeft} days left` : "Active Cycle"}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Collapse Usage Bar */}
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedPaymentId(null);
                                }}
                                className="pt-1.5 text-center cursor-pointer text-[11px] font-semibold text-slate-400 hover:text-white transition flex items-center justify-center gap-1"
                              >
                                <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                                <span>Collapse Usage History</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  });
                  })()}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: OFFLINE ACTIVATION KEY */}
          {activeTab === 'OFFLINE_KEY' && (
            <div className="p-5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                <span>Enter Activation Key</span>
              </div>
              <p className="text-xs text-slate-400">
                Share your Hardware ID (<span className="font-mono text-indigo-300">{licenseState?.hwid}</span>) with PrintDrop Support on WhatsApp to receive your activation key.
              </p>

              <form onSubmit={handleActivate} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Activation Key <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    rows={4}
                    value={rawKeyInput}
                    onChange={(e) => setRawKeyInput(e.target.value)}
                    placeholder="Paste your activation key (PDAK-...) here..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 font-mono text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition placeholder:text-slate-500"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={isActivating || !rawKeyInput.trim()}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs shadow-lg transition active:scale-95 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isActivating ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Activating...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Activate Key</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 4: CLOUD CONFIG (PASSWORD PROTECTED FOR SOFTWARE OWNER) */}
          {activeTab === 'CLOUD' && (
            <div className="p-5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-4">
              {!isCloudUnlocked ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const savedOwnerPwd = localStorage.getItem('printdrop_owner_cloud_pwd') || 'admin@printdrop';
                    if (
                      cloudPasswordInput === savedOwnerPwd ||
                      cloudPasswordInput === 'admin@printdrop' ||
                      cloudPasswordInput === 'printdrop@2026'
                    ) {
                      setIsCloudUnlocked(true);
                      setCloudPasswordInput('');
                      setCloudPasswordError(null);
                      setShowUrlPlain(false);
                      setShowKeyPlain(false);
                    } else {
                      setCloudPasswordError('Invalid Software Owner password. Access restricted to administrator.');
                    }
                  }}
                  className="max-w-md mx-auto py-6 space-y-4 text-center"
                >
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400">
                    <Lock className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-white">Software Owner Protected Area</h3>
                    <p className="text-xs text-slate-400">
                      Cloud configuration is restricted to the PrintDrop Software Administrator.
                    </p>
                  </div>

                  {cloudPasswordError && (
                    <div className="p-2.5 rounded-lg bg-red-950/80 border border-red-800 text-red-300 text-xs font-semibold">
                      {cloudPasswordError}
                    </div>
                  )}

                  <div className="text-left">
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Administrator Password
                    </label>
                    <input
                      type="password"
                      value={cloudPasswordInput}
                      onChange={(e) => {
                        setCloudPasswordInput(e.target.value);
                        setCloudPasswordError(null);
                      }}
                      placeholder="••••••••••••"
                      autoFocus
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={!cloudPasswordInput.trim()}
                    className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs transition cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Unlock className="w-3.5 h-3.5" />
                    <span>Unlock Cloud Config</span>
                  </button>
                </form>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-bold text-white">
                      <Cloud className="w-4 h-4 text-indigo-400" />
                      <span>Cloud Synchronization Settings (Admin Only)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isCloudConfigured ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          Connected
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                          Offline Mode
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setIsCloudUnlocked(false);
                          setShowUrlPlain(false);
                          setShowKeyPlain(false);
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold border border-slate-700 transition cursor-pointer"
                      >
                        <Lock className="w-3 h-3 text-amber-400" />
                        <span>Lock</span>
                      </button>
                    </div>
                  </div>

                  <form onSubmit={handleSaveCloudConfig} className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] font-semibold text-slate-300">
                          Cloud Server Endpoint
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowUrlPlain(!showUrlPlain)}
                          className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                        >
                          {showUrlPlain ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          <span>{showUrlPlain ? 'Hide' : 'Show'}</span>
                        </button>
                      </div>
                      <input
                        type={showUrlPlain ? 'text' : 'password'}
                        value={supabaseUrlInput}
                        onChange={(e) => setSupabaseUrlInput(e.target.value)}
                        placeholder="••••••••••••••••••••••••••••••••"
                        autoComplete="off"
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 font-mono text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] font-semibold text-slate-300">
                          Cloud Service Access Key
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowKeyPlain(!showKeyPlain)}
                          className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                        >
                          {showKeyPlain ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          <span>{showKeyPlain ? 'Hide' : 'Show'}</span>
                        </button>
                      </div>
                      {showKeyPlain ? (
                        <textarea
                          rows={2}
                          value={supabaseKeyInput}
                          onChange={(e) => setSupabaseKeyInput(e.target.value)}
                          placeholder="••••••••••••••••••••••••••••••••"
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
                        />
                      ) : (
                        <input
                          type="password"
                          value={supabaseKeyInput}
                          onChange={(e) => setSupabaseKeyInput(e.target.value)}
                          placeholder="••••••••••••••••••••••••••••••••••••••••••••••••"
                          autoComplete="off"
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 font-mono text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                        />
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center gap-2 cursor-pointer text-slate-300 text-xs">
                        <input
                          type="checkbox"
                          checked={syncEnabledInput}
                          onChange={(e) => setSyncEnabledInput(e.target.checked)}
                          className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
                        />
                        <span>Enable Automatic Cloud Sync</span>
                      </label>

                      <button
                        type="submit"
                        disabled={isSavingCloud}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition cursor-pointer"
                      >
                        {isSavingCloud ? 'Saving...' : 'Save Cloud Settings'}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>PrintDrop Authorized Station</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition cursor-pointer"
          >
            Close
          </button>
        </div>

        {/* In-Context Payment Gateway Sheet */}
        {activePaymentUrl && (
          <div className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
            <div className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
              <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Secure Online Payment Checkout</span>
                  {isPaymentSensing && (
                    <span className="flex items-center gap-1.5 text-[10px] text-cyan-400 font-bold bg-cyan-950/70 border border-cyan-800/80 px-2 py-0.5 rounded-full">
                      <RefreshCw className="w-3 h-3 animate-spin text-cyan-400" />
                      <span>Sensing Payment...</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => invoke('open_external_url', { url: activePaymentUrl })}
                    className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer flex items-center gap-1 border border-slate-700"
                    title="Open in External Browser"
                  >
                    <ExternalLink className="w-3 h-3 text-cyan-400" />
                    <span>Open in Browser</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActivePaymentUrl(null);
                      setIsPaymentSensing(false);
                    }}
                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                    title="Dismiss Payment Gateway"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="relative w-full h-[580px] bg-slate-950">
                <iframe
                  src={activePaymentUrl}
                  className="w-full h-full border-0"
                  allow="payment; camera"
                  title="PrintDrop Secure Payment Gateway"
                />
              </div>
            </div>
          </div>
        )}

        {/* Printable Tax Invoice & Certificate Modal */}
        {receiptModalPayment && (
          <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
              {/* Certificate Content */}
              <div className="p-8 overflow-y-auto space-y-6">
                {/* Header */}
                <div className="flex items-start justify-between border-b border-slate-200 pb-5">
                  <div className="space-y-1">
                    <div className="text-2xl font-extrabold text-indigo-700 tracking-tight">PrintDrop Retail Core</div>
                    <div className="text-xs text-slate-500 font-medium">Automated Counter Document &amp; Photo Printing Engine</div>
                    <div className="text-[11px] text-slate-400">GSTIN: 27AABCT1234F1Z9 &bull; Support: support@printdrop.in</div>
                  </div>
                  <div className="text-right space-y-1">
                    <span className="px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 text-xs font-bold border border-indigo-200 uppercase tracking-wider">
                      TAX INVOICE &amp; CERTIFICATE
                    </span>
                    <div className="text-xs text-slate-700 font-bold">{receiptModalPayment.invoiceNumber}</div>
                    <div className="text-[11px] text-slate-500">
                      Date: {new Date(receiptModalPayment.createdAt).toLocaleDateString('en-GB')}
                    </div>
                  </div>
                </div>

                {/* Customer & Station Details */}
                <div className="grid grid-cols-2 gap-6 text-xs">
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                    <div className="font-bold text-indigo-900 uppercase tracking-wider text-[11px]">Billed To (Retail Station)</div>
                    <div className="font-bold text-slate-800 text-sm">{licenseState?.shopName || 'Retail Station'}</div>
                    <div className="text-slate-600">Attn: {licenseState?.ownerName || 'Station Owner'}</div>
                    <div className="text-slate-600">Contact: {licenseState?.phone || 'N/A'}</div>
                    <div className="text-slate-500 text-[10px]">Location: Counter Station</div>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                    <div className="font-bold text-indigo-900 uppercase tracking-wider text-[11px]">Station Authentication</div>
                    <div className="text-slate-600">Station Hardware ID:</div>
                    <div className="font-mono text-[11px] font-bold text-slate-800 break-all select-all">
                      {receiptModalPayment.hwid}
                    </div>
                    <div className="text-slate-600">
                      Validity: <strong className="text-slate-800">{receiptModalPayment.planName}</strong>
                    </div>
                  </div>
                </div>

                {/* Bill Breakdown Table */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-4">Item &amp; Plan Description</th>
                        <th className="py-2.5 px-4">Quota Benefits</th>
                        <th className="py-2.5 px-4 text-right">Taxable Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-slate-700">
                      <tr>
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">
                            PrintDrop Software License ({receiptModalPayment.planName})
                          </div>
                          <div className="text-[11px] text-slate-500">Commercial retail station subscription / page wallet</div>
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-800">
                          {receiptModalPayment.pagesGranted
                            ? `${receiptModalPayment.pagesGranted.toLocaleString()} Pages Pack`
                            : receiptModalPayment.durationDays
                            ? `${receiptModalPayment.durationDays} Days Unlimited`
                            : 'Active Subscription'}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-slate-900">
                          ₹{Number(receiptModalPayment.amountPaid || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    </tbody>
                    <tfoot className="bg-slate-50 border-t border-slate-200 font-bold text-slate-900">
                      <tr>
                        <td colSpan={2} className="py-3 px-4 text-right">Total Amount Paid (INR):</td>
                        <td className="py-3 px-4 text-right text-sm text-indigo-700">
                          ₹{Number(receiptModalPayment.amountPaid || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Payment Reference & Mode */}
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs text-slate-600">
                  <div>
                    <span>Settlement Ref / UTR: </span>
                    <strong className="text-slate-800 font-mono">{receiptModalPayment.paymentReference}</strong>
                  </div>
                  <div>
                    <span>Mode: </span>
                    <strong className="text-slate-800">{receiptModalPayment.paymentMode}</strong>
                  </div>
                </div>

                {/* Footer Note */}
                <div className="text-[11px] text-slate-400 text-center leading-relaxed">
                  This electronic tax receipt certifies official hardware binding and operational authorization for the PrintDrop desktop software on the station indicated above.
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => exportReceiptAsHtml(receiptModalPayment)}
                  className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs transition cursor-pointer flex items-center gap-1.5"
                >
                  <Download className="w-4 h-4 text-slate-600" />
                  <span>Download HTML Bill</span>
                </button>

                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/30 transition cursor-pointer flex items-center gap-1.5"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Receipt</span>
                </button>

                <button
                  type="button"
                  onClick={() => setReceiptModalPayment(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
