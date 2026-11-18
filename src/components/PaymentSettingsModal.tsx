import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CounterStandeeModal } from "./CounterStandeeModal";
import { Printer, ShieldCheck, Eye, EyeOff } from "lucide-react";

export interface UpiPaymentSettings {
  enabled: boolean;
  businessName: string;
  upiId: string;
  showDeskQr: boolean;
  razorpayEnabled?: boolean;
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  razorpayQrId?: string;
  razorpayQrImageUrl?: string;
  razorpayQrPayload?: string;
}

export const defaultUpiSettings: UpiPaymentSettings = {
  enabled: false,
  businessName: "",
  upiId: "",
  showDeskQr: false,
  razorpayEnabled: false,
  razorpayKeyId: "",
  razorpayKeySecret: "",
  razorpayQrId: "",
  razorpayQrImageUrl: "",
  razorpayQrPayload: "",
};

// Developer Testing Preset (Loaded strictly on-demand in development mode)
export const devTestUpiSettings: UpiPaymentSettings = {
  enabled: true,
  businessName: "TechnoSoft Solution",
  upiId: "satishharilalpa302866.rzp@rxairtel",
  showDeskQr: true,
  razorpayEnabled: false,
  razorpayKeyId: "",
  razorpayKeySecret: "",
  razorpayQrId: "qr_TvmnkaSBVCD0Ok",
  razorpayQrImageUrl: "https://rzp.io/rzp/4DH7ll4d",
  razorpayQrPayload: "upi://pay?cu=INR&mc=7338&mode=19&pa=satishharilalpa302866.rzp@rxairtel&tn=Payment%20To%20TechnoSoft%20Solution&tr=TvmnkaSBVCD0Okqrv2",
};

