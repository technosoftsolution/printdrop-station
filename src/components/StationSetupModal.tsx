import React, { useEffect, useState } from "react";
import { Store, User, MapPin, Phone, CheckCircle2, AlertCircle, X, ShieldCheck } from "lucide-react";

interface StationSetupModalProps {
  isOpen: boolean;
  isTrial: boolean;
  allowSkip: boolean;
  isEditMode?: boolean;
  initialValues: {
    shopName: string;
    ownerName: string;
    city: string;
    phone: string;
  };
  onSave: (data: {
    shopName: string;
    ownerName: string;
    city: string;
    phone: string;
  }) => Promise<void>;
  onSkip?: () => void;
  onClose?: () => void;
}

export const StationSetupModal: React.FC<StationSetupModalProps> = ({
  isOpen,
  isTrial,
  allowSkip,
  isEditMode = false,
  initialValues,
  onSave,
  onSkip,
  onClose,
}) => {
  const [shopName, setShopName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const cleanShop =
        initialValues.shopName &&
        initialValues.shopName.trim() !== "PrintDrop Retail Station"
          ? initialValues.shopName.trim()
          : "";
      setShopName(cleanShop);
      setOwnerName(initialValues.ownerName?.trim() || "");
      setCity(initialValues.city?.trim() || "");
      setPhone(initialValues.phone?.trim() || "");
      setError(null);
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const s = shopName.trim();
    const o = ownerName.trim();
    const c = city.trim();
    const p = phone.trim();

    if (!s || s.toLowerCase() === "printdrop retail station") {
      setError("Please enter your actual Shop / Station Name (e.g. Shree Ganesh Xerox).");
      return;
    }
    if (!o) {
      setError("Please enter the Shopkeeper / Owner Name.");
      return;
    }
    if (!c) {
      setError("Please enter your Shop Location / City (e.g. Shivajinagar, Pune).");
      return;
    }
    const digits = p.replace(/\D/g, "");
    if (digits.length < 10) {
      setError("Please enter a valid 10-digit Mobile / WhatsApp Number.");
      return;
    }

    try {
      setSaving(true);
      await onSave({ shopName: s, ownerName: o, city: c, phone: p });
    } catch (err: any) {
      setError(typeof err === "string" ? err : err?.message || "Failed to save station profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-indigo-500/40 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-indigo-950/80 via-slate-900 to-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-300">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {isEditMode ? "Station Profile & Identity" : "Welcome! Setup Your PrintDrop Station"}
              </h2>
              <p className="text-xs text-slate-400">
                {isTrial
                  ? "Identify this counter for support, cloud sync & customer branding"
                  : "Required station identity for your commercial PrintDrop license"}
              </p>
            </div>
          </div>
          {isEditMode && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {!isTrial && !isEditMode && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-200">
              <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                Your station is on a commercial license. All four fields below are required to register this counter.
              </span>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 flex items-center gap-2 text-xs text-rose-200 font-medium">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Store className="w-3.5 h-3.5 text-indigo-400" />
                <span>Station / Shop Name</span>
                <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                placeholder="e.g. Shree Ganesh Xerox (Counter 1)"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-indigo-500 text-sm text-white placeholder:text-slate-500 outline-none transition"
                autoFocus
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Shown to customers as <span className="text-indigo-300 font-medium">"{shopName.trim() || "Your Shop Name"} • Powered by PrintDrop"</span>
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Shopkeeper / Owner Name</span>
                  <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="e.g. Mahesh Sharma"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-indigo-500 text-sm text-white placeholder:text-slate-500 outline-none transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Mobile / WhatsApp Number</span>
                  <span className="text-rose-400">*</span>
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. +91 98765 43210"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-indigo-500 text-sm text-white placeholder:text-slate-500 outline-none transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-amber-400" />
                <span>Location / Area &amp; City</span>
                <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Shivajinagar, Pune"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-indigo-500 text-sm text-white placeholder:text-slate-500 outline-none transition"
              />
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between gap-3 border-t border-slate-800">
            {allowSkip && isTrial && onSkip ? (
              <button
                type="button"
                onClick={onSkip}
                disabled={saving}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                Skip for now (Trial)
              </button>
            ) : isEditMode && onClose ? (
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                Cancel
              </button>
            ) : (
              <span className="text-[11px] text-slate-500">* All fields required</span>
            )}

            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-bold shadow-lg shadow-indigo-600/25 transition cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{saving ? "Saving & Syncing..." : "Save Station Profile"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
