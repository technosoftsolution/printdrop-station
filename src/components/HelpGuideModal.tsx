import React, { useState, useMemo } from "react";
import {
  BookOpen,
  Search,
  X,
  Printer,
  IndianRupee,
  Sliders,
  ShieldCheck,
  KeyRound,
  Building2,
  FileText,
  HelpCircle,
  ChevronDown,
  Sparkles,
  Zap,
  Copy,
  QrCode,
  PhoneCall,
  Clock,
  CheckCircle2,
  Settings
} from "lucide-react";

interface HelpGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenLicense?: () => void;
  onOpenPricing?: () => void;
  onOpenRouting?: () => void;
  onOpenPaymentSettings?: () => void;
  onOpenContactUs?: () => void;
}

type GuideTopicId =
  | "quick-start"
  | "inspection-canvas"
  | "pricing-billing"
  | "printer-routing"
  | "spooler-hub"
  | "corporate-portals"
  | "licensing-wallet"
  | "backups-privacy"
  | "faq"
  | "shortcuts";

interface TopicInfo {
  id: GuideTopicId;
  title: string;
  shortDesc: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const TOPICS: TopicInfo[] = [
  {
    id: "quick-start",
    title: "1-Minute Quick Start",
    shortDesc: "Daily opening routine & customer upload workflow",
    icon: Zap,
    badge: "Essential",
  },
  {
    id: "inspection-canvas",
    title: "Document Inspection & Canvas",
    shortDesc: "WYSIWYG preview, page ranges, copies & flip",
    icon: FileText,
  },
  {
    id: "pricing-billing",
    title: "Express Billing & Pricing",
    shortDesc: "B&W vs Color rates, duplex discount & totals",
    icon: IndianRupee,
  },
  {
    id: "printer-routing",
    title: "Multi-Printer Intelligent Routing",
    shortDesc: "Auto-divert laser, color ink tank & plotter",
    icon: Sliders,
  },
  {
    id: "spooler-hub",
    title: "Live Spooler & Silent Printing",
    shortDesc: "SumatraPDF engine, pause, resume & repapering",
    icon: Printer,
  },
  {
    id: "corporate-portals",
    title: "Corporate Portals & Credit Tabs",
    shortDesc: "Dedicated client links, PINs & monthly billing",
    icon: Building2,
  },
  {
    id: "licensing-wallet",
    title: "License, Page Wallet & Dual Metering",
    shortDesc: "Smart priority plans, offline keys & tax invoices",
    icon: KeyRound,
    badge: "Important",
  },
  {
    id: "backups-privacy",
    title: "Data Safety, Privacy & Backups",
    shortDesc: "Zero-cloud auto-shredding & 1-click restore",
    icon: ShieldCheck,
  },
  {
    id: "faq",
    title: "Frequently Asked Questions",
    shortDesc: "Troubleshooting Wi-Fi, spooler & paper jams",
    icon: HelpCircle,
  },
  {
    id: "shortcuts",
    title: "Keyboard Shortcuts & Power Tips",
    shortDesc: "Speed up high-volume counter operations",
    icon: Sparkles,
  },
];

interface FaqItem {
  question: string;
  answer: string;
  category: string;
}

const FAQ_LIST: FaqItem[] = [
  {
    category: "Connectivity",
    question: "Customer's phone cannot open the upload link or gives connection timed out?",
    answer:
      "1) Verify the customer is connected to your shop's Wi-Fi network.\n2) If the customer is on mobile 4G/5G mobile data, have them scan the Cloudflare Tunnel QR code instead of the local Wi-Fi IP.\n3) Ensure Windows Firewall allows incoming connections on port 4000.",
  },
  {
    category: "Connectivity",
    question: "Can customers upload documents when shop broadband internet is down?",
    answer:
      "YES! PrintDrop runs a local web server directly on your Wi-Fi router or PC hotspot (http://192.168.x.x:4000). Local Wi-Fi document transfers do not require internet at all. Customers connect to shop Wi-Fi and upload instantly.",
  },
  {
    category: "Printing",
    question: "A print job is stuck in Windows or printer shows 'Offline'?",
    answer:
      "1) Open Settings > Live Print Spooler to check job queue status.\n2) Verify printer USB/LAN cables and ensure paper tray is filled.\n3) If physical paper was jammed, clear it and click 'Resume' in the spooler.",
  },
  {
    category: "Printing",
    question: "How do I exclude blank pages or specific pages without re-uploading?",
    answer:
      "Click any document row in an order to open the interactive WYSIWYG Print Preview Canvas. In the Page Range box, enter only the desired pages (e.g. '1-5, 8, 12-15'). PrintDrop automatically recalculates sheet count and pricing before printing.",
  },
  {
    category: "Pricing & Billing",
    question: "How do I configure my shop printing rates for A4, Legal, or Color?",
    answer:
      "Go to Settings > Shopkeeper Printing Rates & Pricing. Enter your per-page rates for B&W single-sided, B&W double-sided sheet discount, Color simplex, and Color duplex. All incoming orders automatically calculate customer bills using these rates.",
  },
  {
    category: "Payments",
    question: "How do walk-in customers pay via PhonePe, Google Pay, or Paytm?",
    answer:
      "You can print your permanent counter standee via 'Counter Standee / Poster' in the header. Customers scan your standee BharatQR (NPCI Mode 19) or tap 'Pay via UPI' on their mobile web screen to fast-forward into their UPI app.",
  },
  {
    category: "Licensing",
    question: "What happens if I have both an Unlimited Monthly plan and a Page Wallet pack?",
    answer:
      "PrintDrop features Smart Priority Dual Metering: your Unlimited Monthly subscription is actively used first for all print jobs. Your prepaid Page Wallet page balance is preserved 100% in reserve without expiring, and only begins consuming if your time subscription lapses.",
  },
  {
    category: "Licensing",
    question: "How do I get an official GST Tax Invoice for my software renewal?",
    answer:
      "Go to Settings > Recharge Station & Payment History > Payment & Usage History tab. Click 'Print / Reissue Tax Invoice' next to any transaction to preview and print or save an official GST-compliant tax receipt and license certificate.",
  },
  {
    category: "Licensing",
    question: "My shop PC has no internet. How do I activate or renew my license?",
    answer:
      "Copy your Station Hardware ID (HWID) from the top-right pill and send it to your software provider. They will generate an Offline Activation Key. In the app, open Settings > Station License > Offline Key, paste the key, and click 'Activate Station'.",
  },
  {
    category: "Security",
    question: "Where are customer documents saved, and is customer privacy protected?",
    answer:
      "Zero-Cloud Storage: Customer files are never uploaded to any public cloud server. They are transferred directly into a secured local folder on your PC. After completing an order, files are automatically shredded to protect customer confidential data.",
  },
  {
    category: "Licensing",
    question: "What happens if my Paid Subscription or Page Wallet expires during counter rush hour?",
    answer:
      "PrintDrop includes built-in Emergency Grace Protection so your shop never halts mid-rush:\n\n• Paid Subscriptions (Monthly, Quarterly, Annual): You receive a 48-Hour (2-Day) Grace Period after expiration date. Printing remains fully active with an amber countdown banner at the top of the counter displaying remaining grace hours, renew button, and direct software provider contact links. Hard lockout triggers only after 48 hours.\n\n• Page Wallet: When your wallet balance reaches 0 pages, you are automatically granted a 50-Page Emergency Overdraft Buffer. Printing continues uninterrupted until all 50 buffer prints are used.\n\n• Free Evaluation Trial: Free trials operate with a strict zero-grace policy and lock immediately upon reaching their assigned expiration date or print quota. Software providers can dynamically extend trial days anytime via the Admin Panel.",
  },
  {
    category: "Licensing",
    question: "How do I contact my software provider for license renewals or support?",
    answer:
      "Open Settings (gear icon) > Option #8 'Contact Us'. A dedicated support modal will open displaying your provider's official Company Name, Direct Phone Number, 1-Click WhatsApp Chat link, and Support Email. You can also tap 'Copy Station HWID' to instantly copy your unique machine identity to send over WhatsApp.",
  },
  {
    category: "Payments",
    question: "A walk-in customer paid in CASH. How do I record this and enable file deletion?",
    answer:
      "1) In the order row, double-click or tap 'Inspect Details'.\n2) Click the 'Paid CASH' button under Payment Modes.\n3) The order status immediately updates to 'Paid CASH' on your screen and pushes an instant SSE signal to the customer's mobile phone, turning their status badge green and unlocking the 'Delete Files' button on their mobile screen.",
  },
  {
    category: "Security",
    question: "Why did the 'Reprint' button and Trash icon disappear in Document Inspection?",
    answer:
      "This happens when a customer taps 'Delete Files' on their phone after making payment. To guarantee complete customer privacy, PrintDrop performs zero-trace file shredding on your PC storage. Since the original document has been permanently deleted, the Inspect window automatically removes the Dustbin icon and disables the Reprint buttons to reflect that the file no longer exists on disk.",
  },
  {
    category: "Connectivity",
    question: "What happens if broadband internet or mobile 4G/5G drops during an active print batch?",
    answer:
      "PrintDrop features a Dual-Source Resilience Engine with Server-Sent Events (SSE):\n1) If the customer's phone disconnects from Wi-Fi, their staged order and payment tabs remain preserved.\n2) If the shop PC's Cloudflare tunnel drops, the background tunnel watcher automatically re-provisions a new route and updates the Supabase cloud registry in under 2 seconds. The customer's mobile screen automatically migrates to the new route without losing their cart or requiring a page reload.",
  },
];

export const HelpGuideModal: React.FC<HelpGuideModalProps> = ({
  isOpen,
  onClose,
  onOpenLicense,
  onOpenPricing,
  onOpenRouting,
  onOpenPaymentSettings,
  onOpenContactUs,
}) => {
  const [selectedTopic, setSelectedTopic] = useState<GuideTopicId>("quick-start");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFaqIndex, setExpandedFaqIndex] = useState<number | null>(null);

