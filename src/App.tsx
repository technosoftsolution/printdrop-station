import { useEffect, useState, useRef, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
const PrintPreviewCanvas = lazy(() =>
  import("./components/PrintPreviewCanvas").then(m => ({ default: m.PrintPreviewCanvas }))
);
import { CountertopPosterModal } from "./components/CountertopPosterModal";
import { CorporateClientsModal } from "./components/CorporateClientsModal";
import { PricingRatesModal } from "./components/PricingRatesModal";
import { PaymentSettingsModal } from "./components/PaymentSettingsModal";
import { PrinterRoutingModal } from "./components/PrinterRoutingModal";
import { LivePrintSpoolerModal } from "./components/LivePrintSpoolerModal";
import { BackupRestoreModal } from "./components/BackupRestoreModal";
import { LicenseActivationModal, LicenseStateDto, ProviderPaymentConfig } from "./components/LicenseActivationModal";
import { HelpGuideModal } from "./components/HelpGuideModal";
import { StationSetupModal } from "./components/StationSetupModal";
import { 
  Store,
  Printer, 
  Wifi, 
  QrCode as QrIcon, 
  RefreshCw, 
  ExternalLink, 
  Copy, 
  Check, 
  AlertTriangle,
  Lock,
  KeyRound,
  Network,
  Inbox,
  FileText,
  Clock,
  Eye,
  EyeOff,
  Edit3,
  Save,
  UploadCloud,
  Sliders,
  Settings,
  CheckCircle2,
  XCircle,
  Ban,
  FileSpreadsheet,
  Sparkles,
  Trash2,
  RotateCcw,
  ShieldCheck,
  Globe,
  Zap,
  Tag,
  User,
  Smartphone,
  Maximize2,
  Minimize2,
  Building2,
  ArrowLeft,
  ArrowRight,
  Download,
  IndianRupee,
  Banknote,
  Calendar,
  Users,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  WifiOff,
  Square,
  PhoneCall,
  MessageSquare,
  Mail,
  X
} from "lucide-react";

interface AppStatus {
  dbStatus: string;
  lanIp: string;
  receiverPort: number;
  receiverStatus: string;
  version: string;
}

export interface NetworkInterfaceInfo {
  name: string;
  ip: string;
  isVpn: boolean;
  isWifi: boolean;
  isLoopback: boolean;
  isDefault: boolean;
}

interface SessionInfo {
  id: string;
  token: string;
  lanIp: string;
  port: number;
  status: string;
  expiresAt: string;
  accessUrl: string;
  qrSvg: string;
  qrDataUrl: string;
  maxFileSizeBytes: number;
  maxOrderSizeBytes: number;
}

interface WifiInfo {
  ssid: string;
  password: string | null;
  authType: string;
  isConnected: boolean;
  signalQuality: string;
  interfaceName: string;
  isHidden: boolean;
  qrSvg: string;
  qrDataUrl: string;
  qrRawPayload: string;
}

export interface TunnelInfo {
  isActive: boolean;
  isConnecting: boolean;
  url: string | null;
  qrSvg: string | null;
  qrDataUrl: string | null;
  error: string | null;
  protocol: string;
}

export interface OrderFileSummaryDto {
  fileId: string;
  originalFilename: string;
  fileSizeBytes: number;
  documentPages: number;
  copies: number;
  paperSize: string;
  colorMode: string;
  duplexMode: string;
  isExcluded: boolean;
  isPurged: boolean;
  isPrinted: boolean;
  printedAt?: string;
  printedOn?: string;
  targetPrinter?: string;
  autoPrinter?: string;
  subtotal?: number;
}

interface OrderSummaryDto {
  id: string;
  sessionId: string;
  revisionNumber: number;
  status: string;
  totalFiles: number;
  totalBytes: number;
  customerNotes?: string;
  customerName?: string;
  deviceModel?: string;
  deviceToken?: string;
  pickupCode?: string;
  createdAt: string;
  completedAt?: string;
  printedFilesCount?: number;
  targetPrinter?: string;
  activeFilesCount?: number;
  isAllPurged?: boolean;
  corporateClientName?: string;
  corporatePersonName?: string;
  totalAmount?: number;
  paymentStatus?: string;
  paymentMethod?: string;
  customerType?: string;
  paymentClaim?: string;
  paidAt?: string;
  files?: OrderFileSummaryDto[];
}

interface FileBillingDetail {
  fileId: string;
  originalFilename: string;
  isExcluded: boolean;
  isPurged: boolean;
  documentPages: number;
  effectivePages: number;
  copies: number;
  paperSize: string;
  colorMode: string;
  duplexMode: string;
  totalSheets: number;
  duplexSheets: number;
  simplexSheets: number;
  unitRateDescription: string;
  subtotal: number;
}

interface OrderBilling {
  orderId: string;
  customerType: string;
  paymentStatus: string;
  paymentMethod?: string;
  paidAt?: string;
  paymentClaim?: string;
  paymentClaimAt?: string;
  corporateClientId?: string;
  currency: string;
  subtotal: number;
  totalAmount: number;
  totalSheets: number;
  totalPages: number;
  files: FileBillingDetail[];
  createdAt: string;
  updatedAt: string;
}

interface PrintSettingsDto {
  mode: string;
  paperSize: string;
  colorMode: string;
  duplexMode: string;
  copies: number;
  orientation: string;
  pageRange?: string;
  rotation?: number;
  targetPrinter?: string | null;
}

interface OrderFileDetailDto {
  fileId: string;
  originalFilename: string;
  fileSizeBytes: number;
  sha256Hash: string;
  printSettings: PrintSettingsDto;
  settingsSummary: string;
  isExcluded?: boolean;
  isPrinted?: boolean;
  isPurged?: boolean;
  printedAt?: string;
  printedOn?: string;
  autoPrinter?: string;
  resolvedPrinter?: string;
}

interface OrderDetailDto {
  order: OrderSummaryDto;
  files: OrderFileDetailDto[];
}

interface ExcelSheetInfo {
  sheetIndex: number;
  name: string;
  isEmpty: boolean;
  dimension?: string;
  rowCount: number;
  colCount: number;
  hasUserPrintSetup: boolean;
  detectedOrientation: string;
  detectedPaperSize?: string;
  fitToWidth?: number;
  fitToHeight?: number;
  printArea?: string;
  recommendedAction: string;
}

interface ExcelMetadata {
  totalSheets: number;
  populatedSheets: number;
  sheets: ExcelSheetInfo[];
}

interface DocumentInspectionResult {
  fileId: string;
  originalFilename: string;
  fileType: string;
  fileSizeBytes: number;
  pageCount?: number;
  excelMetadata?: ExcelMetadata;
  previewDataUrl?: string;
  previewUrl: string;
}

interface PrinterInfo {
  name: string;
  isDefault: boolean;
  isVirtual: boolean;
  requiresPrompt?: boolean;
  status: string;
}

interface PrintJobResult {
  fileId: string;
  filename: string;
  status: string;
  errorMessage?: string;
}

interface PrintBatchResult {
  orderId: string;
  printerName: string;
  totalFiles: number;
  successfulFiles: number;
  failedFiles: number;
  jobs: PrintJobResult[];
}

export default function App() {
  const [status, setStatus] = useState<AppStatus>({
    dbStatus: "Checking...",
    lanIp: "192.168.10.3",
    receiverPort: 8080,
    receiverStatus: "Initializing...",
    version: "0.1.0",
  });

  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [selectedIp, setSelectedIp] = useState<string>("192.168.10.3");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [orders, setOrders] = useState<OrderSummaryDto[]>([]);
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<OrderDetailDto | null>(null);
  const selectedOrderDetailsRef = useRef<OrderDetailDto | null>(null);
  useEffect(() => {
    selectedOrderDetailsRef.current = selectedOrderDetails;
  }, [selectedOrderDetails]);

  // Platform & Resolution Aware Proportional Scaling:
  // Detects window maximization or large display changes to trigger root font scaling
  useEffect(() => {
    let isDisposed = false;

    const checkMaximized = async () => {
      try {
        const appWin = getCurrentWindow();
        const isMax = await appWin.isMaximized();
        if (!isDisposed) {
          if (isMax) {
            document.documentElement.setAttribute("data-maximized", "true");
          } else {
            document.documentElement.removeAttribute("data-maximized");
          }
        }
      } catch {
        // Fallback for non-Tauri / standard browser context
        const isLikelyMaximized =
          window.screen.availWidth - window.innerWidth < 45 &&
          window.screen.availHeight - window.innerHeight < 90;
        if (!isDisposed) {
          if (isLikelyMaximized) {
            document.documentElement.setAttribute("data-maximized", "true");
          } else {
            document.documentElement.removeAttribute("data-maximized");
          }
        }
      }
    };

    checkMaximized();
    window.addEventListener("resize", checkMaximized);

    return () => {
      isDisposed = true;
      window.removeEventListener("resize", checkMaximized);
    };
  }, []);
  
  // Printer Engine state (Phase-H)
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>("");
  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [printBatchModal, setPrintBatchModal] = useState<PrintBatchResult | null>(null);

  // Document Preview & Print Setup state
  const [previewData, setPreviewData] = useState<DocumentInspectionResult | null>(null);
  const [previewFile, setPreviewFile] = useState<OrderFileDetailDto | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewLoadingFileId, setPreviewLoadingFileId] = useState<string | null>(null);
  const [inspectModalError, setInspectModalError] = useState<string | null>(null);

  // Shopkeeper order approval & rejection state
  const [rejectingOrderId, setRejectingOrderId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>("");
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"ACTIVE" | "PRINTED" | "TRASH">("ACTIVE");
  const [orderSearchTerm, setOrderSearchTerm] = useState("");
  const [isOrderManagementMaximized, setIsOrderManagementMaximized] = useState<boolean>(false);

  // Full-page customer history & financial transactions ledger state
  const [isViewingAllHistory, setIsViewingAllHistory] = useState<boolean>(false);
  const [historyDateFilter, setHistoryDateFilter] = useState<"ALL" | "TODAY" | "YESTERDAY" | "WEEK" | "MONTH">("ALL");
  const [historyPaymentFilter, setHistoryPaymentFilter] = useState<"ALL" | "PAID" | "CASH" | "ONLINE" | "UNPAID">("ALL");
  const [historySearchTerm, setHistorySearchTerm] = useState<string>("");

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Shop Wi-Fi Auto-Discovery & QR State
  const [wifiInfo, setWifiInfo] = useState<WifiInfo | null>(null);
  const [activeQrTab, setActiveQrTab] = useState<"permanent" | "tunnel" | "step2" | "step1">("tunnel");
  const [tunnelInfo, setTunnelInfo] = useState<TunnelInfo | null>(null);
  const [isTunnelLoading, setIsTunnelLoading] = useState(false);
  const [tunnelCopied, setTunnelCopied] = useState(false);
  const [permanentPortalQr, setPermanentPortalQr] = useState<string>("");
  const [permanentPortalCopied, setPermanentPortalCopied] = useState(false);
  const [permanentPortalBaseUrl, setPermanentPortalBaseUrl] = useState<string>("");
  const [isEditingPortalUrl, setIsEditingPortalUrl] = useState(false);
  const [portalUrlInput, setPortalUrlInput] = useState("");
  const [licenseState, setLicenseState] = useState<LicenseStateDto | null>(null);

  const effectiveHwid = licenseState?.hwid || "";
  const permanentPortalUrl = permanentPortalBaseUrl
    ? (effectiveHwid
        ? `${permanentPortalBaseUrl}${permanentPortalBaseUrl.includes("?") ? "&" : "?"}hwid=${encodeURIComponent(effectiveHwid)}`
        : permanentPortalBaseUrl)
    : "";

  const handleDownloadConnectHtml = () => {
    const hwidEscaped = (effectiveHwid || "").replace(/["'<>]/g, "");
    const shopTitle = (licenseState?.shopName || "PrintDrop Counter Station").replace(/["'<>]/g, "");
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${shopTitle} - Connecting...</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; min-height: 100vh; align-items: center; justify-content: center; text-align: center; padding: 24px; }
    .card { max-width: 380px; width: 100%; background: #1e293b; border: 1px solid #334155; border-radius: 20px; padding: 28px; box-shadow: 0 20px 50px rgba(0,0,0,0.4); }
    .spin { width: 38px; height: 38px; border: 3px solid #334155; border-top-color: #6366f1; border-radius: 50%; animation: r 0.9s linear infinite; margin: 0 auto 16px; }
    @keyframes r { to { transform: rotate(360deg); } }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { font-size: 13px; color: #94a3b8; margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spin"></div>
    <h1>${shopTitle}</h1>
    <p id="status">Connecting to shop counter...</p>
  </div>
  <script>
    (async function () {
      const params = new URLSearchParams(window.location.search);
      const hwid = params.get("hwid") || "${hwidEscaped}";
      const sbUrl = "https://nslcrlvuulgqtrdqrkgv.supabase.co";
      const sbKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zbGNybHZ1dWxncXRyZHFya2d2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNTI4NzEsImV4cCI6MjEwOTcyODg3MX0.lpRc097A_PFCD-eJVhyQZmPFxexhSGjM2dhCE0LNdxk";
      const statusEl = document.getElementById("status");
      if (!hwid) {
        statusEl.textContent = "Station ID missing. Please scan the counter QR code again.";
        return;
      }
      try {
        const res = await fetch(sbUrl + "/rest/v1/system_config?key=eq.station_tunnel_" + encodeURIComponent(hwid) + "&select=value&limit=1", {
          headers: { apikey: sbKey, Authorization: "Bearer " + sbKey }
        });
        const rows = await res.json();
        const rawVal = rows && rows[0] ? rows[0].value : null;
        const parsed = typeof rawVal === "string" ? JSON.parse(rawVal) : rawVal;
        const liveUrl = parsed && parsed.url ? parsed.url : null;
        if (!liveUrl) {
          statusEl.textContent = "Counter station is currently offline. Please ask the shopkeeper to open PrintDrop.";
          return;
        }
        window.location.replace(liveUrl);
      } catch (err) {
        statusEl.textContent = "Unable to reach station directory. Please check mobile internet and retry.";
      }
    })();
  </script>
</body>
</html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "connect.html";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setActionSuccessMsg("Downloaded connect.html! Upload it to your GitHub Pages / website and paste its URL above.");
    setTimeout(() => setActionSuccessMsg(null), 6000);
  };

  useEffect(() => {
    invoke<string>("get_permanent_portal_url")
      .then(saved => {
        if (saved && saved.trim().length > 0) {
          setPermanentPortalBaseUrl(saved.trim());
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (permanentPortalUrl) {
      invoke<string>("generate_portal_qr", { targetUrl: permanentPortalUrl })
        .then(qr => setPermanentPortalQr(qr))
        .catch(e => console.warn("Portal QR query error:", e));
    }
  }, [permanentPortalUrl]);
  const [isInternetOnline, setIsInternetOnline] = useState<boolean | null>(null);
  const lastInternetStateRef = useRef<boolean | null>(null);
  const wasTunnelManuallyStoppedRef = useRef<boolean>(false);
  const [showWifiEdit, setShowWifiEdit] = useState(false);
  const [wifiEditSsid, setWifiEditSsid] = useState("");
  const [wifiEditPassword, setWifiEditPassword] = useState("");
  const [wifiEditAuth, setWifiEditAuth] = useState("WPA2-Personal");
  const [wifiEditHidden, setWifiEditHidden] = useState(false);
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  const [isSavingWifi, setIsSavingWifi] = useState(false);
  const [wifiCopied, setWifiCopied] = useState(false);
  const [showPosterModal, setShowPosterModal] = useState(false);
  const [isCorporateModalOpen, setIsCorporateModalOpen] = useState(false);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [isPaymentSettingsModalOpen, setIsPaymentSettingsModalOpen] = useState(false);
  const [isRoutingModalOpen, setIsRoutingModalOpen] = useState(false);
  const [isSpoolerModalOpen, setIsSpoolerModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);

  // In-App Auto-Updater (Tauri v2 Updater + GitHub Releases)
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [updateProgressPct, setUpdateProgressPct] = useState<number | null>(null);
  const [isUpdateDismissed, setIsUpdateDismissed] = useState(false);
  const [rollbackInfo, setRollbackInfo] = useState<{ available: boolean; previousVersion?: string | null } | null>(null);
  const [isBlockedVersion, setIsBlockedVersion] = useState(false);

  const getHwidRolloutBucket = (hwid: string) => {
    let hash = 0;
    for (let i = 0; i < hwid.length; i++) {
      hash = (hash * 31 + hwid.charCodeAt(i)) >>> 0;
    }
    return hash % 100;
  };

  const handleLocalRollback = async () => {
    if (!rollbackInfo?.available) return;
    try {
      await invoke("trigger_local_rollback");
    } catch (err) {
      setErrorMsg(`Rollback failed: ${err}`);
    }
  };

  const checkForAppUpdates = async (manual = false) => {
    setIsCheckingUpdate(true);
    try {
      const [policy, rbInfo] = await Promise.all([
        invoke<{ rolloutPercentage: number; canaryHwids: string[]; blockedVersions: string[] }>("get_ota_rollout_policy").catch(() => ({
          rolloutPercentage: 100,
          canaryHwids: [] as string[],
          blockedVersions: [] as string[],
        })),
        invoke<{ available: boolean; previousVersion?: string | null }>("get_ota_rollback_info").catch(() => null),
      ]);

      if (rbInfo) setRollbackInfo(rbInfo);

      const curVer = status?.version || "";
      if (curVer && Array.isArray(policy.blockedVersions) && policy.blockedVersions.includes(curVer)) {
        setIsBlockedVersion(true);
      } else {
        setIsBlockedVersion(false);
      }

      const update = await check();
      if (update?.available) {
        if (Array.isArray(policy.blockedVersions) && policy.blockedVersions.includes(update.version)) {
          if (manual) {
            setErrorMsg(`Update v${update.version} is currently paused/blocked by administrator.`);
            setTimeout(() => setErrorMsg(null), 5000);
          }
          return;
        }

        const pct = typeof policy.rolloutPercentage === "number" ? policy.rolloutPercentage : 100;
        const hwid = (licenseState?.hwid || "").toUpperCase();
        const isCanary = hwid !== "" && Array.isArray(policy.canaryHwids) && policy.canaryHwids.some((id) => id.trim().toUpperCase() === hwid);
        const inRolloutBucket = pct >= 100 || (pct > 0 && (hwid ? getHwidRolloutBucket(hwid) < pct : false));

        if (!manual && !isCanary && !inRolloutBucket) {
          return;
        }

        setAvailableUpdate(update);
        setIsUpdateDismissed(false);
      } else if (manual) {
        setActionSuccessMsg("You are already running the latest version of PrintDrop!");
        setTimeout(() => setActionSuccessMsg(null), 4000);
      }
    } catch (err) {
      if (manual) {
        setErrorMsg(`Update check unavailable: ${err}`);
        setTimeout(() => setErrorMsg(null), 5000);
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!availableUpdate || isInstallingUpdate) return;
    setIsInstallingUpdate(true);
    setUpdateProgressPct(0);
    try {
      // Layer 2: Snapshot current working EXE + SQLite DB + Start Menu Restore script before updating
      await invoke("prepare_ota_rollback_snapshot").catch((e) =>
        console.warn("Pre-update rollback snapshot warning:", e)
      );
      let downloaded = 0;
      let totalLength = 0;
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalLength = event.data.contentLength || 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (totalLength > 0) {
            setUpdateProgressPct(Math.min(100, Math.round((downloaded / totalLength) * 100)));
          }
        } else if (event.event === "Finished") {
          setUpdateProgressPct(100);
        }
      });
      await relaunch();
    } catch (err) {
      setErrorMsg(`Update installation failed: ${err}`);
      setIsInstallingUpdate(false);
      setUpdateProgressPct(null);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      checkForAppUpdates(false);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);
  const [isLicenseModalOpen, setIsLicenseModalOpen] = useState(false);
  const [isStationSetupOpen, setIsStationSetupOpen] = useState(false);
  const [isStationEditMode, setIsStationEditMode] = useState(false);
  const [hasSkippedSetupThisSession, setHasSkippedSetupThisSession] = useState(false);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [isContactUsModalOpen, setIsContactUsModalOpen] = useState(false);
  const [providerProfile, setProviderProfile] = useState<ProviderPaymentConfig | null>(null);
  const [isSyncingProviderProfile, setIsSyncingProviderProfile] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const settingsCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedOrderBilling, setSelectedOrderBilling] = useState<OrderBilling | null>(null);
  const [expandedFilesOrderIds, setExpandedFilesOrderIds] = useState<Set<string>>(new Set());

  // Dynamic App & Window Title Syncing based on Station Name & License Plan
  useEffect(() => {
    const isTrial = !licenseState || licenseState.planType === "TRIAL";
    const rawShop = licenseState?.shopName?.trim() || "";
    const hasCustomShop = rawShop !== "" && rawShop !== "PrintDrop Retail Station";
    const appTitle = hasCustomShop
      ? `${rawShop} • Powered by PrintDrop${isTrial ? " (Demo)" : ""}`
      : isTrial
      ? "PrintDrop Demo Station - Shopkeeper Counter OS"
      : "PrintDrop Station - Shopkeeper Counter OS";
    document.title = appTitle;
    try {
      getCurrentWindow().setTitle(appTitle).catch(() => {});
    } catch {
      // Browser preview fallback
    }
  }, [licenseState?.planType, licenseState?.shopName]);

  // First-Run Trial Prompt (skippable) & Mandatory Commercial License Station Profile Enforcement
  useEffect(() => {
    if (!licenseState) return;
    const rawShop = licenseState.shopName?.trim() || "";
    const hasCustomShop = rawShop !== "" && rawShop !== "PrintDrop Retail Station";
    const hasAllFields =
      hasCustomShop &&
      Boolean(licenseState.ownerName?.trim()) &&
      Boolean(licenseState.city?.trim()) &&
      Boolean(licenseState.phone?.trim());

    if (hasAllFields) {
      if (isStationSetupOpen && !isStationEditMode) {
        setIsStationSetupOpen(false);
      }
      return;
    }

    if (licenseState.planType !== "TRIAL") {
      setIsStationEditMode(false);
      setIsStationSetupOpen(true);
    } else if (!licenseState.profileConfigured && !hasSkippedSetupThisSession) {
      setIsStationEditMode(false);
      setIsStationSetupOpen(true);
    }
  }, [licenseState, hasSkippedSetupThisSession, isStationSetupOpen, isStationEditMode]);

  // If station profile is incomplete on startup, trigger an immediate cloud sync
  // so Admin Portal updates pull down within ~1s instead of waiting 10s.
  const hasTriggeredStartupProfileSyncRef = useRef(false);
  useEffect(() => {
    if (!licenseState || hasTriggeredStartupProfileSyncRef.current) return;
    const rawShop = licenseState.shopName?.trim() || "";
    const hasAllFields =
      rawShop !== "" &&
      rawShop !== "PrintDrop Retail Station" &&
      Boolean(licenseState.ownerName?.trim()) &&
      Boolean(licenseState.city?.trim()) &&
      Boolean(licenseState.phone?.trim());
    if (!hasAllFields) {
      hasTriggeredStartupProfileSyncRef.current = true;
      invoke<{ updatedLicense?: LicenseStateDto | null }>("sync_license_cloud")
        .then((res) => {
          if (res?.updatedLicense) {
            setLicenseState(res.updatedLicense);
          }
        })
        .catch(() => {});
    }
  }, [licenseState]);

  const handleSaveStationProfile = async (data: {
    shopName: string;
    ownerName: string;
    city: string;
    phone: string;
  }) => {
    const updated = await invoke<LicenseStateDto>("update_station_profile", {
      shopName: data.shopName,
      ownerName: data.ownerName,
      city: data.city,
      phone: data.phone,
      markConfigured: true,
    });
    setLicenseState(updated);
    setIsStationSetupOpen(false);
    setIsStationEditMode(false);
    setActionSuccessMsg(`Station profile saved: ${data.shopName} • Syncing with Cloud`);
    setTimeout(() => setActionSuccessMsg(null), 4000);
  };

  const refreshProviderProfile = async (silent = false) => {
    try {
      if (!silent) setIsSyncingProviderProfile(true);
      const [freshCfg, freshLic] = await Promise.all([
        invoke<ProviderPaymentConfig>("get_provider_payment_config").catch(() => null),
        invoke<LicenseStateDto>("get_license_state").catch(() => null),
      ]);
      if (freshCfg) {
        setProviderProfile(freshCfg);
      }
      if (freshLic) {
        setLicenseState(freshLic);
      }
    } catch (err) {
      console.warn("Failed to refresh provider profile from cloud:", err);
    } finally {
      setIsSyncingProviderProfile(false);
    }
  };

  useEffect(() => {
    if (isContactUsModalOpen) {
      refreshProviderProfile(false);
    }
  }, [isContactUsModalOpen]);

  useEffect(() => {
    if (isSettingsMenuOpen) {
      refreshProviderProfile(true);
    }
  }, [isSettingsMenuOpen]);

  const handleOpenWhatsApp = (customPhone?: string | null, customReason?: string | null) => {
    const raw = customPhone || providerProfile?.whatsappNumber || licenseState?.providerWhatsappNumber || "+91 94220 00000";
    const digitsOnly = raw.replace(/[^0-9]/g, "");
    const phone = digitsOnly.length === 10 ? `91${digitsOnly}` : digitsOnly;
    const hwid = licenseState?.hwid || "Not Available";
    const shop = licenseState?.shopName || "PrintDrop Station";
    const plan = licenseState?.planDisplayName || "Trial Evaluation";
    const reason = customReason || "I need assistance with PrintDrop.";
    const message = `Hello PrintDrop Support,\nStation: ${shop}\nHWID: ${hwid}\nPlan: ${plan}\n${reason}`;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    invoke("open_external_url", { url }).catch((err) => console.error("Failed to launch WhatsApp:", err));
  };

  const handleCallProvider = (customPhone?: string | null) => {
    const phone = (customPhone || providerProfile?.contactPhone || licenseState?.providerContactPhone || "+91 94220 00000").trim();
    invoke("open_external_url", { url: `tel:${phone}` }).catch((err) => console.error("Failed to launch Phone Link:", err));
  };

  const handleSendEmail = (customEmail?: string | null) => {
    const email = (customEmail || providerProfile?.supportEmail || licenseState?.providerSupportEmail || "support@technosoftsolution.com").trim();
    const hwid = licenseState?.hwid || "";
    const shop = licenseState?.shopName || "PrintDrop Station";
    const subject = `PrintDrop Support - ${shop} (HWID: ${hwid})`;
    const body = `Hello Support Team,\n\nStation: ${shop}\nHWID: ${hwid}\n\nI need assistance with:\n`;
    const url = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    invoke("open_external_url", { url }).catch((err) => console.error("Failed to launch Mail:", err));
  };

  const toggleOrderFilesExpanded = (orderId: string) => {
    setExpandedFilesOrderIds(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  async function loadInitialData() {
    try {
      const [appStatus, ifaceList, orderList] = await Promise.all([
        invoke<AppStatus>("get_app_status"),
        invoke<NetworkInterfaceInfo[]>("list_network_interfaces"),
        invoke<OrderSummaryDto[]>("list_incoming_orders"),
      ]);
      
      setStatus(appStatus);
      setInterfaces(ifaceList);
      setOrders(orderList);

      const wifiIface = ifaceList.find(i => i.isWifi && !i.isLoopback);
      const defaultIp = wifiIface ? wifiIface.ip : (ifaceList[0]?.ip || "192.168.10.3");
      setSelectedIp(defaultIp);

      // Fetch active session, Wi-Fi info, printers, and tunnel concurrently in parallel
      const sessionPromise = invoke<SessionInfo>("get_active_session", { selectedIp: defaultIp })
        .then(activeSession => setSession(activeSession))
        .catch(e => console.warn("Session query error:", e));

      const wifiPromise = invoke<WifiInfo>("get_wifi_info")
        .then(wifiData => {
          setWifiInfo(wifiData);
          setWifiEditSsid(wifiData.ssid);
          setWifiEditPassword(wifiData.password || "");
          setWifiEditAuth(wifiData.authType);
          setWifiEditHidden(wifiData.isHidden);
        })
        .catch(e => console.warn("Wi-Fi query error:", e));

      const licensePromise = invoke<LicenseStateDto>("get_license_state")
        .then(lic => setLicenseState(lic))
        .catch(e => console.warn("License state query error:", e));

      const printerPromise = invoke<PrinterInfo[]>("get_available_printers")
        .then(printerList => {
          setPrinters(printerList);
          // Prefer a printer that does not demand interactive file prompt
          const safePrinter = printerList.find(p => p.isDefault && !p.requiresPrompt)
            || printerList.find(p => !p.requiresPrompt && !p.isVirtual)
            || printerList.find(p => p.name.includes("Virtual Test Spooler"))
            || printerList[0];
          if (safePrinter) {
            setSelectedPrinter(safePrinter.name);
          }
        })
        .catch(e => console.warn("Printer query error:", e));

      const tunnelPromise = invoke<TunnelInfo>("get_public_tunnel_status")
        .then(tunnelStatus => setTunnelInfo(tunnelStatus))
        .catch(e => console.warn("Tunnel status query error:", e));

      const portalQrPromise = invoke<string>("generate_portal_qr", { targetUrl: permanentPortalUrl })
        .then(qr => setPermanentPortalQr(qr))
        .catch(e => console.warn("Portal QR query error:", e));

      await Promise.allSettled([sessionPromise, wifiPromise, licensePromise, printerPromise, tunnelPromise, portalQrPromise]);
      setErrorMsg(null);

      // Automatically initiate 4G/5G Internet Tunnel in background as final auto process
      autoStart4G5GTunnel();
    } catch (err) {
      console.warn("Tauri invoke fallback:", err);
      const mockIfaces: NetworkInterfaceInfo[] = [
        { name: "Wi-Fi", ip: "192.168.10.3", isWifi: true, isVpn: false, isLoopback: false, isDefault: true },
        { name: "Tailscale", ip: "100.100.10.51", isWifi: false, isVpn: true, isLoopback: false, isDefault: false },
      ];
      setInterfaces(mockIfaces);
      setSelectedIp("192.168.10.3");
      setPrinters([
        { name: "Microsoft Print to PDF", isDefault: true, isVirtual: true, status: "Ready" }
      ]);
      setSelectedPrinter("Microsoft Print to PDF");
      setStatus({
        dbStatus: "SQLite WAL Ready",
        lanIp: "192.168.10.3",
        receiverPort: 8080,
        receiverStatus: "Active (Listening on all interfaces)",
        version: "0.1.0",
      });
    }
  }

  // Periodic polling for incoming orders (every 3 seconds)
  useEffect(() => {
    loadInitialData();
    const interval = setInterval(async () => {
      try {
        const orderList = await invoke<OrderSummaryDto[]>("list_incoming_orders");
        setOrders(orderList);

        if (selectedOrderDetailsRef.current) {
          const currentId = selectedOrderDetailsRef.current.order.id;
          const [refreshed, refreshedBilling] = await Promise.all([
            invoke<OrderDetailDto | null>("get_order_details", { orderId: currentId }),
            invoke<OrderBilling | null>("get_order_billing", { orderId: currentId }),
          ]);
          if (refreshed && selectedOrderDetailsRef.current?.order.id === currentId) {
            setSelectedOrderDetails(refreshed);
          }
          if (refreshedBilling && selectedOrderDetailsRef.current?.order.id === currentId) {
            setSelectedOrderBilling(refreshedBilling);
          }
        }
      } catch {
        // Suppress background polling error if in browser mode
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Listen for Escape key to restore layout if maximized or return from full-page ledger / close settings dropdown / close help modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isSettingsMenuOpen) {
          setIsSettingsMenuOpen(false);
        } else if (isHelpModalOpen) {
          setIsHelpModalOpen(false);
        } else if (isContactUsModalOpen) {
          setIsContactUsModalOpen(false);
        } else if (isViewingAllHistory) {
          setIsViewingAllHistory(false);
        } else if (isOrderManagementMaximized) {
          setIsOrderManagementMaximized(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOrderManagementMaximized, isViewingAllHistory, isSettingsMenuOpen, isHelpModalOpen, isContactUsModalOpen]);

  // Close settings dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("#settings-dropdown-container")) {
        setIsSettingsMenuOpen(false);
      }
    };
    if (isSettingsMenuOpen) {
      document.addEventListener("click", handleClickOutside);
    }
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [isSettingsMenuOpen]);

  async function handleInterfaceChange(ip: string) {
    setSelectedIp(ip);
    setIsRefreshing(true);
    try {
      const updated = await invoke<SessionInfo>("switch_network_interface", { ip });
      setSession(updated);
      try {
        const tunnelStatus = await invoke<TunnelInfo>("get_public_tunnel_status");
        setTunnelInfo(tunnelStatus);
      } catch (e) {
        console.warn("Tunnel status query error:", e);
      }

      setErrorMsg(null);
    } catch (err) {
      console.warn("Switch IP fallback:", err);
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleRefreshSession() {
    setIsRefreshing(true);
    try {
      const newSession = await invoke<SessionInfo>("create_new_session", { selectedIp });
      setSession(newSession);
      try {
        const tunnelStatus = await invoke<TunnelInfo>("get_public_tunnel_status");
        setTunnelInfo(tunnelStatus);
      } catch (e) {
        console.warn("Tunnel status query error:", e);
      }

      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function inspectOrder(orderId: string) {
    setInspectModalError(null);
    try {
      const [details, billing] = await Promise.all([
        invoke<OrderDetailDto | null>("get_order_details", { orderId }),
        invoke<OrderBilling | null>("get_order_billing", { orderId }),
      ]);
      setSelectedOrderDetails(details);
      setSelectedOrderBilling(billing);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleUpdatePayment(orderId: string, status: string, method?: string) {
    try {
      const updated = await invoke<OrderBilling>("update_order_payment", {
        orderId,
        paymentStatus: status,
        paymentMethod: method || null,
        customerType: null,
      });
      setSelectedOrderBilling(updated);
      const updatedOrders = await invoke<OrderSummaryDto[]>("list_incoming_orders");
      setOrders(updatedOrders);
      setActionSuccessMsg(`Payment updated to ${status}${method ? ` (${method})` : ""}`);
      setTimeout(() => setActionSuccessMsg(null), 2500);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleToggleCustomerType(orderId: string, currentType: string) {
    try {
      const newType = currentType === "REMOTE" ? "WALK_IN" : "REMOTE";
      const updated = await invoke<OrderBilling>("recalculate_order_billing", {
        orderId,
        customerType: newType,
      });
      setSelectedOrderBilling(updated);
      const updatedOrders = await invoke<OrderSummaryDto[]>("list_incoming_orders");
      setOrders(updatedOrders);
      setActionSuccessMsg(`Customer category set to ${newType === "REMOTE" ? "Remote Customer" : "Walk-In Customer"}`);
      setTimeout(() => setActionSuccessMsg(null), 2500);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleOpenPreview(file: OrderFileDetailDto) {
    setIsLoadingPreview(true);
    setPreviewLoadingFileId(file.fileId);
    setInspectModalError(null);
    try {
      const inspection = await invoke<DocumentInspectionResult>("inspect_file_document", { fileId: file.fileId });
      setPreviewData(inspection);
      setPreviewFile(file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInspectModalError(`Cannot preview "${file.originalFilename}": ${msg}`);
      setErrorMsg(`Failed to load preview: ${msg}`);
      setTimeout(() => setErrorMsg(null), 8000);
    } finally {
      setIsLoadingPreview(false);
      setPreviewLoadingFileId(null);
    }
  }

  async function handleApplyPreviewSettings(newSettings: {
    paperSize: string;
    colorMode: string;
    orientation: string;
    rotation: number;
    copies: number;
    duplexMode: string;
    pageRange?: string;
  }) {
    if (!previewFile || !selectedOrderDetails) {
      throw new Error("No active document preview file selected.");
    }
    try {
      const updatedSettings: PrintSettingsDto = {
        mode: "MANUAL",
        paperSize: newSettings.paperSize,
        colorMode: newSettings.colorMode,
        duplexMode: newSettings.duplexMode,
        copies: newSettings.copies,
        orientation: newSettings.orientation,
        pageRange: newSettings.pageRange !== undefined ? (newSettings.pageRange.trim() ? newSettings.pageRange.trim() : undefined) : previewFile.printSettings?.pageRange || undefined,
        rotation: newSettings.rotation,
        targetPrinter: previewFile.printSettings?.targetPrinter || undefined,
      };

      const newSummary = await invoke<string>("update_file_print_settings", {
        fileId: previewFile.fileId,
        settings: updatedSettings,
      });

      // Refresh order details AND billing to reflect new settings and recalculated pricing
      const [refreshed, refreshedBilling] = await Promise.all([
        invoke<OrderDetailDto | null>("get_order_details", { orderId: selectedOrderDetails.order.id }),
        invoke<OrderBilling | null>("get_order_billing", { orderId: selectedOrderDetails.order.id }),
      ]);
      if (refreshed) {
        setSelectedOrderDetails(refreshed);
        const updatedFile = refreshed.files.find((f) => f.fileId === previewFile.fileId);
        if (updatedFile) {
          setPreviewFile(updatedFile);
        }
      }
      if (refreshedBilling) {
        setSelectedOrderBilling(refreshedBilling);
      }
      const updatedOrders = await invoke<OrderSummaryDto[]>("list_incoming_orders");
      setOrders(updatedOrders);

      setActionSuccessMsg(`Settings updated: ${newSummary}`);
      setTimeout(() => setActionSuccessMsg(null), 3000);
      return newSummary;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Failed to update print settings: ${msg}`);
      throw new Error(msg);
    }
  }

  async function handleApproveOrder(orderId: string) {
    try {
      await invoke("approve_order", { orderId });
      setActionSuccessMsg(`Order #${orderId.substring(0, 8)} approved successfully! Ready to print.`);
      const updatedOrders = await invoke<OrderSummaryDto[]>("list_incoming_orders");
      setOrders(updatedOrders);
      if (selectedOrderDetails && selectedOrderDetails.order.id === orderId) {
        const refreshed = await invoke<OrderDetailDto | null>("get_order_details", { orderId });
        if (refreshed) setSelectedOrderDetails(refreshed);
      }
      setTimeout(() => setActionSuccessMsg(null), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleConfirmReject() {
    if (!rejectingOrderId) return;
    try {
      await invoke("reject_order", { 
        orderId: rejectingOrderId, 
        reason: rejectionReason.trim() ? rejectionReason.trim() : "Rejected by Shopkeeper" 
      });
      setActionSuccessMsg(`Order #${rejectingOrderId.substring(0, 8)} rejected.`);
      const updatedOrders = await invoke<OrderSummaryDto[]>("list_incoming_orders");
      setOrders(updatedOrders);
      if (selectedOrderDetails && selectedOrderDetails.order.id === rejectingOrderId) {
        const refreshed = await invoke<OrderDetailDto | null>("get_order_details", { orderId: rejectingOrderId });
        if (refreshed) setSelectedOrderDetails(refreshed);
      }
      setRejectingOrderId(null);
      setRejectionReason("");
      setTimeout(() => setActionSuccessMsg(null), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleTriggerPrint(orderId: string) {
    await handleStartBatchPrint([orderId]);
  }

  async function handleStartBatchPrint(orderIds?: string[]) {
    if (licenseState && !licenseState.isValid) {
      setIsLicenseModalOpen(true);
      setErrorMsg(`Print Authorization Paused: ${licenseState.statusMessage}`);
      return;
    }

    if (!selectedPrinter) {
      setErrorMsg("Please select a target printer first.");
      setTimeout(() => setErrorMsg(null), 4000);
      return;
    }

    const currentPrinter = printers.find(p => p.name === selectedPrinter);
    if (currentPrinter?.requiresPrompt) {
      setErrorMsg(`"${selectedPrinter}" requires an interactive Windows 'Save As' prompt and cannot be used in headless mode. Please select "Virtual Test Spooler (Built-in)" for virtual testing, or a physical printer.`);
      setTimeout(() => setErrorMsg(null), 6000);
      return;
    }

    try {
      setIsPrinting(true);
      await invoke("start_multi_order_batch_print", {
        orderIds: orderIds && orderIds.length > 0 ? orderIds : null,
        fallbackPrinter: selectedPrinter,
      });
      setIsSpoolerModalOpen(true);
    } catch (err) {
      setIsPrinting(false);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.toLowerCase().includes("license") || errMsg.toLowerCase().includes("balance") || errMsg.toLowerCase().includes("authorization")) {
        setIsLicenseModalOpen(true);
      }
      setErrorMsg(`Batch print launch failed: ${errMsg}`);
      setTimeout(() => setErrorMsg(null), 5000);
    }
  }

  async function handlePrintSingleFile(fileId: string, filename: string) {
    if (licenseState && !licenseState.isValid) {
      setIsLicenseModalOpen(true);
      setErrorMsg(`Print Authorization Paused: ${licenseState.statusMessage}`);
      return;
    }

    if (!selectedPrinter) {
      setErrorMsg("Please select a target printer first.");
      setTimeout(() => setErrorMsg(null), 4000);
      return;
    }

    const currentPrinter = printers.find(p => p.name === selectedPrinter);
    if (currentPrinter?.requiresPrompt) {
      setErrorMsg(`"${selectedPrinter}" requires an interactive Windows 'Save As' prompt and cannot be used in headless mode. Please select a virtual or physical printer.`);
      setTimeout(() => setErrorMsg(null), 6000);
      return;
    }

    try {
      setIsPrinting(true);
      await invoke("start_single_file_batch_print", {
        fileId,
        fallbackPrinter: selectedPrinter,
      });
      setIsSpoolerModalOpen(true);
    } catch (err) {
      setIsPrinting(false);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.toLowerCase().includes("license") || errMsg.toLowerCase().includes("balance") || errMsg.toLowerCase().includes("authorization")) {
        setIsLicenseModalOpen(true);
      }
      setErrorMsg(`Failed to print document "${filename}": ${errMsg}`);
      setTimeout(() => setErrorMsg(null), 6000);
    }
  }

  async function handleChangeFilePrinter(fileId: string, filename: string, targetPrinter: string) {
    if (!selectedOrderDetails) return;
    try {
      await invoke("set_file_target_printer", {
        fileId,
        targetPrinter: targetPrinter ? targetPrinter : null,
      });
      const [refreshed, updatedOrders] = await Promise.all([
        invoke<OrderDetailDto | null>("get_order_details", { orderId: selectedOrderDetails.order.id }),
        invoke<OrderSummaryDto[]>("list_incoming_orders"),
      ]);
      if (refreshed) {
        setSelectedOrderDetails(refreshed);
      }
      setOrders(updatedOrders);
      setActionSuccessMsg(
        targetPrinter
          ? `Printer override for "${filename}" set to: ${targetPrinter}`
          : `Printer for "${filename}" restored to Automatic Selection`
      );
      setTimeout(() => setActionSuccessMsg(null), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleToggleFileExclusion(fileId: string, currentExcluded: boolean) {
    if (!selectedOrderDetails) return;
    try {
      await invoke("toggle_file_exclusion", { fileId, isExcluded: !currentExcluded });
      const [refreshed, refreshedBilling] = await Promise.all([
        invoke<OrderDetailDto | null>("get_order_details", { orderId: selectedOrderDetails.order.id }),
        invoke<OrderBilling | null>("get_order_billing", { orderId: selectedOrderDetails.order.id }),
      ]);
      if (refreshed) {
        setSelectedOrderDetails(refreshed);
      }
      if (refreshedBilling) {
        setSelectedOrderBilling(refreshedBilling);
      }
      const updatedOrders = await invoke<OrderSummaryDto[]>("list_incoming_orders");
      setOrders(updatedOrders);
      setActionSuccessMsg(!currentExcluded ? "File rejected and excluded from print batch." : "File approved and included in print batch.");
      setTimeout(() => setActionSuccessMsg(null), 2500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRestoreOrder(orderId: string) {
    try {
      await invoke("restore_order", { orderId });
      setActionSuccessMsg(`Order #${orderId.substring(0, 8)} restored to Active Orders.`);
      const updatedOrders = await invoke<OrderSummaryDto[]>("list_incoming_orders");
      setOrders(updatedOrders);
      setTimeout(() => setActionSuccessMsg(null), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handlePurgeOrder(orderId: string) {
    try {
      await invoke("purge_order", { orderId });
      setActionSuccessMsg(`Order #${orderId.substring(0, 8)} permanently purged.`);
      const updatedOrders = await invoke<OrderSummaryDto[]>("list_incoming_orders");
      setOrders(updatedOrders);
      if (selectedOrderDetails?.order.id === orderId) {
        setSelectedOrderDetails(null);
      }
      setTimeout(() => setActionSuccessMsg(null), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleEmptyDustbin() {
    if (!confirm("Are you sure you want to permanently clear all rejected and erased orders from the Dustbin?")) return;
    try {
      const count = await invoke<number>("empty_dustbin");
      setActionSuccessMsg(`Dustbin emptied: ${count} orders permanently cleared.`);
      const updatedOrders = await invoke<OrderSummaryDto[]>("list_incoming_orders");
      setOrders(updatedOrders);
      setTimeout(() => setActionSuccessMsg(null), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  function handleCopyUrl() {
    if (session?.accessUrl) {
      navigator.clipboard.writeText(session.accessUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleSaveWifi() {
    if (!wifiEditSsid.trim()) return;
    setIsSavingWifi(true);
    try {
      const updated = await invoke<WifiInfo>("save_wifi_config", {
        ssid: wifiEditSsid.trim(),
        password: wifiEditPassword,
        authType: wifiEditAuth,
        isHidden: wifiEditHidden,
      });
      setWifiInfo(updated);
      setShowWifiEdit(false);
      setActionSuccessMsg(`Wi-Fi updated for "${updated.ssid}". QR refreshed!`);
      setTimeout(() => setActionSuccessMsg(null), 4000);
    } catch (err: any) {
      console.error("Failed to save Wi-Fi config:", err);
      setErrorMsg(err.toString());
    } finally {
      setIsSavingWifi(false);
    }
  }

  async function handleResetWifiToSystem() {
    setIsSavingWifi(true);
    try {
      const updated = await invoke<WifiInfo>("reset_wifi_to_system");
      setWifiInfo(updated);
      setWifiEditSsid(updated.ssid);
      setWifiEditPassword(updated.password || "");
      setWifiEditAuth(updated.authType);
      setWifiEditHidden(updated.isHidden);
      setShowWifiEdit(false);
      setActionSuccessMsg(`Re-synced with Windows host Wi-Fi ("${updated.ssid}")`);
      setTimeout(() => setActionSuccessMsg(null), 4000);
    } catch (err: any) {
      console.error("Failed to reset Wi-Fi to system:", err);
      setErrorMsg(err.toString());
    } finally {
      setIsSavingWifi(false);
    }
  }

  async function autoStart4G5GTunnel() {
    setIsTunnelLoading(true);
    try {
      const current = await invoke<TunnelInfo>("get_public_tunnel_status");
      if (current && current.isActive) {
        setTunnelInfo(current);
        setIsTunnelLoading(false);
        return;
      }
      const info = await invoke<TunnelInfo>("start_public_tunnel");
      setTunnelInfo(info);
      if (info.isActive) {
        setActionSuccessMsg("🌐 4G/5G Internet Tunnel activated automatically! Ready for any camera.");
        setTimeout(() => setActionSuccessMsg(null), 4000);
      }
    } catch (err: any) {
      console.warn("Auto-start 4G/5G Tunnel notice:", err);
      const errMsg = err?.message || String(err);
      setTunnelInfo({
        isActive: false,
        isConnecting: false,
        url: null,
        qrSvg: null,
        qrDataUrl: null,
        protocol: "Cloudflare Quick Tunnel (TLS 1.3 / QUIC)",
        error: errMsg,
      });
    } finally {
      setIsTunnelLoading(false);
    }
  }

  async function handleStartTunnel() {
    wasTunnelManuallyStoppedRef.current = false;
    setIsTunnelLoading(true);
    try {
      const info = await invoke<TunnelInfo>("start_public_tunnel");
      setTunnelInfo(info);
      setActionSuccessMsg("🌐 4G/5G Internet Tunnel activated! Ready for any camera.");
      setTimeout(() => setActionSuccessMsg(null), 4000);
      setErrorMsg(null);
    } catch (err: any) {
      console.error("Failed to start tunnel:", err);
      const errMsg = err?.message || String(err);
      setTunnelInfo(prev => ({
        isActive: false,
        isConnecting: false,
        url: null,
        qrSvg: null,
        qrDataUrl: null,
        protocol: prev?.protocol || "Cloudflare Quick Tunnel (TLS 1.3 / QUIC)",
        error: errMsg,
      }));
    } finally {
      setIsTunnelLoading(false);
    }
  }

  async function handleStopTunnel() {
    wasTunnelManuallyStoppedRef.current = true;
    setIsTunnelLoading(true);
    try {
      const info = await invoke<TunnelInfo>("stop_public_tunnel");
      setTunnelInfo(info);
      setActionSuccessMsg("⏸️ 4G/5G Remote Tunnel stopped. Remote customers will see 'Shop Station Offline'. Local shop Wi-Fi remains active.");
      setTimeout(() => setActionSuccessMsg(null), 5000);
    } catch (err: any) {
      console.error("Failed to stop tunnel:", err);
    } finally {
      setIsTunnelLoading(false);
    }
  }

  // Continuous Windows 11 Internet Connection Monitor (Hardware adapter events + 5s reachability heartbeat)
  useEffect(() => {
    let isMounted = true;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const evaluateInternetConnection = async () => {
      try {
        const isConnected = await invoke<boolean>("check_internet_status");
        if (!isMounted) return;

        const previous = lastInternetStateRef.current;
        lastInternetStateRef.current = isConnected;
        setIsInternetOnline(isConnected);

        // Detect State Transitions
        if (previous !== null && previous !== isConnected) {
          if (!isConnected) {
            // TRANSITION: Online -> Offline
            console.warn("[Internet Monitor] Internet connection lost! Switching station to Offline Mode.");
            setErrorMsg("⚠️ Internet connection lost: Station switched to Offline Mode. (Local Shop Wi-Fi remains 100% active for counter printing).");
            setActionSuccessMsg(null);

            // If tunnel was active, update status to reflect offline
            setTunnelInfo(prev => prev?.isActive ? {
              ...prev,
              isActive: false,
              error: "App is in Offline Mode: Internet connection lost. Please check Windows Wi-Fi or Ethernet."
            } : prev);

          } else {
            // TRANSITION: Offline -> Online
            console.log("[Internet Monitor] Internet connection resumed! Triggering 4G/5G Tunnel auto-reconnection...");
            setErrorMsg(null);
            setActionSuccessMsg("🌐 Internet connection resumed! Auto-connecting 4G/5G Tunnel...");
            setTimeout(() => setActionSuccessMsg(null), 5000);

            // Automatically re-establish 4G/5G tunnel if it wasn't manually stopped
            if (!wasTunnelManuallyStoppedRef.current) {
              autoStart4G5GTunnel();
            }
          }
        }
      } catch (e) {
        console.warn("[Internet Monitor] Connectivity probe error:", e);
      }
    };

    // Immediate initial probe on mount
    evaluateInternetConnection();

    // Fast-path OS hardware network change listeners
    const onOffline = () => evaluateInternetConnection();
    const onOnline = () => evaluateInternetConnection();

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    // Continuous 5-second resilient probe for WAN/ISP line drops
    pollInterval = setInterval(() => {
      evaluateInternetConnection();
    }, 5000);

    return () => {
      isMounted = false;
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  function handleCopyTunnelUrl() {
    if (tunnelInfo?.url) {
      navigator.clipboard.writeText(tunnelInfo.url);
      setTunnelCopied(true);
      setTimeout(() => setTunnelCopied(false), 2000);
    }
  }

  function handleCopyPermanentUrl() {
    navigator.clipboard.writeText(permanentPortalUrl);
    setPermanentPortalCopied(true);
    setTimeout(() => setPermanentPortalCopied(false), 2000);
  }

  function handleCopyWifiPassword() {
    if (wifiInfo?.password) {
      navigator.clipboard.writeText(wifiInfo.password);
      setWifiCopied(true);
      setTimeout(() => setWifiCopied(false), 2000);
    }
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  function isTodayOrder(ord: OrderSummaryDto): boolean {
    const rawDate = ord.completedAt || ord.createdAt;
    if (!rawDate) return false;
    const orderDate = rawDate.substring(0, 10);
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const localToday = `${year}-${month}-${day}`;
    return orderDate === localToday || orderDate === now.toISOString().substring(0, 10);
  }

  function exportLedgerCsv(ordersToExport: OrderSummaryDto[]) {
    const headers = [
      "Date",
      "Time",
      "Order ID",
      "Pickup PIN",
      "Customer Name",
      "Device / Source",
      "Customer Type",
      "Total Files",
      "File Names & Print Settings",
      "Total Amount (INR)",
      "Payment Status",
      "Payment Method",
      "Paid At",
      "Target Printer",
      "Status"
    ];

    const rows = ordersToExport.map(o => {
      const dateStr = o.completedAt ? o.completedAt.split(" ")[0] : o.createdAt.split(" ")[0];
      const timeStr = o.completedAt ? (o.completedAt.split(" ")[1] || "") : (o.createdAt.split(" ")[1] || "");
      const fileSpecs = (o.files || []).map(f => {
        return `${f.originalFilename} [${f.documentPages}p, ${f.copies}x, ${f.colorMode}, ${f.duplexMode}, ${f.paperSize}]`;
      }).join("; ");

      return [
        `"${dateStr}"`,
        `"${timeStr}"`,
        `"${o.id.substring(0, 8)}"`,
        `"${o.pickupCode || ""}"`,
        `"${(o.customerName || "Walk-In Customer").replace(/"/g, '""')}"`,
        `"${(o.deviceModel || "Mobile Web").replace(/"/g, '""')}"`,
        `"${o.customerType || "WALK_IN"}"`,
        o.totalFiles,
        `"${fileSpecs.replace(/"/g, '""')}"`,
        o.totalAmount !== undefined && o.totalAmount !== null ? o.totalAmount.toFixed(2) : "0.00",
        `"${o.paymentStatus || "UNPAID"}"`,
        `"${o.paymentMethod || ""}"`,
        `"${o.paidAt || ""}"`,
        `"${o.targetPrinter || ""}"`,
        `"${o.status}"`
      ].join(",");
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    const today = new Date().toISOString().split("T")[0];
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `printdrop_print_jobs_ledger_${today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function matchesHistoryDateFilter(dateStr: string, filter: "ALL" | "TODAY" | "YESTERDAY" | "WEEK" | "MONTH"): boolean {
    if (filter === "ALL") return true;
    if (!dateStr) return false;
    
    const orderDate = dateStr.substring(0, 10);
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const todayStr = `${year}-${month}-${day}`;
    
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yYear = yesterday.getFullYear();
    const yMonth = String(yesterday.getMonth() + 1).padStart(2, "0");
    const yDay = String(yesterday.getDate()).padStart(2, "0");
    const yesterdayStr = `${yYear}-${yMonth}-${yDay}`;
    
    if (filter === "TODAY") return orderDate === todayStr || orderDate === now.toISOString().substring(0, 10);
    if (filter === "YESTERDAY") return orderDate === yesterdayStr || orderDate === yesterday.toISOString().substring(0, 10);
    if (filter === "WEEK") {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const wYear = weekAgo.getFullYear();
      const wMonth = String(weekAgo.getMonth() + 1).padStart(2, "0");
      const wDay = String(weekAgo.getDate()).padStart(2, "0");
      const weekAgoStr = `${wYear}-${wMonth}-${wDay}`;
      return orderDate >= weekAgoStr;
    }
    if (filter === "MONTH") {
      return orderDate.startsWith(`${year}-${month}`);
    }
    return true;
  }

  function groupOrdersByDate(ordersList: OrderSummaryDto[]) {
    const groups: { [dateKey: string]: { displayDate: string; orders: OrderSummaryDto[]; totalAmount: number } } = {};
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const todayStr = `${year}-${month}-${day}`;

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yYear = yesterday.getFullYear();
    const yMonth = String(yesterday.getMonth() + 1).padStart(2, "0");
    const yDay = String(yesterday.getDate()).padStart(2, "0");
    const yesterdayStr = `${yYear}-${yMonth}-${yDay}`;

    for (const ord of ordersList) {
      const rawDate = ord.completedAt || ord.createdAt;
      const dateKey = rawDate ? rawDate.substring(0, 10) : "Unknown Date";

      if (!groups[dateKey]) {
        let displayDate = dateKey;
        try {
          const d = new Date(dateKey + "T00:00:00");
          const formatted = d.toLocaleDateString(undefined, {
            weekday: "long",
            year: "numeric",
            month: "short",
            day: "numeric",
          });
          if (dateKey === todayStr) {
            displayDate = `Today — ${formatted}`;
          } else if (dateKey === yesterdayStr) {
            displayDate = `Yesterday — ${formatted}`;
          } else {
            displayDate = formatted;
          }
        } catch {
          displayDate = dateKey;
        }

        groups[dateKey] = {
          displayDate,
          orders: [],
          totalAmount: 0,
        };
      }

      groups[dateKey].orders.push(ord);
      groups[dateKey].totalAmount += ord.totalAmount || 0;
    }

    // Sort orders inside each date group with latest on top
    for (const key of Object.keys(groups)) {
      groups[key].orders.sort((a, b) => {
        const timeA = a.completedAt || a.createdAt || "";
        const timeB = b.completedAt || b.createdAt || "";
        return timeB.localeCompare(timeA);
      });
    }

    return Object.keys(groups)
      .sort((a, b) => b.localeCompare(a))
      .map(key => ({
        dateKey: key,
        ...groups[key],
      }));
  }

  const completedOrders = orders.filter(o => o.status === "COMPLETED" || o.status === "PURGED_BY_CUSTOMER");
  const todayCompletedOrders = completedOrders.filter(o => isTodayOrder(o));

  const filteredHistoryOrders = completedOrders.filter(o => {
    const rawDate = o.completedAt || o.createdAt;
    if (!matchesHistoryDateFilter(rawDate, historyDateFilter)) {
      return false;
    }

    if (historyPaymentFilter === "PAID" && o.paymentStatus !== "PAID") return false;
    if (historyPaymentFilter === "CASH" && (o.paymentStatus !== "PAID" || o.paymentMethod !== "CASH")) return false;
    if (historyPaymentFilter === "ONLINE" && (o.paymentStatus !== "PAID" || o.paymentMethod !== "ONLINE")) return false;
    if (historyPaymentFilter === "UNPAID" && o.paymentStatus === "PAID") return false;

    if (historySearchTerm.trim()) {
      const q = historySearchTerm.trim().toLowerCase().replace("#", "");
      const matchId = o.id.toLowerCase().includes(q);
      const matchPin = (o.pickupCode || "").toLowerCase().includes(q);
      const matchName = (o.customerName || "").toLowerCase().includes(q);
      const matchDevice = (o.deviceModel || "").toLowerCase().includes(q);
      const matchFile = (o.files || []).some(f => f.originalFilename.toLowerCase().includes(q));
      return matchId || matchPin || matchName || matchDevice || matchFile;
    }

    return true;
  });

  const totalCollections = completedOrders
    .filter(o => o.paymentStatus === "PAID")
    .reduce((acc, o) => acc + (o.totalAmount || 0), 0);

  const cashCollections = completedOrders
    .filter(o => o.paymentStatus === "PAID" && o.paymentMethod === "CASH")
    .reduce((acc, o) => acc + (o.totalAmount || 0), 0);

  const onlineCollections = completedOrders
    .filter(o => o.paymentStatus === "PAID" && o.paymentMethod === "ONLINE")
    .reduce((acc, o) => acc + (o.totalAmount || 0), 0);

  const unpaidCollections = completedOrders
    .filter(o => o.paymentStatus !== "PAID")
    .reduce((acc, o) => acc + (o.totalAmount || 0), 0);

  const paidOrdersCount = completedOrders.filter(o => o.paymentStatus === "PAID").length;
  const cashOrdersCount = completedOrders.filter(o => o.paymentStatus === "PAID" && o.paymentMethod === "CASH").length;
  const onlineOrdersCount = completedOrders.filter(o => o.paymentStatus === "PAID" && o.paymentMethod === "ONLINE").length;
  const unpaidOrdersCount = completedOrders.filter(o => o.paymentStatus !== "PAID").length;

  const dateGroupedHistory = groupOrdersByDate(filteredHistoryOrders);

  function renderCustomerJobCard(ord: OrderSummaryDto, _isInsideLedger: boolean = false) {
    const isPurged = ord.status === "PURGED_BY_CUSTOMER" || ord.isAllPurged || ord.activeFilesCount === 0;
    const isUnpaid = ord.paymentStatus !== "PAID" && !isPurged && ord.status !== "REJECTED";
    const isFilesExpanded = expandedFilesOrderIds.has(ord.id);

    return (
      <div
        key={ord.id}
        className={`border rounded-2xl p-4 transition-all shadow-sm space-y-3 ${
          isPurged
            ? "bg-slate-950/85 border-slate-800/90 hover:border-slate-700"
            : isUnpaid
            ? "bg-gradient-to-r from-amber-950/40 via-slate-950/90 to-amber-950/20 border-amber-600/70 hover:border-amber-500 shadow-md shadow-amber-950/30"
            : "bg-slate-950/80 hover:bg-slate-950 border-teal-900/60 hover:border-teal-700/80"
        }`}
      >
        {/* Section 1: Header Row Pane (Click to Expand / Collapse Files Box) */}
        <div
          onClick={() => toggleOrderFilesExpanded(ord.id)}
          className="flex items-center justify-between gap-3 overflow-x-auto no-scrollbar py-0.5 cursor-pointer select-none group"
          title={isFilesExpanded ? "Click to collapse files list" : "Click to expand itemized files list"}
        >
          <div className="flex items-center gap-2 flex-nowrap shrink-0 min-w-0">
            {ord.corporateClientName && (
              <span className="text-xs bg-gradient-to-r from-purple-950 to-indigo-950 text-purple-300 border border-purple-700/60 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1 shadow-sm whitespace-nowrap shrink-0">
                <Building2 className="w-3.5 h-3.5 text-purple-400" />
                <span>{ord.corporateClientName}</span>
                {ord.corporatePersonName && (
                  <span className="text-purple-200/70 font-normal">({ord.corporatePersonName})</span>
                )}
              </span>
            )}
            {ord.pickupCode && (
              <span className={`font-mono font-black text-xs sm:text-sm px-2.5 py-0.5 rounded shadow-sm flex items-center gap-1 whitespace-nowrap shrink-0 ${
                isUnpaid
                  ? "bg-gradient-to-r from-amber-400 to-orange-400 text-slate-950 ring-2 ring-amber-500/50 shadow-md shadow-amber-500/30"
                  : "bg-amber-400 text-slate-950"
              }`}>
                <Tag className="w-3.5 h-3.5 text-slate-950" />
                #{ord.pickupCode}
              </span>
            )}
            {ord.customerName ? (
              <span className="font-bold text-sm sm:text-base text-white flex items-center gap-1.5 whitespace-nowrap shrink-0">
                <User className="w-3.5 h-3.5 text-indigo-400" />
                {ord.customerName}
              </span>
            ) : (
              <span className="font-mono font-bold text-sm text-indigo-300 whitespace-nowrap shrink-0">
                #{ord.id.substring(0, 8)}
              </span>
            )}
            {ord.deviceModel && (
              <span className="text-xs bg-slate-800 text-slate-300 border border-slate-700/60 px-2.5 py-0.5 rounded-full flex items-center gap-1 font-medium whitespace-nowrap shrink-0">
                <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                {ord.deviceModel}
              </span>
            )}
            <span className="text-xs bg-slate-800/90 text-slate-400 px-2 py-0.5 rounded font-mono whitespace-nowrap shrink-0">
              Rev {ord.revisionNumber}
            </span>
            <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${
              ord.customerType === "REMOTE"
                ? "bg-cyan-950/70 text-cyan-300 border-cyan-800/60"
                : "bg-slate-900 text-slate-300 border-slate-700/60"
            }`}>
              {ord.customerType === "REMOTE" ? "🌐 Remote" : "🚶 Walk-In"}
            </span>
            {ord.totalAmount !== undefined && ord.totalAmount !== null && (
              <span className="font-mono font-bold text-xs sm:text-sm bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 px-2.5 py-0.5 rounded-full shadow-sm flex items-center gap-1 whitespace-nowrap shrink-0">
                💰 ₹{ord.totalAmount.toFixed(2)}
              </span>
            )}
            {ord.paymentStatus && (
              <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${
                ord.paymentStatus === "PAID"
                  ? "bg-emerald-950 text-emerald-400 border-emerald-700/70"
                  : ord.paymentStatus === "CREDIT"
                  ? "bg-purple-950 text-purple-300 border-purple-700/70"
                  : "bg-gradient-to-r from-amber-950 to-orange-950 text-amber-300 border-amber-600/80 shadow-sm"
              }`}>
                {ord.paymentStatus === "PAID"
                  ? `✅ Paid (${ord.paymentMethod || "CASH"})`
                  : ord.paymentStatus === "CREDIT"
                  ? "📋 Credit"
                  : "⏳ Unpaid"}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2 shrink-0 ml-auto pl-2">
            {isPurged ? (
              <span className="text-xs sm:text-sm font-semibold bg-slate-900 text-slate-300 border border-slate-700/80 px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Files Erased (Privacy Shield)
              </span>
            ) : (
              <span className="text-xs sm:text-sm font-semibold bg-teal-950/80 text-teal-300 border border-teal-800/70 px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />
                Printed / Complete
              </span>
            )}

            {/* Expand / Collapse Chevron indicator button */}
            {ord.files && ord.files.length > 0 && (
              <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg border transition shrink-0 ${
                isFilesExpanded
                  ? "bg-indigo-950/80 text-indigo-300 border-indigo-700/70"
                  : "bg-slate-900 text-slate-400 border-slate-800 group-hover:text-white group-hover:border-slate-700"
              }`}>
                <span>{ord.files.length} {ord.files.length === 1 ? "file" : "files"}</span>
                {isFilesExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5 text-indigo-400" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                )}
              </span>
            )}
          </div>
        </div>

        {/* Section 2: Itemized File List (Expanded View - Click anywhere to collapse) */}
        {isFilesExpanded && ord.files && ord.files.length > 0 && (
          <div
            onClick={() => toggleOrderFilesExpanded(ord.id)}
            className="bg-slate-900/85 hover:bg-slate-900 border border-slate-800/90 hover:border-indigo-500/50 rounded-xl p-2.5 space-y-1.5 cursor-pointer select-none transition-all shadow-inner animate-fade-in"
            title="Click anywhere to collapse files view"
          >
            <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1 pb-1 border-b border-slate-800/60">
              <span className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-teal-400" />
                <span className="text-slate-200">Documents & Files ({ord.files.length})</span>
                <span className="text-[10px] text-slate-500 font-normal">(Click anywhere on box to collapse)</span>
              </span>
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <span>Print Specs & Charges</span>
                <ChevronUp className="w-3.5 h-3.5 text-indigo-400" />
              </span>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
              {ord.files.map((f, idx) => {
                const filePrinterLabel = f.printedOn || f.targetPrinter || f.autoPrinter || ord.targetPrinter;
                return (
                <div key={idx} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg hover:bg-slate-800/50 transition gap-2">
                  <div className="flex items-center gap-2 truncate min-w-0 flex-1">
                    <span className="text-xs font-mono font-bold bg-slate-800 text-slate-300 px-2 py-0.5 rounded uppercase shrink-0 border border-slate-700/60">
                      {f.originalFilename.split(".").pop() || "DOC"}
                    </span>
                    <span className="font-medium text-xs sm:text-sm text-slate-200 truncate" title={f.originalFilename}>
                      {f.originalFilename}
                    </span>
                    {filePrinterLabel && (
                      <span
                        className="text-[11px] bg-teal-950/70 text-teal-300 border border-teal-800/60 px-2 py-0.5 rounded-md flex items-center gap-1 shrink-0 font-semibold"
                        title={f.printedOn ? `Printed on ${f.printedOn}` : `Assigned printer: ${filePrinterLabel}`}
                      >
                        <Printer className="w-3 h-3 text-teal-400" />
                        <span>{filePrinterLabel}</span>
                      </span>
                    )}
                    {f.isPurged || isPurged ? (
                      <span className="text-[10px] bg-slate-900 text-slate-400 border border-slate-800 px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0" title="File removed from disk for customer privacy">
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        Erased
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2.5 text-xs sm:text-sm font-semibold text-slate-300 shrink-0">
                    <span className="bg-slate-800/90 border border-slate-700/80 px-2.5 py-1 rounded-lg text-slate-200 shadow-sm">
                      {f.documentPages}p × {f.copies}c • {f.paperSize} • {f.colorMode === "COLOR" ? "Color" : "B&W"}
                    </span>
                    {f.subtotal !== undefined && f.subtotal !== null && (
                      <span className="font-mono font-bold text-xs sm:text-sm text-emerald-300 bg-emerald-950/80 border border-emerald-700/70 px-2.5 py-1 rounded-lg shadow-sm">
                        ₹{f.subtotal.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Inline Quick Payment recording if Unpaid */}
        {ord.paymentStatus !== "PAID" && (
          <div className="flex items-center justify-between gap-2 p-2.5 bg-gradient-to-r from-amber-950/60 to-slate-900/80 border border-amber-600/70 rounded-xl text-xs shadow-sm">
            <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
              <span>⚠️ Payment Due:</span>
              <span className="font-mono font-bold text-sm text-amber-200">₹{(ord.totalAmount || 0).toFixed(2)}</span>
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400 mr-1 font-medium">Mark Paid:</span>
              <button
                type="button"
                onClick={() => handleUpdatePayment(ord.id, "PAID", "CASH")}
                className="px-2.5 py-1 bg-emerald-950/90 hover:bg-emerald-900 text-emerald-200 border border-emerald-600/60 rounded-lg text-xs font-bold transition cursor-pointer shadow-sm"
              >
                💵 Cash
              </button>
              <button
                type="button"
                onClick={() => handleUpdatePayment(ord.id, "PAID", "ONLINE")}
                className="px-2.5 py-1 bg-indigo-950/90 hover:bg-indigo-900 text-indigo-200 border border-indigo-600/60 rounded-lg text-xs font-bold transition cursor-pointer shadow-sm"
              >
                📱 UPI
              </button>
              <button
                type="button"
                onClick={() => handleUpdatePayment(ord.id, "CREDIT")}
                className="px-2.5 py-1 bg-purple-950/90 hover:bg-purple-900 text-purple-200 border border-purple-600/60 rounded-lg text-xs font-bold transition cursor-pointer shadow-sm"
              >
                📋 Credit
              </button>
            </div>
          </div>
        )}

        {/* Footer info & action buttons */}
        <div className="flex items-center justify-between text-xs text-slate-400 pt-1 border-t border-slate-800/60">
          <div className="flex items-center gap-3.5 flex-wrap">
            <span className="flex items-center gap-1 text-slate-300 font-medium">
              <FileText className="w-3.5 h-3.5 text-indigo-400" />
              {ord.totalFiles} {ord.totalFiles === 1 ? "File" : "Files"} ({formatBytes(ord.totalBytes)})
            </span>
            {ord.targetPrinter && (
              <span className="text-slate-400 flex items-center gap-1">
                <Printer className="w-3 h-3 text-slate-400" />
                {ord.targetPrinter}
              </span>
            )}
            {ord.completedAt ? (
              <span className="text-teal-400 font-medium flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Completed: {ord.completedAt}
              </span>
            ) : (
              <span className="text-slate-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {ord.createdAt.substring(11, 16)}
              </span>
            )}
            {ord.paidAt && (
              <span className="text-emerald-400 font-medium flex items-center gap-1">
                <Check className="w-3 h-3" />
                Paid: {ord.paidAt}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => inspectOrder(ord.id)}
              className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded-lg text-xs font-semibold transition border border-slate-700 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{isPurged ? "Inspect Details" : "Inspect & Reprint"}</span>
            </button>

            {isPurged ? (
              <span
                className="flex items-center gap-1.5 bg-slate-900 text-slate-400 border border-slate-800 px-2.5 py-1 rounded-lg text-xs font-semibold select-none cursor-default"
                title="Customer erased all document files from the computer for privacy. Order metadata and transaction details are preserved."
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/80" />
                <span>Files Erased</span>
              </span>
            ) : (
              <button
                onClick={() => handleTriggerPrint(ord.id)}
                className="flex items-center gap-1 bg-teal-900/80 hover:bg-teal-800 text-teal-200 border border-teal-700/60 px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer"
                title={`Reprint all files (${ord.targetPrinter || selectedPrinter})`}
              >
                <RotateCcw className="w-3.5 h-3.5 text-teal-400" />
                <span>Reprint All</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const activeInterface = interfaces.find(i => i.ip === selectedIp);

  return (
    <div className="h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white overflow-hidden">
      {/* Top Header */}
      <header className="flex-shrink-0 border-b border-slate-800 bg-[#0f172a] px-4 sm:px-6 py-2 sm:py-2.5 flex flex-wrap items-center justify-between gap-2 sm:gap-3 sticky top-0 z-30 shadow-md">
        {/* PrintDrop Brand & Logo Launcher (Click to Return to Home Dashboard) */}
        <div
          onClick={() => {
            setIsViewingAllHistory(false);
            setIsOrderManagementMaximized(false);
          }}
          className="flex items-center space-x-2.5 cursor-pointer select-none group"
          title="PrintDrop Home Dashboard (Click to return to home)"
        >
          <div className="p-2 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-500/25 group-hover:scale-105 group-hover:bg-indigo-500 transition-all">
            <Printer className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2 group-hover:text-indigo-200 transition-colors">
              {licenseState?.shopName &&
              licenseState.shopName.trim() !== "" &&
              licenseState.shopName.trim() !== "PrintDrop Retail Station"
                ? licenseState.shopName.trim()
                : "PrintDrop"}
              <span className="text-[10px] uppercase tracking-wider bg-indigo-900/70 text-indigo-300 border border-indigo-700/60 px-2 py-0.5 rounded-full font-semibold">
                {(!licenseState || licenseState.planType === 'TRIAL') ? 'Demo Station' : 'Shopkeeper Station'}
              </span>
              {status?.version && (
                <span
                  className="text-[10px] font-mono bg-slate-800/90 text-slate-300 border border-slate-700/80 px-1.5 py-0.5 rounded-md font-semibold"
                  title={`PrintDrop v${status.version}`}
                >
                  v{status.version}
                </span>
              )}
            </h1>
            <p className="text-[11px] text-slate-400 group-hover:text-slate-300 transition-colors">
              {licenseState?.shopName &&
              licenseState.shopName.trim() !== "" &&
              licenseState.shopName.trim() !== "PrintDrop Retail Station"
                ? `Powered by PrintDrop • Contact: ${providerProfile?.contactPhone || licenseState?.providerContactPhone || "8108101790"}`
                : "Batch Print Automation & Custom Print Workflow"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2.5">
          {/* Active Target Printer Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 rounded-xl px-2.5 py-1 text-xs shadow-sm">
            <Printer className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-slate-400 font-medium">Printer:</span>
            <select
              value={selectedPrinter}
              onChange={(e) => {
                setSelectedPrinter(e.target.value);
                const chosen = printers.find(p => p.name === e.target.value);
                if (chosen?.requiresPrompt) {
                  setErrorMsg(`Notice: "${chosen.name}" requires an interactive Windows file prompt and cannot be automated headlessly. For offline testing, select "Virtual Test Spooler (Built-in)" or a physical printer.`);
                  setTimeout(() => setErrorMsg(null), 6000);
                }
              }}
              className="bg-transparent text-slate-200 font-semibold focus:outline-none cursor-pointer max-w-[150px] lg:max-w-[190px] xl:max-w-[210px] truncate"
            >
              {printers.map((p) => (
                <option key={p.name} value={p.name} className="bg-slate-900 text-white">
                  {p.name} {p.requiresPrompt ? "⚠️ (Save Prompt)" : p.isDefault ? "(Default)" : p.isVirtual ? "[Virtual]" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Multi-Printer Routing Launcher */}
          <button
            type="button"
            onClick={() => {
              setIsViewingAllHistory(false);
              setIsRoutingModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 bg-slate-900 hover:bg-slate-800 text-cyan-300 hover:text-cyan-200 border border-cyan-500/30 rounded-xl text-xs font-semibold shadow-sm transition"
            title="Configure intelligent multi-printer routing (B&W Laser, Color Tank, Plotter)"
          >
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span><span className="hidden xl:inline">Route </span>Rules</span>
          </button>

          {/* Settings & System Tools Dropdown Menu (Hover to reveal, click option to open) */}
          <div
            id="settings-dropdown-container"
            className="relative"
            onMouseEnter={() => {
              if (settingsCloseTimerRef.current) clearTimeout(settingsCloseTimerRef.current);
              setIsSettingsMenuOpen(true);
            }}
            onMouseLeave={() => {
              settingsCloseTimerRef.current = setTimeout(() => {
                setIsSettingsMenuOpen(false);
              }, 180);
            }}
          >
            <button
              type="button"
              onClick={() => setIsSettingsMenuOpen(prev => !prev)}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-xl text-xs font-semibold shadow-sm transition border cursor-pointer ${
                isSettingsMenuOpen
                  ? "bg-indigo-600 text-white border-indigo-500 shadow-indigo-600/30"
                  : "bg-slate-900 hover:bg-slate-800 text-slate-200 border-slate-700 hover:border-slate-600"
              }`}
              title="Settings & System Tools (Hover to open, click option to select)"
            >
              <Settings className="w-3.5 h-3.5 text-indigo-400" />
              <span>Settings</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isSettingsMenuOpen ? "rotate-180 text-white" : "text-slate-400"}`} />
            </button>

            {/* Dropdown Menu Popover (100% Solid Opaque Background) */}
            {isSettingsMenuOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-72 border border-slate-700 rounded-2xl shadow-2xl shadow-black p-2 z-50 ring-1 ring-slate-600/50 space-y-1 text-left animate-fade-in"
                style={{ backgroundColor: "#0f172a", opacity: 1 }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* 1. Print Jobs & Financial Ledger */}
                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsMenuOpen(false);
                    setIsViewingAllHistory(true);
                  }}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white transition group border border-slate-800 hover:border-teal-500/50 cursor-pointer text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-teal-500/20 border border-teal-500/40 flex items-center justify-center text-teal-400 group-hover:scale-105 transition shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold flex items-center justify-between">
                      <span className="text-teal-200">Print Jobs &amp; Ledger</span>
                      <span className="text-[10px] font-mono bg-teal-900 text-teal-300 px-1.5 py-0.2 rounded-full font-semibold border border-teal-700/60">
                        {completedOrders.length}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      Customer specs, collections &amp; Excel export
                    </p>
                  </div>
                </button>

                <div className="border-t border-slate-800 my-1"></div>

                {/* Station Profile & Identity */}
                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsMenuOpen(false);
                    setIsViewingAllHistory(false);
                    setIsStationEditMode(true);
                    setIsStationSetupOpen(true);
                  }}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white transition group border border-slate-800 hover:border-indigo-500/50 cursor-pointer text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition shrink-0">
                    <Store className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-indigo-200">Station Profile &amp; Identity</div>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      {licenseState?.shopName && licenseState.shopName !== "PrintDrop Retail Station"
                        ? `${licenseState.shopName}${licenseState.city ? ` • ${licenseState.city}` : ""}`
                        : "Set Shop Name, Owner, Location & Mobile"}
                    </p>
                  </div>
                </button>

                {/* 2. Corporate Portals */}
                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsMenuOpen(false);
                    setIsViewingAllHistory(false);
                    setIsCorporateModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white transition group border border-slate-800 hover:border-purple-500/50 cursor-pointer text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400 group-hover:scale-105 transition shrink-0">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-purple-200">Corporate Portals</div>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      Client portals, authorized PINs &amp; credit tabs
                    </p>
                  </div>
                </button>

                {/* 3. Shopkeeper Printing Rates & Pricing */}
                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsMenuOpen(false);
                    setIsViewingAllHistory(false);
                    setIsPricingModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white transition group border border-slate-800 hover:border-blue-500/50 cursor-pointer text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400 group-hover:scale-105 transition shrink-0">
                    <IndianRupee className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-blue-200">Shopkeeper Printing Rates &amp; Pricing</div>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      Set customer charges for B&amp;W, Color, Duplex &amp; Paper sizes
                    </p>
                  </div>
                </button>

                {/* 4. UPI & BharatQR Settings */}
                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsMenuOpen(false);
                    setIsViewingAllHistory(false);
                    setIsPaymentSettingsModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white transition group border border-slate-800 hover:border-amber-500/50 cursor-pointer text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 group-hover:scale-105 transition shrink-0">
                    <QrIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-amber-200">UPI &amp; BharatQR Settings</div>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      Shopkeeper UPI ID &amp; standee Mode 19 setup
                    </p>
                  </div>
                </button>

                <div className="border-t border-slate-800 my-1"></div>

                {/* 5. Backup & Restore */}
                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsMenuOpen(false);
                    setIsViewingAllHistory(false);
                    setIsBackupModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white transition group border border-slate-800 hover:border-emerald-500/50 cursor-pointer text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition shrink-0">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-emerald-200">Backup &amp; Restore</div>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      Encrypted archives (.pdropbak) &amp; Excel reports
                    </p>
                  </div>
                </button>

                {/* 6. Station License & HWID */}
                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsMenuOpen(false);
                    setIsViewingAllHistory(false);
                    setIsLicenseModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white transition group border border-slate-800 hover:border-indigo-500/50 cursor-pointer text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition shrink-0">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-indigo-200">Station License &amp; HWID</div>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      {licenseState?.planDisplayName || "Free Trial Evaluation"} &bull; {licenseState?.hwid || "Hardware Bound"}
                    </p>
                  </div>
                </button>

                <div className="border-t border-slate-800 my-1"></div>

                {/* 7. Operator Manual & Help Guide */}
                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsMenuOpen(false);
                    setIsViewingAllHistory(false);
                    setIsHelpModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white transition group border border-slate-800 hover:border-amber-500/50 cursor-pointer text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 group-hover:scale-105 transition shrink-0">
                    <HelpCircle className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold flex items-center justify-between">
                      <span className="text-amber-200">Help &amp; Operator Guide</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        FAQ
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      Feature walkthrough, printer troubleshooting &amp; shortcuts
                    </p>
                  </div>
                </button>

                {/* 8. Check for Software Updates */}
                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsMenuOpen(false);
                    checkForAppUpdates(true);
                  }}
                  disabled={isCheckingUpdate}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white transition group border border-slate-800 hover:border-cyan-500/50 cursor-pointer text-left disabled:opacity-50"
                >
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition shrink-0">
                    <RefreshCw className={`w-4 h-4 ${isCheckingUpdate ? "animate-spin" : ""}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-cyan-200">
                      {isCheckingUpdate ? "Checking for Updates..." : "Check for Software Updates"}
                    </div>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      {availableUpdate ? `v${availableUpdate.version} ready to install` : "Verify latest signed release"}
                    </p>
                  </div>
                </button>

                {rollbackInfo?.available && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsSettingsMenuOpen(false);
                      handleLocalRollback();
                    }}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-200 hover:text-white transition group border border-rose-500/40 cursor-pointer text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0">
                      <RotateCcw className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-rose-200">
                        Restore Previous Version (v{rollbackInfo.previousVersion || "prev"})
                      </div>
                      <p className="text-[10px] text-rose-300/80 truncate mt-0.5">
                        Instant offline rollback to pre-update snapshot
                      </p>
                    </div>
                  </button>
                )}

                {/* 8. Contact Us & Software Provider Support (Last Option in Settings) */}
                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsMenuOpen(false);
                    setIsViewingAllHistory(false);
                    setIsContactUsModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white transition group border border-slate-800 hover:border-cyan-500/50 cursor-pointer text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition shrink-0">
                    <PhoneCall className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold flex items-center justify-between">
                      <span className="text-cyan-200">Contact Us</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                        Support
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      {providerProfile?.businessName || licenseState?.providerCompanyName || "TechnoSoft Solution"} &bull; WhatsApp &amp; Call
                    </p>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* License Status Header Pill */}
          {licenseState && (
            <button
              type="button"
              onClick={() => setIsLicenseModalOpen(true)}
              title="Click to view license details & hardware ID"
              className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 sm:px-3 py-1 rounded-full border shadow-sm transition hover:scale-105 cursor-pointer ${
                !licenseState.isValid
                  ? 'text-red-400 bg-red-950/80 border-red-700 animate-pulse'
                  : licenseState.isLicenseGraceActive
                  ? 'text-amber-300 bg-amber-950/90 border-amber-500 animate-pulse'
                  : licenseState.daysRemaining <= 3 && licenseState.daysRemaining > 0
                  ? 'text-amber-300 bg-amber-950/80 border-amber-600 animate-pulse'
                  : licenseState.planType === 'TRIAL'
                  ? 'text-blue-300 bg-blue-950/70 border-blue-800/80'
                  : licenseState.planType === 'WALLET_PAGES'
                  ? 'text-amber-300 bg-amber-950/70 border-amber-800/80'
                  : 'text-emerald-300 bg-emerald-950/70 border-emerald-800/80'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${
                !licenseState.isValid
                  ? 'bg-red-400 animate-ping'
                  : licenseState.isLicenseGraceActive
                  ? 'bg-amber-400 animate-ping'
                  : licenseState.daysRemaining <= 3 && licenseState.daysRemaining > 0
                  ? 'bg-amber-400'
                  : licenseState.planType === 'TRIAL'
                  ? 'bg-blue-400'
                  : licenseState.planType === 'WALLET_PAGES'
                  ? 'bg-amber-400'
                  : 'bg-emerald-400'
              }`} />
              <span>
                {licenseState.isLicenseGraceActive
                  ? `⚠️ Grace: ${licenseState.licenseGraceHoursRemaining != null ? `${licenseState.licenseGraceHoursRemaining}h` : `${licenseState.licenseGracePrintsRemaining} pgs`}`
                  : licenseState.planType === 'TRIAL'
                  ? `Trial: ${licenseState.daysRemaining}d`
                  : licenseState.planType === 'WALLET_PAGES'
                  ? `Wallet: ${licenseState.walletPagesRemaining?.toLocaleString() ?? 0} pgs`
                  : !licenseState.isValid
                  ? 'License Expired'
                  : licenseState.daysRemaining <= 3
                  ? `⏳ ${licenseState.daysRemaining}d Left`
                  : `Pro: ${licenseState.daysRemaining}d`}
              </span>
            </button>
          )}

          {/* Real-time Internet Connectivity & 4G/5G Tunnel Pill */}
          <div className="flex items-center gap-1.5">
            <span
              className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 sm:px-3 py-1 rounded-full border shadow-sm transition ${
                isInternetOnline === false
                  ? "text-amber-300 bg-amber-950/80 border-amber-600 animate-pulse"
                  : isInternetOnline === true && tunnelInfo?.isActive
                  ? "text-emerald-300 bg-emerald-950/70 border-emerald-800/80"
                  : "text-amber-300 bg-amber-950/60 border-amber-800/70"
              }`}
              title={
                isInternetOnline === false
                  ? "No Internet connection on Windows PC. Local Shop Wi-Fi remains operational."
                  : isInternetOnline === true && tunnelInfo?.isActive
                  ? "Windows 11 PC Internet & 4G/5G Remote Tunnel are active & operational."
                  : "Windows 11 PC has Internet, but 4G/5G remote tunnel is stopped (Local Wi-Fi only mode)."
              }
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isInternetOnline === false
                    ? "bg-amber-400"
                    : isInternetOnline === true && tunnelInfo?.isActive
                    ? "bg-emerald-400 animate-pulse"
                    : "bg-amber-400"
                }`}
              />
              <span>
                {isInternetOnline === false
                  ? "Offline Mode"
                  : isInternetOnline === true && tunnelInfo?.isActive
                  ? "4G/5G Online"
                  : "4G/5G Stopped"}
              </span>
            </span>

            {isInternetOnline === true && !tunnelInfo?.isActive && !isTunnelLoading && (
              <button
                type="button"
                onClick={handleStartTunnel}
                disabled={isTunnelLoading}
                className="hidden md:flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-950/80 hover:bg-emerald-900/80 border border-emerald-700/80 px-2.5 py-1 rounded-full shadow-sm transition cursor-pointer"
                title="Activate 4G/5G remote tunnel so customers can scan and upload via cellular data"
              >
                <Zap className="w-3 h-3 text-amber-300" />
                <span>Start 4G/5G</span>
              </button>
            )}
          </div>

          <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/70 px-2.5 sm:px-3 py-1 rounded-full shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span><span className="hidden sm:inline">Port </span>{status.receiverPort}</span>
          </span>
        </div>
      </header>

      {/* Main Workspace */}
      <main className={`flex-1 min-h-0 w-full mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4 flex flex-col overflow-y-auto ${isViewingAllHistory ? "max-w-[1920px] space-y-6" : "max-w-[1920px]"}`}>
        {/* Emergency Blocked-Version Rollback Banner (Layer 3) */}
        {isBlockedVersion && (
          <div className="p-3.5 mb-3 bg-gradient-to-r from-rose-950/95 via-slate-900 to-rose-950/95 border-2 border-rose-500 rounded-2xl text-rose-100 text-xs sm:text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-shrink-0 shadow-2xl relative z-20">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-9 h-9 rounded-xl bg-rose-500/20 border border-rose-400/40 flex items-center justify-center text-rose-300 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="font-extrabold text-white text-xs sm:text-sm">
                  ⚠️ Critical Issue Detected in v{status?.version}
                </div>
                <div className="text-[11px] text-rose-200 mt-0.5">
                  This release has been recalled by PrintDrop Support. Please restore the previous working version immediately.
                </div>
              </div>
            </div>
            {rollbackInfo?.available && (
              <button
                type="button"
                onClick={handleLocalRollback}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg transition flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restore v{rollbackInfo.previousVersion || "Previous"} Now</span>
              </button>
            )}
          </div>
        )}

        {/* In-App OTA Software Update Available Banner */}
        {availableUpdate && !isUpdateDismissed && (
          <div className="p-3.5 mb-3 bg-gradient-to-r from-indigo-950/95 via-slate-900 to-cyan-950/95 border border-cyan-500/60 rounded-2xl text-cyan-100 text-xs sm:text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-shrink-0 shadow-xl animate-fade-in relative z-20">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300 shrink-0">
                <Download className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="font-extrabold text-white text-xs sm:text-sm flex items-center gap-2">
                  <span>🚀 New PrintDrop Update Available: v{availableUpdate.version}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">Signed</span>
                </div>
                <div className="text-[11px] text-slate-300 truncate mt-0.5">
                  {availableUpdate.body || "Includes latest stability improvements, features, and security patches."}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleInstallUpdate}
                disabled={isInstallingUpdate}
                className="px-3.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-lg transition flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isInstallingUpdate ? "animate-spin" : ""}`} />
                <span>
                  {isInstallingUpdate
                    ? `Installing${updateProgressPct !== null ? ` (${updateProgressPct}%)` : "..."}`
                    : "Update & Restart"}
                </span>
              </button>
              {!isInstallingUpdate && (
                <button
                  type="button"
                  onClick={() => setIsUpdateDismissed(true)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                  title="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}
        {/* Emergency Grace Period Active Banner (48h for Subscriptions / 50 prints for Page Wallet) */}
        {licenseState && licenseState.isValid && licenseState.isLicenseGraceActive && (
          <div className="p-3.5 mb-3 bg-gradient-to-r from-amber-950/95 via-slate-900 to-amber-950/95 border-2 border-amber-500 rounded-2xl text-amber-100 text-xs sm:text-sm flex flex-col md:flex-row md:items-center justify-between gap-3 flex-shrink-0 shadow-2xl animate-fade-in relative z-20">
            <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-400 shrink-0 animate-pulse mt-0.5 sm:mt-0">
                <Clock className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-extrabold text-amber-300 uppercase tracking-wide text-xs">
                    ⚠️ Emergency Grace Period Active
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-200 border border-amber-400/40 text-[11px] font-mono font-bold">
                    {licenseState.licenseGraceHoursRemaining != null
                      ? `⏳ ${licenseState.licenseGraceHoursRemaining} Hours Left`
                      : licenseState.licenseGracePrintsRemaining != null
                      ? `📄 ${licenseState.licenseGracePrintsRemaining} Grace Prints Left`
                      : "Grace Active"}
                  </span>
                  <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                    <span>✓</span> Printing Unlocked
                  </span>
                </div>
                <div className="text-slate-300 text-xs">
                  <span>Your plan expired, but emergency grace is active so your customer service is not interrupted. </span>
                  <span className="text-amber-200 font-medium">Please renew now to avoid sudden counter lockout.</span>
                </div>
                {licenseState.providerContactPhone && (
                  <div className="text-[11px] text-slate-400 flex items-center gap-2 sm:gap-3 flex-wrap pt-0.5">
                    <span>Provider: <strong className="text-white">{licenseState.providerCompanyName || "TechnoSoft Solution"}</strong></span>
                    <span>&bull;</span>
                    <span>Call: <button type="button" onClick={() => handleCallProvider(licenseState.providerContactPhone)} className="text-cyan-400 hover:underline font-mono cursor-pointer">{licenseState.providerContactPhone}</button></span>
                    {licenseState.providerWhatsappNumber && (
                      <>
                        <span>&bull;</span>
                        <button
                          type="button"
                          onClick={() => handleOpenWhatsApp(licenseState.providerWhatsappNumber, "Please help me renew my station license.")}
                          className="text-emerald-400 hover:underline font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <MessageSquare className="w-3 h-3" />
                          <span>Chat on WhatsApp</span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
              <button
                type="button"
                onClick={() => setIsLicenseModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs shadow-lg transition active:scale-95 cursor-pointer flex items-center gap-1.5"
              >
                <span>⚡</span>
                <span>Renew License Now</span>
              </button>
            </div>
          </div>
        )}

        {/* Printing Authorization Paused Banner (Post-Grace or Trial Expired) */}
        {licenseState && !licenseState.isValid && (
          <div className="p-3.5 mb-3 bg-red-950/95 border-2 border-red-600 rounded-2xl text-red-200 text-xs sm:text-sm flex flex-col md:flex-row md:items-center justify-between gap-3 flex-shrink-0 shadow-2xl animate-fade-in relative z-20">
            <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
              <AlertTriangle className="w-6 h-6 flex-shrink-0 text-red-400 animate-pulse mt-0.5 sm:mt-0" />
              <div className="space-y-1">
                <div className="font-bold text-red-100 text-sm">Printing Authorization Paused</div>
                <div className="text-red-200 text-xs">{licenseState.statusMessage}</div>
                {licenseState.providerContactPhone && (
                  <div className="text-[11px] text-red-300/80 flex items-center gap-2 sm:gap-3 flex-wrap pt-0.5">
                    <span>Provider: <strong className="text-white">{licenseState.providerCompanyName || "TechnoSoft Solution"}</strong></span>
                    <span>&bull;</span>
                    <span>Call: <button type="button" onClick={() => handleCallProvider(licenseState.providerContactPhone)} className="text-cyan-300 hover:underline font-mono cursor-pointer">{licenseState.providerContactPhone}</button></span>
                    {licenseState.providerWhatsappNumber && (
                      <>
                        <span>&bull;</span>
                        <button
                          type="button"
                          onClick={() => handleOpenWhatsApp(licenseState.providerWhatsappNumber, "Please activate my station license.")}
                          className="text-emerald-400 hover:underline font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <MessageSquare className="w-3 h-3" />
                          <span>Chat on WhatsApp</span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsLicenseModalOpen(true)}
              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-lg transition active:scale-95 shrink-0 cursor-pointer self-end md:self-center"
            >
              Activate / Renew License
            </button>
          </div>
        )}

        {/* Expiring Soon Notice Banner (< 3 Days) */}
        {licenseState && licenseState.isValid && !licenseState.isLicenseGraceActive && licenseState.daysRemaining <= 3 && licenseState.daysRemaining > 0 && (
          <div className="p-3 sm:p-3.5 mb-3 bg-amber-950/90 border border-amber-500/80 rounded-2xl text-amber-200 text-xs sm:text-sm flex items-center justify-between gap-3 flex-shrink-0 shadow-lg animate-fade-in relative z-20">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <Clock className="w-5 h-5 flex-shrink-0 text-amber-400 animate-pulse" />
              <div>
                <span className="font-bold text-amber-100">License Expiring Soon: </span>
                <span>Your {licenseState.planDisplayName} expires in <b>{licenseState.daysRemaining} day(s)</b>. Renew now to prevent customer print queue interruption.</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsLicenseModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition active:scale-95 shrink-0 cursor-pointer"
            >
              Renew Plan
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 sm:p-3.5 mb-3 bg-red-950/90 border border-red-800/90 rounded-2xl text-red-200 text-xs sm:text-sm flex items-center justify-between gap-3 flex-shrink-0 shadow-lg animate-fade-in relative z-20">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 text-red-400" />
              <span className="break-words font-medium">{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="p-1 hover:bg-red-900/70 text-red-300 hover:text-white rounded-lg transition shrink-0 cursor-pointer"
              title="Dismiss error"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {actionSuccessMsg && (
          <div className="p-3 sm:p-3.5 mb-3 bg-emerald-950/90 border border-emerald-800 rounded-2xl text-emerald-200 text-xs sm:text-sm flex items-center justify-between gap-3 animate-fade-in flex-shrink-0 shadow-lg relative z-20">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 text-emerald-400" />
              <span className="break-words font-medium">{actionSuccessMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionSuccessMsg(null)}
              className="p-1 hover:bg-emerald-900/70 text-emerald-300 hover:text-white rounded-lg transition shrink-0 cursor-pointer"
              title="Dismiss message"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {isInternetOnline === true && !tunnelInfo?.isActive && !isTunnelLoading && (
          <div className="p-3 sm:p-3.5 mb-3 bg-gradient-to-r from-amber-950/80 via-slate-900 to-amber-950/80 border border-amber-600/60 rounded-2xl text-amber-200 text-xs sm:text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-shrink-0 shadow-lg animate-fade-in relative z-20">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="p-1.5 bg-amber-500/20 border border-amber-500/30 rounded-xl text-amber-400 shrink-0">
                <Globe className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-bold text-white text-xs sm:text-sm flex items-center gap-1.5">
                  <span>⏸️ 4G/5G Remote Tunnel is Stopped (Offline)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 font-semibold uppercase tracking-wider">Local Only</span>
                </span>
                <span className="text-[11px] sm:text-xs text-slate-300 mt-0.5 leading-relaxed">
                  Remote customer mobile uploads via 4G/5G cellular data are paused. Customers on mobile web see <em>"Shop Station Offline"</em>. Local Shop Wi-Fi printing remains 100% active.
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleStartTunnel}
              className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 text-amber-300" />
              <span>Start 4G/5G Tunnel</span>
            </button>
          </div>
        )}

        {isViewingAllHistory ? (
          <div className="space-y-6 animate-fade-in">
            {/* Header with Back Button and Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800 relative z-10">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsViewingAllHistory(false)}
                  className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-teal-300 hover:text-white border border-teal-700/70 hover:border-teal-500 rounded-xl transition flex items-center gap-2 text-xs font-bold shadow-md cursor-pointer shrink-0"
                  title="Back to Dashboard (Esc)"
                >
                  <ArrowLeft className="w-4 h-4 text-teal-400" />
                  <span>Back to Dashboard</span>
                </button>
                <div>
                  <h2 className="text-xl font-black text-white flex items-center gap-2">
                    <span>Print Jobs &amp; Financial Ledger</span>
                    <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-teal-950 text-teal-300 border border-teal-800">
                      {completedOrders.length} Total Jobs Till Date
                    </span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Complete chronological audit of customer print jobs, technical specifications, and financial collections
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => exportLedgerCsv(filteredHistoryOrders)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition shadow-sm cursor-pointer"
                  title="Export filtered records as Excel CSV spreadsheet"
                >
                  <Download className="w-3.5 h-3.5 text-teal-400" />
                  <span>Export Excel (CSV)</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition shadow-sm cursor-pointer"
                  title="Print summary ledger report"
                >
                  <Printer className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Print Report</span>
                </button>
              </div>
            </div>

            {/* Financial KPI Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Total Collections</span>
                  <IndianRupee className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="mt-2">
                  <span className="text-2xl font-black font-mono text-emerald-300">
                    ₹{totalCollections.toFixed(2)}
                  </span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {paidOrdersCount} Paid Transactions
                  </p>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Cash Payments</span>
                  <Banknote className="w-4 h-4 text-amber-400" />
                </div>
                <div className="mt-2">
                  <span className="text-2xl font-black font-mono text-amber-300">
                    ₹{cashCollections.toFixed(2)}
                  </span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {cashOrdersCount} Cash Slips
                  </p>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Online / UPI (Razorpay)</span>
                  <QrIcon className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="mt-2">
                  <span className="text-2xl font-black font-mono text-indigo-300">
                    ₹{onlineCollections.toFixed(2)}
                  </span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {onlineOrdersCount} UPI Transactions
                  </p>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Pending / Due</span>
                  <Clock className="w-4 h-4 text-rose-400" />
                </div>
                <div className="mt-2">
                  <span className="text-2xl font-black font-mono text-rose-300">
                    ₹{unpaidCollections.toFixed(2)}
                  </span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {unpaidOrdersCount} Unpaid Orders
                  </p>
                </div>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              {/* Date Filter Pills */}
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 overflow-x-auto text-xs font-semibold">
                {(["ALL", "TODAY", "YESTERDAY", "WEEK", "MONTH"] as const).map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setHistoryDateFilter(f)}
                    className={`px-3 py-1 rounded-lg transition whitespace-nowrap cursor-pointer ${
                      historyDateFilter === f
                        ? "bg-teal-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {f === "ALL" ? "All Dates" : f === "TODAY" ? "Today" : f === "YESTERDAY" ? "Yesterday" : f === "WEEK" ? "Last 7 Days" : "This Month"}
                  </button>
                ))}
              </div>

              {/* Payment Filter Pills */}
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 overflow-x-auto text-xs font-semibold">
                {(["ALL", "PAID", "CASH", "ONLINE", "UNPAID"] as const).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setHistoryPaymentFilter(p)}
                    className={`px-2.5 py-1 rounded-lg transition whitespace-nowrap cursor-pointer ${
                      historyPaymentFilter === p
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {p === "ALL" ? "All Payment" : p === "PAID" ? "All Paid" : p === "CASH" ? "Cash" : p === "ONLINE" ? "Online (UPI)" : "Unpaid"}
                  </button>
                ))}
              </div>

              {/* Search Input */}
              <div className="relative min-w-[220px]">
                <input
                  type="text"
                  placeholder="Search Customer / File / PIN..."
                  value={historySearchTerm}
                  onChange={e => setHistorySearchTerm(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-full"
                />
                {historySearchTerm && (
                  <button
                    onClick={() => setHistorySearchTerm("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
                  >
                    &times;
                  </button>
                )}
              </div>
            </div>

            {/* Date-Wise Grouped Feed */}
            {dateGroupedHistory.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-slate-500 text-xs text-center p-6 border-2 border-dashed border-slate-800 rounded-3xl bg-slate-900/40">
                <Calendar className="w-10 h-10 text-slate-700 mb-2 stroke-[1.5]" />
                <p className="font-medium text-slate-400">No customer print jobs match your filter</p>
                <p className="text-[11px] text-slate-500 mt-1 max-w-xs">
                  Try selecting "All Dates" or clearing the search box to view previous customer jobs.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {dateGroupedHistory.map(group => (
                  <div key={group.dateKey} className="space-y-3">
                    <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 px-4 py-2.5 rounded-2xl shadow-sm">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-teal-400" />
                        <span className="text-sm font-bold text-white">{group.displayDate}</span>
                        <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-mono">
                          {group.orders.length} {group.orders.length === 1 ? "Job" : "Jobs"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-emerald-400">
                        <span>Day Collections:</span>
                        <span>₹{group.totalAmount.toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {group.orders.map(ord => renderCustomerJobCard(ord, true))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
        /* Primary Row: QR Code Box + Incoming Orders Queue */
        <div className="grid grid-cols-1 lg:grid-cols-[510px_1fr] xl:grid-cols-[540px_1fr] gap-6 flex-1 min-h-0">
          {/* Customer Connect & QR Box - Optimal width (~510-540px) ensuring Desk Poster & tabs fit cleanly without cutting */}
          <div className="w-full max-w-[540px] mx-auto lg:mx-0 bg-gradient-to-b from-slate-900/90 to-slate-900/50 border border-slate-800/90 rounded-3xl p-3 sm:p-4 xl:p-5 flex flex-col justify-between text-center shadow-xl relative overflow-hidden self-start">
            {/* Top Bar: Navigation Tabs & Poster Launcher */}
            <div className="w-full flex flex-col gap-2.5 mb-3">
              <div className="flex items-center justify-between gap-1.5 sm:gap-2">
                {/* Mode Selector Tabs */}
                <div className="flex items-center gap-0.5 sm:gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-semibold shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveQrTab("permanent")}
                    className={`flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg transition whitespace-nowrap ${
                      activeQrTab === "permanent"
                        ? "bg-gradient-to-r from-amber-500 to-indigo-600 text-white shadow-sm shadow-amber-500/25"
                        : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                    }`}
                    title="Permanent Standee QR (Zero reprint needed, permanent entrypoint on GitHub Pages)"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                    <span>Permanent</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveQrTab("tunnel")}
                    className={`flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg transition whitespace-nowrap ${
                      activeQrTab === "tunnel"
                        ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm shadow-emerald-500/25"
                        : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                    }`}
                    title="Allow customers to scan on 4G/5G mobile data (No Wi-Fi needed)"
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-300" />
                    <span>4G/5G</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveQrTab("step2")}
                    className={`flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg transition whitespace-nowrap ${
                      activeQrTab === "step2"
                        ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/25"
                        : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                    }`}
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    <span>LAN</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveQrTab("step1")}
                    className={`flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg transition whitespace-nowrap ${
                      activeQrTab === "step1"
                        ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/25"
                        : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                    }`}
                  >
                    <Wifi className="w-3.5 h-3.5" />
                    <span>Wi-Fi</span>
                  </button>
                </div>

                {/* Print Signboard Poster Button */}
                <button
                  type="button"
                  onClick={() => setShowPosterModal(true)}
                  className="flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200 transition bg-amber-950/50 hover:bg-amber-900/60 border border-amber-700/60 px-2.5 py-1.5 rounded-xl shadow-sm shrink-0 ml-auto whitespace-nowrap"
                  title="Print customer countertop tent card / poster"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span className="font-semibold">Desk Poster</span>
                </button>
              </div>

              {/* Sub-status Indicator */}
              <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                {activeQrTab === "permanent" ? (
                  <>
                    <span className="flex items-center gap-1.5 text-amber-300 font-semibold">
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                      Permanent GitHub Portal
                    </span>
                    {tunnelInfo?.isActive ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-emerald-400 text-[10px] font-semibold flex items-center gap-1">
                          ● 4G/5G Live
                        </span>
                        <button
                          type="button"
                          onClick={handleStopTunnel}
                          disabled={isTunnelLoading}
                          className="text-rose-400 hover:text-rose-300 transition text-[10px] underline cursor-pointer"
                          title="Stop active 4G/5G tunnel"
                        >
                          Stop Tunnel
                        </button>
                      </div>
                    ) : tunnelInfo?.error ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-amber-400 text-[10px] font-semibold flex items-center gap-1">
                          ⚠️ Offline Mode
                        </span>
                        <button
                          type="button"
                          onClick={handleStartTunnel}
                          disabled={isTunnelLoading}
                          className="text-amber-300 hover:text-amber-200 transition text-[10px] underline font-bold cursor-pointer"
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleStartTunnel}
                        disabled={isTunnelLoading}
                        className="text-amber-400 hover:text-amber-300 font-semibold transition text-[10px] underline flex items-center gap-1 cursor-pointer"
                      >
                        Start 4G/5G Tunnel
                      </button>
                    )}
                  </>
                ) : activeQrTab === "tunnel" ? (
                  <>
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Globe className={`w-3.5 h-3.5 ${tunnelInfo?.isActive ? "text-emerald-400" : tunnelInfo?.error ? "text-amber-400" : "text-slate-400"}`} />
                      <span className={tunnelInfo?.isActive ? "text-emerald-400" : tunnelInfo?.error ? "text-amber-400" : "text-slate-400"}>
                        {tunnelInfo?.isActive ? "Cloudflare Tunnel Active (4G/5G)" : tunnelInfo?.error ? "Offline Mode (No Internet)" : "4G/5G Tunnel Stopped"}
                      </span>
                    </span>
                    {tunnelInfo?.isActive ? (
                      <button
                        type="button"
                        onClick={handleStopTunnel}
                        disabled={isTunnelLoading}
                        className="text-rose-400 hover:text-rose-300 transition text-[10px] underline flex items-center gap-1 cursor-pointer"
                        title="Stop active 4G/5G tunnel"
                      >
                        <Square className="w-2.5 h-2.5 fill-current" />
                        <span>Stop Tunnel</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleStartTunnel}
                        disabled={isTunnelLoading}
                        className="text-emerald-400 hover:text-emerald-300 font-semibold transition text-[10px] underline flex items-center gap-1 cursor-pointer"
                      >
                        <Zap className="w-3 h-3 text-amber-300" />
                        {tunnelInfo?.error ? "Retry 4G/5G" : "Start 4G/5G Tunnel"}
                      </button>
                    )}
                  </>
                ) : activeQrTab === "step2" ? (
                  <>
                    <span className="flex items-center gap-1.5 text-indigo-300">
                      <QrIcon className="w-3 h-3" /> Customer Web Portal
                    </span>
                    <button
                      onClick={handleRefreshSession}
                      disabled={isRefreshing}
                      className="flex items-center gap-1 hover:text-white text-slate-400 transition"
                      title="Expire current session and generate a fresh token"
                    >
                      <RefreshCw className={`w-3 h-3 ${isRefreshing ? "animate-spin text-indigo-400" : ""}`} />
                      <span>Refresh Token</span>
                    </button>
                  </>
                ) : activeQrTab === "step1" ? (
                  <>
                    <span className="flex items-center gap-1.5 text-emerald-400">
                      <Wifi className="w-3 h-3" />
                      {wifiInfo?.isConnected ? `Connected: ${wifiInfo.ssid} (${wifiInfo.signalQuality})` : `SSID: ${wifiInfo?.ssid || "Shop Wi-Fi"}`}
                    </span>
                    <button
                      onClick={() => setShowWifiEdit(!showWifiEdit)}
                      className="flex items-center gap-1 hover:text-white text-slate-400 transition"
                    >
                      <Edit3 className="w-3 h-3 text-indigo-400" />
                      <span>{showWifiEdit ? "Close Editor" : "Edit Wi-Fi"}</span>
                    </button>
                  </>
                ) : (
                  <span className="text-slate-400">Side-by-side customer view (Desk Display)</span>
                )}
              </div>
            </div>

            {/* TAB CONTENT: PERMANENT GITHUB PORTAL */}
            {activeQrTab === "permanent" && (
              <div className="flex flex-col items-center w-full">
                <div className="p-3 sm:p-4 bg-white rounded-2xl shadow-2xl border-4 border-amber-500/40 my-1.5 sm:my-2 relative">
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-amber-500 to-indigo-600 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow">
                    ⭐ Permanent QR &bull; Standee
                  </div>
                  {!permanentPortalBaseUrl ? (
                    <div className="w-44 h-44 xl:w-52 xl:h-52 flex flex-col items-center justify-center text-slate-600 text-xs px-3 text-center gap-2">
                      <Globe className="w-7 h-7 text-amber-500" />
                      <span className="font-bold text-slate-800">No Static Gateway Set</span>
                      <span className="text-[10px] text-slate-500 leading-tight">
                        Set your shop&apos;s permanent URL or download <code className="font-mono">connect.html</code>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setPortalUrlInput("");
                          setIsEditingPortalUrl(true);
                        }}
                        className="mt-1 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold transition"
                      >
                        Configure Link
                      </button>
                    </div>
                  ) : permanentPortalQr ? (
                    <img
                      src={permanentPortalQr}
                      alt="Permanent Customer Portal QR"
                      className="w-44 h-44 xl:w-52 xl:h-52 object-contain block"
                    />
                  ) : (
                    <div className="w-44 h-44 xl:w-52 xl:h-52 flex flex-col items-center justify-center text-slate-400 text-xs">
                      <RefreshCw className="w-6 h-6 animate-spin mb-2 text-amber-500" />
                      Generating Permanent QR...
                    </div>
                  )}
                </div>

                <p className="text-xs font-semibold text-amber-300 mt-2 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  Desk Standee QR (Never needs reprinting!)
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Customers can save to Mobile Home Screen for 1-Tap Ordering
                </p>

                <div className="w-full mt-3 flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl p-1.5 font-mono text-[11px] text-amber-300 select-all">
                  <span className="flex-1 px-2 overflow-hidden text-ellipsis whitespace-nowrap text-left" title={permanentPortalUrl || "Not configured"}>
                    {permanentPortalUrl || "Not configured — click edit to set your static link"}
                  </span>
                  <button
                    onClick={() => {
                      setPortalUrlInput(permanentPortalBaseUrl);
                      setIsEditingPortalUrl(!isEditingPortalUrl);
                    }}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-lg transition"
                    title="Configure Custom Static Link / Domain"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  {permanentPortalUrl && (
                    <>
                      <button
                        onClick={handleCopyPermanentUrl}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
                        title="Copy Permanent URL"
                      >
                        {permanentPortalCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <a
                        href={permanentPortalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition"
                        title="Open in Browser"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </>
                  )}
                </div>

                {/* Inline Drawer for Custom Static Link / Domain Configuration */}
                {isEditingPortalUrl && (
                  <div className="w-full mt-2 p-2.5 bg-slate-900 border border-amber-500/50 rounded-xl text-left space-y-2 animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-amber-400" />
                        Configure Static Standee Gateway:
                      </span>
                      <button 
                        onClick={() => setIsEditingPortalUrl(false)} 
                        className="text-slate-400 hover:text-white text-xs px-1"
                      >
                        &times;
                      </button>
                    </div>
                    <input
                      type="text"
                      value={portalUrlInput}
                      onChange={(e) => setPortalUrlInput(e.target.value)}
                      placeholder="https://yourshop.github.io/connect.html"
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-400 font-mono"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px] text-slate-400">
                      <button
                        type="button"
                        onClick={handleDownloadConnectHtml}
                        className="px-2 py-1 rounded bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 font-semibold text-[10px] flex items-center gap-1"
                        title="Download self-contained connect.html pre-configured with your station HWID"
                      >
                        <Download className="w-3 h-3" /> Download connect.html
                      </button>
                      <div className="flex items-center gap-1.5">
                        {(import.meta as any).env?.DEV && (
                          <button
                            type="button"
                            onClick={() => {
                              setPortalUrlInput("https://technosoftsolution.github.io/printdrop-station/connect.html");
                            }}
                            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 text-[10px]"
                          >
                            🧪 Dev Preset
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            const trimmed = portalUrlInput.trim();
                            await invoke("save_permanent_portal_url", { url: trimmed });
                            setPermanentPortalBaseUrl(trimmed);
                            if (!trimmed) setPermanentPortalQr("");
                            setIsEditingPortalUrl(false);
                            setActionSuccessMsg(trimmed ? "Static Gateway Base URL saved & QR regenerated!" : "Static Gateway Base URL cleared.");
                            setTimeout(() => setActionSuccessMsg(null), 4000);
                          }}
                          className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs flex items-center gap-1"
                        >
                          <Save className="w-3 h-3" /> Save
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Live Tunnel Status Callout */}
                <div className="w-full mt-2.5 p-2 bg-slate-950/60 border border-slate-800/80 rounded-xl flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Station Internet Link:</span>
                  {tunnelInfo?.isActive ? (
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Online &amp; Ready
                      </span>
                      <button
                        type="button"
                        onClick={handleStopTunnel}
                        disabled={isTunnelLoading}
                        className="text-rose-400 hover:text-rose-300 font-semibold underline text-[10px] cursor-pointer"
                        title="Stop active 4G/5G tunnel"
                      >
                        Stop Tunnel
                      </button>
                    </div>
                  ) : tunnelInfo?.error ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-amber-400 font-semibold">⚠️ Offline (No PC Internet)</span>
                      <button
                        type="button"
                        onClick={handleStartTunnel}
                        disabled={isTunnelLoading}
                        className="text-amber-300 hover:text-amber-200 font-bold underline text-[10px] cursor-pointer"
                      >
                        Retry 4G/5G
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500">Tunnel Stopped</span>
                      <button
                        type="button"
                        onClick={handleStartTunnel}
                        disabled={isTunnelLoading}
                        className="text-amber-400 hover:text-amber-300 font-semibold underline text-[10px] cursor-pointer"
                      >
                        Start 4G/5G Tunnel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT: 4G/5G INTERNET TUNNEL */}
            {activeQrTab === "tunnel" && (
              <div className="flex flex-col items-center w-full">
                {tunnelInfo?.isActive && tunnelInfo.url ? (
                  <>
                    <div className="p-3 sm:p-4 bg-white rounded-2xl shadow-2xl border-4 border-emerald-500/30 my-1.5 sm:my-2 relative">
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow">
                        ⚡ 4G/5G Direct
                      </div>
                      {tunnelInfo?.qrDataUrl ? (
                        <img
                          src={tunnelInfo.qrDataUrl}
                          alt="4G/5G Customer QR Code"
                          className="w-44 h-44 xl:w-52 xl:h-52 object-contain block"
                        />
                      ) : (
                        <div className="w-44 h-44 xl:w-52 xl:h-52 flex flex-col items-center justify-center text-slate-400 text-xs">
                          <RefreshCw className="w-6 h-6 animate-spin mb-2 text-emerald-500" />
                          Generating 4G/5G QR...
                        </div>
                      )}
                    </div>

                    <p className="text-xs font-semibold text-emerald-300 mt-2 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                      Scan with any normal camera on 4G/5G mobile data
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Zero Wi-Fi Switching • Works on Jio, Airtel, VI, 4G/5G
                    </p>

                    <div className="w-full mt-3 flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl p-1.5 font-mono text-[11px] text-emerald-300 select-all">
                      <span className="flex-1 px-2 overflow-hidden text-ellipsis whitespace-nowrap text-left">
                        {tunnelInfo.url}
                      </span>
                      <button
                        onClick={handleCopyTunnelUrl}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg cursor-pointer"
                        title="Copy Public Tunnel URL"
                      >
                        {tunnelCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <a
                        href={tunnelInfo.url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg cursor-pointer"
                        title="Open in Browser"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>

                    {/* Dedicated Stop Tunnel Action Strip */}
                    <div className="w-full mt-3 flex items-center justify-between p-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs">
                      <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                        4G/5G Live &amp; Connected
                      </span>
                      <button
                        type="button"
                        onClick={handleStopTunnel}
                        disabled={isTunnelLoading}
                        className="px-3 py-1.5 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-700/80 rounded-lg font-semibold text-xs transition flex items-center gap-1.5 shadow-sm cursor-pointer"
                        title="Stop 4G/5G tunnel and switch back to local shop Wi-Fi mode"
                      >
                        <Square className="w-3 h-3 fill-current" />
                        <span>Stop Tunnel</span>
                      </button>
                    </div>
                  </>
                ) : isTunnelLoading ? (
                  <div className="w-full my-3 p-6 bg-slate-950/80 border border-slate-800 rounded-2xl flex flex-col items-center text-center">
                    <div className="p-3 bg-amber-950/40 border border-amber-800/40 rounded-2xl mb-3 text-amber-400">
                      <RefreshCw className="w-8 h-8 animate-spin" />
                    </div>
                    <h3 className="text-sm font-bold text-white mb-1">
                      Connecting 4G/5G Internet Tunnel...
                    </h3>
                    <p className="text-xs text-slate-400 max-w-sm">
                      Establishing Cloudflare bridge to allow phone cameras to scan without connecting to local shop Wi-Fi.
                    </p>
                  </div>
                ) : tunnelInfo?.error ? (
                  <div className="w-full my-3 p-5 bg-gradient-to-b from-amber-950/30 to-slate-950/90 border-2 border-amber-600/50 rounded-2xl flex flex-col items-center text-center shadow-lg relative overflow-hidden">
                    <div className="p-3 bg-amber-950/60 border border-amber-700/60 rounded-2xl mb-2.5 text-amber-400">
                      <WifiOff className="w-8 h-8" />
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold uppercase tracking-wider mb-1.5">
                      ⚠️ App is in Offline Mode
                    </div>
                    <h3 className="text-sm font-bold text-white mb-1">
                      No Internet Connection Detected on PC
                    </h3>
                    <p className="text-xs text-slate-300 max-w-sm mb-2 leading-relaxed">
                      Please enable Internet (Wi-Fi or Ethernet) on this Windows 11 PC/Laptop to activate the 4G/5G mobile upload QR.
                    </p>
                    <div className="w-full p-2.5 bg-slate-900/90 border border-slate-800 rounded-xl text-[11px] text-emerald-300 text-left mb-3 flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                      <span>
                        <strong>Local Shop Wi-Fi is still 100% operational:</strong> Walk-in customers can connect to your shop Wi-Fi and scan the LAN QR code right now.
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleStartTunnel}
                        disabled={isTunnelLoading}
                        className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-md transition cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Retry 4G/5G Connection</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveQrTab("step2")}
                        className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition cursor-pointer"
                      >
                        Use Local LAN QR
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="w-full my-3 p-6 bg-slate-950/80 border border-slate-800 rounded-2xl flex flex-col items-center text-center">
                    <div className="p-3 bg-slate-800/80 border border-slate-700 rounded-2xl mb-3 text-slate-400">
                      <Globe className="w-10 h-10" />
                    </div>
                    <h3 className="text-sm font-bold text-white mb-1">
                      4G/5G Internet Tunnel is Stopped
                    </h3>
                    <p className="text-xs text-slate-400 max-w-sm mb-4">
                      Station is currently running in local-only mode. Start the 4G/5G tunnel whenever you want customers to upload directly using mobile data (Jio, Airtel, etc.).
                    </p>
                    <button
                      type="button"
                      onClick={handleStartTunnel}
                      disabled={isTunnelLoading}
                      className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white font-semibold text-xs rounded-xl shadow-lg shadow-emerald-600/30 transition cursor-pointer"
                    >
                      <Zap className="w-4 h-4 text-amber-300" />
                      <span>Activate 4G/5G Internet Tunnel</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: STEP 2 (Upload Web Portal) */}
            {activeQrTab === "step2" && (
              <div className="flex flex-col items-center w-full">
                <div className="p-3 sm:p-4 bg-white rounded-2xl shadow-2xl border-4 border-indigo-500/20 my-1.5 sm:my-2">
                  {session?.qrDataUrl ? (
                    <img
                      src={session.qrDataUrl}
                      alt="Customer Mobile QR Portal"
                      className="w-44 h-44 xl:w-52 xl:h-52 object-contain block"
                    />
                  ) : (
                    <div className="w-44 h-44 xl:w-52 xl:h-52 flex flex-col items-center justify-center text-slate-400 text-xs">
                      <RefreshCw className="w-6 h-6 animate-spin mb-2 text-indigo-500" />
                      Generating QR...
                    </div>
                  )}
                </div>

                <p className="text-xs font-medium text-slate-300 mt-2">
                  Scan with camera to open web uploader ({activeInterface?.ip})
                </p>

                <div className="w-full mt-3 flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl p-1.5 font-mono text-[11px] text-indigo-300 select-all">
                  <span className="flex-1 px-2 overflow-hidden text-ellipsis whitespace-nowrap text-left">{session?.accessUrl || "..."}</span>
                  <button onClick={handleCopyUrl} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg">
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a href={session?.accessUrl || "#"} target="_blank" rel="noreferrer" className="p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                {/* Compact Interface Selector for LAN Upload */}
                {interfaces.length > 1 && (
                  <div className="mt-3 flex items-center justify-between gap-2 w-full bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-1.5 text-xs">
                    <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      <Network className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Interface:</span>
                    </span>
                    <select
                      value={selectedIp}
                      onChange={(e) => handleInterfaceChange(e.target.value)}
                      className="bg-transparent text-slate-200 text-xs font-semibold focus:outline-none cursor-pointer max-w-[210px] truncate text-right"
                    >
                      {interfaces.map((iface) => (
                        <option key={iface.ip} value={iface.ip} className="bg-slate-900 text-slate-200">
                          {iface.name} ({iface.ip}){iface.isVpn ? " [VPN]" : iface.isWifi ? " [Wi-Fi]" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: STEP 1 (Wi-Fi Auto-Discovery & Connect) */}
            {activeQrTab === "step1" && (
              <div className="flex flex-col items-center w-full">
                {showWifiEdit ? (
                  /* Wi-Fi Settings Inline Editor */
                  <div className="w-full bg-slate-950/80 border border-slate-800 rounded-2xl p-4 my-2 text-left animate-fade-in">
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
                      <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Wifi className="w-3.5 h-3.5 text-indigo-400" />
                        Configure Shop Wi-Fi for Customers
                      </h3>
                      <button
                        onClick={handleResetWifiToSystem}
                        disabled={isSavingWifi}
                        className="text-[10px] text-indigo-300 hover:text-indigo-200 underline"
                        title="Auto-detect current connected network on this Windows PC"
                      >
                        Sync with Windows Wi-Fi
                      </button>
                    </div>

                    <div className="space-y-3 text-xs">
                      <div>
                        <label className="text-slate-400 block mb-1">Wi-Fi Network Name (SSID):</label>
                        <input
                          type="text"
                          value={wifiEditSsid}
                          onChange={(e) => setWifiEditSsid(e.target.value)}
                          placeholder="e.g. MyPrintShop_5G"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      <div>
                        <label className="text-slate-400 block mb-1">Wi-Fi Password:</label>
                        <input
                          type="text"
                          value={wifiEditPassword}
                          onChange={(e) => setWifiEditPassword(e.target.value)}
                          placeholder="Leave blank for open network"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-slate-400 block mb-1">Security Type:</label>
                          <select
                            value={wifiEditAuth}
                            onChange={(e) => setWifiEditAuth(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none"
                          >
                            <option value="WPA2-Personal">WPA2/WPA3 (Standard)</option>
                            <option value="WEP">WEP (Legacy)</option>
                            <option value="Open">Open (No Password)</option>
                          </select>
                        </div>
                        <div className="flex items-end pb-1.5">
                          <label className="flex items-center gap-2 cursor-pointer text-slate-300 text-xs">
                            <input
                              type="checkbox"
                              checked={wifiEditHidden}
                              onChange={(e) => setWifiEditHidden(e.target.checked)}
                              className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                            />
                            <span>Hidden SSID</span>
                          </label>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => setShowWifiEdit(false)}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveWifi}
                          disabled={isSavingWifi || !wifiEditSsid.trim()}
                          className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold"
                        >
                          <Save className="w-3.5 h-3.5" />
                          {isSavingWifi ? "Saving..." : "Save & Generate QR"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Standard Wi-Fi QR Card */
                  <>
                    <div className="p-3 sm:p-4 bg-white rounded-2xl shadow-2xl border-4 border-indigo-500/20 my-1.5 sm:my-2">
                      {wifiInfo?.qrDataUrl ? (
                        <img
                          src={wifiInfo.qrDataUrl}
                          alt="Customer Wi-Fi QR Code"
                          className="w-44 h-44 xl:w-52 xl:h-52 object-contain block"
                        />
                      ) : (
                        <div className="w-44 h-44 xl:w-52 xl:h-52 flex flex-col items-center justify-center text-slate-400 text-xs">
                          <Wifi className="w-8 h-8 text-indigo-500 mb-2" />
                          No Wi-Fi Configured
                        </div>
                      )}
                    </div>

                    <p className="text-xs font-medium text-slate-300 mt-2">
                      Scan with camera &rarr; tap <span className="text-indigo-400 font-semibold">&quot;Connect to network&quot;</span>
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      (Tap the pop-up Wi-Fi prompt to join automatically)
                    </p>

                    {/* Wi-Fi Details & Password Card */}
                    <div className="w-full mt-3 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-left">
                      <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-800/80">
                        <span className="text-slate-400 text-[11px]">Network (SSID):</span>
                        <span className="font-mono font-bold text-white text-[12px]">{wifiInfo?.ssid || "N/A"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-[11px]">Password:</span>
                        <div className="flex items-center gap-1.5 font-mono">
                          <span className="text-indigo-300 font-bold">
                            {wifiInfo?.password
                              ? showWifiPassword
                                ? wifiInfo.password
                                : "••••••••"
                              : "(Open / No Pass)"}
                          </span>
                          {wifiInfo?.password && (
                            <>
                              <button
                                onClick={() => setShowWifiPassword(!showWifiPassword)}
                                className="p-1 hover:text-white text-slate-400 transition"
                                title={showWifiPassword ? "Hide password" : "Show password"}
                              >
                                {showWifiPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              </button>
                              <button
                                onClick={handleCopyWifiPassword}
                                className="p-1 hover:text-white text-slate-400 transition"
                                title="Copy password"
                              >
                                {wifiCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Incoming Orders Queue (Expands to all remaining width in max view) */}
          <div className={`transition-all duration-300 flex flex-col ${
            isOrderManagementMaximized
              ? "fixed inset-2 md:inset-4 z-40 bg-slate-900/98 backdrop-blur-2xl border border-indigo-500/40 rounded-3xl p-6 shadow-2xl overflow-y-auto ring-1 ring-white/10"
              : "bg-slate-900/60 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-sm h-full min-h-0 min-w-0"
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-950 text-indigo-400 rounded-lg border border-indigo-800/50">
                  <Inbox className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Order Management</h2>
                  <p className="text-xs text-slate-400">Review, approve, exclude files, or inspect trash</p>
                </div>
              </div>

              {/* Search & Tab Selector */}
              <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto">
                {activeTab === "TRASH" && orders.some(o => o.status === "REJECTED") && (
                  <button
                    type="button"
                    onClick={handleEmptyDustbin}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded-xl text-xs font-semibold transition shadow-sm cursor-pointer"
                    title="Permanently empty all rejected orders from the Dustbin"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                    <span>Empty Dustbin</span>
                  </button>
                )}

                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search PIN / Name / File..."
                    value={orderSearchTerm}
                    onChange={(e) => setOrderSearchTerm(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-36 sm:w-44"
                  />
                  {orderSearchTerm && (
                    <button
                      onClick={() => setOrderSearchTerm("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
                    >
                      &times;
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setActiveTab("ACTIVE")}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                      activeTab === "ACTIVE" 
                        ? "bg-indigo-600 text-white shadow-sm" 
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Inbox className="w-3.5 h-3.5" />
                    <span>Active ({orders.filter(o => o.status !== "COMPLETED" && o.status !== "REJECTED" && o.status !== "PURGED_BY_CUSTOMER").length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("PRINTED")}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                      activeTab === "PRINTED" 
                        ? "bg-teal-600 text-white shadow-sm" 
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Customer Jobs ({todayCompletedOrders.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("TRASH")}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                      activeTab === "TRASH" 
                        ? "bg-rose-950 text-rose-300 border border-rose-800 shadow-sm" 
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                    <span>Dustbin ({orders.filter(o => o.status === "REJECTED").length})</span>
                  </button>
                </div>

                {/* Maximize / Restore Toggle Button */}
                <button
                  type="button"
                  onClick={() => setIsOrderManagementMaximized(!isOrderManagementMaximized)}
                  className={`p-1.5 rounded-xl transition border flex items-center justify-center cursor-pointer shadow-sm ${
                    isOrderManagementMaximized
                      ? "bg-indigo-600/30 border-indigo-500 text-indigo-300 hover:bg-indigo-600/50"
                      : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800"
                  }`}
                  title={isOrderManagementMaximized ? "Restore Layout (Esc)" : "Maximize Order Management"}
                >
                  {isOrderManagementMaximized ? (
                    <Minimize2 className="w-4 h-4 text-indigo-300" />
                  ) : (
                    <Maximize2 className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Orders Feed */}
            <div className={`flex-1 overflow-y-auto mt-2.5 sm:mt-3 space-y-3 pr-1 min-h-[180px] ${
              isOrderManagementMaximized ? "max-h-[calc(100vh-140px)]" : ""
            }`}>
              {(() => {
                const displayedOrders = orders.filter((o) => {
                  let tabMatches = false;
                  if (activeTab === "ACTIVE") {
                    tabMatches = o.status !== "COMPLETED" && o.status !== "REJECTED" && o.status !== "PURGED_BY_CUSTOMER";
                  } else if (activeTab === "PRINTED") {
                    tabMatches = (o.status === "COMPLETED" || o.status === "PURGED_BY_CUSTOMER") && isTodayOrder(o);
                  } else {
                    tabMatches = o.status === "REJECTED";
                  }
                  if (!tabMatches) return false;

                  if (orderSearchTerm.trim()) {
                    const q = orderSearchTerm.trim().toLowerCase().replace("#", "");
                    const matchId = o.id.toLowerCase().includes(q);
                    const matchPin = (o.pickupCode || "").toLowerCase().includes(q);
                    const matchName = (o.customerName || "").toLowerCase().includes(q);
                    const matchDevice = (o.deviceModel || "").toLowerCase().includes(q);
                    const matchFile = (o.files || []).some(f => f.originalFilename.toLowerCase().includes(q));
                    return matchId || matchPin || matchName || matchDevice || matchFile;
                  }
                  return true;
                });

                if (displayedOrders.length === 0) {
                  return (
                    <div className="h-64 flex flex-col items-center justify-center text-slate-500 text-xs text-center p-6 border-2 border-dashed border-slate-800 rounded-2xl">
                      {activeTab === "ACTIVE" ? (
                        <>
                          <Inbox className="w-10 h-10 text-slate-700 mb-2 stroke-[1.5]" />
                          <p className="font-medium text-slate-400">No active orders</p>
                          <p className="text-[11px] text-slate-500 mt-1 max-w-xs">
                            Scan the QR code on your phone, choose documents, and tap "Upload & Submit" to see them appear here in real time!
                          </p>
                        </>
                      ) : activeTab === "PRINTED" ? (
                        <div className="space-y-3 flex flex-col items-center">
                          <Users className="w-10 h-10 text-slate-700 mb-1 stroke-[1.5]" />
                          <p className="font-medium text-slate-400">No customer print jobs completed today</p>
                          <p className="text-[11px] text-slate-500 max-w-xs">
                            Customer jobs completed today will appear here. The queue resets each morning for fresh daily tracking.
                          </p>
                          {completedOrders.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setIsViewingAllHistory(true)}
                              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-teal-300 border border-teal-700/60 rounded-xl text-xs font-semibold shadow-sm transition cursor-pointer mt-1"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>View All {completedOrders.length} Historical Print Jobs &rarr;</span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <>
                          <Trash2 className="w-10 h-10 text-slate-700 mb-2 stroke-[1.5]" />
                          <p className="font-medium text-slate-400">Dustbin is empty</p>
                          <p className="text-[11px] text-slate-500 mt-1 max-w-xs">
                            Orders rejected by shopkeeper will appear here.
                          </p>
                        </>
                      )}
                    </div>
                  );
                }

                const finalOrders = displayedOrders;

                return (
                  <div className="space-y-4">
                    {activeTab === "PRINTED" && (
                      <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-teal-950/70 via-slate-900 to-indigo-950/70 border border-teal-500/30 rounded-2xl p-3 shadow-md mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-teal-500/20 border border-teal-500/30 flex items-center justify-center text-teal-400">
                            <Calendar className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-slate-100 flex items-center gap-2">
                              <span>Today&apos;s Completed Queue</span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-teal-900/80 text-teal-300 border border-teal-700/60 font-semibold">
                                {displayedOrders.length} {displayedOrders.length === 1 ? "Job" : "Jobs"} Today
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400">
                              Showing today&apos;s jobs only. Resets automatically tomorrow morning.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsViewingAllHistory(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-teal-950/40 transition hover:scale-[1.02] cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>Print Jobs &amp; Financial Ledger ({completedOrders.length} Total)</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {activeTab === "ACTIVE" && (() => {
                      const approvedList = finalOrders.filter(o => o.status === "APPROVED");
                      if (approvedList.length === 0) return null;
                      return (
                        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-emerald-950/70 via-slate-900 to-indigo-950/70 border border-emerald-500/40 rounded-2xl p-3.5 shadow-lg animate-fadeIn mb-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                              <Zap className="w-4 h-4 animate-pulse" />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-slate-100 flex items-center gap-2">
                                <span>Ready for Batch Spooling:</span>
                                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-[11px] font-bold border border-emerald-500/30">
                                  {approvedList.length} {approvedList.length === 1 ? "Order" : "Orders"} Approved
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400">
                                Sequential execution with auto-routing, fail-soft continuation & live customer tracking
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleStartBatchPrint(approvedList.map(o => o.id))}
                            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-950/40 transition hover:scale-[1.02] cursor-pointer active:scale-95"
                          >
                            <Printer className="w-4 h-4" />
                            <span>Print All Approved ({approvedList.length})</span>
                          </button>
                        </div>
                      );
                    })()}

                    <div className="space-y-3">
                      {finalOrders.map((ord) => {
                        if (activeTab === "PRINTED") {
                          return renderCustomerJobCard(ord, false);
                        }
                        const isPurged = ord.status === "PURGED_BY_CUSTOMER" || ord.isAllPurged || ord.activeFilesCount === 0;
                        const isUnpaid = ord.paymentStatus !== "PAID" && ord.status !== "REJECTED" && !isPurged;
                        const isFilesExpanded = expandedFilesOrderIds.has(ord.id);

                        return (
                  <div
                    key={ord.id}
                    className={`border rounded-2xl p-4 transition-all shadow-sm space-y-3 ${
                      ord.status === "PURGED_BY_CUSTOMER"
                        ? "bg-slate-950/85 border-slate-800/90 opacity-80"
                        : ord.status === "REJECTED"
                        ? "bg-slate-950/90 border-rose-900/60 hover:border-rose-700"
                        : isUnpaid
                        ? "bg-gradient-to-r from-amber-950/40 via-slate-950/90 to-amber-950/20 border-amber-600/70 hover:border-amber-500 shadow-md shadow-amber-950/30"
                        : ord.status === "COMPLETED"
                        ? "bg-slate-950/80 hover:bg-slate-950 border-teal-900/60 hover:border-teal-700/80"
                        : "bg-slate-950/70 hover:bg-slate-950 border-slate-800/90 hover:border-indigo-500/50"
                    }`}
                  >
                    <div
                      onClick={() => toggleOrderFilesExpanded(ord.id)}
                      className="flex items-center justify-between gap-3 overflow-x-auto no-scrollbar py-0.5 cursor-pointer select-none group"
                      title={isFilesExpanded ? "Click to collapse files list" : "Click to view itemized files list"}
                    >
                      <div className="flex items-center gap-2 flex-nowrap shrink-0 min-w-0">
                        {ord.corporateClientName && (
                          <span className="text-xs bg-gradient-to-r from-purple-950 to-indigo-950 text-purple-300 border border-purple-700/60 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1 shadow-sm whitespace-nowrap shrink-0">
                            <Building2 className="w-3.5 h-3.5 text-purple-400" />
                            <span>{ord.corporateClientName}</span>
                            {ord.corporatePersonName && (
                              <span className="text-purple-200/70 font-normal">({ord.corporatePersonName})</span>
                            )}
                          </span>
                        )}
                        {ord.pickupCode && (
                          <span className={`font-mono font-black text-xs sm:text-sm px-2.5 py-0.5 rounded shadow-sm flex items-center gap-1 whitespace-nowrap shrink-0 ${
                            isUnpaid
                              ? "bg-gradient-to-r from-amber-400 to-orange-400 text-slate-950 ring-2 ring-amber-500/50 shadow-md shadow-amber-500/30"
                              : "bg-amber-400 text-slate-950"
                          }`}>
                            <Tag className="w-3.5 h-3.5 text-slate-950" />
                            #{ord.pickupCode}
                          </span>
                        )}
                        {ord.customerName ? (
                          <span className="font-bold text-sm sm:text-base text-white flex items-center gap-1.5 whitespace-nowrap shrink-0">
                            <User className="w-3.5 h-3.5 text-indigo-400" />
                            {ord.customerName}
                          </span>
                        ) : (
                          <span className="font-mono font-bold text-sm text-indigo-300 whitespace-nowrap shrink-0">
                            #{ord.id.substring(0, 8)}
                          </span>
                        )}
                        {ord.deviceModel && (
                          <span className="text-xs bg-slate-800 text-slate-300 border border-slate-700/60 px-2.5 py-0.5 rounded-full flex items-center gap-1 font-medium whitespace-nowrap shrink-0">
                            <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                            {ord.deviceModel}
                          </span>
                        )}
                        <span className="text-xs bg-slate-800/90 text-slate-400 px-2 py-0.5 rounded font-mono whitespace-nowrap shrink-0">
                          Rev {ord.revisionNumber}
                        </span>
                        <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${
                          ord.customerType === "REMOTE"
                            ? "bg-cyan-950/70 text-cyan-300 border-cyan-800/60"
                            : "bg-slate-900 text-slate-300 border-slate-700/60"
                        }`}>
                          {ord.customerType === "REMOTE" ? "🌐 Remote" : "🚶 Walk-In"}
                        </span>
                        {ord.totalAmount !== undefined && ord.totalAmount !== null && (
                          <span className="font-mono font-bold text-xs sm:text-sm bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 px-2.5 py-0.5 rounded-full shadow-sm flex items-center gap-1 whitespace-nowrap shrink-0">
                            💰 ₹{ord.totalAmount.toFixed(2)}
                          </span>
                        )}
                        {ord.paymentStatus && (
                          <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${
                            ord.paymentStatus === "PAID"
                              ? "bg-emerald-950 text-emerald-400 border-emerald-700/70"
                              : ord.paymentStatus === "CREDIT"
                              ? "bg-purple-950 text-purple-300 border-purple-700/70"
                              : "bg-gradient-to-r from-amber-950 to-orange-950 text-amber-300 border-amber-600/80 shadow-sm"
                          }`}>
                            {ord.paymentStatus === "PAID"
                              ? `✅ Paid (${ord.paymentMethod || "CASH"})`
                              : ord.paymentStatus === "CREDIT"
                              ? "📋 Credit"
                              : "⏳ Unpaid"}
                          </span>
                        )}
                        {ord.paymentClaim === "CLAIMED" && ord.paymentStatus !== "PAID" && (
                          <span className="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-400 animate-pulse flex items-center gap-1 shadow-sm whitespace-nowrap shrink-0">
                            <span>📱</span>
                            <span>UPI Claimed</span>
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2 shrink-0 ml-auto pl-2">
                        {ord.status === "PURGED_BY_CUSTOMER" ? (
                          <span className="text-xs sm:text-sm font-semibold bg-slate-900 text-slate-300 border border-slate-700/80 px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                            Erased by Customer
                          </span>
                        ) : ord.status === "COMPLETED" ? (
                          <span className="text-xs sm:text-sm font-semibold bg-teal-950/80 text-teal-300 border border-teal-800/70 px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0">
                            <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />
                            Printed / Completed
                          </span>
                        ) : ord.status === "PRINTING" ? (
                          <span className="text-xs sm:text-sm font-semibold bg-indigo-950/70 text-indigo-300 border border-indigo-800/60 px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
                            Printing ({ord.printedFilesCount || 0}/{ord.totalFiles})
                          </span>
                        ) : ord.status === "APPROVED" ? (
                          <span className="text-xs sm:text-sm font-semibold bg-emerald-950/70 text-emerald-300 border border-emerald-800/60 px-3 py-1 rounded-full flex items-center gap-1.5 whitespace-nowrap shrink-0">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            Approved
                          </span>
                        ) : ord.status === "REJECTED" ? (
                          <span className="text-xs sm:text-sm font-semibold bg-rose-950/70 text-rose-300 border border-rose-800/60 px-3 py-1 rounded-full flex items-center gap-1.5 whitespace-nowrap shrink-0">
                            <XCircle className="w-3.5 h-3.5 text-rose-400" />
                            In Dustbin (Rejected)
                          </span>
                        ) : (
                          <span className="text-xs sm:text-sm font-semibold bg-amber-950/70 text-amber-300 border border-amber-800/60 px-3 py-1 rounded-full flex items-center gap-1.5 whitespace-nowrap shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                            Awaiting Review
                          </span>
                        )}

                        {ord.files && ord.files.length > 0 && (
                          <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg border transition shrink-0 ${
                            isFilesExpanded
                              ? "bg-indigo-950/80 text-indigo-300 border-indigo-700/70"
                              : "bg-slate-900 text-slate-400 border-slate-800 group-hover:text-white group-hover:border-slate-700"
                          }`}>
                            <span>{ord.files.length} {ord.files.length === 1 ? "file" : "files"}</span>
                            {isFilesExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5 text-indigo-400" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Section 2: Itemized File List (Collapsible View - Click anywhere to collapse) */}
                    {isFilesExpanded && ord.files && ord.files.length > 0 && (
                      <div
                        onClick={() => toggleOrderFilesExpanded(ord.id)}
                        className="bg-slate-900/85 hover:bg-slate-900 border border-slate-800/90 hover:border-indigo-500/50 rounded-xl p-2.5 space-y-1.5 cursor-pointer select-none transition-all shadow-inner animate-fade-in"
                        title="Click anywhere on box to collapse"
                      >
                        <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1 pb-1 border-b border-slate-800/60">
                          <span className="flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5 text-teal-400" />
                            <span className="text-slate-200">Documents & Files ({ord.files.length})</span>
                            <span className="text-[10px] text-slate-500 font-normal">(Click anywhere on box to collapse)</span>
                          </span>
                          <span className="flex items-center gap-1 text-xs text-slate-400">
                            <span>Print Specs & Charges</span>
                            <ChevronUp className="w-3.5 h-3.5 text-indigo-400" />
                          </span>
                        </div>
                        <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                          {ord.files.map((f, idx) => {
                            const filePrinterLabel = f.printedOn || f.targetPrinter || f.autoPrinter || ord.targetPrinter;
                            return (
                            <div key={idx} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg hover:bg-slate-800/50 transition gap-2">
                              <div className="flex items-center gap-2 truncate min-w-0 flex-1">
                                <span className="text-xs font-mono font-bold bg-slate-800 text-slate-300 px-2 py-0.5 rounded uppercase shrink-0 border border-slate-700/60">
                                  {f.originalFilename.split(".").pop() || "DOC"}
                                </span>
                                <span className="font-medium text-xs sm:text-sm text-slate-200 truncate" title={f.originalFilename}>
                                  {f.originalFilename}
                                </span>
                                {filePrinterLabel && (
                                  <span
                                    className={`text-[11px] px-2 py-0.5 rounded-md flex items-center gap-1 shrink-0 font-semibold border ${
                                      f.printedOn
                                        ? "bg-teal-950/70 text-teal-300 border-teal-800/60"
                                        : f.targetPrinter
                                        ? "bg-amber-950/70 text-amber-300 border-amber-800/60"
                                        : "bg-indigo-950/70 text-indigo-300 border-indigo-800/60"
                                    }`}
                                    title={
                                      f.printedOn
                                        ? `Printed on ${f.printedOn}`
                                        : f.targetPrinter
                                        ? `Manual printer override: ${f.targetPrinter}`
                                        : `Default Auto Printer: ${filePrinterLabel}`
                                    }
                                  >
                                    <Printer className="w-3 h-3" />
                                    <span>{f.printedOn ? f.printedOn : f.targetPrinter ? `Override: ${f.targetPrinter}` : `Auto: ${filePrinterLabel}`}</span>
                                  </span>
                                )}
                                {f.isPurged || isPurged ? (
                                  <span className="text-[10px] bg-slate-900 text-slate-400 border border-slate-800 px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0" title="File removed from disk for customer privacy">
                                    <ShieldCheck className="w-3 h-3 text-emerald-400" />
                                    Erased
                                  </span>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-2.5 text-xs sm:text-sm font-semibold text-slate-300 shrink-0">
                                <span className="bg-slate-800/90 border border-slate-700/80 px-2.5 py-1 rounded-lg text-slate-200 shadow-sm">
                                  {f.documentPages}p × {f.copies}c • {f.paperSize} • {f.colorMode === "COLOR" ? "Color" : "B&W"}
                                </span>
                                {f.subtotal !== undefined && f.subtotal !== null && (
                                  <span className="font-mono font-bold text-xs sm:text-sm text-emerald-300 bg-emerald-950/80 border border-emerald-700/70 px-2.5 py-1 rounded-lg shadow-sm">
                                    ₹{f.subtotal.toFixed(2)}
                                  </span>
                                )}
                              </div>
                            </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1 text-slate-300 font-medium">
                          <FileText className="w-3.5 h-3.5 text-indigo-400" />
                          {ord.totalFiles} {ord.totalFiles === 1 ? "File" : "Files"}
                        </span>
                        <span>{formatBytes(ord.totalBytes)}</span>
                        {ord.completedAt && (
                          <span className="text-teal-400 font-medium flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Printed: {ord.completedAt}
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-1.5">
                        {!ord.completedAt && (
                          <span className="text-[11px] text-slate-500 flex items-center gap-1 mr-1">
                            <Clock className="w-3 h-3" />
                            {ord.createdAt.substring(11, 16)}
                          </span>
                        )}
                        <button
                          onClick={() => inspectOrder(ord.id)}
                          className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded-lg text-xs font-semibold transition border border-slate-700"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          {ord.status === "PURGED_BY_CUSTOMER" || ord.isAllPurged || ord.activeFilesCount === 0 ? "Inspect" : ord.status === "COMPLETED" ? "Inspect & Reprint" : "Inspect"}
                        </button>

                        {/* Dustbin Actions */}
                        {ord.status === "REJECTED" && (
                          <>
                            <button
                              onClick={() => handleRestoreOrder(ord.id)}
                              className="flex items-center gap-1 bg-indigo-950 hover:bg-indigo-900 text-indigo-300 border border-indigo-800/80 px-2.5 py-1 rounded-lg text-xs font-semibold transition"
                              title="Restore order back to Active Queue"
                            >
                              <RotateCcw className="w-3.5 h-3.5 text-indigo-400" />
                              <span>Restore</span>
                            </button>
                            <button
                              onClick={() => handlePurgeOrder(ord.id)}
                              className="flex items-center gap-1 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 px-2 py-1 rounded-lg text-xs font-semibold transition"
                              title="Permanently Delete this order"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                            </button>
                          </>
                        )}

                        {ord.status === "PURGED_BY_CUSTOMER" && (
                          <button
                            onClick={() => handlePurgeOrder(ord.id)}
                            className="flex items-center gap-1 bg-slate-900 hover:bg-rose-950/80 text-slate-400 hover:text-rose-300 border border-slate-800 hover:border-rose-800 px-2.5 py-1 rounded-lg text-xs font-semibold transition"
                            title="Remove this erased order entry from history"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                            <span>Dismiss</span>
                          </button>
                        )}

                        {ord.status === "AWAITING_APPROVAL" && (
                          <>
                            <button
                              onClick={() => handleApproveOrder(ord.id)}
                              className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded-lg text-xs font-semibold transition shadow-sm"
                              title="Approve Order"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => { setRejectingOrderId(ord.id); setRejectionReason(""); }}
                              className="flex items-center gap-1 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/60 px-2 py-1 rounded-lg text-xs font-semibold transition"
                              title="Reject Order and move to Dustbin"
                            >
                              <Ban className="w-3.5 h-3.5 text-rose-400" />
                            </button>
                          </>
                        )}

                        {ord.status === "APPROVED" && (
                          <button
                            onClick={() => handleTriggerPrint(ord.id)}
                            className="flex items-center gap-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-3 py-1 rounded-lg text-xs font-semibold transition shadow-md shadow-emerald-950/50"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            Print All
                          </button>
                        )}

                        {ord.status === "COMPLETED" && (
                          ord.isAllPurged || ord.activeFilesCount === 0 ? (
                            <span
                              className="flex items-center gap-1.5 bg-slate-900 text-slate-400 border border-slate-800 px-2.5 py-1 rounded-lg text-xs font-semibold select-none cursor-default"
                              title="Customer erased all document files from the computer. Order metadata is preserved in audit history."
                            >
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/80" />
                              <span>Files Deleted</span>
                            </span>
                          ) : (
                            <button
                              onClick={() => handleTriggerPrint(ord.id)}
                              className="flex items-center gap-1 bg-teal-900/80 hover:bg-teal-800 text-teal-200 border border-teal-700/60 px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer"
                              title={`Reprint all files (${ord.targetPrinter || selectedPrinter})`}
                            >
                              <RotateCcw className="w-3.5 h-3.5 text-teal-400" />
                              Reprint All
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                  );
                })}
                    </div>
              </div>
            );
          })()}
            </div>
          </div>
        </div>
        )}

        {/* Selected Order Detail Modal */}
        {selectedOrderDetails && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-slate-700 rounded-3xl p-5 sm:p-6 max-w-4xl w-full shadow-2xl max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    {selectedOrderDetails.order.pickupCode && (
                      <span className="font-mono font-black text-sm bg-amber-400 text-slate-950 px-3 py-0.5 rounded-lg shadow-sm flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5 text-slate-950" />
                        #{selectedOrderDetails.order.pickupCode}
                      </span>
                    )}
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      {selectedOrderDetails.order.customerName ? (
                        <>
                          <User className="w-4 h-4 text-indigo-400" />
                          <span>{selectedOrderDetails.order.customerName}</span>
                          <span className="text-slate-500 font-mono text-sm font-normal">(#{selectedOrderDetails.order.id.substring(0, 8)})</span>
                        </>
                      ) : (
                        <span>Order #{selectedOrderDetails.order.id.substring(0, 8)}</span>
                      )}
                    </h3>
                    {selectedOrderDetails.order.corporateClientName && (
                      <span className="text-xs bg-purple-950 text-purple-200 border border-purple-700/60 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 font-bold">
                        <Building2 className="w-3.5 h-3.5 text-purple-400" />
                        <span>Corporate: {selectedOrderDetails.order.corporateClientName}</span>
                        {selectedOrderDetails.order.corporatePersonName && (
                          <span className="text-purple-300/80 font-normal">({selectedOrderDetails.order.corporatePersonName})</span>
                        )}
                      </span>
                    )}
                    {selectedOrderDetails.order.deviceModel && (
                      <span className="text-xs bg-slate-800 text-slate-300 border border-slate-700/60 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                        <Smartphone className="w-3 h-3 text-emerald-400" />
                        {selectedOrderDetails.order.deviceModel}
                      </span>
                    )}
                    <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                      Rev {selectedOrderDetails.order.revisionNumber}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggleCustomerType(
                        selectedOrderDetails.order.id,
                        selectedOrderBilling?.customerType || selectedOrderDetails.order.customerType || "WALK_IN"
                      )}
                      className="text-xs font-bold px-2.5 py-0.5 rounded-full border transition flex items-center gap-1.5 shadow-sm bg-cyan-950/70 text-cyan-300 border-cyan-800/80 hover:bg-cyan-900 cursor-pointer"
                      title="Click to switch between Walk-In and Remote customer category"
                    >
                      {(selectedOrderBilling?.customerType || selectedOrderDetails.order.customerType) === "REMOTE"
                        ? "🌐 Remote Customer"
                        : "🚶 Walk-In Customer"}
                      <span className="text-[10px] text-cyan-400/80 underline font-normal">(change)</span>
                    </button>
                    {selectedOrderDetails.order.status === "PURGED_BY_CUSTOMER" ? (
                      <span className="text-xs font-semibold bg-slate-900 text-slate-300 border border-slate-700/80 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-sm">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        Erased by Customer
                      </span>
                    ) : selectedOrderDetails.order.status === "COMPLETED" ? (
                      <span className="text-xs font-semibold bg-teal-950/80 text-teal-300 border border-teal-800/70 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-sm">
                        <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />
                        Printed / Completed
                      </span>
                    ) : selectedOrderDetails.order.status === "APPROVED" ? (
                      <span className="text-xs font-semibold bg-emerald-950/70 text-emerald-300 border border-emerald-800/60 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        Approved
                      </span>
                    ) : selectedOrderDetails.order.status === "REJECTED" ? (
                      <span className="text-xs font-semibold bg-rose-950/70 text-rose-300 border border-rose-800/60 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5 text-rose-400" />
                        Rejected
                      </span>
                    ) : (
                      <span className="text-xs font-semibold bg-amber-950/70 text-amber-300 border border-amber-800/60 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                        Awaiting Review
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {selectedOrderDetails.files.length} documents &bull; Total Size: {formatBytes(selectedOrderDetails.order.totalBytes)} &bull; Submitted: {selectedOrderDetails.order.createdAt.substring(11, 16)}
                    {selectedOrderDetails.order.completedAt && (
                      <span className="text-teal-400 font-medium ml-2">
                        &bull; Printed: {selectedOrderDetails.order.completedAt} {selectedOrderDetails.order.targetPrinter ? `(${selectedOrderDetails.order.targetPrinter})` : ""}
                      </span>
                    )}
                  </p>
                  {selectedOrderDetails.order.customerNotes && (
                    <div className="mt-2 text-xs bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-1.5 text-amber-300/90 flex items-center gap-2">
                      <span className="font-semibold text-slate-400">Customer Note:</span>
                      <span>"{selectedOrderDetails.order.customerNotes}"</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setSelectedOrderDetails(null)}
                  className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold"
                >
                  &times;
                </button>
              </div>

              {/* Inspect Modal Preview / Action Error Notification */}
              {inspectModalError && (
                <div className="p-3 my-2 bg-rose-950/80 border border-rose-800/80 rounded-xl text-rose-200 text-xs flex items-center justify-between gap-2 shadow-sm animate-fade-in shrink-0">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{inspectModalError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInspectModalError(null)}
                    className="text-slate-400 hover:text-white font-bold px-1.5"
                  >
                    &times;
                  </button>
                </div>
              )}

              {/* Files List with Shopkeeper Edit & Per-File Rejection Option */}
              <div className="flex-1 overflow-y-auto my-4 space-y-3 pr-1">
                {selectedOrderDetails.files.map((file, idx) => {
                  const isExcluded = !!file.isExcluded;
                  const autoPrinterName = file.autoPrinter || selectedPrinter || "Default Printer";
                  const manualOverridePrinter = file.printSettings?.targetPrinter || "";
                  const effectiveFilePrinter = manualOverridePrinter || file.resolvedPrinter || autoPrinterName;
                  return (
                    <div
                      key={file.fileId}
                      className={`border rounded-2xl p-4 space-y-3 transition ${
                        file.isPurged
                          ? "bg-slate-950/70 border-slate-800/60 opacity-75"
                          : isExcluded
                          ? "bg-rose-950/20 border-rose-900/60 opacity-80"
                          : "bg-slate-950 border-slate-800/80"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <span className={`w-6 h-6 rounded-lg text-xs flex items-center justify-center font-bold font-mono shrink-0 mt-0.5 ${
                            file.isPurged
                              ? "bg-slate-900 text-slate-400 border border-slate-800"
                              : isExcluded
                              ? "bg-rose-950 text-rose-400 border border-rose-800"
                              : "bg-indigo-950 text-indigo-400 border border-indigo-800"
                          }`}>
                            {idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`font-semibold text-sm ${file.isPurged ? "text-slate-500 line-through" : isExcluded ? "text-slate-400 line-through" : "text-slate-200"}`}>
                                {file.originalFilename}
                              </span>
                              <span
                                className="text-[11px] bg-indigo-950/80 text-indigo-300 border border-indigo-800/70 px-2 py-0.5 rounded-md font-semibold flex items-center gap-1"
                                title={`Default automatic printer based on ${file.printSettings.colorMode === "COLOR" ? "Color" : "B&W"} (${file.printSettings.paperSize}) settings`}
                              >
                                <Printer className="w-3 h-3 text-indigo-400" />
                                <span>Auto: {autoPrinterName}</span>
                              </span>
                              {manualOverridePrinter && (
                                <span
                                  className="text-[11px] bg-amber-950/80 text-amber-300 border border-amber-700/70 px-2 py-0.5 rounded-md font-bold flex items-center gap-1"
                                  title={`Manual printer override active: ${manualOverridePrinter}`}
                                >
                                  <span>🎯 Override: {manualOverridePrinter}</span>
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {file.isPurged ? (
                                <span className="text-[10px] bg-slate-900 text-slate-300 border border-slate-700/80 px-2 py-0.5 rounded font-semibold flex items-center gap-1">
                                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                                  Erased by Customer (Erased from PC)
                                </span>
                              ) : (selectedOrderDetails.order.status === "COMPLETED" || activeTab === "PRINTED") ? (
                                isExcluded ? (
                                  <span className="text-[10px] bg-rose-950/90 text-rose-300 border border-rose-800/80 px-2 py-0.5 rounded font-bold flex items-center gap-1 shadow-sm">
                                    <Ban className="w-3 h-3 text-rose-400" />
                                    EXCLUDED FROM PRINT
                                  </span>
                                ) : null
                              ) : isExcluded ? (
                                <span className="text-[10px] bg-rose-950/90 text-rose-300 border border-rose-800/80 px-2 py-0.5 rounded font-bold flex items-center gap-1 shadow-sm">
                                  <Ban className="w-3 h-3 text-rose-400" />
                                  REJECTED / EXCLUDED
                                </span>
                              ) : selectedOrderDetails.order.status === "APPROVED" ? (
                                <span className="text-[10px] bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 px-2 py-0.5 rounded font-bold flex items-center gap-1 shadow-sm">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                  APPROVED FOR PRINT
                                </span>
                              ) : (
                                <span className="text-[10px] bg-amber-950/80 text-amber-300 border border-amber-800/80 px-2 py-0.5 rounded font-bold flex items-center gap-1 shadow-sm">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                                  PENDING APPROVAL
                                </span>
                              )}
                              {(file.originalFilename.toLowerCase().endsWith(".xlsx") || file.originalFilename.toLowerCase().endsWith(".xls")) && (
                                <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-medium">
                                  <FileSpreadsheet className="w-3 h-3" />
                                  Excel Workbook
                                </span>
                              )}
                              {file.isPrinted && (
                                <span className="text-[10px] bg-teal-950/80 text-teal-300 border border-teal-800/60 px-2 py-0.5 rounded font-semibold flex items-center gap-1" title={file.printedAt ? `Printed at ${file.printedAt}` : undefined}>
                                  <Check className="w-3 h-3 text-teal-400" />
                                  Printed {file.printedAt ? file.printedAt.substring(11, 16) : ""} {file.printedOn ? `on ${file.printedOn}` : ""}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Per-File Printer Selection Override Dropdown + File Size */}
                        <div className="flex items-center gap-2 shrink-0 flex-wrap">
                          {!file.isPurged && (
                            <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700/80 rounded-xl px-2.5 py-1">
                              <Printer className={`w-3.5 h-3.5 shrink-0 ${manualOverridePrinter ? "text-amber-400" : "text-indigo-400"}`} />
                              <span className="text-[11px] text-slate-400 font-medium whitespace-nowrap">Printer:</span>
                              <select
                                value={manualOverridePrinter || "AUTO"}
                                onChange={(e) => handleChangeFilePrinter(file.fileId, file.originalFilename, e.target.value)}
                                disabled={isPrinting}
                                className={`bg-slate-950 border rounded-lg px-2 py-1 text-xs font-semibold focus:outline-none cursor-pointer max-w-[230px] truncate ${
                                  manualOverridePrinter
                                    ? "border-amber-600/80 text-amber-300"
                                    : "border-slate-700 text-indigo-200"
                                }`}
                                title="Automatic printer selection based on Color/B&W rules, or manually override printer for this specific file"
                              >
                                <option value="AUTO">⚡ Auto ({autoPrinterName})</option>
                                {printers.map((p) => (
                                  <option key={p.name} value={p.name}>
                                    🎯 {p.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                          <span className="text-xs text-slate-400 font-mono">{formatBytes(file.fileSizeBytes)}</span>
                        </div>
                      </div>

                      {/* Print Settings Box with Shopkeeper Modify, Preview & Exclude Buttons */}
                      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 block text-[11px]">Print Configuration:</span>
                            {file.printSettings.pageRange && file.printSettings.pageRange.trim() && file.printSettings.pageRange.toLowerCase() !== "all" && (
                              <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800/80 px-2 py-0.5 rounded font-mono font-bold flex items-center gap-1 shadow-sm">
                                📄 Target: {file.printSettings.pageRange.trim()}
                              </span>
                            )}
                          </div>
                          <span className={`font-semibold mt-0.5 block ${file.isPurged || isExcluded ? "text-slate-500 line-through" : "text-indigo-300"}`}>
                            {file.settingsSummary}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-2 flex-wrap">
                          {!file.isPurged && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenPreview(file)}
                                disabled={isLoadingPreview}
                                title="Preview & Setup Print Configuration"
                                className="flex items-center gap-1.5 bg-indigo-950/90 hover:bg-indigo-900 text-indigo-300 hover:text-white border border-indigo-700/70 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition cursor-pointer"
                              >
                                {previewLoadingFileId === file.fileId ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5 text-indigo-400" />
                                )}
                                <span>{previewLoadingFileId === file.fileId ? "Loading..." : "Preview & Setup"}</span>
                              </button>

                              {/* Per-File Direct Print / Reprint */}
                              <button
                                type="button"
                                onClick={() => handlePrintSingleFile(file.fileId, file.originalFilename)}
                                disabled={(selectedOrderDetails.order.status !== "COMPLETED" && isExcluded) || isPrinting}
                                className={`flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition cursor-pointer ${
                                  file.isPrinted 
                                    ? "bg-teal-700/80 hover:bg-teal-600" 
                                    : "bg-emerald-700/80 hover:bg-emerald-600"
                                }`}
                                title={
                                  (selectedOrderDetails.order.status !== "COMPLETED" && isExcluded)
                                    ? "Cannot print excluded file" 
                                    : `${file.isPrinted ? "Reprint" : "Print"} "${file.originalFilename}" to ${effectiveFilePrinter}`
                                }
                              >
                                {file.isPrinted ? (
                                  <>
                                    <RotateCcw className="w-3.5 h-3.5" />
                                    <span>Reprint File</span>
                                  </>
                                ) : (
                                  <>
                                    <Printer className="w-3.5 h-3.5" />
                                    <span>Print File</span>
                                  </>
                                )}
                              </button>
                            </>
                          )}

                          {/* Per-File Approval / Rejection Dual-State Segmented Switch (Only in Active Queue / Non-Completed Orders) */}
                          {!file.isPurged && selectedOrderDetails.order.status !== "COMPLETED" && activeTab !== "PRINTED" && (
                            <div className="flex items-center bg-slate-950 p-0.5 rounded-xl border border-slate-800 text-xs shadow-inner">
                              <button
                                type="button"
                                onClick={() => isExcluded && handleToggleFileExclusion(file.fileId, true)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                                  !isExcluded
                                    ? "bg-emerald-600 text-white shadow-md shadow-emerald-950 ring-1 ring-emerald-400"
                                    : "text-slate-400 hover:text-emerald-300 hover:bg-slate-900"
                                }`}
                                title={!isExcluded ? "File is approved for printing" : "Click to approve this file for printing"}
                              >
                                <CheckCircle2 className={`w-3.5 h-3.5 ${!isExcluded ? "text-white" : "text-emerald-500"}`} />
                                <span>{!isExcluded ? "Approved" : "Approve"}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => !isExcluded && handleToggleFileExclusion(file.fileId, false)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                                  isExcluded
                                    ? "bg-rose-600 text-white shadow-md shadow-rose-950 ring-1 ring-rose-400"
                                    : "text-slate-400 hover:text-rose-300 hover:bg-slate-900"
                                }`}
                                title={isExcluded ? "File is rejected / excluded from printing" : "Click to reject / exclude this file from printing"}
                              >
                                <XCircle className={`w-3.5 h-3.5 ${isExcluded ? "text-white" : "text-rose-400"}`} />
                                <span>{isExcluded ? "Rejected" : "Reject"}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1 truncate">
                        <span>SHA-256:</span>
                        <span className="text-slate-400">{file.sha256Hash}</span>
                      </div>

                      {/* File Billing Detail Row */}
                      {(() => {
                        const fb = selectedOrderBilling?.files.find((b) => b.fileId === file.fileId);
                        if (!fb) return null;
                        return (
                          <div className="flex items-center justify-between text-xs px-2.5 py-1.5 bg-slate-900/60 border border-slate-800/80 rounded-xl">
                            <div className="flex items-center gap-2 text-slate-400 text-[11px] flex-wrap">
                              <span className="font-semibold text-slate-300">📄 {fb.documentPages} {fb.documentPages === 1 ? "Page" : "Pages"}</span>
                              {fb.effectivePages !== fb.documentPages && (
                                <span className="text-amber-400">({fb.effectivePages} selected)</span>
                              )}
                              <span>&bull;</span>
                              <span>{fb.copies} {fb.copies === 1 ? "Copy" : "Copies"}</span>
                              <span>&bull;</span>
                              <span className="text-indigo-300">{fb.totalSheets} {fb.totalSheets === 1 ? "Sheet" : "Sheets"} ({fb.duplexSheets > 0 ? `${fb.duplexSheets} Duplex` : "Simplex"})</span>
                              <span className="text-slate-500 font-mono text-[10px]">({fb.unitRateDescription})</span>
                            </div>
                            <div className="font-mono font-bold text-xs">
                              {fb.isExcluded || fb.isPurged ? (
                                <span className="text-rose-400 line-through">₹0.00</span>
                              ) : (
                                <span className="text-emerald-400">₹{fb.subtotal.toFixed(2)}</span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>

              {/* Order Billing & Payment Summary Card */}
              {selectedOrderBilling && (
                <div className="mb-4 bg-slate-950/90 border border-blue-900/50 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg shadow-blue-950/20">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-blue-300 uppercase tracking-wider flex items-center gap-1">
                        <span>🧾</span> Total Printing Charges:
                      </span>
                      <span className="text-xl font-extrabold text-emerald-400 font-mono">
                        ₹{selectedOrderBilling.totalAmount.toFixed(2)}
                      </span>
                      <span className="text-xs text-slate-400">
                        ({selectedOrderBilling.totalSheets} {selectedOrderBilling.totalSheets === 1 ? "Sheet" : "Sheets"} &bull; {selectedOrderBilling.totalPages} {selectedOrderBilling.totalPages === 1 ? "Page" : "Pages"})
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-xs text-slate-400">Customer:</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        selectedOrderBilling.customerType === "REMOTE"
                          ? "bg-cyan-950 text-cyan-300 border-cyan-800"
                          : "bg-slate-900 text-slate-300 border-slate-700"
                      }`}>
                        {selectedOrderBilling.customerType === "REMOTE" ? "🌐 Remote Customer" : "🚶 Walk-In Customer"}
                      </span>
                      <span className="text-xs text-slate-400 ml-1">Payment:</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        selectedOrderBilling.paymentStatus === "PAID"
                          ? "bg-emerald-950 text-emerald-400 border-emerald-700"
                          : selectedOrderBilling.paymentStatus === "CREDIT"
                          ? "bg-purple-950 text-purple-300 border-purple-700"
                          : "bg-amber-950 text-amber-300 border-amber-700"
                      }`}>
                        {selectedOrderBilling.paymentStatus === "PAID"
                          ? `✅ Paid (${selectedOrderBilling.paymentMethod || "CASH"})`
                          : selectedOrderBilling.paymentStatus === "CREDIT"
                          ? "📋 Corporate Credit"
                          : "⏳ Unpaid"}
                      </span>
                      {selectedOrderBilling.paymentClaim === "CLAIMED" && selectedOrderBilling.paymentStatus === "UNPAID" && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-cyan-950 text-cyan-300 border-cyan-500 animate-pulse">
                          📡 UPI Claimed
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Customer Claim Alert Banner */}
                  {selectedOrderBilling.paymentClaim === "CLAIMED" && selectedOrderBilling.paymentStatus === "UNPAID" && (
                    <div className="w-full bg-gradient-to-r from-cyan-950/95 via-blue-950/90 to-slate-900 border-2 border-cyan-400 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg shadow-cyan-950/60 animate-pulse">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl animate-bounce">📱</span>
                        <div>
                          <div className="text-xs font-black text-cyan-200 uppercase tracking-wide flex items-center gap-2">
                            <span>Customer Claimed UPI Payment</span>
                            <span className="bg-cyan-500/20 text-cyan-300 border border-cyan-400/50 text-xs px-2 py-0.5 rounded-full font-mono font-bold">
                              ₹{selectedOrderBilling.totalAmount.toFixed(2)}
                            </span>
                          </div>
                          <div className="text-[11px] text-cyan-300/80 mt-0.5">
                            Customer claimed payment via UPI app from mobile. Once verified on your UPI app / bank SMS, click Confirm.
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUpdatePayment(selectedOrderBilling.orderId, "PAID", "ONLINE")}
                        className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-xs font-black shadow-md flex items-center justify-center gap-1.5 transition flex-shrink-0 cursor-pointer"
                      >
                        <span>✅</span> Confirm Received (₹{selectedOrderBilling.totalAmount.toFixed(2)})
                      </button>
                    </div>
                  )}

                  {/* Payment Actions */}
                  {(() => {
                    const methodUpper = (selectedOrderBilling.paymentMethod || "").toUpperCase();
                    const isOnlineSelected = selectedOrderBilling.paymentStatus === "PAID" && (methodUpper === "ONLINE" || methodUpper === "UPI" || methodUpper === "RAZORPAY");
                    const isCashSelected = selectedOrderBilling.paymentStatus === "PAID" && !isOnlineSelected;
                    const isCreditSelected = selectedOrderBilling.paymentStatus === "CREDIT";
                    const isAnySettled = selectedOrderBilling.paymentStatus === "PAID" || selectedOrderBilling.paymentStatus === "CREDIT";

                    return (
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Paid CASH */}
                        <button
                          type="button"
                          onClick={() => handleUpdatePayment(selectedOrderBilling.orderId, "PAID", "CASH")}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                            isCashSelected
                              ? "bg-emerald-600 text-white ring-2 ring-emerald-400 shadow-md shadow-emerald-950"
                              : isAnySettled
                              ? "bg-slate-900/40 text-slate-500 border border-slate-800/60 hover:text-slate-300 hover:bg-slate-800/80 opacity-50 hover:opacity-100"
                              : "bg-emerald-950/70 hover:bg-emerald-900/90 text-emerald-300 border border-emerald-700/60 shadow-sm"
                          }`}
                          title="Mark as Paid in Cash at Counter"
                        >
                          {isCashSelected ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-white" />
                              <span>Paid CASH</span>
                            </>
                          ) : (
                            <>
                              <span>💵</span>
                              <span>Paid CASH</span>
                            </>
                          )}
                        </button>

                        {/* Paid ONLINE */}
                        <button
                          type="button"
                          onClick={() => handleUpdatePayment(selectedOrderBilling.orderId, "PAID", "ONLINE")}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                            isOnlineSelected
                              ? "bg-indigo-600 text-white ring-2 ring-indigo-400 shadow-md shadow-indigo-950"
                              : isAnySettled
                              ? "bg-slate-900/40 text-slate-500 border border-slate-800/60 hover:text-slate-300 hover:bg-slate-800/80 opacity-50 hover:opacity-100"
                              : "bg-indigo-950/70 hover:bg-indigo-900/90 text-indigo-300 border border-indigo-700/60 shadow-sm"
                          }`}
                          title="Mark as Paid Online (UPI)"
                        >
                          {isOnlineSelected ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-white" />
                              <span>Paid ONLINE</span>
                            </>
                          ) : (
                            <>
                              <span>📱</span>
                              <span>Paid ONLINE</span>
                            </>
                          )}
                        </button>

                        {/* Credit */}
                        <button
                          type="button"
                          onClick={() => handleUpdatePayment(selectedOrderBilling.orderId, "CREDIT")}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                            isCreditSelected
                              ? "bg-purple-700 text-white ring-2 ring-purple-400 shadow-md shadow-purple-950 font-bold"
                              : isAnySettled
                              ? "bg-slate-900/40 text-slate-500 border border-slate-800/60 hover:text-slate-300 hover:bg-slate-800/80 opacity-50 hover:opacity-100"
                              : "bg-purple-950/70 hover:bg-purple-900/90 text-purple-300 border border-purple-700/60 shadow-sm"
                          }`}
                          title="Mark as Corporate Credit (Pay Later)"
                        >
                          {isCreditSelected ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-white" />
                              <span>Credit</span>
                            </>
                          ) : (
                            <>
                              <span>📋</span>
                              <span>Credit</span>
                            </>
                          )}
                        </button>

                        {/* Reset button to mark unpaid if needed */}
                        {isAnySettled && (
                          <button
                            type="button"
                            onClick={() => handleUpdatePayment(selectedOrderBilling.orderId, "UNPAID")}
                            className="px-2.5 py-1.5 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700/60 rounded-lg text-xs transition cursor-pointer"
                            title="Reset Payment Status to Unpaid"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Inspection Footer with Strict Approval & Print Gate */}
              <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-slate-400">
                  <span className="font-semibold text-slate-200">
                    {selectedOrderDetails.files.filter(f => !f.isExcluded).length} of {selectedOrderDetails.files.length} Files Included
                  </span>
                  {selectedOrderDetails.files.some(f => f.isExcluded) && (
                    <span className="text-rose-400 ml-1">
                      ({selectedOrderDetails.files.filter(f => f.isExcluded).length} Excluded)
                    </span>
                  )}
                  <span> &bull; {selectedOrderDetails.files.filter(f => !f.isExcluded).reduce((acc, f) => acc + (f.printSettings.copies || 1), 0)} Total Copies</span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {(selectedOrderDetails.order.status === "PURGED_BY_CUSTOMER" || selectedOrderDetails.files.every(f => f.isPurged)) ? (
                    <div className="text-xs bg-slate-950 border border-slate-800 text-slate-300 px-3.5 py-2 rounded-xl flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Customer erased all files in this order from the shop computer.</span>
                    </div>
                  ) : (
                    <>
                      {selectedOrderDetails.order.status !== "REJECTED" && 
                       selectedOrderDetails.order.status !== "COMPLETED" && 
                       selectedOrderDetails.order.status !== "PURGED_BY_CUSTOMER" && 
                       activeTab !== "PRINTED" && 
                       !selectedOrderDetails.files.every(f => f.isPurged) && (
                        <button
                          onClick={() => {
                            setRejectingOrderId(selectedOrderDetails.order.id);
                            setRejectionReason("");
                          }}
                          className="px-3.5 py-2 bg-rose-950/50 hover:bg-rose-900/80 text-rose-300 border border-rose-800/60 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Move to Dustbin
                        </button>
                      )}

                      {selectedOrderDetails.order.status !== "APPROVED" && selectedOrderDetails.order.status !== "COMPLETED" && (
                        <button
                          onClick={() => handleApproveOrder(selectedOrderDetails.order.id)}
                          disabled={selectedOrderDetails.files.filter(f => !f.isExcluded).length === 0}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-semibold transition shadow-md shadow-emerald-950 flex items-center justify-center font-bold cursor-pointer"
                          title={selectedOrderDetails.files.filter(f => !f.isExcluded).length === 0 ? "Cannot approve: At least 1 file must be approved" : "Approve selected files for printing"}
                        >
                          <span>Approve Order ({selectedOrderDetails.files.filter(f => !f.isExcluded).length} of {selectedOrderDetails.files.length} Files)</span>
                        </button>
                      )}

                      {/* Print Controls: Print All or Reprint Entire Order */}
                      {(() => {
                        const hasPrintable = selectedOrderDetails.files.some(f => !f.isPurged && !f.isExcluded);
                        if (selectedOrderDetails.order.status === "COMPLETED") {
                          return hasPrintable ? (
                            <button
                              onClick={() => handleTriggerPrint(selectedOrderDetails.order.id)}
                              disabled={isPrinting}
                              className="px-5 py-2 bg-gradient-to-r from-teal-600 to-indigo-600 hover:from-teal-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-teal-950/60 flex items-center gap-2 cursor-pointer"
                              title={`Reprint all files using their assigned printers (${selectedOrderDetails.order.targetPrinter || selectedPrinter})`}
                            >
                              <RotateCcw className="w-4 h-4" />
                              Reprint Entire Order
                            </button>
                          ) : null;
                        } else if (selectedOrderDetails.order.status === "APPROVED" || selectedOrderDetails.order.status === "PRINTING") {
                          return hasPrintable ? (
                            <button
                              onClick={() => handleTriggerPrint(selectedOrderDetails.order.id)}
                              disabled={isPrinting}
                              className="px-5 py-2 bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-950/60 flex items-center gap-2 cursor-pointer"
                            >
                              <Printer className="w-4 h-4" />
                              Print All (Batch)
                            </button>
                          ) : null;
                        } else {
                          return (
                            <div className="relative group">
                              <button
                                disabled
                                className="px-4 py-2 bg-slate-800/80 text-slate-500 border border-slate-700/50 rounded-xl text-xs font-semibold cursor-not-allowed flex items-center gap-1.5"
                              >
                                <Lock className="w-3.5 h-3.5 text-slate-500" />
                                Print All
                              </button>
                              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block bg-slate-950 text-slate-300 border border-slate-800 text-[11px] rounded-lg px-2.5 py-1 whitespace-nowrap shadow-xl z-50">
                                Approve order first to unlock printing
                              </div>
                            </div>
                          );
                        }
                      })()}
                    </>
                  )}

                  <button
                    onClick={() => setSelectedOrderDetails(null)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Rejection Prompt Modal */}
        {rejectingOrderId && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-rose-900/80 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
              <div className="flex items-center gap-2.5 text-rose-400">
                <div className="p-2 bg-rose-950 rounded-xl border border-rose-800/50">
                  <Ban className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Reject Order #{rejectingOrderId.substring(0, 8)}</h3>
                  <p className="text-xs text-slate-400">Provide an optional reason for the audit ledger</p>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                  Rejection Reason
                </label>
                <input
                  type="text"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="e.g. Unreadable font, corrupted document, customer cancelled..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setRejectingOrderId(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmReject}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold transition shadow-md shadow-rose-950 flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Move to Dustbin</span>
                </button>
              </div>
            </div>
          </div>
        )}


        {/* WYSIWYG Physical Paper Sheet Print Preview Canvas Modal */}
        {previewData && previewFile && (
          <Suspense fallback={
            <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in font-sans">
              <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 text-slate-300 flex flex-col items-center gap-3 max-w-sm text-center shadow-2xl">
                <div className="w-10 h-10 rounded-2xl bg-indigo-950/80 border border-indigo-700/60 flex items-center justify-center text-indigo-400">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-white">Loading Document Engine & Canvas</h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-[260px] truncate">
                    Rendering preview for "{previewData.originalFilename}"
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewData(null);
                    setPreviewFile(null);
                  }}
                  className="mt-2 px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer shadow-sm"
                >
                  Cancel / Close
                </button>
              </div>
            </div>
          }>
            <PrintPreviewCanvas
              fileId={previewFile.fileId}
              filename={previewData.originalFilename}
              fileType={previewData.fileType}
              previewDataUrl={previewData.previewDataUrl}
              previewUrl={previewData.previewUrl}
              excelMetadata={previewData.excelMetadata}
              initialSettings={{
                paperSize: previewFile.printSettings.paperSize || "A4",
                colorMode: previewFile.printSettings.colorMode || "BW",
                orientation: previewFile.printSettings.orientation || "PORTRAIT",
                copies: previewFile.printSettings.copies || 1,
                duplexMode: previewFile.printSettings.duplexMode || "SIMPLEX",
                rotation: previewFile.printSettings.rotation || 0,
                pageRange: previewFile.printSettings.pageRange || "",
              }}
              onApplySettings={handleApplyPreviewSettings}
              onClose={() => {
                setPreviewData(null);
                setPreviewFile(null);
              }}
            />
          </Suspense>
        )}
        {/* Batch Print Result Spool Summary Modal (Phase-H) */}
        {printBatchModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-950/80 border border-emerald-700/80 flex items-center justify-center text-emerald-400">
                    <Printer className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base">Print Batch Execution</h3>
                    <p className="text-xs text-slate-400">
                      Target: <span className="font-semibold text-slate-200">{printBatchModal.printerName}</span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setPrintBatchModal(null)}
                  className="w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold"
                >
                  &times;
                </button>
              </div>

              {/* Status Banner */}
              <div
                className={`p-3 rounded-2xl border flex items-center gap-3 text-xs ${
                  printBatchModal.failedFiles === 0
                    ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
                    : "bg-amber-950/40 border-amber-800 text-amber-300"
                }`}
              >
                {printBatchModal.failedFiles === 0 ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                )}
                <div>
                  <p className="font-bold">
                    {printBatchModal.failedFiles === 0
                      ? "All documents sent to Windows spooler!"
                      : `Batch completed with issues: ${printBatchModal.successfulFiles} of ${printBatchModal.totalFiles} sent.`}
                  </p>
                  <p className="text-[11px] opacity-80 mt-0.5">
                    Order #{printBatchModal.orderId.substring(0, 8)} status updated to COMPLETED.
                  </p>
                </div>
              </div>

              {/* Dispatched Files List */}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {printBatchModal.jobs.map((job) => (
                  <div
                    key={job.fileId}
                    className="flex items-center justify-between p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-xs"
                  >
                    <div className="flex items-center gap-2 truncate mr-2">
                      <FileText className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                      <span className="font-medium text-slate-200 truncate">{job.filename}</span>
                    </div>
                    {job.status === "COMPLETED" || job.status === "SENT_TO_SPOOLER" ? (
                      <span className="text-[10px] bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 flex-shrink-0">
                        <Check className="w-3 h-3" /> Spooled
                      </span>
                    ) : (
                      <span
                        className="text-[10px] bg-rose-950/80 text-rose-300 border border-rose-800/80 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 flex-shrink-0"
                        title={job.errorMessage || "Spool failed"}
                      >
                        <XCircle className="w-3 h-3 text-rose-400" /> Failed
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setPrintBatchModal(null)}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30 transition"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="flex-shrink-0 border-t border-slate-800/80 bg-slate-950 px-4 sm:px-6 py-2 sm:py-2.5 text-xs text-slate-500 flex justify-between items-center">
        <span>PrintDrop Windows 11 Desktop {status?.version ? `v${status.version} ` : ''}&copy; 2026</span>
        <span>Phase-I: Intelligent Multi-Printer Sequential Batch Spooling Engine & Real-Time Animated UI</span>
      </footer>

      {/* Printable Countertop Poster Modal */}
      <CountertopPosterModal
        isOpen={showPosterModal}
        onClose={() => setShowPosterModal(false)}
        shopName={
          licenseState?.shopName &&
          licenseState.shopName.trim() !== "" &&
          licenseState.shopName.trim() !== "PrintDrop Retail Station"
            ? `${licenseState.shopName.trim()} • Powered by PrintDrop`
            : "PrintDrop Station"
        }
        wifiSsid={wifiInfo?.ssid || ""}
        wifiPassword={wifiInfo?.password}
        wifiQrDataUrl={wifiInfo?.qrDataUrl}
        uploadUrl={session?.accessUrl || ""}
        uploadQrDataUrl={session?.qrDataUrl}
        tunnelUrl={tunnelInfo?.isActive ? tunnelInfo.url : undefined}
        tunnelQrDataUrl={tunnelInfo?.isActive ? tunnelInfo.qrDataUrl : undefined}
        permanentUrl={permanentPortalUrl}
        permanentQrDataUrl={permanentPortalQr}
      />

      {/* Corporate Clients & Permanent Portals Modal */}
      <CorporateClientsModal
        isOpen={isCorporateModalOpen}
        onClose={() => setIsCorporateModalOpen(false)}
        interfaces={interfaces}
        tunnelUrl={tunnelInfo?.isActive ? tunnelInfo.url : undefined}
      />

      {/* Pricing Rates Config Modal */}
      <PricingRatesModal
        isOpen={isPricingModalOpen}
        onClose={() => setIsPricingModalOpen(false)}
        onRatesSaved={async () => {
          const updatedOrders = await invoke<OrderSummaryDto[]>("list_incoming_orders");
          setOrders(updatedOrders);
          if (selectedOrderDetails) {
            const [refreshed, refreshedBilling] = await Promise.all([
              invoke<OrderDetailDto | null>("get_order_details", { orderId: selectedOrderDetails.order.id }),
              invoke<OrderBilling | null>("get_order_billing", { orderId: selectedOrderDetails.order.id }),
            ]);
            if (refreshed) setSelectedOrderDetails(refreshed);
            if (refreshedBilling) setSelectedOrderBilling(refreshedBilling);
          }
        }}
      />

      {/* UPI Payment Settings Modal */}
      <PaymentSettingsModal
        isOpen={isPaymentSettingsModalOpen}
        onClose={() => setIsPaymentSettingsModalOpen(false)}
      />

      {/* Backup & Disaster Recovery Modal */}
      <BackupRestoreModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        onRefreshOrders={async () => {
          const updatedOrders = await invoke<OrderSummaryDto[]>("list_incoming_orders");
          setOrders(updatedOrders);
        }}
      />

      {/* Printer Intelligent Routing Modal */}
      <PrinterRoutingModal
        isOpen={isRoutingModalOpen}
        onClose={() => setIsRoutingModalOpen(false)}
        printers={printers}
        selectedPrinter={selectedPrinter}
        onPrinterSelected={(p) => setSelectedPrinter(p)}
        onPrintersRefreshed={async () => {
          const freshPrinters = await invoke<PrinterInfo[]>("get_available_printers");
          setPrinters(freshPrinters);
        }}
        isTrialLicense={licenseState?.planType === 'TRIAL'}
      />

      {/* Live Animated Print Spooler Hub */}
      <LivePrintSpoolerModal
        isOpen={isSpoolerModalOpen}
        onClose={() => setIsSpoolerModalOpen(false)}
        onBatchComplete={async () => {
          setIsPrinting(false);
          const updatedOrders = await invoke<OrderSummaryDto[]>("list_incoming_orders");
          setOrders(updatedOrders);
          try {
            const updatedLicense = await invoke<LicenseStateDto>("get_license_state");
            setLicenseState(updatedLicense);
          } catch {
            // Ignore license refresh failure
          }
        }}
      />

      {/* Commercial Station License & HWID Modal */}
      <LicenseActivationModal
        isOpen={isLicenseModalOpen}
        onClose={() => setIsLicenseModalOpen(false)}
        onLicenseUpdated={(updatedState) => setLicenseState(updatedState)}
      />

      {/* Shopkeeper Operations Manual & Help Center Modal */}
      <HelpGuideModal
        isOpen={isHelpModalOpen}
        onClose={() => setIsHelpModalOpen(false)}
        onOpenLicense={() => setIsLicenseModalOpen(true)}
        onOpenPricing={() => setIsPricingModalOpen(true)}
        onOpenRouting={() => setIsRoutingModalOpen(true)}
        onOpenPaymentSettings={() => setIsPaymentSettingsModalOpen(true)}
        onOpenContactUs={() => setIsContactUsModalOpen(true)}
      />

      {/* Software Provider Profile & Contact Us Support Modal */}
      {isContactUsModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="p-4 bg-gradient-to-r from-cyan-950/80 via-slate-900 to-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-400">
                  <PhoneCall className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white text-sm">Contact Software Provider</h3>
                    {isSyncingProviderProfile ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 animate-pulse flex items-center gap-1">
                        <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                        <span>Checking Cloud...</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => refreshProviderProfile(false)}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition flex items-center gap-1 cursor-pointer"
                        title="Click to check and pull latest provider profile from Cloud"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        <span>Cloud Synced</span>
                        <RefreshCw className="w-2.5 h-2.5 text-emerald-400 ml-0.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-cyan-300/80">Support, Renewals &amp; Commercial Licensing</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsContactUsModalOpen(false)}
                className="w-7 h-7 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4">
              {/* Company Info Box */}
              <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Company / Software Provider</span>
                <div className="text-base font-extrabold text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-cyan-400" />
                  <span>{providerProfile?.businessName || licenseState?.providerCompanyName || "TechnoSoft Solution"}</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Official developer &amp; distributor of PrintDrop Retail Counter OS. Contact for subscription renewals, wallet page recharges, counter standee setup, and technical assistance.
                </p>
              </div>

              {/* Direct Channels */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Phone Call */}
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                      <PhoneCall className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Customer Support Phone</span>
                    </div>
                    <div className="font-mono font-bold text-cyan-300 text-xs truncate mt-1">
                      {providerProfile?.contactPhone || licenseState?.providerContactPhone || "+91 94220 00000"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCallProvider()}
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold text-cyan-300 hover:text-white bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-800/50 rounded-lg px-2.5 py-1.5 transition cursor-pointer self-start shadow-sm active:scale-95"
                    title="Initiate phone call via Windows Phone Link / default telephony app"
                  >
                    <PhoneCall className="w-3 h-3 text-cyan-400" />
                    <span>Call Provider</span>
                  </button>
                </div>

                {/* WhatsApp Chat */}
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                      <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                      <span>WhatsApp Direct Support</span>
                    </div>
                    <div className="font-mono font-bold text-emerald-300 text-xs truncate mt-1">
                      {providerProfile?.whatsappNumber || licenseState?.providerWhatsappNumber || "+91 94220 00000"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenWhatsApp()}
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-300 hover:text-white bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-800/50 rounded-lg px-2.5 py-1.5 transition cursor-pointer self-start shadow-sm active:scale-95"
                    title="Opens WhatsApp Desktop app (if installed) or WhatsApp Web in your browser"
                  >
                    <MessageSquare className="w-3 h-3 text-emerald-400" />
                    <span>Chat on WhatsApp</span>
                    <ExternalLink className="w-2.5 h-2.5 text-emerald-400/80 ml-0.5" />
                  </button>
                </div>
              </div>

              {/* Email */}
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-indigo-400" />
                  <div>
                    <span className="text-[10px] text-slate-400 block font-medium">Support Email Address</span>
                    <span className="font-mono text-xs text-indigo-300 font-semibold select-all">
                      {providerProfile?.supportEmail || licenseState?.providerSupportEmail || "support@technosoftsolution.com"}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleSendEmail()}
                  className="px-2.5 py-1.5 rounded-lg bg-indigo-950 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/60 text-xs font-semibold transition cursor-pointer inline-flex items-center gap-1.5 active:scale-95"
                  title="Opens default email client with station details pre-filled"
                >
                  <Mail className="w-3 h-3 text-indigo-400" />
                  <span>Send Mail</span>
                </button>
              </div>

              {/* Station Hardware ID Card with 1-click Copy */}
              <div className="p-3.5 rounded-xl bg-slate-900/90 border border-indigo-500/40 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-indigo-300 tracking-wider">Your Station Hardware ID (HWID)</span>
                  <span className="text-[10px] text-slate-400">Quote during support calls</span>
                </div>
                <div className="flex items-center justify-between gap-2 bg-slate-950 p-2 rounded-lg border border-slate-800">
                  <span className="font-mono font-bold text-indigo-200 text-xs truncate select-all">
                    {licenseState?.hwid || "Detecting HWID..."}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (licenseState?.hwid) {
                        navigator.clipboard.writeText(licenseState.hwid);
                        setActionSuccessMsg("Station HWID copied to clipboard!");
                        setTimeout(() => setActionSuccessMsg(null), 2500);
                      }
                    }}
                    className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold flex items-center gap-1 transition shrink-0 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </button>
                </div>
              </div>

              <div className="text-[11px] text-slate-400 text-center">
                <span>Support Hours: </span>
                <strong className="text-slate-200">Monday &ndash; Saturday &bull; 9:00 AM &ndash; 9:00 PM IST</strong>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-900/60 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsContactUsModalOpen(false);
                  setIsLicenseModalOpen(true);
                }}
                className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition cursor-pointer"
              >
                View Plans &amp; Renew
              </button>
              <button
                type="button"
                onClick={() => setIsContactUsModalOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Station First-Run & Profile Setup Modal */}
      <StationSetupModal
        isOpen={isStationSetupOpen}
        isTrial={!licenseState || licenseState.planType === "TRIAL"}
        allowSkip={(!licenseState || licenseState.planType === "TRIAL") && !isStationEditMode}
        isEditMode={isStationEditMode}
        initialValues={{
          shopName: licenseState?.shopName || "",
          ownerName: licenseState?.ownerName || "",
          city: licenseState?.city || "",
          phone: licenseState?.phone || "",
        }}
        onSave={handleSaveStationProfile}
        onSkip={() => {
          setHasSkippedSetupThisSession(true);
          setIsStationSetupOpen(false);
        }}
        onClose={() => {
          setIsStationSetupOpen(false);
          setIsStationEditMode(false);
        }}
      />
    </div>
  );
}
