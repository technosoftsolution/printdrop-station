import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Printer, Download, X, QrCode, ShieldCheck, ExternalLink, Check, Info } from "lucide-react";

interface CounterStandeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  upiId: string;
  businessName: string;
  razorpayEnabled?: boolean;
  razorpayQrImageUrl?: string;
  razorpayQrPayload?: string;
}

interface StandeeQrData {
  rawSvg: string;
  svgDataUrl: string;
  pngDataUrl: string;
  upiUri: string;
}

export const CounterStandeeModal: React.FC<CounterStandeeModalProps> = ({
  isOpen,
  onClose,
  upiId,
  businessName,
  razorpayEnabled,
  razorpayQrImageUrl,
  razorpayQrPayload,
}) => {
  const [qrPngDataUrl, setQrPngDataUrl] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [savingQr, setSavingQr] = useState<boolean>(false);
  const [openingPoster, setOpeningPoster] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<{ text: string; type: "success" | "info" | "error" } | null>(null);
  const [standeeSize, setStandeeSize] = useState<"A4" | "A5">("A4");

  const effectiveName = businessName.trim() || "PrintDrop Counter";
  const effectiveUpi = upiId.trim();

  useEffect(() => {
    if (isOpen) {
      loadQrCode();
    }
  }, [isOpen, upiId, businessName, razorpayEnabled, razorpayQrPayload]);

  const loadQrCode = async () => {
    if (!effectiveUpi) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Always generate the pure, edge-to-edge vector QR code and high-res PNG
      const data = await invoke<StandeeQrData | string>("generate_standee_qr", {
        upiId: effectiveUpi,
        businessName: effectiveName,
      });

      if (typeof data === "string") {
        setQrPngDataUrl(data);
      } else if (data) {
        setQrPngDataUrl(data.pngDataUrl || data.svgDataUrl);
      }
    } catch (err) {
      console.error("Failed to generate standee QR:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenRazorpayPoster = async () => {
    if (!razorpayQrImageUrl) return;
    setOpeningPoster(true);
    setStatusNotice(null);
    try {
      await invoke("open_external_url", { url: razorpayQrImageUrl });
      setStatusNotice({ text: "Opened Razorpay Poster in default browser!", type: "success" });
    } catch (err: any) {
      console.warn("Failed to open via Tauri shell, trying window.open fallback:", err);
      window.open(razorpayQrImageUrl, "_blank");
    } finally {
      setOpeningPoster(false);
      setTimeout(() => setStatusNotice(null), 4000);
    }
  };

  const handleSaveQr = async () => {
    setSavingQr(true);
    setStatusNotice(null);
    try {
      const savedPath = await invoke<string>("save_standee_qr_file", {
        upiId: effectiveUpi,
        businessName: effectiveName,
      });
      const fileName = savedPath.split(/[/\\]/).pop() || "QR_Code.png";
      setStatusNotice({
        text: `✓ Saved QR to Downloads: ${fileName} (Revealed in File Explorer)`,
        type: "success",
      });
    } catch (err: any) {
      console.error("Native save failed, falling back to browser download:", err);
      if (qrPngDataUrl) {
        const link = document.createElement("a");
        link.href = qrPngDataUrl;
        link.download = `PrintDrop_Payment_QR_${effectiveUpi.replace(/[^a-zA-Z0-9]/g, "_")}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setStatusNotice({ text: "Downloaded QR image to browser downloads!", type: "success" });
      } else {
        setStatusNotice({ text: `Save failed: ${err}`, type: "error" });
      }
    } finally {
      setSavingQr(false);
      setTimeout(() => setStatusNotice(null), 6000);
    }
  };

  const handlePrint = () => {
    const printableEl = document.getElementById("printdrop-standee-printable");
    if (!printableEl) {
      window.print();
      return;
    }

    // Create an isolated hidden iframe so printing is 100% free of modal and page styling interference
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      window.print();
      return;
    }

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>PrintDrop Payment Standee - ${effectiveName}</title>
          <style>
            @page {
              size: ${standeeSize === "A4" ? "A4 portrait" : "A5 portrait"};
              margin: 8mm;
            }
            body {
              margin: 0;
              padding: 0;
              background: #ffffff;
              display: flex;
              justify-content: center;
              align-items: flex-start;
              font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            * {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              color-adjust: exact !important;
            }
            #printdrop-standee-printable {
              box-shadow: none !important;
              border: 2px solid #0f172a !important;
              border-radius: 16px !important;
              width: 100% !important;
              max-width: ${standeeSize === "A4" ? "420px" : "360px"} !important;
              margin: 0 auto !important;
            }
          </style>
        </head>
        <body>
          ${printableEl.outerHTML}
        </body>
      </html>
    `);
    doc.close();

    // Give iframe a brief moment to render images and styles
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.error("Iframe print failed, falling back to window.print():", err);
        window.print();
      } finally {
        setTimeout(() => {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
        }, 3000);
      }
    }, 250);
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.82)",
          backdropFilter: "blur(6px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10000,
          padding: "1rem",
        }}
      >
        <div
          style={{
            backgroundColor: "#0b1120",
            border: "1px solid #1e293b",
            borderRadius: "1.25rem",
            width: "100%",
            maxWidth: "560px",
            maxHeight: "92vh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.8)",
          }}
        >
          {/* Modal Header */}
          <div
            style={{
              padding: "1rem 1.25rem",
              borderBottom: "1px solid #1e293b",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "linear-gradient(to right, #0b1120, #1e1b4b)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <div style={{ background: "#4f46e5", borderRadius: "0.5rem", padding: "0.4rem", display: "flex" }}>
                <QrCode className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#f8fafc" }}>
                  Front-Desk UPI Standee
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.72rem", color: "#94a3b8" }}>
                  Print and place this official payment poster at your shop counter
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
                padding: "0.25rem",
              }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Controls Bar */}
          <div
            style={{
              padding: "0.75rem 1.25rem",
              backgroundColor: "#0f172a",
              borderBottom: "1px solid #1e293b",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "0.5rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 600 }}>Paper Size:</span>
              <div style={{ display: "inline-flex", background: "#1e293b", borderRadius: "0.375rem", padding: "2px" }}>
                <button
                  type="button"
                  onClick={() => setStandeeSize("A4")}
                  style={{
                    padding: "0.25rem 0.6rem",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    borderRadius: "0.25rem",
                    border: "none",
                    cursor: "pointer",
                    background: standeeSize === "A4" ? "#4f46e5" : "transparent",
                    color: standeeSize === "A4" ? "#ffffff" : "#94a3b8",
                  }}
                >
                  A4 Paper
                </button>
                <button
                  type="button"
                  onClick={() => setStandeeSize("A5")}
                  style={{
                    padding: "0.25rem 0.6rem",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    borderRadius: "0.25rem",
                    border: "none",
                    cursor: "pointer",
                    background: standeeSize === "A5" ? "#4f46e5" : "transparent",
                    color: standeeSize === "A5" ? "#ffffff" : "#94a3b8",
                  }}
                >
                  A5 Standee
                </button>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              {razorpayQrImageUrl && (
                <button
                  type="button"
                  onClick={handleOpenRazorpayPoster}
                  disabled={openingPoster}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.45rem 0.75rem",
                    fontSize: "0.74rem",
                    fontWeight: 600,
                    backgroundColor: "rgba(56, 189, 248, 0.12)",
                    border: "1px solid #0284c7",
                    borderRadius: "0.5rem",
                    color: "#38bdf8",
                    cursor: openingPoster ? "not-allowed" : "pointer",
                  }}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {openingPoster ? "Opening..." : "Razorpay Poster"}
                </button>
              )}
              <button
                type="button"
                onClick={handleSaveQr}
                disabled={loading || savingQr || !qrPngDataUrl}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  padding: "0.45rem 0.75rem",
                  fontSize: "0.74rem",
                  fontWeight: 600,
                  backgroundColor: "rgba(148, 163, 184, 0.1)",
                  border: "1px solid #334155",
                  borderRadius: "0.5rem",
                  color: "#cbd5e1",
                  cursor: loading || savingQr || !qrPngDataUrl ? "not-allowed" : "pointer",
                }}
              >
                <Download className="w-3.5 h-3.5" />
                {savingQr ? "Saving..." : "Save QR"}
              </button>
              <button
                type="button"
                onClick={handlePrint}
                disabled={loading || !qrPngDataUrl}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  padding: "0.45rem 0.95rem",
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  background: "linear-gradient(135deg, #06b6d4 0%, #4f46e5 100%)",
                  border: "none",
                  borderRadius: "0.5rem",
                  color: "#ffffff",
                  cursor: loading || !qrPngDataUrl ? "not-allowed" : "pointer",
                  boxShadow: "0 4px 12px rgba(79, 70, 229, 0.35)",
                }}
              >
                <Printer className="w-4 h-4" />
                Print Standee Now
              </button>
            </div>
          </div>

          {/* Status Message or Printer Selection Tip Banner */}
          {statusNotice ? (
            <div
              style={{
                padding: "0.5rem 1.25rem",
                backgroundColor: statusNotice.type === "success" ? "rgba(16, 185, 129, 0.15)" : statusNotice.type === "error" ? "rgba(239, 68, 68, 0.15)" : "rgba(59, 130, 246, 0.15)",
                borderBottom: `1px solid ${statusNotice.type === "success" ? "rgba(16, 185, 129, 0.3)" : statusNotice.type === "error" ? "rgba(239, 68, 68, 0.3)" : "rgba(59, 130, 246, 0.3)"}`,
                color: statusNotice.type === "success" ? "#34d399" : statusNotice.type === "error" ? "#fca5a5" : "#93c5fd",
                fontSize: "0.74rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "0.45rem",
              }}
            >
              {statusNotice.type === "success" ? <Check className="w-4 h-4 flex-shrink-0" /> : <Info className="w-4 h-4 flex-shrink-0" />}
              <span>{statusNotice.text}</span>
            </div>
          ) : (
            <div
              style={{
                padding: "0.45rem 1.25rem",
                backgroundColor: "rgba(59, 130, 246, 0.08)",
                borderBottom: "1px solid rgba(59, 130, 246, 0.2)",
                color: "#93c5fd",
                fontSize: "0.7rem",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <Info className="w-3.5 h-3.5 flex-shrink-0 text-blue-400" />
              <span>
                <strong>Printer Selection:</strong> In the print preview window, change the <strong>Destination</strong> dropdown to your shop printer or <em>Microsoft Print to PDF</em> (if OneNote is pre-selected).
              </span>
            </div>
          )}

          {/* Standee Live Preview Container */}
          <div
            style={{
              padding: "1.25rem",
              overflowY: "auto",
              display: "flex",
              justifyContent: "center",
              backgroundColor: "#030712",
            }}
          >
            {!effectiveUpi ? (
              <div
                style={{
                  width: "100%",
                  maxWidth: "420px",
                  padding: "2.5rem 1.5rem",
                  backgroundColor: "#0f172a",
                  border: "2px dashed #f59e0b",
                  borderRadius: "1rem",
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "1rem",
                  margin: "1.5rem 0",
                }}
              >
                <span style={{ fontSize: "2.5rem" }}>⚠️</span>
                <h4 style={{ color: "#f8fafc", fontSize: "1.1rem", fontWeight: 700, margin: 0 }}>
                  No UPI ID Configured Yet
                </h4>
                <p style={{ color: "#94a3b8", fontSize: "0.8rem", lineHeight: 1.5, margin: 0 }}>
                  To generate and print your shop counter's payment standee, please enter your <strong>Business Name</strong> and <strong>UPI VPA</strong> (e.g. <code>yourshop@okaxis</code> or <code>yourshop@upi</code>) in Settings.
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: "0.6rem 1.25rem",
                    backgroundColor: "#4f46e5",
                    color: "#ffffff",
                    borderRadius: "0.5rem",
                    border: "none",
                    fontWeight: 700,
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(79, 70, 229, 0.4)",
                  }}
                >
                  Close &amp; Configure in Settings
                </button>
              </div>
            ) : (
            /* The Actual Printable Standee Card */
            <div
              id="printdrop-standee-printable"
              style={{
                width: "100%",
                maxWidth: standeeSize === "A4" ? "420px" : "360px",
                backgroundColor: "#ffffff",
                color: "#0f172a",
                borderRadius: "1rem",
                padding: "1.5rem",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
                border: "2px solid #e2e8f0",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                position: "relative",
              }}
            >
              {/* Standee Header */}
              <div
                style={{
                  width: "100%",
                  paddingBottom: "0.75rem",
                  borderBottom: "2px solid #0f172a",
                  marginBottom: "1rem",
                }}
              >
                <div
                  style={{
                    display: "inline-block",
                    backgroundColor: "#0f172a",
                    color: "#ffffff",
                    fontSize: "0.68rem",
                    fontWeight: 800,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    padding: "0.2rem 0.75rem",
                    borderRadius: "9999px",
                    marginBottom: "0.4rem",
                  }}
                >
                  OFFICIAL PAYMENT COUNTER
                </div>
                <h1
                  style={{
                    fontSize: "1.35rem",
                    fontWeight: 900,
                    color: "#0f172a",
                    margin: 0,
                    lineHeight: 1.2,
                    textTransform: "uppercase",
                    letterSpacing: "0.02em",
                  }}
                >
                  {effectiveName}
                </h1>
                <div style={{ fontSize: "0.75rem", color: "#475569", marginTop: "0.2rem", fontWeight: 600 }}>
                  {razorpayEnabled ? "Scan with any UPI App • Official Razorpay Merchant QR" : "High-Speed Wireless Printing • Zero-Resident Security"}
                </div>
              </div>

              {/* QR Code Container */}
              <div
                style={{
                  backgroundColor: "#ffffff",
                  padding: "1.1rem",
                  borderRadius: "1.25rem",
                  border: "2.5px solid #0f172a",
                  boxShadow: "0 6px 16px -2px rgba(0, 0, 0, 0.15)",
                  marginBottom: "1rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {loading ? (
                  <div style={{ width: "290px", height: "290px", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: "0.85rem" }}>
                    Generating Large Standee QR...
                  </div>
                ) : qrPngDataUrl ? (
                  <img
                    src={qrPngDataUrl}
                    alt="Counter Standee Payment QR"
                    style={{
                      width: "290px",
                      height: "290px",
                      maxWidth: "100%",
                      display: "block",
                      objectFit: "contain",
                      imageRendering: "crisp-edges",
                    }}
                  />
                ) : (
                  <div style={{ width: "290px", height: "290px", display: "flex", alignItems: "center", justifyContent: "center", color: "#ef4444", fontSize: "0.85rem" }}>
                    QR Unavailable
                  </div>
                )}
              </div>

              {/* Monospace UPI ID Badge */}
              <div
                style={{
                  backgroundColor: "#f8fafc",
                  border: "1.5px solid #cbd5e1",
                  borderRadius: "0.5rem",
                  padding: "0.35rem 0.85rem",
                  marginBottom: "1rem",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: "0.65rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>
                    {razorpayEnabled ? "Official Merchant Payee VPA" : "Direct Payee UPI ID"}
                  </div>
                  {razorpayEnabled && (
                    <span style={{ fontSize: "0.62rem", color: "#4f46e5", fontWeight: 700, background: "#e0e7ff", padding: "0.1rem 0.4rem", borderRadius: "9999px" }}>
                      Official BharatQR
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.95rem", fontWeight: 800, fontFamily: "monospace", color: "#0f172a", marginTop: "1px" }}>
                  {effectiveUpi}
                </div>
              </div>

              {/* Supported UPI Apps Row */}
              <div
                style={{
                  width: "100%",
                  padding: "0.6rem 0.5rem",
                  backgroundColor: "#f1f5f9",
                  borderRadius: "0.6rem",
                  marginBottom: "1rem",
                }}
              >
                <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                  Accepted Online Payment Apps
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: "0.45rem",
                    flexWrap: "wrap",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                  }}
                >
                  <span style={{ background: "#ffffff", padding: "0.2rem 0.5rem", borderRadius: "4px", border: "1px solid #cbd5e1", color: "#1e293b" }}>
                    Google Pay
                  </span>
                  <span style={{ background: "#5f259f", color: "#ffffff", padding: "0.2rem 0.5rem", borderRadius: "4px" }}>
                    PhonePe
                  </span>
                  <span style={{ background: "#00b9f5", color: "#ffffff", padding: "0.2rem 0.5rem", borderRadius: "4px" }}>
                    Paytm
                  </span>
                  <span style={{ background: "#0078d4", color: "#ffffff", padding: "0.2rem 0.5rem", borderRadius: "4px" }}>
                    BHIM UPI
                  </span>
                  <span style={{ background: "#111827", color: "#ffffff", padding: "0.2rem 0.5rem", borderRadius: "4px" }}>
                    CRED / Any App
                  </span>
                </div>
              </div>

              {/* Simple 3-Step Instructions */}
              <div
                style={{
                  width: "100%",
                  textAlign: "left",
                  fontSize: "0.72rem",
                  color: "#334155",
                  lineHeight: 1.5,
                  padding: "0.5rem 0.25rem",
                  borderTop: "1px solid #e2e8f0",
                }}
              >
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-start", marginBottom: "0.25rem" }}>
                  <span style={{ fontWeight: 800, color: "#4f46e5" }}>1.</span>
                  <span>Scan this QR code using any UPI app or tap <strong>Scan Counter QR</strong> on your mobile web page.</span>
                </div>
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-start", marginBottom: "0.25rem" }}>
                  <span style={{ fontWeight: 800, color: "#4f46e5" }}>2.</span>
                  <span>Enter your exact printing bill amount &amp; complete payment.</span>
                </div>
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-start" }}>
                  <span style={{ fontWeight: 800, color: "#4f46e5" }}>3.</span>
                  <span>Collect your printed documents &amp; verify instant zero-resident file shredding.</span>
                </div>
              </div>

              {/* Footer */}
              <div
                style={{
                  marginTop: "0.85rem",
                  paddingTop: "0.5rem",
                  borderTop: "1.5px dashed #cbd5e1",
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.35rem",
                  fontSize: "0.65rem",
                  color: "#64748b",
                  fontWeight: 600,
                }}
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Powered by PrintDrop &bull; Direct Instant Bank Settlement</span>
              </div>
            </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
