import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { NetworkInterfaceInfo, TunnelInfo } from "../App";
import {
  Building2,
  X,
  Plus,
  Trash2,
  Lock,
  Printer,
  Copy,
  Check,
  Smartphone,
  Laptop,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  Tag,
  Edit3
} from "lucide-react";

export interface CorporateClient {
  id: string;
  name: string;
  staticToken: string;
  billingAccount?: string | null;
  notes?: string | null;
  isActive: boolean;
  registeredDevicesCount: number;
  createdAt: string;
}

export interface CorporateDevice {
  id: string;
  clientId: string;
  clientName: string;
  deviceFingerprint: string;
  personName: string;
  deviceType: string;
  authToken: string;
  isRevoked: boolean;
  lastSeenAt: string;
  createdAt: string;
}

export interface CorporateQrInfo {
  clientId: string;
  clientName: string;
  staticToken: string;
  accessUrl: string;
  qrSvg: string;
  qrDataUrl: string;
}

interface CorporateClientsModalProps {
  isOpen: boolean;
  onClose: () => void;
  interfaces?: NetworkInterfaceInfo[];
  tunnelUrl?: string | null;
}

export const CorporateClientsModal: React.FC<CorporateClientsModalProps> = ({
  isOpen,
  onClose,
  interfaces = [],
  tunnelUrl,
}) => {
  const [clients, setClients] = useState<CorporateClient[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Live real-time network and tunnel state
  const [liveInterfaces, setLiveInterfaces] = useState<NetworkInterfaceInfo[]>(interfaces);
  const [liveTunnelInfo, setLiveTunnelInfo] = useState<TunnelInfo | null>(null);
  const [isStartingTunnel, setIsStartingTunnel] = useState(false);

  // Real-time live network query from OS
  async function refreshRealtimeNetwork(): Promise<{
    activeVpn: NetworkInterfaceInfo | null;
    activeTunnel: string | null;
  }> {
    try {
      const [ifaces, tunnel] = await Promise.all([
        invoke<NetworkInterfaceInfo[]>("list_network_interfaces"),
        invoke<TunnelInfo>("get_public_tunnel_status"),
      ]);
      setLiveInterfaces(ifaces);
      setLiveTunnelInfo(tunnel);

      const vpn = ifaces.find(
        (i) => (i.isVpn || i.name.toLowerCase().includes("tailscale") || i.ip.startsWith("100.")) && !i.ip.startsWith("169.254.")
      ) || null;
      const tUrl = (tunnel?.isActive && tunnel.url) ? tunnel.url : (tunnelUrl || null);

      return { activeVpn: vpn, activeTunnel: tUrl };
    } catch (e) {
      console.warn("Failed to refresh live network:", e);
      const vpn = liveInterfaces.find(
        (i) => (i.isVpn || i.name.toLowerCase().includes("tailscale") || i.ip.startsWith("100.")) && !i.ip.startsWith("169.254.")
      ) || null;
      return { activeVpn: vpn, activeTunnel: tunnelUrl || null };
    }
  }

  // 1-Click Start 4G/5G Tunnel directly inside Modal
  async function handleStartTunnelFromModal() {
    setIsStartingTunnel(true);
    setErrorMsg(null);
    try {
      const started = await invoke<TunnelInfo>("start_public_tunnel");
      setLiveTunnelInfo(started);
      if (started.url && activeClientForQr) {
        const cleanStarted = started.url.split("?")[0].replace(/\/$/, "");
        setSelectedPosterIp(cleanStarted);
        const qr = await invoke<CorporateQrInfo>("get_corporate_qr", {
          clientId: activeClientForQr.id,
          targetIp: cleanStarted,
        });
        setActiveQrInfo(qr);
        setSuccessMsg("Cloudflare 4G/5G Tunnel started! Corporate poster switched to live Internet link.");
      }
    } catch (err: any) {
      setErrorMsg(`Failed to start Cloudflare Tunnel: ${err}`);
    } finally {
      setIsStartingTunnel(false);
    }
  }

  useEffect(() => {
    if (isOpen) {
      refreshRealtimeNetwork();
      loadClients();
    }
  }, [isOpen]);

  // Live Tailscale VPN interface (strictly excludes APIPA 169.254. addresses)
  const activeTailscale = liveInterfaces.find(
    (i) => (i.isVpn || i.name.toLowerCase().includes("tailscale") || i.ip.startsWith("100.")) && !i.ip.startsWith("169.254.")
  );
  
  const cleanOriginUrl = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    return raw.split("?")[0].replace(/\/$/, "");
  };

  const rawTunnelUrl = (liveTunnelInfo?.isActive && liveTunnelInfo.url) || tunnelUrl || null;
  const currentTunnelUrl = cleanOriginUrl(rawTunnelUrl);

  // External corporate connections: strictly ONLY live Tailscale Fixed VPN and/or live Cloudflare Tunnel
  const corporateNetworkOptions: { id: string; label: string; host: string; type: "vpn" | "tunnel" }[] = [];
  if (activeTailscale) {
    corporateNetworkOptions.push({
      id: activeTailscale.ip,
      label: `🔒 Tailscale Fixed VPN (${activeTailscale.ip})`,
      host: activeTailscale.ip,
      type: "vpn",
    });
  }
  if (currentTunnelUrl && currentTunnelUrl.trim().length > 0) {
    corporateNetworkOptions.push({
      id: currentTunnelUrl,
      label: `🌐 Public Internet Link (Cloudflare Tunnel)`,
      host: currentTunnelUrl,
      type: "tunnel",
    });
  }

  // Target host strictly prefers live Tailscale VPN, then live Cloudflare Tunnel, then fallback
  const defaultPosterIp = activeTailscale?.ip || currentTunnelUrl || "100.100.10.51";
  const [selectedPosterIp, setSelectedPosterIp] = useState<string>("");

  useEffect(() => {
    if (defaultPosterIp) {
      setSelectedPosterIp(defaultPosterIp);
    }
  }, [defaultPosterIp]);

  // New Client Form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPin, setNewClientPin] = useState("");
  const [newBillingAccount, setNewBillingAccount] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit Client Form state
  const [editingClient, setEditingClient] = useState<CorporateClient | null>(null);
  const [editName, setEditName] = useState("");
  const [editPin, setEditPin] = useState("");
  const [editBillingAccount, setEditBillingAccount] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  // Devices Submodal state
  const [selectedClientForDevices, setSelectedClientForDevices] = useState<CorporateClient | null>(null);
  const [devices, setDevices] = useState<CorporateDevice[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);

  // Corporate Poster / QR View State
  const [activeQrInfo, setActiveQrInfo] = useState<CorporateQrInfo | null>(null);
  const [activeClientForQr, setActiveClientForQr] = useState<CorporateClient | null>(null);
  const [isCopiedUrl, setIsCopiedUrl] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadClients();
    }
  }, [isOpen]);

  // Handle ESC key to close submodals or parent modal
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (activeQrInfo) {
          setActiveQrInfo(null);
          setActiveClientForQr(null);
        } else if (selectedClientForDevices) {
          setSelectedClientForDevices(null);
        } else if (isOpen) {
          onClose();
        }
      }
    }
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, activeQrInfo, selectedClientForDevices, onClose]);

  async function loadClients() {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const list = await invoke<CorporateClient[]>("list_corporate_clients");
      setClients(list);
    } catch (err: any) {
      setErrorMsg(`Failed to load corporate clients: ${err}`);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateClient(e: React.FormEvent) {
    e.preventDefault();
    if (!newClientName.trim() || !newClientPin.trim()) {
      setErrorMsg("Please enter both Company Name and a 4-to-12 digit Corporate PIN.");
      return;
    }
    if (newClientPin.trim().length < 4) {
      setErrorMsg("PIN must be at least 4 digits.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const created = await invoke<CorporateClient>("create_corporate_client", {
        name: newClientName.trim(),
        pin: newClientPin.trim(),
        billingAccount: newBillingAccount.trim() || null,
        notes: newNotes.trim() || null,
      });

      setSuccessMsg(`Created portal for "${created.name}" successfully!`);
      setTimeout(() => setSuccessMsg(null), 4000);

      // Reset form
      setNewClientName("");
      setNewClientPin("");
      setNewBillingAccount("");
      setNewNotes("");
      setShowAddForm(false);
      await loadClients();

      // Open QR poster for this newly created client
      handleOpenQrPoster(created);
    } catch (err: any) {
      setErrorMsg(`Error creating corporate client: ${err}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleStartEdit(client: CorporateClient) {
    setEditingClient(client);
    setEditName(client.name);
    setEditPin("");
    setEditBillingAccount(client.billingAccount || "");
    setEditNotes(client.notes || "");
    setShowAddForm(false);
    setErrorMsg(null);
    setSuccessMsg(null);
  }

  async function handleUpdateClient(e: React.FormEvent) {
    e.preventDefault();
    if (!editingClient) return;
    if (!editName.trim()) {
      setErrorMsg("Please enter a valid company name.");
      return;
    }
    if (editPin.trim() && editPin.trim().length < 4) {
      setErrorMsg("New PIN must be between 4 and 12 digits (or leave blank to retain existing PIN).");
      return;
    }

    setIsUpdating(true);
    setErrorMsg(null);
    try {
      await invoke("update_corporate_client", {
        clientId: editingClient.id,
        name: editName.trim(),
        pin: editPin.trim() || null,
        billingAccount: editBillingAccount.trim() || null,
        notes: editNotes.trim() || null,
      });

      setSuccessMsg(`Successfully updated corporate profile "${editName.trim()}".`);
      setEditingClient(null);
      await loadClients();
    } catch (err: any) {
      setErrorMsg(`Failed to update corporate profile: ${err}`);
    } finally {
      setIsUpdating(false);
    }
  }

  async function handleToggleStatus(client: CorporateClient) {
    try {
      await invoke("toggle_corporate_client_status", {
        clientId: client.id,
        isActive: !client.isActive,
      });
      await loadClients();
    } catch (err: any) {
      setErrorMsg(`Failed to update status: ${err}`);
    }
  }

  async function handleDeleteClient(client: CorporateClient) {
    if (!window.confirm(`Are you sure you want to delete corporate account "${client.name}"? All employee device bindings will be permanently removed.`)) {
      return;
    }
    try {
      await invoke("delete_corporate_client", { clientId: client.id });
      if (activeClientForQr?.id === client.id) setActiveQrInfo(null);
      if (selectedClientForDevices?.id === client.id) setSelectedClientForDevices(null);
      await loadClients();
    } catch (err: any) {
      setErrorMsg(`Failed to delete client: ${err}`);
    }
  }

  async function handleOpenDevices(client: CorporateClient) {
    setSelectedClientForDevices(client);
    setIsLoadingDevices(true);
    try {
      const devs = await invoke<CorporateDevice[]>("list_corporate_devices", { clientId: client.id });
      setDevices(devs);
    } catch (err: any) {
      setErrorMsg(`Failed to load devices: ${err}`);
    } finally {
      setIsLoadingDevices(false);
    }
  }

  async function handleToggleDeviceRevoke(device: CorporateDevice) {
    try {
      if (device.isRevoked) {
        await invoke("restore_corporate_device", { deviceId: device.id });
      } else {
        await invoke("revoke_corporate_device", { deviceId: device.id });
      }
      if (selectedClientForDevices) {
        const devs = await invoke<CorporateDevice[]>("list_corporate_devices", { clientId: selectedClientForDevices.id });
        setDevices(devs);
      }
      await loadClients();
    } catch (err: any) {
      setErrorMsg(`Failed to toggle device revoke: ${err}`);
    }
  }

  async function handleOpenQrPoster(client: CorporateClient, hostOverride?: string) {
    setActiveClientForQr(client);
    try {
      // 1. Scan real-time network and tunnel state
      const { activeVpn, activeTunnel } = await refreshRealtimeNetwork();

      // 2. Resolve target host dynamically: prefer Tailscale Fixed VPN when active
      let targetHost: string;
      if (hostOverride) {
        targetHost = hostOverride;
      } else if (activeVpn) {
        targetHost = activeVpn.ip;
      } else if (activeTunnel) {
        // VPN is offline -> Auto-fallback to active Cloudflare Tunnel!
        targetHost = activeTunnel;
      } else {
        targetHost = "100.100.10.51";
      }

      setSelectedPosterIp(targetHost);

      const qr = await invoke<CorporateQrInfo>("get_corporate_qr", {
        clientId: client.id,
        targetIp: targetHost,
      });
      setActiveQrInfo(qr);
    } catch (err: any) {
      setErrorMsg(`Failed to generate corporate QR: ${err}`);
    }
  }

  async function handleSelectPosterIp(newIp: string) {
    setSelectedPosterIp(newIp);
    if (activeClientForQr) {
      try {
        const qr = await invoke<CorporateQrInfo>("get_corporate_qr", {
          clientId: activeClientForQr.id,
          targetIp: newIp || null,
        });
        setActiveQrInfo(qr);
      } catch (err: any) {
        setErrorMsg(`Failed to update corporate QR for IP ${newIp}: ${err}`);
      }
    }
  }

  function handleCopyCorporateUrl(url: string) {
    navigator.clipboard.writeText(url);
    setIsCopiedUrl(true);
    setTimeout(() => setIsCopiedUrl(false), 2500);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex justify-center items-start sm:items-center p-3 sm:p-5 z-50 overflow-y-auto print:p-0 print:bg-white print:static print:inset-auto">
      {/* Print-specific style for Corporate Poster Printout */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #corporate-poster-sheet,
          #corporate-poster-sheet * {
            visibility: visible !important;
          }
          #corporate-poster-sheet {
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

      {/* Corporate Poster Modal View (if active) */}
      {activeQrInfo && activeClientForQr ? (
        <div className="relative w-full max-w-2xl bg-slate-900 border border-purple-500/40 rounded-3xl shadow-2xl p-4 sm:p-5 my-auto max-h-[94vh] flex flex-col overflow-hidden">
          {/* Prominent Close Cross Button at Top Right Corner */}
          <button
            type="button"
            onClick={() => { setActiveQrInfo(null); setActiveClientForQr(null); }}
            className="absolute top-3.5 right-3.5 p-2 bg-slate-800/90 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl border border-slate-700/60 shadow-md transition z-20 no-print"
            title="Close Desk Poster (Esc)"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          {/* Header Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3 mb-3 pr-12 sm:pr-14 no-print flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-purple-950/80 text-purple-400 rounded-xl border border-purple-700/50">
                <Printer className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  Permanent Desk Poster: {activeClientForQr.name}
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-purple-300">
                    Fixed QR code with persistent URL
                  </p>
                  {activeTailscale ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-950/90 text-emerald-300 border border-emerald-700/70 rounded-full text-[10px] font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      Tailscale Fixed VPN
                    </span>
                  ) : currentTunnelUrl ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-950/90 text-indigo-300 border border-indigo-700/70 rounded-full text-[10px] font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
                      VPN Offline: Auto-Switched to 4G/5G Tunnel
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-rose-950/90 text-rose-300 border border-rose-700/70 rounded-full text-[10px] font-bold">
                      ⚠️ Tailscale VPN Offline
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Target Network Link Selector */}
              {corporateNetworkOptions.length > 0 ? (
                <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-700/80 rounded-xl px-2.5 py-1 text-xs">
                  <span className="text-slate-400 font-medium">Link:</span>
                  <select
                    value={selectedPosterIp}
                    onChange={(e) => handleSelectPosterIp(e.target.value)}
                    className="bg-transparent text-purple-200 font-mono text-xs focus:outline-none cursor-pointer"
                  >
                    {corporateNetworkOptions.map((opt) => (
                      <option key={opt.id} value={opt.host} className="bg-slate-900 text-white font-mono">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleStartTunnelFromModal}
                  disabled={isStartingTunnel}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition shadow-sm disabled:opacity-50"
                  title="Tailscale is offline. Start 4G/5G Cloudflare Tunnel for corporate fallback"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isStartingTunnel ? 'animate-spin' : ''}`} />
                  <span>{isStartingTunnel ? "Starting Tunnel..." : "🚀 Start 4G/5G Tunnel"}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-md transition"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Poster</span>
              </button>
            </div>
          </div>

          {/* Scrollable Body Container */}
          <div className="flex-1 overflow-y-auto pr-1 space-y-3">
            {/* Printable Sheet */}
            <div
              id="corporate-poster-sheet"
              className="bg-white text-slate-950 rounded-2xl p-4 sm:p-6 flex flex-col items-center text-center shadow-lg border border-slate-200"
            >
              {/* Poster Header */}
              <div className="flex items-center justify-center gap-2 bg-purple-50 border border-purple-200 px-3.5 py-1 rounded-full mb-2">
                <Building2 className="w-3.5 h-3.5 text-purple-700" />
                <span className="text-[11px] font-black uppercase tracking-wider text-purple-900">
                  Official Corporate Print Station
                </span>
              </div>

              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                {activeClientForQr.name}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5 max-w-md">
                Permanent VIP Printing Portal • 365 Days Direct Access
              </p>

              {/* Reduced Square Border QR Box */}
              <div className="my-2.5 sm:my-3 p-2 bg-white rounded-xl border-2 border-purple-400/40 shadow-md">
                <img
                  src={activeQrInfo.qrDataUrl}
                  alt="Corporate Print QR Code"
                  className="w-44 h-44 sm:w-48 sm:h-48 object-contain block mx-auto"
                />
              </div>

              {/* Steps & Guidance */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-lg text-left mt-1">
                <div className="bg-slate-50 border border-slate-200 p-2.5 rounded-xl">
                  <div className="text-[11px] font-black uppercase text-purple-800 flex items-center gap-1.5">
                    <Laptop className="w-3.5 h-3.5 text-purple-600" />
                    <span>Office Desktop / PC</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                    Bookmark the link or drag-and-drop PDFs &amp; spreadsheets directly into Chrome/Edge.
                  </p>
                </div>

                <div className="bg-slate-50 border border-slate-200 p-2.5 rounded-xl">
                  <div className="text-[11px] font-black uppercase text-emerald-800 flex items-center gap-1.5">
                    <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Site / Factory Phone</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                    Scan once to verify device. Then select site photos in Gallery &amp; tap <b>Share &rarr; PrintDrop</b>!
                  </p>
                </div>
              </div>

              {/* Security Assurance */}
              <div className="mt-3 pt-2.5 border-t border-slate-200 w-full flex items-center justify-between text-[11px] text-slate-500 flex-wrap gap-2">
                <span className="flex items-center gap-1 text-slate-700 font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Protected by Corporate PIN</span>
                </span>
                <span className="px-2 py-0.5 bg-purple-50 text-purple-800 border border-purple-200 rounded font-mono font-bold text-[10px]">
                  {activeQrInfo.accessUrl.includes("trycloudflare.com")
                    ? `🌐 Public Internet Link (Cloudflare)`
                    : activeTailscale && activeQrInfo.accessUrl.includes(activeTailscale.ip)
                    ? `🔒 Tailscale Fixed VPN (${activeTailscale.ip})`
                    : activeQrInfo.accessUrl.includes("100.")
                    ? `🔒 Tailscale Fixed VPN (${activeQrInfo.accessUrl.split("//")[1]?.split(":")[0]})`
                    : `Network: ${activeQrInfo.accessUrl.split("//")[1]?.split(":")[0]}`}
                </span>
                <span className="font-mono text-purple-700 font-bold">
                  Token: {activeClientForQr.staticToken}
                </span>
              </div>
            </div>

            {/* Permanent URL Bar */}
            <div className="mt-3 bg-slate-950 border border-slate-800 rounded-xl p-2.5 font-mono text-xs text-purple-300 no-print">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                  activeQrInfo.accessUrl.startsWith("https://")
                    ? "bg-emerald-950 text-emerald-300 border border-emerald-700/60"
                    : "bg-purple-950 text-purple-300 border border-purple-700/60"
                }`}>
                  {activeQrInfo.accessUrl.startsWith("https://") ? "🔒 HTTPS" : "🛡️ VPN (Encrypted)"}
                </span>
                <span className="flex-1 px-1 overflow-hidden text-ellipsis whitespace-nowrap text-purple-200">
                  {activeQrInfo.accessUrl}
                </span>
                <button
                  onClick={() => handleCopyCorporateUrl(activeQrInfo.accessUrl)}
                  className="px-2.5 py-1.5 bg-purple-900/60 hover:bg-purple-800/80 text-purple-200 rounded-lg flex items-center gap-1 text-xs font-semibold transition"
                >
                  {isCopiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{isCopiedUrl ? "Copied" : "Copy Link"}</span>
                </button>
              </div>

              {activeQrInfo.accessUrl.startsWith("http://100.") && (
                <div className="mt-1.5 pt-1.5 border-t border-slate-900 text-[11px] text-slate-400 font-sans flex items-center gap-1.5">
                  <span className="text-indigo-400">🛡️</span>
                  <span>
                    Tailscale VPN connection is hardware-encrypted end-to-end via WireGuard (ChaCha20-Poly1305).
                  </span>
                </div>
              )}
            </div>

            {/* 4G/5G Cloudflare Tunnel Fallback Card for corporate staff */}
            {currentTunnelUrl ? (
              <div className="mt-2.5 p-3 bg-slate-950/80 border border-indigo-900/50 rounded-2xl flex items-center justify-between gap-3 text-xs text-slate-300 no-print">
                <div className="flex items-center gap-2.5">
                  <span className="text-base">🌐</span>
                  <div>
                    <div className="font-bold text-white text-xs">4G/5G Public Internet Fallback Link</div>
                    <div className="text-[11px] text-slate-400">
                      If VPN is offline on any day, corporate users can use this link to upload with zero PIN prompts.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const fallback = `${currentTunnelUrl.replace(/\/$/, '')}/?corp=${activeClientForQr.staticToken}`;
                    navigator.clipboard.writeText(fallback);
                    setIsCopiedUrl(true);
                    setTimeout(() => setIsCopiedUrl(false), 2500);
                  }}
                  className="px-2.5 py-1.5 bg-indigo-950 hover:bg-indigo-900 text-indigo-200 border border-indigo-700/60 rounded-xl font-mono text-[11px] font-semibold transition whitespace-nowrap"
                >
                  Copy Fallback Link
                </button>
              </div>
            ) : (
              <div className="mt-2.5 p-3 bg-slate-950/60 border border-slate-800/80 rounded-2xl flex items-center justify-between gap-3 text-xs text-slate-300 no-print">
                <div className="flex items-center gap-2">
                  <span className="text-amber-400">💡</span>
                  <span className="text-[11px] text-slate-400">
                    Tailscale VPN offline? Start the <b>4G/5G Internet Tunnel</b>. Corporate staff can then upload directly without PIN prompts.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleStartTunnelFromModal}
                  disabled={isStartingTunnel}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition shadow-sm disabled:opacity-50 whitespace-nowrap"
                >
                  {isStartingTunnel ? "Starting..." : "Start 4G/5G Tunnel"}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : selectedClientForDevices ? (
        /* Registered Devices Submodal View */
        <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-indigo-950/80 text-indigo-400 rounded-xl border border-indigo-700/50">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  Registered Devices: {selectedClientForDevices.name}
                </h3>
                <p className="text-xs text-slate-400">
                  Whitelisted employee phones and desktops authorized to submit print jobs
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedClientForDevices(null)}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {isLoadingDevices ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 text-xs">
              <RefreshCw className="w-6 h-6 animate-spin text-purple-400 mb-2" />
              Loading authorized devices...
            </div>
          ) : devices.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs bg-slate-950/60 rounded-2xl border border-slate-800">
              <Smartphone className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="font-semibold text-slate-300">No Devices Bound Yet</p>
              <p className="text-[11px] text-slate-500 mt-1">
                When employees scan the permanent QR code and enter their Corporate PIN, their device will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {devices.map((dev) => (
                <div
                  key={dev.id}
                  className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
                    dev.isRevoked
                      ? "bg-rose-950/20 border-rose-900/50 text-slate-400"
                      : "bg-slate-950/70 border-slate-800 text-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-900 rounded-xl border border-slate-800 text-purple-400">
                      {dev.deviceType === "desktop" ? <Laptop className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-2">
                        <span>{dev.personName}</span>
                        {dev.isRevoked ? (
                          <span className="text-[10px] bg-rose-950 text-rose-300 border border-rose-800 px-2 py-0.5 rounded-full font-bold">
                            Revoked
                          </span>
                        ) : (
                          <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                        {dev.deviceType.toUpperCase()} • Fingerprint: {dev.deviceFingerprint.substring(0, 16)}...
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggleDeviceRevoke(dev)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                      dev.isRevoked
                        ? "bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 border border-emerald-700/60"
                        : "bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800/60"
                    }`}
                  >
                    {dev.isRevoked ? "Restore Device" : "Revoke Access"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Main Corporate Clients Management View */
        <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-2xl text-white shadow-lg shadow-purple-500/20">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  Corporate Accounts &amp; Permanent Portals
                </h2>
                <p className="text-xs text-slate-400">
                  Manage fixed corporate links, dedicated QR posters, and authenticated employee devices
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(!showAddForm)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-md transition"
              >
                <Plus className="w-4 h-4" />
                <span>Add Corporate Client</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Feedback Banners */}
          {errorMsg && (
            <div className="mb-4 p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-rose-200 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="mb-4 p-3 bg-emerald-950/80 border border-emerald-800 rounded-xl text-emerald-200 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Add Corporate Client Drawer */}
          {showAddForm && (
            <form onSubmit={handleCreateClient} className="mb-5 p-4 bg-slate-950/90 border border-purple-500/40 rounded-2xl animate-fade-in">
              <div className="text-xs font-bold uppercase tracking-wider text-purple-300 mb-3 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                <span>Create New Corporate Print Portal</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Company / Firm Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Apex Law Firm or Tata Construction"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-400"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    4-to-12 Digit Corporate PIN *
                  </label>
                  <input
                    type="password"
                    required
                    maxLength={12}
                    placeholder="e.g. 4821"
                    value={newClientPin}
                    onChange={(e) => setNewClientPin(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-center tracking-widest text-white focus:outline-none focus:border-purple-400"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Billing Account / PO Reference (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. ACCT-2026-OCT"
                    value={newBillingAccount}
                    onChange={(e) => setNewBillingAccount(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-400"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Department / Notes (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Site Inspection & Blueprints"
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-400"
                  />
                </div>
              </div>

              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md transition disabled:opacity-50"
                >
                  {isSubmitting ? "Creating..." : "Save Corporate Account"}
                </button>
              </div>
            </form>
          )}

          {/* Edit Corporate Client Drawer */}
          {editingClient && (
            <form onSubmit={handleUpdateClient} className="mb-5 p-4 bg-slate-950/90 border border-indigo-500/50 rounded-2xl animate-fade-in">
              <div className="text-xs font-bold uppercase tracking-wider text-indigo-300 mb-3 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit Corporate Profile: {editingClient.name}</span>
                </span>
                <span className="font-mono text-[10px] text-slate-400">
                  Token: {editingClient.staticToken}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Company / Firm Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-400"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    New PIN (4-12 digits) • <span className="text-slate-400 font-normal">Leave blank to keep existing</span>
                  </label>
                  <input
                    type="password"
                    maxLength={12}
                    placeholder="Enter new PIN or leave blank"
                    value={editPin}
                    onChange={(e) => setEditPin(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-center tracking-widest text-white focus:outline-none focus:border-indigo-400"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Billing Account / PO Reference (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. ACCT-2026-OCT"
                    value={editBillingAccount}
                    onChange={(e) => setEditBillingAccount(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-400"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Department / Notes (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Site Inspection & Blueprints"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-400"
                  />
                </div>
              </div>

              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingClient(null)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="px-4 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-xs font-bold shadow-md transition disabled:opacity-50"
                >
                  {isUpdating ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          )}

          {/* Client List */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {isLoading ? (
              <div className="py-12 flex flex-col items-center justify-center text-slate-400 text-xs">
                <RefreshCw className="w-6 h-6 animate-spin text-purple-400 mb-2" />
                Loading corporate accounts...
              </div>
            ) : clients.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-xs bg-slate-950/60 rounded-3xl border border-slate-800">
                <Building2 className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-300">No Corporate Clients Registered</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Create permanent QR portals for regular businesses, law firms, and factory field inspectors.
                </p>
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  className="mt-4 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md"
                >
                  + Add First Corporate Client
                </button>
              </div>
            ) : (
              clients.map((c) => (
                <div
                  key={c.id}
                  className={`p-4 rounded-2xl border transition ${
                    c.isActive
                      ? "bg-slate-950/70 border-slate-800 hover:border-purple-500/40"
                      : "bg-slate-950/40 border-slate-900 opacity-60"
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-purple-400" />
                          <span>{c.name}</span>
                        </h4>
                        {c.isActive ? (
                          <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded-full font-bold">
                            Active
                          </span>
                        ) : (
                          <span className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded-full font-bold">
                            Paused
                          </span>
                        )}
                        <span className="text-[10px] bg-purple-950 text-purple-300 border border-purple-800 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                          <Lock className="w-2.5 h-2.5" />
                          <span>PIN Protected</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1.5 flex-wrap">
                        <span className="font-mono text-purple-300 font-semibold">
                          Token: {c.staticToken}
                        </span>
                        {c.billingAccount && (
                          <span className="flex items-center gap-1 text-slate-300">
                            <Tag className="w-3 h-3 text-slate-500" />
                            <span>Billing: {c.billingAccount}</span>
                          </span>
                        )}
                        {c.notes && (
                          <span className="text-slate-400">
                            • {c.notes}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                      <button
                        type="button"
                        onClick={() => handleOpenQrPoster(c)}
                        className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-sm transition"
                        title="View and print permanent countertop QR poster"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Desk Poster</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenDevices(c)}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
                        title="View authorized employee devices"
                      >
                        <Smartphone className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Devices ({c.registeredDevicesCount})</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleStartEdit(c)}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-purple-300 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
                        title="Edit Company Name, PIN, or Billing Account"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleStatus(c)}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs transition"
                        title={c.isActive ? "Pause Client Access" : "Activate Client Access"}
                      >
                        {c.isActive ? "Pause" : "Resume"}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteClient(c)}
                        className="p-1.5 bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 rounded-xl transition"
                        title="Delete corporate client"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
