import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Printer, Zap, Check, X, Sliders, AlertCircle } from "lucide-react";

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
  isVirtual: boolean;
  requiresPrompt?: boolean;
  status: string;
}

export interface PrinterRoutingConfig {
  enabled: boolean;
  defaultPrinter: string;
  bwPrinter?: string | null;
  colorPrinter?: string | null;
  plotterPrinter?: string | null;
}

interface PrinterRoutingModalProps {
  isOpen: boolean;
  onClose: () => void;
  printers: PrinterInfo[];
  selectedPrinter: string;
  onPrinterSelected: (printerName: string) => void;
  onPrintersRefreshed?: () => Promise<void>;
  isTrialLicense?: boolean;
}

export const PrinterRoutingModal: React.FC<PrinterRoutingModalProps> = ({
  isOpen,
  onClose,
  printers,
  selectedPrinter,
  onPrinterSelected,
  onPrintersRefreshed,
  isTrialLicense = true,
}) => {
  const [config, setConfig] = useState<PrinterRoutingConfig>({
    enabled: false,
    defaultPrinter: selectedPrinter || "",
    bwPrinter: null,
    colorPrinter: null,
    plotterPrinter: null,
  });
  const [loading, setLoading] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSimulationMode, setIsSimulationMode] = useState<boolean>(true);
  const [isSimulationSupported, setIsSimulationSupported] = useState<boolean>(true);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  async function loadConfig() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await invoke<PrinterRoutingConfig>("get_printer_routing_config");
      const [isSim, isSupported] = await Promise.all([
        invoke<boolean>("get_printer_simulation_mode").catch(() => true),
        invoke<boolean>("is_simulation_supported").catch(() => true),
      ]);
      setIsSimulationMode(isSim);
      setIsSimulationSupported(isSupported);
      setConfig({
        enabled: res.enabled,
        defaultPrinter: res.defaultPrinter || selectedPrinter || (printers[0]?.name ?? ""),
        bwPrinter: res.bwPrinter || null,
        colorPrinter: res.colorPrinter || null,
        plotterPrinter: res.plotterPrinter || null,
      });
    } catch (err) {
      console.error("Failed to load printer routing config:", err);
      setErrorMsg("Could not load current routing settings.");
    } finally {
      setLoading(false);
    }
  }

  async function handleApplySimulationPreset() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const preset = await invoke<PrinterRoutingConfig>("apply_simulation_routing_preset");
      setConfig({
        enabled: preset.enabled,
        defaultPrinter: preset.defaultPrinter,
        bwPrinter: preset.bwPrinter || null,
        colorPrinter: preset.colorPrinter || null,
        plotterPrinter: preset.plotterPrinter || null,
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleSimulationMode(enabled: boolean) {
    setLoading(true);
    setErrorMsg(null);
    try {
      await invoke("set_printer_simulation_mode", { enabled });
      setIsSimulationMode(enabled);
      if (onPrintersRefreshed) {
        await onPrintersRefreshed();
      }
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 1500);
    } catch (err: any) {
      setErrorMsg(err?.toString() || "Failed to switch hardware mode");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setErrorMsg(null);
    try {
      await invoke("save_printer_routing_config", { config });
      if (config.defaultPrinter) {
        onPrinterSelected(config.defaultPrinter);
      }
      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 1200);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
                Multi-Printer Intelligent Routing
                <span className="text-[10px] uppercase font-mono tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  Auto-Dispatch
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Route B&W, Color, and Plotter jobs to dedicated physical hardware automatically
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {errorMsg && (
            <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* === HARDWARE ENVIRONMENT SWITCHER (DEMO vs REAL) === */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-200">Hardware Environment</span>
                <span className="text-[10px] text-slate-400">
                  {isSimulationSupported 
                    ? (isTrialLicense ? "• Switch for field demos or real counter" : "• Testing & Field Demo Fleet Available") 
                    : "• Licensed Production Hardware"}
                </span>
              </div>
              {/* Segmented Pill Switch (Enabled in Virtual Simulation Edition) */}
              {isSimulationSupported ? (
                <div className="flex items-center p-1 rounded-xl bg-slate-900 border border-slate-700/80 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleSimulationMode(true)}
                    disabled={loading}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition ${
                      isSimulationMode
                        ? "bg-cyan-600 text-white shadow-md shadow-cyan-950/50"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <span>🧪 Virtual Demo Fleet</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleSimulationMode(false)}
                    disabled={loading}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition ${
                      !isSimulationMode
                        ? "bg-emerald-600 text-white shadow-md shadow-emerald-950/50"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <span>🖨️ Real Hardware Mode</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-xs font-bold">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Real Physical Hardware Active</span>
                </div>
              )}
            </div>

            {isSimulationSupported && isSimulationMode ? (
              <div className="flex items-center justify-between text-xs text-cyan-300/90 bg-cyan-950/30 p-2.5 rounded-lg border border-cyan-800/40">
                <div className="flex items-center gap-2">
                  <span>✨ <strong>Demo Simulation Active:</strong> Simulates HP LaserJet, Canon Color &amp; Plotter without physical paper/ink.</span>
                </div>
                <button
                  type="button"
                  onClick={handleApplySimulationPreset}
                  disabled={loading}
                  className="px-2.5 py-1 rounded bg-cyan-600/40 hover:bg-cyan-600/70 text-cyan-200 font-medium border border-cyan-500/50 text-[11px] shrink-0 transition"
                >
                  Apply Virtual Preset
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between text-xs text-emerald-300/90 bg-emerald-950/30 p-2.5 rounded-lg border border-emerald-800/40">
                <span>✓ <strong>Real Hardware Active:</strong> Detecting real USB, Wi-Fi, and Network LAN printers installed on Windows.</span>
                <span className="text-[11px] text-emerald-400 font-semibold">{printers.length} printer(s) detected</span>
              </div>
            )}
          </div>

          {/* Master Toggle */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/60 border border-slate-700/60">
            <div>
              <div className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                Enable Auto-Routing Rules
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Automatically split batch files by type instead of sending everything to one printer
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          {/* Primary / Fallback Printer */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Primary / Default Printer (Fallback)
            </label>
            <div className="relative">
              <select
                value={config.defaultPrinter}
                onChange={(e) => setConfig({ ...config, defaultPrinter: e.target.value })}
                className="w-full bg-slate-800/90 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 appearance-none"
              >
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} {p.isDefault ? "(System Default)" : ""} {p.isVirtual ? "[Virtual]" : ""}
                  </option>
                ))}
              </select>
              <div className="absolute right-3 top-3 pointer-events-none text-slate-400">
                <Printer className="w-4 h-4" />
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              Used when a document has no specific route or when auto-routing is turned off.
            </p>
          </div>

          {/* Dedicated Routes */}
          <div className={`space-y-4 pt-2 transition-opacity duration-200 ${config.enabled ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
            <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <span>Hardware Destination Assignments</span>
            </div>

            {/* B&W Route */}
            <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-700/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
                  Black & White Laser Printer
                </span>
                <span className="text-[10px] text-slate-400 font-mono">B&W Documents & Resumes</span>
              </div>
              <select
                value={config.bwPrinter || ""}
                onChange={(e) => setConfig({ ...config, bwPrinter: e.target.value || null })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="">Use Default ({config.defaultPrinter || "Default"})</option>
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Color Route */}
            <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-700/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-pink-500 via-amber-400 to-cyan-400"></span>
                  Color Tank / Photo Printer
                </span>
                <span className="text-[10px] text-slate-400 font-mono">Color, Photos & Certificates</span>
              </div>
              <select
                value={config.colorPrinter || ""}
                onChange={(e) => setConfig({ ...config, colorPrinter: e.target.value || null })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="">Use Default ({config.defaultPrinter || "Default"})</option>
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Plotter Route */}
            <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-700/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                  Plotter / Large Format (A3/A1/A0)
                </span>
                <span className="text-[10px] text-slate-400 font-mono">Blueprints & Cad Drawings</span>
              </div>
              <select
                value={config.plotterPrinter || ""}
                onChange={(e) => setConfig({ ...config, plotterPrinter: e.target.value || null })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="">Use Default ({config.defaultPrinter || "Default"})</option>
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-between bg-slate-900/90">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 rounded-xl hover:bg-slate-800 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold rounded-xl transition shadow-lg ${
              savedSuccess
                ? "bg-emerald-600 text-white"
                : "bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white shadow-indigo-500/20"
            }`}
          >
            {savedSuccess ? (
              <>
                <Check className="w-4 h-4" />
                Routing Saved!
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Apply Routing Rules
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