  // Filter FAQs based on search query
  const filteredFaqs = useMemo(() => {
    if (!searchQuery.trim()) return FAQ_LIST;
    const q = searchQuery.toLowerCase();
    return FAQ_LIST.filter(
      (f) =>
        f.question.toLowerCase().includes(q) ||
        f.answer.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fade-in select-none">
      <div
        className="relative w-full max-w-5xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black overflow-hidden flex flex-col max-h-[92vh] text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 flex items-center justify-center font-bold text-lg shadow-sm">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold text-white tracking-wide">
                  PrintDrop Retail Core — Shopkeeper Guide &amp; Help Center
                </h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  v1.0.0 Manual
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Complete counter operations walkthrough, multi-printer routing, billing formulas &amp; troubleshooting
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer"
            title="Close Help Guide (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Global Search Bar & Topic Pill Bar */}
        <div className="px-6 py-2.5 bg-slate-950/40 border-b border-slate-800 flex items-center justify-between gap-4 shrink-0">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value.trim() && selectedTopic !== "faq") {
                  setSelectedTopic("faq");
                }
              }}
              placeholder="Search help topics, error codes, Wi-Fi, pricing, license..."
              className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[10px] text-slate-300">Esc</kbd> anytime to return to counter</span>
          </div>
        </div>