interface PaymentSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export const PaymentSettingsModal: React.FC<PaymentSettingsModalProps> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const [settings, setSettings] = useState<UpiPaymentSettings>(defaultUpiSettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showStandeeModal, setShowStandeeModal] = useState(false);
  const [showKeySecret, setShowKeySecret] = useState(false);
  const [isSyncingQr, setIsSyncingQr] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    setLoading(true);
    setStatusMsg(null);
    try {
      const data = await invoke<UpiPaymentSettings>("get_payment_settings");
      if (data) {
        setSettings(data);
      }
    } catch (err: any) {
      console.error("Failed to load payment settings:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncRazorpayQr = async () => {
    setIsSyncingQr(true);
    setStatusMsg(null);
    try {
      const updated = await invoke<UpiPaymentSettings>("sync_razorpay_qr");
      setSettings(updated);
      setStatusMsg({
        text: `Official Razorpay QR linked: ${updated.razorpayQrId || "Active"}!`,
        type: "success"
      });
    } catch (err: any) {
      console.error("Failed to sync Razorpay QR:", err);
      setStatusMsg({ text: `Sync failed: ${err}`, type: "error" });
    } finally {
      setIsSyncingQr(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMsg(null);
    try {
      await invoke("save_payment_settings", { settings });
      setStatusMsg({ text: "Payment settings saved successfully!", type: "success" });
      if (onSaved) onSaved();
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err: any) {
      console.error("Failed to save payment settings:", err);
      setStatusMsg({ text: `Failed to save: ${err}`, type: "error" });
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const sampleUpiUri = `upi://pay?pa=${encodeURIComponent(settings.upiId || "")}&pn=${encodeURIComponent(settings.businessName || "")}&cu=INR&tn=Sample%20PrintDrop%20Order`;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "1rem",
      }}
    >
      <div
        style={{
          backgroundColor: "#0f172a",
          border: "1px solid #334155",
          borderRadius: "1rem",
          width: "100%",
          maxWidth: "520px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "1.25rem 1.5rem",
            borderBottom: "1px solid #1e293b",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(to right, #0f172a, #1e1b4b)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ fontSize: "1.5rem" }}>💳</span>
            <div>
              <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f8fafc", margin: 0 }}>
                UPI & Payment Settings
              </h2>
              <p style={{ fontSize: "0.75rem", color: "#94a3b8", margin: "2px 0 0 0" }}>
                {loading ? "Loading current settings..." : "Zero-commission direct payments to your shop's UPI ID / VPA"}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {(import.meta as any).env?.DEV && (
              <button
                type="button"
                onClick={() => {
                  setSettings(devTestUpiSettings);
                  setStatusMsg({ text: "🧪 Loaded developer test presets into form fields.", type: "success" });
                }}
                style={{
                  background: "rgba(245, 158, 11, 0.15)",
                  border: "1px solid rgba(245, 158, 11, 0.4)",
                  color: "#fbbf24",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  padding: "0.25rem 0.5rem",
                  borderRadius: "0.375rem",
                  cursor: "pointer",
                }}
                title="Load Developer Test Preset (Visible in Development Mode Only)"
              >
                🧪 Dev Preset
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                fontSize: "1.25rem",
                cursor: "pointer",
                padding: "0.25rem",
                borderRadius: "0.375rem",
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem", maxHeight: "calc(88vh - 140px)", overflowY: "auto" }}>
          {statusMsg && (
            <div
              style={{
                padding: "0.6rem 0.9rem",
                borderRadius: "0.5rem",
                fontSize: "0.8rem",
                fontWeight: 600,
                backgroundColor: statusMsg.type === "success" ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                border: `1px solid ${statusMsg.type === "success" ? "#10b981" : "#ef4444"}`,
                color: statusMsg.type === "success" ? "#34d399" : "#fca5a5",
              }}
            >
              {statusMsg.text}
            </div>
          )}

          {/* Enable Toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.75rem 1rem",
              backgroundColor: "#1e293b",
              borderRadius: "0.625rem",
              border: "1px solid #334155",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "#f8fafc" }}>
                Accept Online UPI Payments
              </div>
              <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "2px" }}>
                Allow customers to pay via GPay, PhonePe, Paytm or BHIM with locked amounts
              </div>
            </div>
            <label style={{ position: "relative", display: "inline-block", width: "44px", height: "24px" }}>
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: "absolute",
                  cursor: "pointer",
                  inset: 0,
                  backgroundColor: settings.enabled ? "#4f46e5" : "#475569",
                  borderRadius: "24px",
                  transition: "0.3s",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    content: "''",
                    height: "18px",
                    width: "18px",
                    left: settings.enabled ? "23px" : "3px",
                    bottom: "3px",
                    backgroundColor: "white",
                    borderRadius: "50%",
                    transition: "0.3s",
                  }}
                />
              </span>
            </label>
          </div>

          {/* Shopkeeper VPA / UPI ID */}
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 700, color: "#cbd5e1", marginBottom: "0.35rem" }}>
              Shopkeeper UPI ID / VPA <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              type="text"
              value={settings.upiId}
              onChange={(e) => setSettings({ ...settings, upiId: e.target.value.trim() })}
              placeholder="e.g. apexprint@okaxis or 9876543210@paytm"
              style={{
                width: "100%",
                padding: "0.65rem 0.85rem",
                backgroundColor: "#090d16",
                border: "1px solid #334155",
                borderRadius: "0.5rem",
                color: "#f8fafc",
                fontSize: "0.85rem",
                fontFamily: "monospace",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div style={{ fontSize: "0.7rem", color: "#94a3b8", marginTop: "0.3rem" }}>
              Payments go directly to this bank account with 0% platform commission.
            </div>
          </div>

          {/* Business / Payee Name */}
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 700, color: "#cbd5e1", marginBottom: "0.35rem" }}>
              Business / Store Payee Name
            </label>
            <input
              type="text"
              value={settings.businessName}
              onChange={(e) => setSettings({ ...settings, businessName: e.target.value })}
              placeholder="e.g. Apex Xerox & Digital Prints"
              style={{
                width: "100%",
                padding: "0.65rem 0.85rem",
                backgroundColor: "#090d16",
                border: "1px solid #334155",
                borderRadius: "0.5rem",
                color: "#f8fafc",
                fontSize: "0.85rem",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div style={{ fontSize: "0.7rem", color: "#94a3b8", marginTop: "0.3rem" }}>
              Displayed on customer's phone during UPI payment authorization.
            </div>
          </div>

          {/* Razorpay Gateway Integration Section */}
          <div
            style={{
              padding: "1rem",
              backgroundColor: "#111827",
              border: settings.razorpayEnabled ? "1.5px solid #6366f1" : "1px solid #374151",
              borderRadius: "0.75rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.85rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1.2rem" }}>⚡</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "#f8fafc", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    Razorpay Gateway Integration
                    <span style={{ fontSize: "0.65rem", padding: "0.15rem 0.45rem", borderRadius: "9999px", background: "rgba(99, 102, 241, 0.2)", color: "#818cf8", border: "1px solid rgba(99, 102, 241, 0.4)", fontWeight: 700 }}>
                      RECOMMENDED
                    </span>
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "2px" }}>
                    Guarantees smooth mobile payments (prevents BHIM Next-disabled &amp; PaytmProtect risk blocks)
                  </div>
                </div>
              </div>
              <label style={{ position: "relative", display: "inline-block", width: "44px", height: "24px", flexShrink: 0 }}>
                <input
                  type="checkbox"
                  checked={!!settings.razorpayEnabled}
                  onChange={(e) => setSettings({ ...settings, razorpayEnabled: e.target.checked })}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span
                  style={{
                    position: "absolute",
                    cursor: "pointer",
                    inset: 0,
                    backgroundColor: settings.razorpayEnabled ? "#6366f1" : "#475569",
                    borderRadius: "24px",
                    transition: "0.3s",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      content: "''",
                      height: "18px",
                      width: "18px",
                      left: settings.razorpayEnabled ? "23px" : "3px",
                      bottom: "3px",
                      backgroundColor: "white",
                      borderRadius: "50%",
                      transition: "0.3s",
                    }}
                  />
                </span>
              </label>
            </div>

            {settings.razorpayEnabled && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.25rem", paddingTop: "0.75rem", borderTop: "1px solid #1f2937" }}>
                {/* Key ID */}
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#cbd5e1", marginBottom: "0.3rem" }}>
                    Razorpay Key ID <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      type="text"
                      value={settings.razorpayKeyId || ""}
                      onChange={(e) => setSettings({ ...settings, razorpayKeyId: e.target.value.trim() })}
                      placeholder="rzp_test_... or rzp_live_..."
                      style={{
                        width: "100%",
                        padding: "0.6rem 0.85rem",
                        backgroundColor: "#030712",
                        border: "1px solid #4b5563",
                        borderRadius: "0.5rem",
                        color: "#f8fafc",
                        fontSize: "0.82rem",
                        fontFamily: "monospace",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "#9ca3af", marginTop: "0.25rem" }}>
                    Found in Razorpay Dashboard &gt; Account &amp; Settings &gt; API Keys.
                  </div>
                </div>

                {/* Key Secret */}
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#cbd5e1", marginBottom: "0.3rem" }}>
                    Razorpay Key Secret <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <input
                      type={showKeySecret ? "text" : "password"}
                      value={settings.razorpayKeySecret || ""}
                      onChange={(e) => setSettings({ ...settings, razorpayKeySecret: e.target.value.trim() })}
                      placeholder="Enter Key Secret from Razorpay Dashboard"
                      style={{
                        width: "100%",
                        padding: "0.6rem 2.5rem 0.6rem 0.85rem",
                        backgroundColor: "#030712",
                        border: "1px solid #4b5563",
                        borderRadius: "0.5rem",
                        color: "#f8fafc",
                        fontSize: "0.82rem",
                        fontFamily: "monospace",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKeySecret(!showKeySecret)}
                      style={{
                        position: "absolute",
                        right: "0.5rem",
                        background: "transparent",
                        border: "none",
                        color: "#9ca3af",
                        cursor: "pointer",
                        padding: "0.25rem",
                        display: "flex",
                        alignItems: "center",
                      }}
                      title={showKeySecret ? "Hide secret" : "Show secret"}
                    >
                      {showKeySecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "#9ca3af", marginTop: "0.25rem" }}>
                    Stored securely on your local PC. Used to verify payment signatures and prevent fraud.
                  </div>
                </div>

                {/* Official Razorpay QR Code Integration Card */}
                <div
                  style={{
                    padding: "0.75rem",
                    borderRadius: "0.5rem",
                    backgroundColor: "#030712",
                    border: "1px solid #374151",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#e0e7ff", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                      <span>📱</span> Official Razorpay Counter QR Code
                    </div>
                    <button
                      type="button"
                      onClick={handleSyncRazorpayQr}
                      disabled={isSyncingQr || !settings.razorpayKeyId}
                      style={{
                        padding: "0.3rem 0.65rem",
                        backgroundColor: "rgba(99, 102, 241, 0.2)",
                        border: "1px solid #6366f1",
                        borderRadius: "0.375rem",
                        color: "#a5b4fc",
                        fontSize: "0.72rem",
                        fontWeight: 700,
                        cursor: isSyncingQr ? "not-allowed" : "pointer",
                      }}
                    >
                      {isSyncingQr ? "Syncing..." : "🔄 Sync from Razorpay"}
                    </button>
                  </div>

                  <div style={{ fontSize: "0.7rem", color: "#94a3b8", lineHeight: "1.4" }}>
                    Linked to your Razorpay Bank Account with NPCI Merchant Category (MCC: 7338 Quick Copy / Printing). Works 100% with PhonePe, Google Pay, Paytm, BHIM.
                  </div>

                  {settings.razorpayQrId && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0.55rem 0.75rem",
                        backgroundColor: "rgba(16, 185, 129, 0.08)",
                        borderRadius: "0.5rem",
                        border: "1px solid rgba(16, 185, 129, 0.25)",
                        marginTop: "0.25rem",
                      }}
                    >
                      <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#34d399", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                        <span>✓</span> Linked Merchant QR: <span style={{ fontFamily: "monospace", color: "#67e8f9" }}>{settings.razorpayQrId}</span>
                      </div>
                      <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#818cf8", backgroundColor: "rgba(99, 102, 241, 0.15)", border: "1px solid rgba(99, 102, 241, 0.3)", padding: "0.15rem 0.5rem", borderRadius: "9999px" }}>
                        NPCI Mode 19 (Active)
                      </span>
                    </div>
                  )}
                </div>

                <div
                  style={{
                    padding: "0.55rem 0.75rem",
                    borderRadius: "0.5rem",
                    backgroundColor: "rgba(16, 185, 129, 0.08)",
                    border: "1px solid rgba(16, 185, 129, 0.25)",
                    fontSize: "0.72rem",
                    color: "#6ee7b7",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                  }}
                >
                  <ShieldCheck className="w-4 h-4 flex-shrink-0 text-emerald-400" />
                  <span>
                    When enabled, walk-in &amp; mobile customers get a native checkout sheet supporting <strong>GPay, PhonePe, Paytm, BHIM, NetBanking &amp; Cards</strong> with 100% success rate.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Front-Desk QR Standee Generator Banner */}
          <div
            style={{
              padding: "0.85rem 1rem",
              background: "linear-gradient(135deg, rgba(79, 70, 229, 0.15) 0%, rgba(6, 182, 212, 0.1) 100%)",
              border: "1.5px solid rgba(129, 140, 248, 0.35)",
              borderRadius: "0.75rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.75rem",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#e0e7ff", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span>🖨️</span> Front-Desk Payment Standee
              </div>
              <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "2px" }}>
                Generate an official A4/A5 counter poster with clean NPCI QR code for Walk-In customers to scan.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowStandeeModal(true)}
              disabled={!settings.upiId.trim()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.5rem 0.95rem",
                backgroundColor: "#4f46e5",
                border: "none",
                borderRadius: "0.5rem",
                color: "#ffffff",
                fontSize: "0.78rem",
                fontWeight: 700,
                cursor: settings.upiId.trim() ? "pointer" : "not-allowed",
                opacity: settings.upiId.trim() ? 1 : 0.5,
                boxShadow: "0 4px 12px rgba(79, 70, 229, 0.4)",
              }}
            >
              <Printer className="w-3.5 h-3.5" />
              Preview &amp; Print Standee
            </button>
          </div>

          {/* Configuration Preview Card */}
          <div
            style={{
              padding: "0.85rem 1rem",
              backgroundColor: "rgba(6, 182, 212, 0.06)",
              border: "1px solid rgba(6, 182, 212, 0.25)",
              borderRadius: "0.625rem",
              fontSize: "0.74rem",
              color: "#94a3b8",
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 700, color: "#38bdf8", marginBottom: "0.25rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <span>ℹ️</span> Pre-filled & Locked Amount Protocol:
            </div>
            <div>
              When a customer taps <strong>"Pay Online (UPI / QR)"</strong>, the exact printed bill amount is locked in the UPI deep link. The customer does not need to enter or edit amounts manually.
            </div>
            {settings.upiId && (
              <div style={{ marginTop: "0.5rem", padding: "0.4rem 0.6rem", backgroundColor: "#090d16", borderRadius: "0.375rem", fontFamily: "monospace", fontSize: "0.68rem", color: "#67e8f9", wordBreak: "break-all" }}>
                Deep-link preview: {sampleUpiUri}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "1rem 1.5rem",
            borderTop: "1px solid #1e293b",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "0.75rem",
            backgroundColor: "#0b1120",
          }}
        >
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: "0.55rem 1.1rem",
              backgroundColor: "transparent",
              border: "1px solid #334155",
              borderRadius: "0.5rem",
              color: "#94a3b8",
              fontSize: "0.82rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !settings.upiId.trim()}
            style={{
              padding: "0.55rem 1.25rem",
              background: "linear-gradient(135deg, #06b6d4, #4f46e5)",
              border: "none",
              borderRadius: "0.5rem",
              color: "white",
              fontSize: "0.82rem",
              fontWeight: 700,
              cursor: saving || !settings.upiId.trim() ? "not-allowed" : "pointer",
              opacity: saving || !settings.upiId.trim() ? 0.6 : 1,
              boxShadow: "0 4px 12px rgba(6, 182, 212, 0.25)",
            }}
          >
            {saving ? "Saving..." : "Save Payment Settings"}
          </button>
        </div>
      </div>

      {/* Standee Preview & Print Modal */}
      <CounterStandeeModal
        isOpen={showStandeeModal}
        onClose={() => setShowStandeeModal(false)}
        upiId={settings.upiId}
        businessName={settings.businessName}
        razorpayEnabled={settings.razorpayEnabled}
        razorpayQrImageUrl={settings.razorpayQrImageUrl}
        razorpayQrPayload={settings.razorpayQrPayload}
      />
    </div>
  );
};
