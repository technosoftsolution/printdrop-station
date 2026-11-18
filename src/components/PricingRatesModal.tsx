import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface PaperRate {
  bwSingle: number;
  bwDuplexSheet: number;
  colorSingle: number;
  colorDuplexSheet: number;
}

export interface PricingRateCard {
  currency: string;
  a4: PaperRate;
  a3: PaperRate;
  legal: PaperRate;
  plotter: PaperRate;
}

interface PricingRatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRatesSaved?: () => void;
}

export const defaultRates: PricingRateCard = {
  currency: "₹",
  a4: {
    bwSingle: 3.0,
    bwDuplexSheet: 5.0,
    colorSingle: 10.0,
    colorDuplexSheet: 18.0,
  },
  a3: {
    bwSingle: 10.0,
    bwDuplexSheet: 18.0,
    colorSingle: 25.0,
    colorDuplexSheet: 45.0,
  },
  legal: {
    bwSingle: 4.0,
    bwDuplexSheet: 7.0,
    colorSingle: 12.0,
    colorDuplexSheet: 22.0,
  },
  plotter: {
    bwSingle: 50.0,
    bwDuplexSheet: 50.0,
    colorSingle: 120.0,
    colorDuplexSheet: 120.0,
  },
};

export const PricingRatesModal: React.FC<PricingRatesModalProps> = ({
  isOpen,
  onClose,
  onRatesSaved,
}) => {
  const [rates, setRates] = useState<PricingRateCard>(defaultRates);
  const [activeTab, setActiveTab] = useState<"A4" | "A3" | "LEGAL" | "PLOTTER">("A4");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Test sandbox calculator
  const [testSize, setTestSize] = useState<"A4" | "A3" | "LEGAL" | "PLOTTER">("A4");
  const [testColor, setTestColor] = useState<"BW" | "COLOR">("BW");
  const [testDuplex, setTestDuplex] = useState<"SIMPLEX" | "DUPLEX">("DUPLEX");
  const [testPages, setTestPages] = useState<number>(3);
  const [testCopies, setTestCopies] = useState<number>(1);

  useEffect(() => {
    if (isOpen) {
      loadRates();
      setSaveSuccess(false);
    }
  }, [isOpen]);

  async function loadRates() {
    try {
      const res = await invoke<PricingRateCard>("get_pricing_rates");
      if (res && res.a4) {
        setRates(res);
      }
    } catch (e) {
      console.warn("Failed to load pricing rates, using defaults:", e);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      await invoke("save_pricing_rates", { rates });
      setSaveSuccess(true);
      if (onRatesSaved) onRatesSaved();
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (e) {
      alert("Failed to save rates: " + e);
    } finally {
      setIsSaving(false);
    }
  }

  function handleRateChange(
    paper: "a4" | "a3" | "legal" | "plotter",
    field: keyof PaperRate,
    val: string
  ) {
    const num = parseFloat(val) || 0;
    setRates((prev) => ({
      ...prev,
      [paper]: {
        ...prev[paper],
        [field]: num,
      },
    }));
  }

  // Calculate sandbox price
  function calculateTestPrice(): { total: number; duplexSheets: number; simplexSheets: number; totalSheets: number } {
    const paperRate =
      testSize === "A4"
        ? rates.a4
        : testSize === "A3"
        ? rates.a3
        : testSize === "LEGAL"
        ? rates.legal
        : rates.plotter;

    const isColor = testColor === "COLOR";
    const isDuplex = testDuplex === "DUPLEX" && testSize !== "PLOTTER";

    const fullDuplex = isDuplex ? Math.floor(testPages / 2) : 0;
    const oddSimplex = isDuplex ? testPages % 2 : testPages;

    const duplexSheets = fullDuplex * testCopies;
    const simplexSheets = oddSimplex * testCopies;
    const totalSheets = duplexSheets + simplexSheets;

    const duplexRate = isColor ? paperRate.colorDuplexSheet : paperRate.bwDuplexSheet;
    const simplexRate = isColor ? paperRate.colorSingle : paperRate.bwSingle;

    const total = duplexSheets * duplexRate + simplexSheets * simplexRate;
    return { total, duplexSheets, simplexSheets, totalSheets };
  }

  const testCalc = calculateTestPrice();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-xl">
              💰
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">
                Shopkeeper Printing Rates &amp; Pricing
              </h2>
              <p className="text-xs text-slate-400">
                Configure per-sheet and per-page rates for automatic customer bill calculation
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Tab Selector */}
          <div className="flex items-center gap-2 p-1 bg-slate-950/60 border border-slate-800 rounded-xl">
            {(["A4", "A3", "LEGAL", "PLOTTER"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                  activeTab === tab
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                }`}
              >
                {tab === "PLOTTER" ? "Plotter / Plan" : tab}
              </button>
            ))}
          </div>

          {/* Active Tab Rate Editor */}
          <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-white">
                {activeTab === "PLOTTER" ? "Plotter / Architectural Blueprints (Roll Feed)" : `${activeTab} Paper Rates`}
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                Currency: <strong className="text-blue-400">₹ (INR)</strong>
              </span>
            </div>

            {activeTab !== "PLOTTER" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Black & White Single */}
                <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-3.5 space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    B&amp;W Single-Sided (Simplex)
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 font-bold">₹</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={rates[activeTab.toLowerCase() as "a4" | "a3" | "legal"].bwSingle}
                      onChange={(e) =>
                        handleRateChange(
                          activeTab.toLowerCase() as "a4" | "a3" | "legal",
                          "bwSingle",
                          e.target.value
                        )
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:border-blue-500 focus:outline-none"
                    />
                    <span className="text-[11px] text-slate-400">/page</span>
                  </div>
                </div>

                {/* Black & White Duplex Sheet */}
                <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-300">
                      B&amp;W Double-Sided (Duplex)
                    </label>
                    <span className="text-[10px] text-emerald-400 font-medium">Both sides</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 font-bold">₹</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={rates[activeTab.toLowerCase() as "a4" | "a3" | "legal"].bwDuplexSheet}
                      onChange={(e) =>
                        handleRateChange(
                          activeTab.toLowerCase() as "a4" | "a3" | "legal",
                          "bwDuplexSheet",
                          e.target.value
                        )
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:border-blue-500 focus:outline-none"
                    />
                    <span className="text-[11px] text-slate-400">/sheet</span>
                  </div>
                </div>

                {/* Color Single */}
                <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-3.5 space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    Color Single-Sided (Simplex)
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 font-bold">₹</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={rates[activeTab.toLowerCase() as "a4" | "a3" | "legal"].colorSingle}
                      onChange={(e) =>
                        handleRateChange(
                          activeTab.toLowerCase() as "a4" | "a3" | "legal",
                          "colorSingle",
                          e.target.value
                        )
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:border-blue-500 focus:outline-none"
                    />
                    <span className="text-[11px] text-slate-400">/page</span>
                  </div>
                </div>

                {/* Color Duplex Sheet */}
                <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-300">
                      Color Double-Sided (Duplex)
                    </label>
                    <span className="text-[10px] text-emerald-400 font-medium">Both sides</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 font-bold">₹</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={rates[activeTab.toLowerCase() as "a4" | "a3" | "legal"].colorDuplexSheet}
                      onChange={(e) =>
                        handleRateChange(
                          activeTab.toLowerCase() as "a4" | "a3" | "legal",
                          "colorDuplexSheet",
                          e.target.value
                        )
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:border-blue-500 focus:outline-none"
                    />
                    <span className="text-[11px] text-slate-400">/sheet</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Plotter B&W Line Drawing */}
                <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-3.5 space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    B&amp;W Blueprint / Line Drawing Plan
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 font-bold">₹</span>
                    <input
                      type="number"
                      step="5"
                      min="0"
                      value={rates.plotter.bwSingle}
                      onChange={(e) => handleRateChange("plotter", "bwSingle", e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:border-blue-500 focus:outline-none"
                    />
                    <span className="text-[11px] text-slate-400">/plan</span>
                  </div>
                </div>

                {/* Plotter Color Architectural Render */}
                <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-3.5 space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    Color Architectural Render / Map
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 font-bold">₹</span>
                    <input
                      type="number"
                      step="10"
                      min="0"
                      value={rates.plotter.colorSingle}
                      onChange={(e) => handleRateChange("plotter", "colorSingle", e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:border-blue-500 focus:outline-none"
                    />
                    <span className="text-[11px] text-slate-400">/plan</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Test Sandbox Calculator */}
          <div className="bg-blue-950/20 border border-blue-900/40 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-blue-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>🧮</span> Live Pricing Calculator Test
              </span>
              <span className="text-xs text-slate-400">Verify your rates with live inputs</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Paper</label>
                <select
                  value={testSize}
                  onChange={(e) => setTestSize(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
                >
                  <option value="A4">A4</option>
                  <option value="A3">A3</option>
                  <option value="LEGAL">Legal</option>
                  <option value="PLOTTER">Plotter</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Color Mode</label>
                <select
                  value={testColor}
                  onChange={(e) => setTestColor(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
                >
                  <option value="BW">B&amp;W</option>
                  <option value="COLOR">Color</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Sides</label>
                <select
                  value={testDuplex}
                  onChange={(e) => setTestDuplex(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
                  disabled={testSize === "PLOTTER"}
                >
                  <option value="SIMPLEX">1-Sided</option>
                  <option value="DUPLEX">2-Sided (Duplex)</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Doc Pages</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={testPages}
                  onChange={(e) => setTestPages(parseInt(e.target.value) || 1)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Copies</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={testCopies}
                  onChange={(e) => setTestCopies(parseInt(e.target.value) || 1)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 font-mono"
                />
              </div>
            </div>

            {/* Test result banner */}
            <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-300">
                <span>Sheets Used: </span>
                <strong className="text-white font-mono">{testCalc.totalSheets} sheets</strong>
                {testCalc.duplexSheets > 0 && (
                  <span className="text-[11px] text-slate-400">
                    {" "}
                    ({testCalc.duplexSheets} duplex
                    {testCalc.simplexSheets > 0 ? ` + ${testCalc.simplexSheets} single` : ""})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Calculated Bill:</span>
                <span className="text-base font-extrabold text-emerald-400 font-mono">
                  ₹{testCalc.total.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/60">
          <div>
            {saveSuccess && (
              <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1 animate-fadeIn">
                ✓ Rates saved and applied successfully!
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/25 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "💾 Save Printing Rates"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