        {/* Modal Main Split: Sidebar Navigation + Main Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar: Topics List */}
          <div className="w-64 border-r border-slate-800 bg-slate-950/50 p-3 overflow-y-auto space-y-1 shrink-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-3 py-1">
              Table of Topics
            </div>

            {TOPICS.map((topic) => {
              const Icon = topic.icon;
              const isSelected = selectedTopic === topic.id;
              return (
                <button
                  key={topic.id}
                  type="button"
                  onClick={() => setSelectedTopic(topic.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition cursor-pointer group ${
                    isSelected
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                      : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isSelected ? "text-white" : "text-slate-400 group-hover:text-indigo-400"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold truncate flex items-center justify-between">
                      <span className="truncate">{topic.title}</span>
                      {topic.badge && !isSelected && (
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          {topic.badge}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}

            {/* Quick Action Buttons in Sidebar */}
            <div className="pt-3 border-t border-slate-800 space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-3 py-1">
                Quick Configurations
              </div>
              {onOpenPricing && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenPricing();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-blue-300 hover:bg-blue-950/40 border border-transparent hover:border-blue-900 transition"
                >
                  <IndianRupee className="w-3.5 h-3.5" />
                  <span>Configure Rates &amp; Pricing</span>
                </button>
              )}
              {onOpenRouting && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenRouting();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-cyan-300 hover:bg-cyan-950/40 border border-transparent hover:border-cyan-900 transition"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Printer Route Rules</span>
                </button>
              )}
              {onOpenPaymentSettings && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenPaymentSettings();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-emerald-300 hover:bg-emerald-950/40 border border-transparent hover:border-emerald-900 transition"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>UPI &amp; Standee QR Setup</span>
                </button>
              )}
              {onOpenLicense && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenLicense();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-amber-300 hover:bg-amber-950/40 border border-transparent hover:border-amber-900 transition"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Recharge Station &amp; Payment History</span>
                </button>
              )}
              {onOpenContactUs && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenContactUs();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-emerald-400 hover:bg-emerald-950/40 border border-transparent hover:border-emerald-900 transition"
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  <span>Contact Software Provider</span>
                </button>
              )}
            </div>
          </div>

          {/* Right Area: Topic Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-slate-300 select-text">
            {/* TOPIC 1: QUICK START */}
            {selectedTopic === "quick-start" && (
              <div className="space-y-5 animate-fade-in">
                <div className="border-b border-slate-800 pb-3">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400">
                    Step-by-Step Walkthrough
                  </span>
                  <h3 className="text-lg font-bold text-white mt-0.5">
                    1-Minute Daily Counter Operations
                  </h3>
                  <p className="text-slate-400 mt-1">
                    PrintDrop is built for high-throughput retail Xerox counters. Follow this routine every morning:
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-sm">
                      1
                    </div>
                    <h4 className="font-bold text-white text-sm">Turn On &amp; Launch</h4>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      Power on your PC and printers. Open PrintDrop. The local Wi-Fi receiver (Port 4000) and Cloudflare Tunnel initialize automatically.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm">
                      2
                    </div>
                    <h4 className="font-bold text-white text-sm">Customer Scans Standee</h4>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      Customer points phone camera at your counter standee QR code. No app download required! They upload PDFs or photos directly.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-sm">
                      3
                    </div>
                    <h4 className="font-bold text-white text-sm">Review &amp; Print</h4>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      Order arrives with pre-calculated bill. Click file row to preview, or click <strong>Print Batch</strong> to silently print without popups.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-800/60 space-y-2 text-indigo-200">
                    <div className="font-bold flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <span>Zero Internet Dependency (Local Wi-Fi Mode)</span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      Even during total broadband internet outages, PrintDrop continues to work 100% locally. Customers connect to your shop's Wi-Fi hotspot and transfer documents directly at high speed over LAN (<code>http://192.168.x.x:4000</code>).
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/60 space-y-2 text-emerald-200">
                    <div className="font-bold flex items-center gap-2">
                      <Zap className="w-4 h-4 text-emerald-400" />
                      <span>Real-Time SSE Sync &amp; Mobile Fullscreen</span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      Server-Sent Events (SSE) keep the customer's phone updated in real time with spooling progress and payment settlement badges. On mobile browsers, customers can tap <strong>App View</strong> in the header to hide browser address bars for a native, distraction-free screen.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TOPIC 2: INSPECTION & CANVAS */}
            {selectedTopic === "inspection-canvas" && (
              <div className="space-y-5 animate-fade-in">
                <div className="border-b border-slate-800 pb-3">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400">
                    Quality Assurance
                  </span>
                  <h3 className="text-lg font-bold text-white mt-0.5">
                    WYSIWYG Print Preview Canvas &amp; Sheet Flip
                  </h3>
                  <p className="text-slate-400 mt-1">
                    Never waste expensive paper or ink on wrong orientations or unwanted pages.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start gap-3">
                    <FileText className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-white">How to Open Preview</h4>
                      <p className="text-slate-400 text-[11px] mt-0.5">
                        In any incoming order, click on the file row or tap the <strong>Eye (Preview)</strong> icon. The interactive Canvas renders the exact physical paper sheet layout.
                      </p>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start gap-3">
                    <Sliders className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-white">Dynamic Page Ranges &amp; Live Recalculation</h4>
                      <p className="text-slate-400 text-[11px] mt-0.5">
                        Type specific pages into the Page Range field (e.g. <code>1-3, 5, 8-10</code>). Notice that total pages, duplex sheets, and final bill amount recalculate in real-time.
                      </p>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start gap-3">
                    <Printer className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-white">Orientation &amp; Rotation</h4>
                      <p className="text-slate-400 text-[11px] mt-0.5">
                        For landscape spreadsheets, drawings, or forms, use the 90° rotation button to orient pages properly before sending them to the Windows spooler.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TOPIC 3: PRICING & BILLING */}
            {selectedTopic === "pricing-billing" && (
              <div className="space-y-5 animate-fade-in">
                <div className="border-b border-slate-800 pb-3">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400">
                    Revenue Engine
                  </span>
                  <h3 className="text-lg font-bold text-white mt-0.5">
                    Preflight Rates &amp; Express Counter Billing
                  </h3>
                  <p className="text-slate-400 mt-1">
                    PrintDrop automates counter billing so your cashiers never have to do mental math or write manual paper slips.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                  <h4 className="font-bold text-white text-xs">Mathematical Billing Formula:</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="font-bold text-indigo-300 block">Single-Sided (Simplex):</span>
                      <code className="text-emerald-400 text-[10px] block mt-1">
                        Amount = Pages × SimplexRate × Copies
                      </code>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="font-bold text-indigo-300 block">Double-Sided (Duplex):</span>
                      <code className="text-emerald-400 text-[10px] block mt-1">
                        Amount = (FullSheets × DuplexSheetRate) + (OddPage × SimplexRate)
                      </code>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="font-bold text-white text-xs">Supported Paper Sizes &amp; Custom Rates:</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="font-bold text-white block">A4 Normal</span>
                      <span className="text-[10px] text-slate-400">₹3 B&amp;W / ₹5 Duplex</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="font-bold text-white block">Legal / Bond</span>
                      <span className="text-[10px] text-slate-400">₹4 B&amp;W / ₹7 Duplex</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="font-bold text-white block">A3 Drawing</span>
                      <span className="text-[10px] text-slate-400">₹10 B&amp;W / ₹25 Color</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="font-bold text-white block">Plotter Plan</span>
                      <span className="text-[10px] text-slate-400">Architectural rolls</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/80 border border-emerald-500/30 space-y-2.5">
                  <h4 className="font-bold text-white text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Multi-Modal Payment Settlement &amp; Live Cash Sync</span>
                  </h4>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    PrintDrop supports 3 payment pathways for every walk-in customer:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px]">
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                      <span className="font-bold text-emerald-400 block">1. Paid CASH</span>
                      <p className="text-slate-400 text-[10px]">
                        When a customer hands physical cash, double-click the order and tap <strong>Paid CASH</strong>. The order turns green and immediately signals the customer's phone that their bill is settled, unlocking the &quot;Delete Files&quot; privacy button.
                      </p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                      <span className="font-bold text-blue-400 block">2. Paid ONLINE (UPI)</span>
                      <p className="text-slate-400 text-[10px]">
                        Customers scan the Counter Standee BharatQR or tap &quot;Pay via UPI&quot; on mobile. Once Razorpay senses bank confirmation, the order automatically flips to Paid ONLINE without cashier interaction.
                      </p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                      <span className="font-bold text-purple-400 block">3. Credit (Khata)</span>
                      <p className="text-slate-400 text-[10px]">
                        For corporate accounts, colleges, or regular clients, select <strong>Credit</strong> to defer payment into their monthly billing ledger and generate consolidated invoices later.
                      </p>
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-[10px] text-slate-400">
                    <strong className="text-slate-200">Inspect Window Visual Clarity:</strong> In the Inspect Details modal, only the payment method actually used is highlighted in vibrant color, while the unused modes are gracefully grayed out to eliminate accounting confusion.
                  </div>
                </div>
              </div>
            )}

            {/* TOPIC 4: PRINTER ROUTING */}
            {selectedTopic === "printer-routing" && (
              <div className="space-y-5 animate-fade-in">
                <div className="border-b border-slate-800 pb-3">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400">
                    Hardware Automation
                  </span>
                  <h3 className="text-lg font-bold text-white mt-0.5">
                    Intelligent Multi-Printer Routing
                  </h3>
                  <p className="text-slate-400 mt-1">
                    Route different document types to specialized physical printers automatically.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5">
                    <div className="font-bold text-white flex items-center gap-1.5">
                      <Printer className="w-4 h-4 text-slate-300" />
                      <span>B&amp;W Laser Printer</span>
                    </div>
                    <p className="text-slate-400 text-[11px]">
                      Routes high-volume black &amp; white text, invoices, court affidavits, and notes (e.g. HP LaserJet 1020, Canon LBP 2900).
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5">
                    <div className="font-bold text-white flex items-center gap-1.5">
                      <Printer className="w-4 h-4 text-cyan-400" />
                      <span>Color Ink Tank</span>
                    </div>
                    <p className="text-slate-400 text-[11px]">
                      Routes color presentations, identity cards, photos, and brochures (e.g. Epson EcoTank L3250, Canon G-Series).
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5">
                    <div className="font-bold text-white flex items-center gap-1.5">
                      <Printer className="w-4 h-4 text-purple-400" />
                      <span>Plotter / Large Format</span>
                    </div>
                    <p className="text-slate-400 text-[11px]">
                      Routes CAD blueprints, maps, architectural plans, and posters up to A0 roll size.
                    </p>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
                  <h4 className="font-bold text-white text-xs">Automatic Fallback &amp; Cascade Routing:</h4>
                  <p className="text-slate-400 text-[11px] mt-1 leading-relaxed">
                    If your primary B&amp;W printer runs out of paper or encounters a paper jam, PrintDrop can automatically divert remaining print jobs to your backup printer without cancelling the order.
                  </p>
                </div>
              </div>
            )}

            {/* TOPIC 5: SPOOLER HUB */}
            {selectedTopic === "spooler-hub" && (
              <div className="space-y-5 animate-fade-in">
                <div className="border-b border-slate-800 pb-3">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400">
                    Silent Printing
                  </span>
                  <h3 className="text-lg font-bold text-white mt-0.5">
                    Live Spooler Hub (Automated Background Printing)
                  </h3>
                  <p className="text-slate-400 mt-1">
                    PrintDrop spools files through high-performance SumatraPDF without interactive Windows popups.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                    <h4 className="font-bold text-white text-xs">Pause / Resume Batch Spooling:</h4>
                    <p className="text-slate-400 text-[11px]">
                      Need to load more paper or replace a toner cartridge? Open <strong>Settings &gt; Live Spooler</strong> and tap <strong>Pause Spooler</strong>. Current jobs pause immediately without losing their position in queue.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                    <h4 className="font-bold text-white text-xs">Reprint Specific Files:</h4>
                    <p className="text-slate-400 text-[11px]">
                      If a sheet crinkles or runs out of toner mid-way, you don't need to reprint the entire 50-page batch. In the Spooler Hub, click <strong>Reprint</strong> next to that specific document.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TOPIC 6: CORPORATE PORTALS */}
            {selectedTopic === "corporate-portals" && (
              <div className="space-y-5 animate-fade-in">
                <div className="border-b border-slate-800 pb-3">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400">
                    B2B Accounts
                  </span>
                  <h3 className="text-lg font-bold text-white mt-0.5">
                    Corporate Portals &amp; Monthly Credit Tabs (Khata)
                  </h3>
                  <p className="text-slate-400 mt-1">
                    Create permanent portals for nearby colleges, coaching institutes, law firms, and CA offices.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="p-4 rounded-xl bg-slate-950/80 border border-purple-500/30 space-y-2">
                    <h4 className="font-bold text-white text-xs flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-purple-400" />
                      <span>Dedicated Portal with 4-Digit Security PIN</span>
                    </h4>
                    <p className="text-slate-300 text-[11px] leading-relaxed">
                      Give each corporate client their permanent branded URL (e.g. <code>https://your-shop.printdrop.in/corp/apex-law</code>). When employees upload legal briefs or thesis files, they enter their authorized 4-digit PIN.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                    <h4 className="font-bold text-white text-xs flex items-center gap-2">
                      <IndianRupee className="w-4 h-4 text-emerald-400" />
                      <span>Monthly Credit Khata &amp; Excel Statements</span>
                    </h4>
                    <p className="text-slate-300 text-[11px] leading-relaxed">
                      Corporate jobs can be marked as <strong>Credit (Khata)</strong>. The system records company billing notes, tracks total monthly spend, and lets you generate an official consolidated statement with 1 click for month-end reconciliation.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TOPIC 7: LICENSING & WALLET */}
            {selectedTopic === "licensing-wallet" && (
              <div className="space-y-5 animate-fade-in">
                <div className="border-b border-slate-800 pb-3">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400">
                    Commercial License
                  </span>
                  <h3 className="text-lg font-bold text-white mt-0.5">
                    Station Licensing, Page Wallet &amp; Smart Dual Metering
                  </h3>
                  <p className="text-slate-400 mt-1">
                    Flexible options tailored for both low-volume seasonal counters and high-volume commercial Xerox hubs.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-slate-950/80 border border-amber-500/30 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-white text-sm">Model A: Page Wallet</h4>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        No Expiry
                      </span>
                    </div>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      Purchase prepaid page quota (e.g. 5,000 pages for ₹749). Balance never expires and decrements only as you print. Perfect for small shops.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-950/80 border border-indigo-500/30 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-white text-sm">Model B: Unlimited Time Sub</h4>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        Zero Page Limits
                      </span>
                    </div>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      30-Day Monthly (₹299), Quarterly (₹799), or Annual (₹2,499) plans. Print unlimited pages without quota deductions during your validity.
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/60 space-y-2">
                  <div className="font-bold text-emerald-300 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    <span>Smart Priority Dual Metering Hierarchy</span>
                  </div>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    If you hold <strong>both</strong> an active Unlimited Monthly Plan and a Page Wallet balance, PrintDrop automatically prioritizes the unlimited time subscription. Your Page Wallet quota remains 100% frozen in reserve and only activates if your time plan expires!
                  </p>
                </div>

                {/* Grace Period & Overdraft Buffer Policy */}
                <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-600/60 space-y-3">
                  <div className="font-bold text-amber-300 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-400" />
                    <span>Emergency Grace Period &amp; Overdraft Protection</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] text-slate-300">
                    <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                      <span className="font-bold text-amber-300 block mb-1">Paid Subscriptions (48-Hour Grace):</span>
                      <p className="leading-relaxed text-slate-300 text-[11px]">
                        When a Monthly, Quarterly, or Annual subscription expires, printing remains <strong>fully unlocked for 48 hours</strong>. An amber emergency banner appears at the top of your counter with remaining hours and direct software provider renewal buttons. Hard lockout triggers only after 48 hours.
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                      <span className="font-bold text-amber-300 block mb-1">Page Wallet (50-Print Overdraft Buffer):</span>
                      <p className="leading-relaxed text-slate-300 text-[11px]">
                        When your prepaid wallet drops to 0 pages, an emergency overdraft buffer of <strong>50 grace prints</strong> activates automatically, preventing order halts while customers are waiting. Hard lockout triggers only after all 50 buffer prints are consumed.
                      </p>
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between text-[10px] text-amber-300/90">
                    <span><strong>Free Trial Notice:</strong> Free Evaluation Trials operate with a strict zero-grace policy and lock immediately upon reaching expiration or exhausted test prints. Your software provider can dynamically extend trial days anytime via the Cloud Admin Panel.</span>
                  </div>
                </div>

                {/* Offline Clock Tamper Resistance */}
                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                  <h4 className="font-bold text-white text-xs flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-blue-400" />
                    <span>Offline Clock Tamper Resistance</span>
                  </h4>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    PrintDrop records an encrypted high-water mark timestamp on every action. If a station is operated offline and the Windows system clock is rolled backward to cheat expiration dates, the tamper-detection engine immediately flags <code>ClockTampered</code> and suspends printing until the PC clock is resynchronized with Internet Time.
                  </p>
                </div>
              </div>
            )}

            {/* TOPIC 8: BACKUPS & PRIVACY */}
            {selectedTopic === "backups-privacy" && (
              <div className="space-y-5 animate-fade-in">
                <div className="border-b border-slate-800 pb-3">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400">
                    Disaster Recovery
                  </span>
                  <h3 className="text-lg font-bold text-white mt-0.5">
                    Data Safety, Document Privacy &amp; 1-Click Backups
                  </h3>
                  <p className="text-slate-400 mt-1">
                    Your shop's operational data and customer privacy are guaranteed with zero public cloud dependence.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                    <ShieldCheck className="w-6 h-6 text-emerald-400" />
                    <h4 className="font-bold text-white text-sm">Zero-Cloud Customer Privacy</h4>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      Customer files are never sent to external AI or public cloud storage servers. Files reside only in a temporary local folder on your PC and are auto-shredded following order completion.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                    <Copy className="w-6 h-6 text-blue-400" />
                    <h4 className="font-bold text-white text-sm">Full Encrypted Backups (.pdropbak)</h4>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      Under <strong>Settings &gt; Backup &amp; Restore</strong>, generate an AES-256 encrypted archive of your entire database—including orders, corporate client accounts, and financial ledger—with automatic pre-restore safety rollback.
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-indigo-950/20 border border-indigo-500/30 space-y-2">
                  <h4 className="font-bold text-white text-xs flex items-center gap-2">
                    <Settings className="w-4 h-4 text-indigo-400" />
                    <span>1-Click Configuration Backup &amp; Restore (.json)</span>
                  </h4>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    Need to copy your shop settings to a second counter PC or restore preferences after reinstalling Windows without bringing over old orders? Open <strong>Settings &gt; Backup &amp; Restore &gt; Settings</strong> tab:
                  </p>
                  <ul className="list-disc pl-5 text-[11px] text-slate-400 space-y-1">
                    <li><strong>1-Click Export Config (.json)</strong>: Saves only your Pricing Rate Card, UPI/Razorpay settings, Printer Routing rules, Guest Wi-Fi SSID, Static QR link, and auto-backup schedule.</li>
                    <li><strong>1-Click Restore Config (.json)</strong>: Instantly applies saved settings to the station without modifying orders, financial ledger, or machine HWID license bindings.</li>
                  </ul>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/80 border border-emerald-500/30 space-y-2">
                  <h4 className="font-bold text-white text-xs flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Customer-Driven File Shredding &amp; Anti-Reprint Shield</span>
                  </h4>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    Once payment is settled, customers can tap <strong>&quot;Delete Files&quot;</strong> on their mobile phone. PrintDrop immediately performs zero-trace disk shredding on your PC storage. Following this purge:
                  </p>
                  <ul className="list-disc pl-5 text-[11px] text-slate-400 space-y-1">
                    <li>The Dustbin (trash) icon is automatically removed from the Inspect window.</li>
                    <li>The &quot;Reprint File&quot; and &quot;Reprint Entire Order&quot; actions are cleanly hidden, verifying that the file no longer exists in shop memory.</li>
                    <li>Both customer and shopkeeper have verifiable proof of total data privacy.</li>
                  </ul>
                </div>
              </div>
            )}

            {/* TOPIC 9: FAQ */}
            {selectedTopic === "faq" && (
              <div className="space-y-5 animate-fade-in">
                <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400">
                      Troubleshooting &amp; Knowledge Base
                    </span>
                    <h3 className="text-lg font-bold text-white mt-0.5">
                      Frequently Asked Questions (FAQ)
                    </h3>
                  </div>
                  <span className="text-xs text-slate-400">
                    Showing {filteredFaqs.length} of {FAQ_LIST.length} articles
                  </span>
                </div>

                <div className="space-y-2.5">
                  {filteredFaqs.map((faq, idx) => {
                    const isExpanded = expandedFaqIndex === idx;
                    return (
                      <div
                        key={idx}
                        className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden shadow-sm transition"
                      >
                        <div
                          onClick={() => setExpandedFaqIndex(isExpanded ? null : idx)}
                          className="p-3.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-800/40 transition select-none"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 shrink-0">
                              {faq.category}
                            </span>
                            <span className="text-xs font-bold text-white truncate">
                              {faq.question}
                            </span>
                          </div>
                          <ChevronDown
                            className={`w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0 ${
                              isExpanded ? "rotate-180 text-indigo-400" : ""
                            }`}
                          />
                        </div>

                        {isExpanded && (
                          <div className="px-4 pb-4 pt-1 border-t border-slate-800/80 bg-slate-900/40 text-slate-300 text-[11px] leading-relaxed whitespace-pre-line">
                            {faq.answer}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TOPIC 10: KEYBOARD SHORTCUTS */}
            {selectedTopic === "shortcuts" && (
              <div className="space-y-5 animate-fade-in">
                <div className="border-b border-slate-800 pb-3">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400">
                    High Speed Productivity
                  </span>
                  <h3 className="text-lg font-bold text-white mt-0.5">
                    Keyboard Shortcuts &amp; Operator Cheat Sheet
                  </h3>
                  <p className="text-slate-400 mt-1">
                    Control counter queues without taking your hands off the keyboard.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-4 font-semibold uppercase text-[10px]">Shortcut Key</th>
                        <th className="py-2.5 px-4 font-semibold uppercase text-[10px]">Action &amp; Purpose</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-slate-300">
                      <tr>
                        <td className="py-2.5 px-4 font-mono font-bold text-indigo-300">Esc</td>
                        <td className="py-2.5 px-4">Close any active modal, exit Print Preview Canvas, or collapse Settings menu</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-4 font-mono font-bold text-indigo-300">Double Click Row</td>
                        <td className="py-2.5 px-4">Instantly open Full Order Inspection to view all files, customer notes, and preflight billing</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-4 font-mono font-bold text-indigo-300">Click License Pill</td>
                        <td className="py-2.5 px-4">Open Station Hardware ID, plan expiration, page wallet, and official tax invoice ledger</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-4 font-mono font-bold text-indigo-300">Ctrl + Shift + S</td>
                        <td className="py-2.5 px-4">Open Live Print Spooler Hub to check Windows print queue and printer status</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Bottom Footer */}
        <div className="p-3.5 border-t border-slate-800 bg-slate-950/90 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-300">Need direct operator help or license renewal?</span>
            {onOpenContactUs ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenContactUs();
                }}
                className="text-amber-400 hover:text-amber-300 font-bold underline cursor-pointer flex items-center gap-1.5"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                <span>Open Provider Support &amp; Contact Us (Settings #8)</span>
              </button>
            ) : (
              <span>Open Settings &gt; Option #8 &quot;Contact Us&quot;</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition cursor-pointer"
          >
            Close Guide (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
