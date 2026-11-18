import React, { useState } from "react";
import { 
  Printer, 
  X, 
  Wifi, 
  UploadCloud, 
  ShieldCheck, 
  Sparkles, 
  FileText, 
  Smartphone, 
  CheckCircle2,
  Globe,
  Star
} from "lucide-react";

interface CountertopPosterModalProps {
  isOpen: boolean;
  onClose: () => void;
  shopName?: string;
  wifiSsid: string;
  wifiPassword?: string | null;
  wifiQrDataUrl?: string;
  uploadUrl: string;
  uploadQrDataUrl?: string;
  tunnelUrl?: string | null;
  tunnelQrDataUrl?: string | null;
  permanentUrl?: string;
  permanentQrDataUrl?: string;
}

export const CountertopPosterModal: React.FC<CountertopPosterModalProps> = ({
  isOpen,
  onClose,
  shopName = "PrintDrop Station",
  wifiSsid,
  wifiPassword,
  wifiQrDataUrl,
  uploadUrl,
  uploadQrDataUrl,
  tunnelUrl,
  tunnelQrDataUrl,
  permanentUrl = "",
  permanentQrDataUrl,
}) => {
  const [standeeMode, setStandeeMode] = useState<"permanent" | "tunnel" | "dual">("permanent");

  if (!isOpen) return null;

  const effectiveUploadUrl = tunnelUrl || uploadUrl;
  const effectiveUploadQr = tunnelQrDataUrl || uploadQrDataUrl;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-start justify-center p-3 sm:p-5 z-50 overflow-y-auto print:p-0 print:bg-white print:static print:inset-auto">
      {/* Print-specific style injection to isolate the poster sheet during window.print() */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printdrop-countertop-sheet,
          #printdrop-countertop-sheet * {
            visibility: visible !important;
          }
          #printdrop-countertop-sheet {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 24px !important;
            box-shadow: none !important;
            border: 2px solid #0f172a !important;
            background: #ffffff !important;
            color: #0f172a !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="w-full max-w-3xl flex flex-col items-center">
        {/* Modal Toolbar (hidden on print) */}
        <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-2.5 bg-slate-900 border border-slate-800 px-4 py-2.5 rounded-xl mb-3 shadow-xl no-print">
          {/* Mode Selector Tabs */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setStandeeMode("permanent")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                standeeMode === "permanent"
                  ? "bg-gradient-to-r from-amber-500 to-indigo-600 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Star className="w-3.5 h-3.5 text-amber-300" />
              <span>Permanent QR (Zero Reprinting)</span>
            </button>
            <button
              type="button"
              onClick={() => setStandeeMode("dual")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                standeeMode === "dual"
                  ? "bg-indigo-600 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Wifi className="w-3.5 h-3.5" />
              <span>Wi-Fi + LAN Dual</span>
            </button>
            <button
              type="button"
              onClick={() => setStandeeMode("tunnel")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                standeeMode === "tunnel"
                  ? "bg-emerald-600 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>4G/5G Direct</span>
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white text-xs font-semibold px-3.5 py-1.5 rounded-xl shadow-lg shadow-indigo-600/30 transition cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              Print Signboard (A4 / Standee)
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* The Printable Poster Sheet */}
        <div
          id="printdrop-countertop-sheet"
          className="w-full bg-white text-slate-900 rounded-2xl p-5 sm:p-6 shadow-2xl border-2 border-slate-200 relative overflow-hidden"
        >
          {/* Header Banner */}
          <div className="text-center pb-3 border-b border-slate-100">
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-bold uppercase tracking-wider rounded-full mb-1">
              <Sparkles className="w-3 h-3" />
              Express Digital Document Printing &bull; Xerox &bull; Scanning
            </div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">
              {shopName}
            </h1>
            <p className="text-xs font-medium text-slate-600 mt-0.5 max-w-xl mx-auto">
              Scan with your phone camera on normal 4G/5G mobile data. Zero apps to install &bull; Zero cables &bull; Direct counter pickup.
            </p>
          </div>

          {/* MODE 1: PERMANENT STANDEE (RECOMMENDED) */}
          {standeeMode === "permanent" && (
            <div className="my-3 flex flex-col items-center">
              <div className="w-full max-w-md bg-gradient-to-b from-indigo-50/80 via-white to-slate-50 border-2 border-indigo-500/40 rounded-2xl p-4 sm:p-5 flex flex-col items-center text-center shadow-lg relative">
                <div className="absolute -top-3 bg-gradient-to-r from-amber-500 to-indigo-600 text-white text-[11px] font-black px-3.5 py-0.5 rounded-full uppercase tracking-wider shadow">
                  ⚡ 1-Scan Direct Upload
                </div>

                <h3 className="text-lg font-black text-slate-900 mt-1 mb-0.5">
                  Scan to Upload Documents
                </h3>
                <p className="text-[11px] text-slate-600 mb-2.5">
                  Works on all phones (Jio, Airtel, Vi, 4G/5G, Wi-Fi) &bull; No app required
                </p>

                {/* Big Permanent QR */}
                <div className="p-2.5 bg-white rounded-xl shadow-md border-2 border-slate-200 mb-2.5">
                  {permanentQrDataUrl ? (
                    <img
                      src={permanentQrDataUrl}
                      alt="Permanent Customer Portal QR"
                      className="w-44 h-44 sm:w-48 sm:h-48 object-contain block"
                    />
                  ) : (
                    <div className="w-44 h-44 sm:w-48 sm:h-48 flex flex-col items-center justify-center text-xs text-slate-400">
                      Generating Permanent Standee QR...
                    </div>
                  )}
                </div>

                {/* Permanent Link Info */}
                <div className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-left shadow-sm">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-500 font-medium">Permanent Web Address:</span>
                    <span className="font-mono font-bold text-indigo-700 text-[11px] truncate max-w-[200px]">
                      {permanentUrl}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>📱 Add to Phone Home Screen for 1-Tap Access</span>
                    <span className="text-emerald-600 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Permanent
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* MODE 2: DUAL (Wi-Fi + LAN Upload) */}
          {standeeMode === "dual" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-2.5">
              {/* STEP 1: Connect to Wi-Fi */}
              <div className="bg-gradient-to-b from-indigo-50/70 to-slate-50 border-2 border-indigo-200/80 rounded-2xl p-4 sm:p-4.5 flex flex-col items-center text-center relative">
                <div className="absolute -top-3 left-5 bg-indigo-600 text-white text-[11px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow">
                  Step 1
                </div>

                <div className="flex items-center gap-1.5 text-indigo-900 font-bold text-sm mt-0.5 mb-0.5">
                  <Wifi className="w-4 h-4 text-indigo-600" />
                  Connect to Shop Wi-Fi
                </div>
                <p className="text-[11px] text-slate-600 mb-2">
                  Scan with phone camera & tap <span className="font-bold text-indigo-700">&quot;Connect to network&quot;</span>
                </p>

                <div className="p-2 bg-white rounded-xl shadow-md border-2 border-slate-200 mb-2">
                  {wifiQrDataUrl ? (
                    <img
                      src={wifiQrDataUrl}
                      alt="Scan to Connect Wi-Fi"
                      className="w-36 h-36 sm:w-40 sm:h-40 object-contain block"
                    />
                  ) : (
                    <div className="w-36 h-36 sm:w-40 sm:h-40 flex items-center justify-center text-xs text-slate-400">
                      No Wi-Fi QR Available
                    </div>
                  )}
                </div>

                <div className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-left shadow-sm">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-500 font-medium">Network (SSID):</span>
                    <span className="font-mono font-bold text-slate-900">{wifiSsid || "Not Connected"}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-medium">Password:</span>
                    <span className="font-mono font-bold text-indigo-700">
                      {wifiPassword && wifiPassword.trim() ? wifiPassword : "(No Password Needed)"}
                    </span>
                  </div>
                </div>
              </div>

              {/* STEP 2: Drop Your Files */}
              <div className="bg-gradient-to-b from-emerald-50/70 to-slate-50 border-2 border-emerald-200/80 rounded-2xl p-4 sm:p-4.5 flex flex-col items-center text-center relative">
                <div className="absolute -top-3 left-5 bg-emerald-600 text-white text-[11px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow">
                  Step 2
                </div>

                <div className="flex items-center gap-1.5 text-emerald-900 font-bold text-sm mt-0.5 mb-0.5">
                  <UploadCloud className="w-4 h-4 text-emerald-600" />
                  Upload & Select Print Options
                </div>
                <p className="text-[11px] text-slate-600 mb-2">
                  Scan to open PrintDrop web portal directly on your phone
                </p>

                <div className="p-2 bg-white rounded-xl shadow-md border-2 border-slate-200 mb-2">
                  {uploadQrDataUrl ? (
                    <img
                      src={uploadQrDataUrl}
                      alt="Scan to Open PrintDrop"
                      className="w-36 h-36 sm:w-40 sm:h-40 object-contain block"
                    />
                  ) : (
                    <div className="w-36 h-36 sm:w-40 sm:h-40 flex items-center justify-center text-xs text-slate-400">
                      No Session QR Available
                    </div>
                  )}
                </div>

                <div className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-left shadow-sm">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-500 font-medium">Web Address:</span>
                    <span className="font-mono font-bold text-emerald-700 truncate max-w-[190px]">
                      {uploadUrl || "http://192.168.x.x:8080"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>Fast Resumable Uploads</span>
                    <span className="text-emerald-600 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Ready
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* MODE 3: DIRECT TUNNEL */}
          {standeeMode === "tunnel" && (
            <div className="my-3 flex flex-col items-center">
              <div className="w-full max-w-md bg-gradient-to-b from-emerald-50/80 via-white to-slate-50 border-2 border-emerald-500/40 rounded-2xl p-4 sm:p-5 flex flex-col items-center text-center shadow-lg relative">
                <div className="absolute -top-3 bg-emerald-600 text-white text-[11px] font-black px-3.5 py-0.5 rounded-full uppercase tracking-wider shadow">
                  ⚡ 4G/5G Internet Direct
                </div>

                <h3 className="text-lg font-black text-slate-900 mt-1 mb-0.5">
                  Direct Internet Upload
                </h3>
                <p className="text-[11px] text-slate-600 mb-2.5">
                  Scan with normal phone camera &bull; Zero Wi-Fi connection needed
                </p>

                <div className="p-2.5 bg-white rounded-xl shadow-md border-2 border-slate-200 mb-2.5">
                  {effectiveUploadQr ? (
                    <img
                      src={effectiveUploadQr}
                      alt="4G/5G Direct QR"
                      className="w-44 h-44 sm:w-48 sm:h-48 object-contain block"
                    />
                  ) : (
                    <div className="w-44 h-44 sm:w-48 sm:h-48 flex flex-col items-center justify-center text-xs text-slate-400">
                      No 4G/5G Tunnel Active
                    </div>
                  )}
                </div>

                <div className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-left shadow-sm">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-500 font-medium">Session URL:</span>
                    <span className="font-mono font-bold text-emerald-700 text-[11px] truncate max-w-[200px]">
                      {effectiveUploadUrl}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>Encrypted TLS 1.3 / QUIC</span>
                    <span className="text-emerald-600 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Online
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Footer Features & Privacy Notice */}
          <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1 font-semibold text-slate-800">
                <FileText className="w-3.5 h-3.5 text-indigo-600" />
                PDF, Word, Excel, PPT, Photos
              </span>
              <span className="hidden sm:inline text-slate-300">&bull;</span>
              <span className="flex items-center gap-1 font-semibold text-slate-800">
                <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                Android &amp; iPhone Compatible
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-slate-500 bg-slate-100 px-3 py-1 rounded-full font-medium text-[11px]">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Files automatically deleted from shop PC after printing</span>
            </div>
          </div>
        </div>

        {/* Footnote (hidden on print) */}
        <p className="text-[11px] text-slate-400 mt-2.5 no-print text-center">
          Tip: In <span className="font-semibold text-white">&quot;Permanent QR&quot;</span> mode, this standee NEVER needs reprinting even when restarting the computer or internet.
        </p>
      </div>
    </div>
  );
};
