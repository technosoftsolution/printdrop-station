import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  Printer,
  Pause,
  Play,
  Square,
  CheckCircle2,
  XCircle,
  FileText,
  Minimize2,
  Maximize2,
  Zap,
  Sparkles,
  Layers,
  AlertTriangle,
  RotateCcw,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export interface ActiveSpoolingFile {
  orderId: string;
  pickupCode: string;
  customerName: string;
  fileId: string;
  filename: string;
  fileIndex: number;
  totalFilesInOrder: number;
  globalIndex: number;
  totalGlobalFiles: number;
  targetPrinter: string;
  copies: number;
  colorMode: string;
  paperSize: string;
  duplexMode: string;
  stage: "PREPARING" | "SPOOLING" | "PRINTING" | "COMPLETED" | "FAILED";
  stageMessage: string;
  error?: string | null;
  currentPage?: number;
  totalPages?: number;
  spoolerProgressPct?: number;
  pageProgressPct?: number;
  printerFileIndex?: number;
  printerTotalFiles?: number;
}

export interface BatchQueuedFile {
  fileId: string;
  orderId: string;
  pickupCode: string;
  customerName: string;
  filename: string;
  targetPrinter: string;
  copies: number;
  colorMode: string;
  paperSize: string;
  duplexMode: string;
  totalPages: number;
  globalIndex: number;
  totalFiles: number;
  status: "QUEUED" | "PREPARING" | "SPOOLING" | "PRINTING" | "COMPLETED" | "FAILED";
  progressPct: number;
  currentPage: number;
  spoolerProgressPct?: number;
  pageProgressPct?: number;
}

export interface BatchSpoolerState {
  isActive: boolean;
  isPaused: boolean;
  pauseRequested?: boolean;
  isJammed?: boolean;
  isCancelled: boolean;
  pauseReason?: string | null;
  jammedPrinter?: string | null;
  interruptedFileId?: string | null;
  currentOrderId?: string | null;
  currentFile?: ActiveSpoolingFile | null;
  targetPrinter?: string | null;
  totalOrders: number;
  completedOrders: number;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  queuedOrderIds: string[];
  queuedFiles?: BatchQueuedFile[];
  activePrinters?: Record<string, ActiveSpoolingFile>;
}

export interface MultiOrderBatchSummary {
  totalOrders: number;
  completedOrders: number;
  totalFiles: number;
  successfulFiles: number;
  failedFiles: number;
  orderResults: Array<{
    orderId: string;
    printerName: string;
    totalFiles: number;
    successfulFiles: number;
    failedFiles: number;
    jobs: Array<{
      fileId: string;
      filename: string;
      status: string;
      errorMessage?: string | null;
    }>;
  }>;
}

export interface PrinterInfo {
  name: string;
  is_default: boolean;
  status: string;
}

interface PrinterCardState {
  printerName: string;
  currentFile: ActiveSpoolingFile | null;
  filesCompleted: number;
  filesTotal: number;
  spoolerProgressPct: number;
  pageProgressPct: number;
  currentPage: number;
  totalPages: number;
  stage: "IDLE" | "PREPARING" | "SPOOLING" | "PRINTING" | "COMPLETED" | "FAILED";
  stageMessage: string;
  isJammed: boolean;
  isPaused: boolean;
  pauseReason?: string | null;
  error?: string | null;
  completedCount: number;
  failedCount: number;
}

interface LivePrintSpoolerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBatchComplete?: () => void;
}

function getPrinterTheme(printerName: string) {
  const lower = printerName.toLowerCase();
  if (lower.includes("color") || lower.includes("tank") || lower.includes("l805") || lower.includes("photo")) {
    return {
      badge: "bg-purple-500/15 text-purple-300 border-purple-500/40",
      border: "border-purple-500/40",
      accent: "text-purple-400",
      bgGlow: "bg-purple-500/10",
      text: "text-purple-300",
      barGradient: "from-purple-600 via-indigo-500 to-pink-500",
      ringColor: "#c084fc", // purple-400
      nameTag: "🌈 Color Tank",
    };
  } else if (lower.includes("plotter") || lower.includes("prograf") || lower.includes("canon")) {
    return {
      badge: "bg-amber-500/15 text-amber-300 border-amber-500/40",
      border: "border-amber-500/40",
      accent: "text-amber-400",
      bgGlow: "bg-amber-500/10",
      text: "text-amber-300",
      barGradient: "from-amber-600 via-orange-500 to-yellow-500",
      ringColor: "#fbbf24", // amber-400
      nameTag: "📐 Roll Plotter",
    };
  } else if (lower.includes("brother") || lower.includes("backup")) {
    return {
      badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
      border: "border-emerald-500/40",
      accent: "text-emerald-400",
      bgGlow: "bg-emerald-500/10",
      text: "text-emerald-300",
      barGradient: "from-emerald-600 via-teal-500 to-green-500",
      ringColor: "#34d399", // emerald-400
      nameTag: "🖨️ Backup B&W",
    };
  } else {
    // Default Laser B&W (HP LaserJet)
    return {
      badge: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40",
      border: "border-cyan-500/40",
      accent: "text-cyan-400",
      bgGlow: "bg-cyan-500/10",
      text: "text-cyan-300",
      barGradient: "from-cyan-600 via-blue-500 to-indigo-500",
      ringColor: "#22d3ee", // cyan-400
      nameTag: "⚡ Laser B&W",
    };
  }
}

const CircularProgressGauge: React.FC<{
  progress: number;
  size?: number;
  strokeWidth?: number;
  ringColor?: string;
  title: string;
  subtitle: string;
  centerText: React.ReactNode;
}> = ({
  progress,
  size = 94,
  strokeWidth = 7,
  ringColor = "#22d3ee",
  title,
  subtitle,
  centerText,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, progress));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="w-full h-full transform -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#1e293b"
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={ringColor}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.4s ease-out" }}
            fill="transparent"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-1">
          {centerText}
        </div>
      </div>
      <div className="text-[11px] font-bold text-slate-200 mt-1.5 text-center">{title}</div>
      <div className="text-[10px] text-slate-400 font-mono text-center">{subtitle}</div>
    </div>
  );
};

export const LivePrintSpoolerModal: React.FC<LivePrintSpoolerModalProps> = ({
  isOpen,
  onClose,
  onBatchComplete,
}) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [spoolerState, setSpoolerState] = useState<BatchSpoolerState | null>(null);
  const [currentFile, setCurrentFile] = useState<ActiveSpoolingFile | null>(null);
  const [completedList, setCompletedList] = useState<ActiveSpoolingFile[]>([]);
  const [batchSummary, setBatchSummary] = useState<MultiOrderBatchSummary | null>(null);
  const [isProcessingControl, setIsProcessingControl] = useState(false);

  // Multi-printer live state map for simultaneous parallel visualization
  const [printersMap, setPrintersMap] = useState<Record<string, PrinterCardState>>({});

  // Hardware reroute & recovery state
  const [availablePrinters, setAvailablePrinters] = useState<PrinterInfo[]>([]);
  const [isRerouteOpen, setIsRerouteOpen] = useState(false);
  const [selectedNewPrinter, setSelectedNewPrinter] = useState<string>("");
  const [autoMigrateRemaining, setAutoMigrateRemaining] = useState<boolean>(true);
  const [resumeMode, setResumeMode] = useState<"full" | "custom">("custom");
  const [customPageRange, setCustomPageRange] = useState<string>("");
  const [reroutedPrinters, setReroutedPrinters] = useState<string[]>([]);
  const [rerouteSubmitting, setRerouteSubmitting] = useState(false);
  const [rerouteSuccessMsg, setRerouteSuccessMsg] = useState<string | null>(null);
  const [isGracefulPending, setIsGracefulPending] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [activeCarouselIdx, setActiveCarouselIdx] = useState(0);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const onDesktopCarouselScroll = () => {
    const track = scrollContainerRef.current;
    if (!track) return;
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const sLeft = track.scrollLeft;
    setCanScrollLeft(sLeft > 12);
    setCanScrollRight(maxScroll - sLeft > 12);

    const firstCard = track.firstElementChild as HTMLElement | null;
    const cardStride = Math.max(1, (firstCard?.offsetWidth || 380) + 16);
    const idx = Math.max(0, Math.round(sLeft / cardStride));
    setActiveCarouselIdx(idx);
  };

  const scrollToPrinterIndex = (index: number) => {
    const track = scrollContainerRef.current;
    if (!track) return;
    const targetEl = document.getElementById(`desktop-printer-slide-${index}`);
    if (targetEl) {
      track.scrollTo({ left: targetEl.offsetLeft, behavior: "smooth" });
      setActiveCarouselIdx(index);
    } else {
      track.scrollTo({ left: index * 396, behavior: "smooth" });
      setActiveCarouselIdx(index);
    }
  };

  const scrollLeft = () => {
    const track = scrollContainerRef.current;
    if (!track) return;
    const firstCard = track.firstElementChild as HTMLElement | null;
    const stride = (firstCard?.offsetWidth || 380) + 16;
    track.scrollBy({ left: -stride, behavior: "smooth" });
  };

  const scrollRight = () => {
    const track = scrollContainerRef.current;
    if (!track) return;
    const firstCard = track.firstElementChild as HTMLElement | null;
    const stride = (firstCard?.offsetWidth || 380) + 16;
    track.scrollBy({ left: stride, behavior: "smooth" });
  };

  useEffect(() => {
    let unlistenProgress: UnlistenFn | null = null;
    let unlistenState: UnlistenFn | null = null;
    let unlistenFinished: UnlistenFn | null = null;
    let unlistenError: UnlistenFn | null = null;

    async function setupListeners() {
      // 1. Progress updates emitted per tick across all concurrent printer threads
      unlistenProgress = await listen<ActiveSpoolingFile>("print://job-progress", (event) => {
        const file = event.payload;
        setCurrentFile(file);

        // Keep spoolerState.queuedFiles synchronized on every tick so per-file status transitions immediately
        setSpoolerState((prevState) => {
          if (!prevState) return prevState;
          const updatedQueued = (prevState.queuedFiles || []).map((qf) => {
            if (qf.fileId === file.fileId) {
              return {
                ...qf,
                targetPrinter: file.targetPrinter || qf.targetPrinter,
                status: (file.stage === "PREPARING" || file.stage === "SPOOLING" || file.stage === "PRINTING" || file.stage === "COMPLETED" || file.stage === "FAILED")
                  ? file.stage
                  : qf.status,
                currentPage: file.currentPage ?? qf.currentPage,
                totalPages: file.totalPages ?? qf.totalPages,
                spoolerProgressPct: file.spoolerProgressPct ?? (file.stage === "PRINTING" || file.stage === "COMPLETED" ? 100 : qf.spoolerProgressPct),
                pageProgressPct: file.pageProgressPct ?? (file.stage === "COMPLETED" ? 100 : qf.pageProgressPct),
                progressPct: file.stage === "COMPLETED"
                  ? 100
                  : file.stage === "PRINTING"
                  ? (file.pageProgressPct ?? qf.progressPct)
                  : (file.spoolerProgressPct ?? qf.progressPct),
              };
            }
            return qf;
          });
          return {
            ...prevState,
            queuedFiles: updatedQueued,
            activePrinters: {
              ...(prevState.activePrinters || {}),
              [file.targetPrinter || "Default Printer"]: file,
            },
          };
        });

        // Update multi-printer state map
        const pName = file.targetPrinter || "Default Printer";
        setPrintersMap((prev) => {
          const prevCard = prev[pName];
          const isDone = file.stage === "COMPLETED";
          const isFail = file.stage === "FAILED";

          const filesTotal = file.printerTotalFiles || prevCard?.filesTotal || 1;
          const currentIdx = file.printerFileIndex || prevCard?.filesCompleted || 1;
          const filesCompleted = isDone ? Math.max(prevCard?.filesCompleted || 0, currentIdx) : (prevCard?.filesCompleted || 0);

          return {
            ...prev,
            [pName]: {
              printerName: pName,
              currentFile: file,
              filesCompleted,
              filesTotal,
              spoolerProgressPct: file.spoolerProgressPct ?? (isDone || file.stage === "PRINTING" ? 100 : 0),
              pageProgressPct: file.pageProgressPct ?? (isDone ? 100 : 0),
              currentPage: file.currentPage || 1,
              totalPages: file.totalPages || 1,
              stage: file.stage,
              stageMessage: file.stageMessage,
              isJammed: (isFail && (file.error?.toLowerCase().includes("jam") ?? false)) || Boolean(prevCard?.isJammed),
              isPaused: Boolean(prevCard?.isPaused),
              pauseReason: prevCard?.pauseReason || null,
              error: file.error,
              completedCount: (prevCard?.completedCount || 0) + (isDone ? 1 : 0),
              failedCount: (prevCard?.failedCount || 0) + (isFail ? 1 : 0),
            },
          };
        });

        if (file.stage === "COMPLETED" || file.stage === "FAILED") {
          setCompletedList((prev) => {
            const exists = prev.some((p) => p.fileId === file.fileId && p.orderId === file.orderId);
            if (exists) {
              return prev.map((p) =>
                p.fileId === file.fileId && p.orderId === file.orderId ? file : p
              );
            }
            return [file, ...prev];
          });
        }
      });

      // 2. Spooler state updates (syncs all active printer stations simultaneously)
      unlistenState = await listen<BatchSpoolerState>("print://spooler-state", (event) => {
        const state = event.payload;
        setSpoolerState(state);

        setPrintersMap((prev) => {
          const next = { ...prev };
          const printerNames = new Set<string>();
          for (const qf of state.queuedFiles || []) {
            if (qf.targetPrinter) printerNames.add(qf.targetPrinter);
          }
          if (state.activePrinters) {
            for (const p of Object.keys(state.activePrinters)) {
              if (p) printerNames.add(p);
            }
          }
          if (state.targetPrinter) {
            printerNames.add(state.targetPrinter);
          }

          for (const pName of printerNames) {
            const existing = next[pName];
            const activeForP =
              state.activePrinters?.[pName] ||
              (state.currentFile?.targetPrinter === pName ? state.currentFile : null) ||
              existing?.currentFile ||
              null;

            const assigned = (state.queuedFiles || []).filter((qf) => qf.targetPrinter === pName);
            const doneInAssigned = assigned.filter((qf) => qf.status === "COMPLETED").length;
            const totalInAssigned = assigned.length || activeForP?.printerTotalFiles || existing?.filesTotal || 1;
            const isThisPrinterJammed = Boolean(
              state.isJammed &&
                (!state.jammedPrinter ||
                  state.jammedPrinter === pName ||
                  pName.includes(state.jammedPrinter) ||
                  state.jammedPrinter.includes(pName))
            );

            next[pName] = {
              printerName: pName,
              currentFile: activeForP,
              filesCompleted: assigned.length > 0 ? doneInAssigned : (existing?.filesCompleted || 0),
              filesTotal: totalInAssigned,
              spoolerProgressPct: activeForP?.spoolerProgressPct ?? existing?.spoolerProgressPct ?? 0,
              pageProgressPct: activeForP?.pageProgressPct ?? existing?.pageProgressPct ?? 0,
              currentPage: activeForP?.currentPage || existing?.currentPage || 1,
              totalPages: activeForP?.totalPages || existing?.totalPages || 1,
              stage: (isThisPrinterJammed
                ? "FAILED"
                : (activeForP?.stage as any) || existing?.stage || "PREPARING") as
                | "IDLE"
                | "PREPARING"
                | "SPOOLING"
                | "PRINTING"
                | "COMPLETED"
                | "FAILED",
              stageMessage: activeForP?.stageMessage || existing?.stageMessage || `Preparing queue on ${pName}...`,
              isJammed: isThisPrinterJammed,
              isPaused: Boolean(state.isPaused),
              pauseReason: state.pauseReason || null,
              error: isThisPrinterJammed ? "Simulated Paper Jam" : (activeForP?.error || existing?.error || null),
              completedCount: doneInAssigned,
              failedCount: assigned.filter((qf) => qf.status === "FAILED").length,
            };
          }
          return next;
        });
      });

      // 3. Finished event
      unlistenFinished = await listen<MultiOrderBatchSummary>("print://batch-finished", (event) => {
        setBatchSummary(event.payload);
        if (onBatchComplete) {
          onBatchComplete();
        }
      });

      // 4. Batch error
      unlistenError = await listen<{ error: string }>("print://batch-error", (event) => {
        console.error("Batch error event:", event.payload);
      });
    }

    if (isOpen) {
      setupListeners();
      invoke<BatchSpoolerState>("get_spooler_state")
        .then((state) => {
          setSpoolerState(state);
          if (state.currentFile) {
            setCurrentFile(state.currentFile);
          }
          const initialMap: Record<string, PrinterCardState> = {};
          const printerNames = new Set<string>();
          for (const qf of state.queuedFiles || []) {
            if (qf.targetPrinter) printerNames.add(qf.targetPrinter);
          }
          if (state.activePrinters) {
            for (const p of Object.keys(state.activePrinters)) {
              if (p) printerNames.add(p);
            }
          }
          if (state.currentFile?.targetPrinter) {
            printerNames.add(state.currentFile.targetPrinter);
          }

          for (const pName of printerNames) {
            const activeForP =
              state.activePrinters?.[pName] ||
              (state.currentFile?.targetPrinter === pName ? state.currentFile : null);
            const assigned = (state.queuedFiles || []).filter((qf) => qf.targetPrinter === pName);
            const firstQf = assigned[0];
            const fallbackFile: ActiveSpoolingFile | null =
              activeForP ||
              (firstQf
                ? {
                    orderId: firstQf.orderId,
                    pickupCode: firstQf.pickupCode,
                    customerName: firstQf.customerName,
                    fileId: firstQf.fileId,
                    filename: firstQf.filename,
                    fileIndex: 1,
                    totalFilesInOrder: assigned.length,
                    globalIndex: firstQf.globalIndex,
                    totalGlobalFiles: firstQf.totalFiles,
                    targetPrinter: pName,
                    copies: firstQf.copies,
                    colorMode: firstQf.colorMode,
                    paperSize: firstQf.paperSize,
                    duplexMode: firstQf.duplexMode,
                    stage: (firstQf.status === "QUEUED" ? "PREPARING" : firstQf.status) as any,
                    stageMessage: `Preparing document on '${pName}'...`,
                    currentPage: Math.max(1, firstQf.currentPage || 1),
                    totalPages: Math.max(1, firstQf.totalPages || 1),
                    spoolerProgressPct: firstQf.spoolerProgressPct || 0,
                    pageProgressPct: firstQf.pageProgressPct || 0,
                    printerFileIndex: 1,
                    printerTotalFiles: assigned.length,
                  }
                : null);

            const doneInAssigned = assigned.filter((qf) => qf.status === "COMPLETED").length;
            initialMap[pName] = {
              printerName: pName,
              currentFile: fallbackFile,
              filesCompleted: doneInAssigned,
              filesTotal: Math.max(1, assigned.length || fallbackFile?.printerTotalFiles || 1),
              spoolerProgressPct: fallbackFile?.spoolerProgressPct || 0,
              pageProgressPct: fallbackFile?.pageProgressPct || 0,
              currentPage: fallbackFile?.currentPage || 1,
              totalPages: fallbackFile?.totalPages || 1,
              stage: (fallbackFile?.stage as any) || "PREPARING",
              stageMessage: fallbackFile?.stageMessage || `Preparing queue on '${pName}'...`,
              isJammed: Boolean(state.isJammed && (!state.jammedPrinter || state.jammedPrinter === pName)),
              isPaused: Boolean(state.isPaused),
              pauseReason: state.pauseReason || null,
              error: fallbackFile?.error || null,
              completedCount: doneInAssigned,
              failedCount: assigned.filter((qf) => qf.status === "FAILED").length,
            };
          }

          if (Object.keys(initialMap).length > 0) {
            setPrintersMap(initialMap);
          }
        })
        .catch(console.error);

      invoke<PrinterInfo[]>("get_available_printers")
        .then((printers) => {
          setAvailablePrinters(printers);
          if (printers.length > 0 && !selectedNewPrinter) {
            setSelectedNewPrinter(printers[0].name);
          }
        })
        .catch(console.error);
    }

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenState) unlistenState();
      if (unlistenFinished) unlistenFinished();
      if (unlistenError) unlistenError();
    };
  }, [isOpen, onBatchComplete]);

  // Initial state reset when modal opens fresh
  useEffect(() => {
    if (isOpen) {
      setBatchSummary(null);
      setIsMinimized(false);
      setIsRerouteOpen(false);
      setRerouteSuccessMsg(null);
      setReroutedPrinters([]);
      setPrintersMap({});
      setCompletedList([]);
      setCurrentFile(null);
    }
  }, [isOpen]);

  // Automatically expand rerouting assistant if a paper jam or hardware fault occurs
  useEffect(() => {
    if (spoolerState?.isJammed) {
      setIsRerouteOpen(true);
      const faulty = spoolerState.jammedPrinter || currentFile?.targetPrinter || "";
      const alt = availablePrinters.find((p) => p.name !== faulty);
      if (alt) {
        setSelectedNewPrinter(alt.name);
      }
      const card = faulty ? printersMap[faulty] : null;
      const cur = card?.currentPage || currentFile?.currentPage || 1;
      const tot = card?.totalPages || currentFile?.totalPages || 1;
      const remaining = cur < tot ? `${cur}-${tot}` : `${cur}`;
      setResumeMode("custom");
      setCustomPageRange(remaining);
    }
  }, [spoolerState?.isJammed, spoolerState?.jammedPrinter, currentFile?.targetPrinter, availablePrinters]);

  async function handleTogglePause() {
    setIsProcessingControl(true);
    try {
      if (spoolerState?.isPaused) {
        setIsGracefulPending(false);
        await invoke("resume_print_spooler");
      } else {
        await invoke("pause_print_spooler");
      }
      const updated = await invoke<BatchSpoolerState>("get_spooler_state");
      setSpoolerState(updated);
    } catch (err) {
      console.error("Pause/resume failed:", err);
    } finally {
      setIsProcessingControl(false);
    }
  }

  async function handleGracefulPause(reason = "CARTRIDGE_RELOAD") {
    setIsProcessingControl(true);
    setIsGracefulPending(true);
    try {
      await invoke("pause_print_spooler_graceful", { reason });
      const updated = await invoke<BatchSpoolerState>("get_spooler_state");
      setSpoolerState(updated);
    } catch (err) {
      console.error("Graceful pause failed:", err);
      setIsGracefulPending(false);
    } finally {
      setIsProcessingControl(false);
    }
  }

  async function handleEmergencyJam(printerName?: string) {
    setIsProcessingControl(true);
    try {
      const printer = printerName || spoolerState?.targetPrinter || currentFile?.targetPrinter || null;
      await invoke("emergency_jam_pause", { printerName: printer });
      const updated = await invoke<BatchSpoolerState>("get_spooler_state");
      setSpoolerState(updated);
      setIsRerouteOpen(true);

      const card = printer ? printersMap[printer] : null;
      const cur = card?.currentPage || currentFile?.currentPage || 1;
      const tot = card?.totalPages || currentFile?.totalPages || 1;
      const remaining = cur < tot ? `${cur}-${tot}` : `${cur}`;
      setResumeMode("custom");
      setCustomPageRange(remaining);

      if (printer) {
        const alt = availablePrinters.find((p) => p.name !== printer);
        if (alt) {
          setSelectedNewPrinter(alt.name);
        }
      }
    } catch (err) {
      console.error("Emergency jam pause failed:", err);
    } finally {
      setIsProcessingControl(false);
    }
  }

  async function handleCancel() {
    if (!window.confirm("Are you sure you want to stop the remaining print jobs in the queue?")) {
      return;
    }
    setIsProcessingControl(true);
    try {
      await invoke("cancel_print_spooler");
      const updated = await invoke<BatchSpoolerState>("get_spooler_state");
      setSpoolerState(updated);
    } catch (err) {
      console.error("Cancel failed:", err);
    } finally {
      setIsProcessingControl(false);
    }
  }

  async function handleApplyReroute() {
    if (!selectedNewPrinter) return;
    const fromPrinter = spoolerState?.jammedPrinter || currentFile?.targetPrinter || "";
    const interruptedId = spoolerState?.interruptedFileId || currentFile?.fileId || null;

    setRerouteSubmitting(true);
    setRerouteSuccessMsg(null);
    try {
      const res = await invoke<number>("reroute_printer_queue", {
        req: {
          fromPrinter,
          toPrinter: selectedNewPrinter,
          interruptedFileId: interruptedId,
          resumePageRange: resumeMode === "custom" && customPageRange.trim() ? customPageRange.trim() : null,
          migrateRemaining: autoMigrateRemaining,
        },
      });

      // Hide and exclude the faulty printer from UI display so only the new printer card is shown
      setReroutedPrinters((prev) => [...prev, fromPrinter]);
      setPrintersMap((prev) => {
        const next = { ...prev };
        delete next[fromPrinter];
        return next;
      });

      setRerouteSuccessMsg(`Successfully rerouted ${res} job(s) from "${fromPrinter}" to "${selectedNewPrinter}". Resuming print engine...`);
      setTimeout(() => {
        setIsRerouteOpen(false);
        setRerouteSuccessMsg(null);
      }, 2500);

      const updated = await invoke<BatchSpoolerState>("get_spooler_state");
      setSpoolerState(updated);
    } catch (err) {
      console.error("Reroute failed:", err);
      alert(`Rerouting failed: ${err}`);
    } finally {
      setRerouteSubmitting(false);
    }
  }

  if (!isOpen) return null;

  // Discover all distinct active/queued printers in deterministic order (supports 1..N printers simultaneously)
  const discoveredPrinterNames: string[] = [];
  for (const qf of spoolerState?.queuedFiles || []) {
    if (qf.targetPrinter && !reroutedPrinters.includes(qf.targetPrinter) && !discoveredPrinterNames.includes(qf.targetPrinter)) {
      discoveredPrinterNames.push(qf.targetPrinter);
    }
  }
  for (const pName of Object.keys(printersMap)) {
    if (pName && !reroutedPrinters.includes(pName) && !discoveredPrinterNames.includes(pName)) {
      discoveredPrinterNames.push(pName);
    }
  }
  if (spoolerState?.activePrinters) {
    for (const pName of Object.keys(spoolerState.activePrinters)) {
      if (pName && !reroutedPrinters.includes(pName) && !discoveredPrinterNames.includes(pName)) {
        discoveredPrinterNames.push(pName);
      }
    }
  }

  const activePrintersList: PrinterCardState[] = discoveredPrinterNames.map((pName) => {
    if (printersMap[pName]) {
      return printersMap[pName];
    }
    const activeForP = spoolerState?.activePrinters?.[pName] || null;
    const assigned = (spoolerState?.queuedFiles || []).filter((qf) => qf.targetPrinter === pName);
    const doneCount = assigned.filter((qf) => qf.status === "COMPLETED").length;
    return {
      printerName: pName,
      currentFile: activeForP,
      filesCompleted: doneCount,
      filesTotal: Math.max(1, assigned.length),
      spoolerProgressPct: activeForP?.spoolerProgressPct ?? (doneCount === assigned.length && assigned.length > 0 ? 100 : 0),
      pageProgressPct: activeForP?.pageProgressPct ?? (doneCount === assigned.length && assigned.length > 0 ? 100 : 0),
      currentPage: activeForP?.currentPage || 1,
      totalPages: activeForP?.totalPages || assigned[0]?.totalPages || 1,
      stage: (doneCount === assigned.length && assigned.length > 0
        ? "COMPLETED"
        : (activeForP?.stage as any) || (assigned[0]?.status as any) || "PREPARING"),
      stageMessage: activeForP?.stageMessage || `Preparing queue on ${pName}...`,
      isJammed: Boolean(spoolerState?.isJammed && spoolerState?.jammedPrinter === pName),
      isPaused: Boolean(spoolerState?.isPaused),
      pauseReason: spoolerState?.pauseReason || null,
      error: activeForP?.error || null,
      completedCount: doneCount,
      failedCount: assigned.filter((qf) => qf.status === "FAILED").length,
    };
  });

  // Fallback card if empty
  const displayPrinters: PrinterCardState[] = activePrintersList.length > 0
    ? activePrintersList
    : [
        {
          printerName: currentFile?.targetPrinter || spoolerState?.targetPrinter || "Default Station Printer",
          currentFile: currentFile,
          filesCompleted: spoolerState?.completedFiles || 0,
          filesTotal: spoolerState?.totalFiles || 1,
          spoolerProgressPct: currentFile?.spoolerProgressPct ?? 0,
          pageProgressPct: currentFile?.pageProgressPct ?? 0,
          currentPage: currentFile?.currentPage || 1,
          totalPages: currentFile?.totalPages || 1,
          stage: currentFile?.stage || "IDLE",
          stageMessage: currentFile?.stageMessage || "Ready in station queue...",
          isJammed: spoolerState?.isJammed ?? false,
          isPaused: spoolerState?.isPaused ?? false,
          pauseReason: spoolerState?.pauseReason,
          error: currentFile?.error,
          completedCount: 0,
          failedCount: 0,
        },
      ];

  const totalFiles = spoolerState?.totalFiles || 1;
  const completedFiles = spoolerState?.completedFiles || 0;
  const percentComplete = Math.min(100, Math.round((completedFiles / totalFiles) * 100));

  // Minimized Floating Widget Mode
  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50 animate-bounce-subtle">
        <div className="bg-slate-900/95 border-2 border-cyan-500/80 rounded-2xl p-4 shadow-2xl backdrop-blur-md max-w-sm w-80 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <Printer className="w-4 h-4 animate-pulse" />
                </div>
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-900 animate-ping"></span>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                  Spooling {percentComplete}%
                  {spoolerState?.isPaused && (
                    <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.2 rounded font-mono">
                      {spoolerState.isJammed ? "JAMMED" : "PAUSED"}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 truncate max-w-[170px]">
                  {currentFile ? currentFile.filename : "Queue processing..."}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsMinimized(false)}
                className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition"
                title="Expand Monitor"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 transition-all duration-300"
              style={{ width: `${percentComplete}%` }}
            ></div>
          </div>
        </div>
      </div>
    );
  }

  // Full Screen Hybrid Modal Mode
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-7xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh]">
        {/* Top Header Banner */}
        <div className="px-5 sm:px-6 py-3.5 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-500/20 via-indigo-500/20 to-purple-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-inner">
                <Printer className="w-5 h-5 animate-pulse" />
              </div>
              {!batchSummary && spoolerState?.isActive && !spoolerState?.isPaused && (
                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-slate-900 animate-ping"></span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-black text-slate-100 tracking-tight">
                  Multi-Printer Command Station
                </h2>
                {batchSummary ? (
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono">
                    COMPLETED
                  </span>
                ) : spoolerState?.isJammed ? (
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-mono flex items-center gap-1 animate-pulse">
                    <AlertTriangle className="w-3 h-3 text-rose-400" />
                    PAPER JAM / FAULT
                  </span>
                ) : spoolerState?.isPaused ? (
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 font-mono">
                    PAUSED ({spoolerState.pauseReason || "MANUAL"})
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 font-mono flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>
                    CONCURRENT PRINTING LIVE
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span>Parallel Multi-Printer Execution</span>
                <span>•</span>
                <span>Paced Hardware Simulation (5s Spool + 20s/Page)</span>
                <span>•</span>
                <span className="text-cyan-400 font-mono text-[10px] bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/30">
                  {displayPrinters.length} Active Printer {displayPrinters.length === 1 ? "Line" : "Lines"}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!batchSummary && (
              <button
                onClick={() => setIsMinimized(true)}
                className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-xl transition"
                title="Minimize to Floating Dock"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              disabled={spoolerState?.isActive && !batchSummary}
              className={`p-2 rounded-xl transition ${
                spoolerState?.isActive && !batchSummary
                  ? "text-slate-600 cursor-not-allowed"
                  : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              }`}
              title={spoolerState?.isActive && !batchSummary ? "Queue is actively printing" : "Close"}
            >
              <Square className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Master Progress Bar & Hardware Ribbon */}
        <div className="px-5 sm:px-6 py-2.5 bg-slate-950/70 border-b border-slate-800/80 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-3 font-mono">
              <span className="text-slate-300 font-bold">
                Batch Progress: {completedFiles} / {totalFiles} Documents Spooled
              </span>
              <span className="text-slate-500 hidden sm:inline">•</span>
              <span className="text-cyan-400 font-semibold hidden sm:inline">
                {spoolerState?.completedOrders || 0} of {spoolerState?.totalOrders || 1} Orders Completed
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-slate-200">
                {percentComplete}% Overall
              </span>
              {/* Horizontal Scroll Navigation chevrons if multiple printers exist */}
              {displayPrinters.length > 2 && (
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={scrollLeft}
                    className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                    title="Scroll Left"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={scrollRight}
                    className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                    title="Scroll Right"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="w-full bg-slate-800/80 h-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 transition-all duration-300"
              style={{ width: `${percentComplete}%` }}
            ></div>
          </div>
        </div>

        {/* Main Content Area (Vertically Scrollable modal body) */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1 min-h-0 bg-slate-950/30">
          {/* Hardware Rerouting Drawer */}
          {isRerouteOpen && (
            <div className="rounded-2xl p-5 bg-slate-900 border-2 border-cyan-500 shadow-2xl animate-slideDown space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                    <RotateCcw className="w-4 h-4 animate-spin-slow" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">
                      Hardware Fault Tolerance &amp; Reroute Engine
                    </h3>
                    <p className="text-xs text-slate-400">
                      Select alternative working printer to divert interrupted and remaining queue
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsRerouteOpen(false)}
                  className="text-slate-400 hover:text-slate-200 text-sm font-mono p-1"
                >
                  ✕
                </button>
              </div>

              {rerouteSuccessMsg ? (
                <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500 text-emerald-200 text-xs flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  <span>{rerouteSuccessMsg}</span>
                </div>
              ) : (
                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-400 mb-1.5 font-semibold">From Faulty/Jammed Printer:</label>
                      <input
                        type="text"
                        disabled
                        value={spoolerState?.jammedPrinter || currentFile?.targetPrinter || "Current Hardware"}
                        className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-mono text-xs cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 mb-1.5 font-semibold">Switch &amp; Reroute to Working Printer:</label>
                      <select
                        value={selectedNewPrinter}
                        onChange={(e) => setSelectedNewPrinter(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-cyan-500/50 text-slate-100 font-semibold text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                      >
                        {availablePrinters.map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.name} {p.name.includes("Virtual") ? "[Simulated]" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800 space-y-2">
                    <span className="text-slate-400 font-semibold block">Interrupted Document Recovery:</span>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                        <input
                          type="radio"
                          name="resumeMode"
                          value="full"
                          checked={resumeMode === "full"}
                          onChange={() => setResumeMode("full")}
                          className="text-cyan-500"
                        />
                        <span>Restart file from Page 1</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                        <input
                          type="radio"
                          name="resumeMode"
                          value="custom"
                          checked={resumeMode === "custom"}
                          onChange={() => setResumeMode("custom")}
                          className="text-cyan-500"
                        />
                        <span>Resume remaining pages only</span>
                      </label>
                    </div>
                    {resumeMode === "custom" && (
                      <div className="pt-1 flex items-center gap-2">
                        <span className="text-slate-400 text-xs">Custom Range:</span>
                        <input
                          type="text"
                          value={customPageRange}
                          onChange={(e) => setCustomPageRange(e.target.value)}
                          placeholder="e.g. 3-6 or 3,4,5"
                          className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono text-xs w-40"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                    <label className="flex items-center gap-2 cursor-pointer text-slate-300 select-none">
                      <input
                        type="checkbox"
                        checked={autoMigrateRemaining}
                        onChange={(e) => setAutoMigrateRemaining(e.target.checked)}
                        className="rounded border-slate-700 text-cyan-600 focus:ring-cyan-500"
                      />
                      <span>Auto-migrate all upcoming pending documents assigned to faulty printer</span>
                    </label>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsRerouteOpen(false)}
                        className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
                      >
                        Dismiss
                      </button>
                      <button
                        onClick={handleApplyReroute}
                        disabled={rerouteSubmitting || !selectedNewPrinter}
                        className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-cyan-600 via-indigo-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white font-bold flex items-center gap-1.5 shadow-lg shadow-cyan-900/30 transition disabled:opacity-50"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                        Apply Reroute Now
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* HYBRID MULTI-COLUMN CONCURRENT PRINTER CARDS DECK (CAROUSEL)   */}
          {/* ============================================================== */}
          {!batchSummary && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-cyan-400" />
                  Active Hardware Stations ({displayPrinters.length} Online)
                </span>

                {/* N-Printer Carousel Page Navigation Strip (1..N Printers) */}
                {displayPrinters.length > 1 ? (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={scrollLeft}
                      className="px-2 py-1 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-cyan-400 text-[11px] font-mono font-bold flex items-center gap-0.5 transition shadow"
                      title="Previous Printer Section"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Prev
                    </button>
                    <div className="flex items-center gap-1 flex-wrap">
                      {displayPrinters.map((pItem, pIdx) => {
                        const isSelected = activeCarouselIdx === pIdx;
                        const isDoneP = pItem.stage === "COMPLETED";
                        const isPrintP = pItem.stage === "PRINTING";
                        const isSpoolP = pItem.stage === "SPOOLING" || pItem.stage === "PREPARING";
                        const isJamP = pItem.isJammed;
                        return (
                          <button
                            key={pItem.printerName}
                            type="button"
                            onClick={() => scrollToPrinterIndex(pIdx)}
                            title={pItem.printerName}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold border transition flex items-center gap-1.5 ${
                              isSelected
                                ? "bg-cyan-500/25 border-cyan-400 text-cyan-300 shadow-sm shadow-cyan-500/30"
                                : "bg-slate-900/80 hover:bg-slate-800 border-slate-700/80 text-slate-400"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isJamP
                                  ? "bg-red-500 animate-ping"
                                  : isDoneP
                                  ? "bg-emerald-400"
                                  : isPrintP
                                  ? "bg-emerald-400 animate-ping"
                                  : isSpoolP
                                  ? "bg-amber-400 animate-ping"
                                  : "bg-cyan-400"
                              }`}
                            />
                            <span>
                              {pIdx + 1}/{displayPrinters.length}
                            </span>
                            <span className="max-w-[95px] truncate hidden sm:inline">
                              {pItem.printerName.replace("[VIRTUAL] ", "")}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={scrollRight}
                      className="px-2 py-1 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-cyan-400 text-[11px] font-mono font-bold flex items-center gap-0.5 transition shadow"
                      title="Next Printer Section"
                    >
                      Next
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <span className="text-[11px] text-slate-400 font-mono">
                    Simultaneous Independent Spooling
                  </span>
                )}
              </div>

              {/* Relative Carousel Wrapper with Left/Right Semi-Transparent Overlay Arrows */}
              <div className="relative group">
                {displayPrinters.length > 2 && (canScrollLeft || activeCarouselIdx > 0) && (
                  <button
                    type="button"
                    onClick={scrollLeft}
                    aria-label="Scroll Carousel Left"
                    className="absolute left-1.5 top-1/2 -translate-y-1/2 z-20 w-9 h-14 rounded-full bg-slate-900/80 hover:bg-slate-800/95 border border-cyan-400/60 text-cyan-400 flex items-center justify-center shadow-2xl backdrop-blur-md transition hover:scale-105"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                )}

                {displayPrinters.length > 2 && (canScrollRight || activeCarouselIdx < displayPrinters.length - 1) && (
                  <button
                    type="button"
                    onClick={scrollRight}
                    aria-label="Scroll Carousel Right"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 z-20 w-9 h-14 rounded-full bg-slate-900/80 hover:bg-slate-800/95 border border-cyan-400/60 text-cyan-400 flex items-center justify-center shadow-2xl backdrop-blur-md transition hover:scale-105"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                )}

                {/* Horizontal Scrollable Carousel Track (Supports 1..N Printers Simultaneously) */}
                <div
                  ref={scrollContainerRef}
                  onScroll={onDesktopCarouselScroll}
                  className="flex gap-4 overflow-x-auto pb-3 pt-1 px-1 snap-x snap-mandatory scroll-smooth scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900/50"
                >
                  {displayPrinters.map((printer, printerIdx) => {
                    const theme = getPrinterTheme(printer.printerName);
                    const isJammed = printer.isJammed || (spoolerState?.isJammed && spoolerState?.jammedPrinter === printer.printerName);
                    const isPaused = printer.isPaused || spoolerState?.isPaused;
                    const activeDoc = printer.currentFile;
                    const filesPct = Math.min(100, Math.round(((printer.filesCompleted || 0) / Math.max(1, printer.filesTotal || 1)) * 100));

                    const assignedFiles = (spoolerState?.queuedFiles || []).filter(
                      (qf) => qf.targetPrinter === printer.printerName
                    );

                    const displayFiles: BatchQueuedFile[] = assignedFiles.length > 0 ? assignedFiles : (printer.currentFile ? [{
                      fileId: printer.currentFile.fileId,
                      orderId: printer.currentFile.orderId,
                      pickupCode: printer.currentFile.pickupCode,
                      customerName: printer.currentFile.customerName,
                      filename: printer.currentFile.filename,
                      targetPrinter: printer.printerName,
                      copies: printer.currentFile.copies,
                      colorMode: printer.currentFile.colorMode,
                      paperSize: printer.currentFile.paperSize,
                      duplexMode: printer.currentFile.duplexMode,
                      totalPages: printer.totalPages || 1,
                      globalIndex: 1,
                      totalFiles: 1,
                      status: printer.stage === "IDLE" ? "QUEUED" : (printer.stage as any),
                      progressPct: printer.pageProgressPct,
                      currentPage: printer.currentPage,
                    }] : []);

                    // Group assigned files by customer order / job
                    const orderMap = new Map<string, { orderId: string; pickupCode: string; customerName: string; files: BatchQueuedFile[] }>();
                    for (const f of displayFiles) {
                      const key = f.orderId || f.pickupCode || "unknown";
                      if (!orderMap.has(key)) {
                        orderMap.set(key, {
                          orderId: f.orderId,
                          pickupCode: f.pickupCode || f.orderId?.slice(0, 4) || "0000",
                          customerName: f.customerName || "Customer",
                          files: [],
                        });
                      }
                      orderMap.get(key)!.files.push(f);
                    }
                    const jobGroups = Array.from(orderMap.values());
                    const totalPrinterJobs = Math.max(1, jobGroups.length);
                    const completedPrinterJobs = jobGroups.filter((g) =>
                      g.files.length > 0 && g.files.every((f) => f.status === "COMPLETED")
                    ).length;
                    const printerJobsPct = Math.min(100, Math.round((completedPrinterJobs / totalPrinterJobs) * 100));

                    return (
                      <div
                        id={`desktop-printer-slide-${printerIdx}`}
                        key={printer.printerName}
                        className={`snap-start shrink-0 rounded-2xl p-5 border shadow-2xl transition-all duration-300 relative flex flex-col justify-between ${
                          displayPrinters.length === 1
                            ? "w-full max-w-4xl mx-auto"
                            : displayPrinters.length === 2
                            ? "w-full md:w-[calc(50%-0.5rem)] min-w-[340px]"
                            : "w-full md:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.67rem)] min-w-[360px]"
                        } ${
                          isJammed
                            ? "bg-red-950/50 border-red-500 ring-4 ring-red-500/60 shadow-red-500/40 animate-pulse"
                            : isPaused
                            ? "bg-amber-950/30 border-amber-500/80 ring-2 ring-amber-500/40"
                            : `bg-slate-900/90 ${theme.border} hover:border-slate-600`
                        }`}
                      >
                        {/* Top Printer Header */}
                        <div>
                          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className={`w-8 h-8 rounded-xl ${theme.badge} flex items-center justify-center shrink-0`}>
                                <Printer className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <h3 className="font-bold text-slate-100 text-xs sm:text-sm truncate">
                                  {printer.printerName}
                                </h3>
                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                  <span className="text-[10px] font-mono font-extrabold px-1.5 py-0.2 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/35">
                                    PRINTER {printerIdx + 1}/{displayPrinters.length}
                                  </span>
                                  <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.2 rounded border ${theme.badge}`}>
                                    {theme.nameTag}
                                  </span>
                                </div>
                              </div>
                            </div>

                          <div className="shrink-0 text-right">
                            {isJammed ? (
                              <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/50 text-[10px] font-bold font-mono animate-pulse flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-red-400" />
                                JAMMED
                              </span>
                            ) : isPaused ? (
                              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/50 text-[10px] font-bold font-mono">
                                PAUSED
                              </span>
                            ) : printer.stage === "PRINTING" ? (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold font-mono flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                                PRINTING
                              </span>
                            ) : printer.stage === "SPOOLING" ? (
                              <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[10px] font-bold font-mono flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>
                                SPOOLING
                              </span>
                            ) : printer.stage === "COMPLETED" ? (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-bold font-mono">
                                ✓ READY
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 text-[10px] font-mono">
                                IDLE
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Flashing Alert Banner (Specific to this printer on jam or error) */}
                        {isJammed && (
                          <div className="mt-3 p-3 rounded-xl bg-red-900/60 border border-red-500 text-red-100 text-xs flex items-center justify-between gap-2 shadow-lg animate-pulse">
                            <div className="flex items-center gap-2 min-w-0">
                              <AlertTriangle className="w-4 h-4 text-red-300 shrink-0" />
                              <div className="min-w-0">
                                <div className="font-bold text-red-100">EMERGENCY PAPER JAM</div>
                                <div className="text-[10px] text-red-200 truncate">Halted on Page {printer.currentPage} of {printer.totalPages}</div>
                              </div>
                            </div>
                            <button
                              onClick={() => handleEmergencyJam(printer.printerName)}
                              className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-[11px] shadow shrink-0"
                            >
                              Reroute
                            </button>
                          </div>
                        )}

                        {isPaused && !isJammed && (
                          <div className="mt-3 p-3 rounded-xl bg-amber-950/60 border-2 border-amber-500 text-amber-200 text-xs flex items-center justify-between gap-2 shadow-lg shadow-amber-950/50 ring-2 ring-amber-500/40 animate-pulse">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
                                <Pause className="w-4 h-4 text-amber-400" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-bold text-amber-100 flex items-center gap-1.5">
                                  <span>CARTRIDGE / TONER RELOAD PAUSED</span>
                                </div>
                                <div className="text-[10px] text-amber-300/90 truncate font-mono">
                                  Cleanly held on Page {printer.currentPage} of {printer.totalPages}. Reload then continue.
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={handleTogglePause}
                              className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs shadow-md flex items-center gap-1 shrink-0 transition"
                              title="Resume printing right from where it paused"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              Continue
                            </button>
                          </div>
                        )}

                        {/* Active Document Details */}
                        <div className="mt-3 bg-slate-950/60 border border-slate-800 rounded-xl p-3 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-400 font-mono flex items-center gap-1 truncate max-w-[200px]">
                              <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="truncate">{activeDoc ? activeDoc.filename : "No active file"}</span>
                            </span>
                            {activeDoc && (
                              <span className="text-[10px] font-mono text-cyan-300 font-bold px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/60">
                                #{activeDoc.pickupCode}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-2 flex-wrap">
                            <span className="text-slate-300 font-medium">Customer: {activeDoc?.customerName || "N/A"}</span>
                            <span>•</span>
                            <span>{activeDoc?.paperSize || "A4"}</span>
                            <span>•</span>
                            <span>{activeDoc?.colorMode || "BW"}</span>
                          </div>
                        </div>

                        {/* ============================================================== */}
                        {/* TOP PROGRESS BAR: TOTAL PRINT JOBS FOR THIS PRINTER           */}
                        {/* ============================================================== */}
                        <div className="mt-3 bg-slate-950/70 border border-slate-800 rounded-xl p-2.5 space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] font-mono">
                            <span className="text-slate-300 font-bold flex items-center gap-1.5">
                              <Layers className="w-3.5 h-3.5 text-cyan-400" />
                              Station Print Jobs:
                            </span>
                            <span className="text-cyan-300 font-bold">
                              {completedPrinterJobs} of {totalPrinterJobs} Jobs ({printerJobsPct}%)
                            </span>
                          </div>
                          <div className="w-full bg-slate-800/80 h-2 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 transition-all duration-300"
                              style={{ width: `${printerJobsPct}%` }}
                            ></div>
                          </div>
                        </div>

                        {/* ============================================================== */}
                        {/* DUAL CIRCULAR PROGRESS GAUGES (Replacing 3 static boxes)      */}
                        {/* ============================================================== */}
                        <div className="mt-3.5 pt-3 border-t border-slate-800/80 grid grid-cols-2 gap-2 justify-items-center">
                          {/* Circular Gauge 1: Spooler Stage (5.0s pacing) */}
                          <CircularProgressGauge
                            progress={printer.spoolerProgressPct}
                            ringColor={theme.ringColor}
                            title="1. Spooler Ring"
                            subtitle="SumatraPDF (5s)"
                            centerText={
                              <>
                                <Zap className={`w-3.5 h-3.5 ${theme.accent} mb-0.5 ${printer.stage === "SPOOLING" ? "animate-spin" : ""}`} />
                                <span className="text-xs font-bold font-mono text-slate-100">
                                  {Math.round(printer.spoolerProgressPct)}%
                                </span>
                              </>
                            }
                          />

                          {/* Circular Gauge 2: Hardware Page Printing (20.0s/page pacing) */}
                          <CircularProgressGauge
                            progress={printer.pageProgressPct}
                            ringColor="#34d399"
                            title="2. Page Printing"
                            subtitle={
                              activeDoc && activeDoc.copies > 1
                                ? `Copy ${Math.min(activeDoc.copies, Math.floor((Math.max(1, printer.currentPage) - 1) / Math.max(1, Math.round(printer.totalPages / activeDoc.copies))) + 1)}/${activeDoc.copies} • 20s/p`
                                : "Hardware (20s/p)"
                            }
                            centerText={
                              <>
                                <Printer className="w-3.5 h-3.5 text-emerald-400 mb-0.5" />
                                <span className="text-xs font-bold font-mono text-slate-100">
                                  P-{printer.currentPage}/{printer.totalPages}
                                </span>
                                <span className="text-[9px] text-slate-400 font-mono">
                                  {Math.round(printer.pageProgressPct)}%
                                </span>
                              </>
                            }
                          />
                        </div>

                        {/* Live Pacing Stage Message */}
                        <div className="text-center text-[11px] text-cyan-300 font-mono pt-3 truncate">
                          {printer.stageMessage}
                        </div>

                        {/* ============================================================== */}
                        {/* JOB-WISE FILE DISPLAY BOXES                                    */}
                        {/* ============================================================== */}
                        <div className="mt-4 space-y-3 pt-3 border-t border-slate-800/80">
                          {/* Horizontal Bar 1: Printer Station Batch Level */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[11px] font-mono">
                              <span className="text-slate-400 font-semibold">Station Batch Progress:</span>
                              <span className="text-slate-200 font-bold">
                                {printer.filesCompleted} of {printer.filesTotal} Files ({filesPct}%)
                              </span>
                            </div>
                            <div className="w-full bg-slate-800/90 h-2.5 rounded-full overflow-hidden">
                              <div
                                className={`h-full bg-gradient-to-r ${theme.barGradient} transition-all duration-300`}
                                style={{ width: `${filesPct}%` }}
                              ></div>
                            </div>
                          </div>

                          {/* Horizontal Bars 2: Job-wise Grouped File Boxes */}
                          {jobGroups.length > 0 && (
                            <div className="pt-2 border-t border-slate-800/60 space-y-3">
                              <div className="flex items-center justify-between text-[11px] font-mono">
                                <span className="text-slate-400 font-semibold flex items-center gap-1">
                                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                                  Customer Print Jobs ({jobGroups.length}):
                                </span>
                                <span className="text-[10px] text-slate-500 font-mono">
                                  Top job prints first
                                </span>
                              </div>

                              <div className="space-y-3 max-h-72 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                                {jobGroups.map((job, jobIdx) => {
                                  const isJobActive = job.files.some((f) => f.fileId === activeDoc?.fileId);
                                  const isJobDone = job.files.every((f) => f.status === "COMPLETED");
                                  const jobCompletedCount = job.files.filter((f) => f.status === "COMPLETED").length;

                                  return (
                                    <div
                                      key={job.orderId || jobIdx}
                                      className={`rounded-xl border p-3 transition-all ${
                                        isJobActive
                                          ? "bg-slate-950/90 border-cyan-500/60 shadow-lg shadow-cyan-950/40 ring-1 ring-cyan-500/30"
                                          : isJobDone
                                          ? "bg-slate-950/40 border-emerald-900/30 opacity-75"
                                          : "bg-slate-950/30 border-slate-800/70"
                                      }`}
                                    >
                                      {/* Job Header */}
                                      <div className="flex items-center justify-between text-xs pb-2 mb-2 border-b border-slate-800/60">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 shrink-0">
                                            Job #{job.pickupCode}
                                          </span>
                                          <span className="font-semibold text-slate-200 text-xs truncate">
                                            {job.customerName}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                                          <span className="text-slate-400">
                                            {jobCompletedCount}/{job.files.length} Files
                                          </span>
                                          {isJobDone ? (
                                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold text-[9px]">
                                              ✓ PRINTED
                                            </span>
                                          ) : isJobActive ? (
                                            job.files.some((f) => f.status === "PRINTING" || (activeDoc?.fileId === f.fileId && printer.stage === "PRINTING")) ? (
                                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[9px] flex items-center gap-1">
                                                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-ping"></span>
                                                🖨️ PRINTING
                                              </span>
                                            ) : (
                                              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[9px] flex items-center gap-1">
                                                <span className="w-1 h-1 rounded-full bg-amber-400 animate-ping"></span>
                                                ⚡ SPOOLING
                                              </span>
                                            )
                                          ) : (
                                            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[9px]">
                                              QUEUED
                                            </span>
                                          )}
                                        </div>
                                      </div>

                                      {/* Files in this Job */}
                                      <div className="space-y-2">
                                        {job.files.map((file, fIdx) => {
                                          const isCurrentActive = activeDoc?.fileId === file.fileId;
                                          const isDone = file.status === "COMPLETED";
                                          const isPrinting = file.status === "PRINTING" || (isCurrentActive && printer.stage === "PRINTING");
                                          const isSpooling = file.status === "SPOOLING" || (isCurrentActive && printer.stage === "SPOOLING");
                                          const isFailed = file.status === "FAILED" || (isCurrentActive && isJammed);

                                          const displayProgress = isDone
                                            ? 100
                                            : isPrinting
                                            ? Math.round(isCurrentActive ? printer.pageProgressPct : (file.pageProgressPct ?? file.progressPct))
                                            : isSpooling
                                            ? Math.round(isCurrentActive ? printer.spoolerProgressPct : (file.spoolerProgressPct ?? file.progressPct))
                                            : 0;

                                          const displayPage = isCurrentActive && (isPrinting || isSpooling)
                                            ? printer.currentPage
                                            : (isDone ? file.totalPages : (file.currentPage || 0));

                                          return (
                                            <div
                                              key={file.fileId || fIdx}
                                              className={`p-2 rounded-lg border transition-all ${
                                                isCurrentActive
                                                  ? "bg-slate-900/90 border-cyan-500/40 ring-1 ring-cyan-500/20"
                                                  : isDone
                                                  ? "bg-slate-900/40 border-emerald-950/40 opacity-75"
                                                  : "bg-slate-900/30 border-slate-800/40"
                                              }`}
                                            >
                                              <div className="flex items-center justify-between text-[11px] mb-1.5 gap-2">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                  <span
                                                    className={`w-4 h-4 rounded text-[9px] font-bold font-mono flex items-center justify-center shrink-0 ${
                                                      isDone
                                                        ? "bg-emerald-500/20 text-emerald-400"
                                                        : isCurrentActive
                                                        ? "bg-cyan-500/20 text-cyan-300"
                                                        : "bg-slate-800 text-slate-400"
                                                    }`}
                                                  >
                                                    {fIdx + 1}
                                                  </span>
                                                  <span className="font-semibold text-slate-200 truncate max-w-[150px]" title={file.filename}>
                                                    {file.filename}
                                                  </span>
                                                  <span className="text-[9px] font-mono text-slate-400 shrink-0">
                                                    ({file.totalPages}p{file.copies > 1 ? ` • ${file.copies} Copies` : ""})
                                                  </span>
                                                </div>

                                                <div className="shrink-0 flex items-center gap-1 font-mono text-[10px]">
                                                  {isDone ? (
                                                    <span className="text-emerald-400 font-bold flex items-center gap-0.5">
                                                      <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Printed (100%)
                                                    </span>
                                                  ) : isPrinting ? (
                                                    <span className="text-emerald-300 font-bold flex items-center gap-1">
                                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                                                      {file.copies > 1
                                                        ? `🖨️ Printing Copy ${Math.min(file.copies, Math.floor((Math.max(1, displayPage) - 1) / Math.max(1, Math.round(file.totalPages / file.copies))) + 1)}/${file.copies} • P-${displayPage}/${file.totalPages} (${displayProgress}%)`
                                                        : `🖨️ Printing P-${displayPage}/${file.totalPages} (${displayProgress}%)`}
                                                    </span>
                                                  ) : isSpooling ? (
                                                    <span className="text-amber-300 font-bold flex items-center gap-1">
                                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span>
                                                      ⚡ Spooling {displayProgress}%
                                                    </span>
                                                  ) : isFailed ? (
                                                    <span className="text-red-400 font-bold">⚠️ Halted</span>
                                                  ) : (
                                                    <span className="text-slate-500 font-semibold">Queued (P-0/{file.totalPages})</span>
                                                  )}
                                                </div>
                                              </div>

                                              {/* Individual file horizontal progress bar */}
                                              <div className="w-full bg-slate-800/80 h-1.5 rounded-full overflow-hidden">
                                                <div
                                                  className={`h-full transition-all duration-300 ${
                                                    isDone
                                                      ? "bg-emerald-500"
                                                      : isPrinting
                                                      ? "bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 animate-pulse"
                                                      : isSpooling
                                                      ? "bg-gradient-to-r from-amber-500 to-yellow-400 animate-pulse"
                                                      : isFailed
                                                      ? "bg-red-500"
                                                      : "bg-transparent"
                                                  }`}
                                                  style={{ width: `${displayProgress}%` }}
                                                ></div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Card Footer Actions */}
                      <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                        <button
                          onClick={() => handleEmergencyJam(printer.printerName)}
                          className={`px-2.5 py-1 text-[11px] rounded-lg font-semibold transition flex items-center gap-1 ${
                            isJammed
                              ? "bg-red-600 hover:bg-red-500 text-white font-bold border border-red-400 shadow-[0_0_15px_rgba(239,68,68,0.8)] ring-2 ring-red-400 animate-pulse"
                              : "bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-500/40"
                          }`}
                          title="Simulate or report paper jam on this printer"
                        >
                          <AlertTriangle className={`w-3 h-3 ${isJammed ? "text-white" : "text-rose-400"}`} />
                          {isJammed ? "Paper Jam Active" : "Paper Jam"}
                        </button>
                        {isPaused ? (
                          <button
                            onClick={handleTogglePause}
                            className="px-3 py-1 text-[11px] rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold transition flex items-center gap-1 shadow"
                            title="Continue printing"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            Continue
                          </button>
                        ) : (
                          <button
                            onClick={() => handleGracefulPause("CARTRIDGE_RELOAD")}
                            disabled={isProcessingControl || spoolerState?.pauseRequested || isGracefulPending}
                            className={`px-2.5 py-1 text-[11px] rounded-lg font-semibold transition flex items-center gap-1 ${
                              spoolerState?.pauseRequested || isGracefulPending
                                ? "bg-amber-500/30 text-amber-200 border-2 border-amber-400 shadow-[0_0_14px_rgba(245,158,11,0.5)] ring-2 ring-amber-500/40 animate-pulse font-bold"
                                : "bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30"
                            }`}
                            title="Graceful manual pause: completes current page before pausing"
                          >
                            <Pause className="w-3 h-3" />
                            {spoolerState?.pauseRequested || isGracefulPending ? "Pausing after Page..." : "Cartridge Pause"}
                          </button>
                        )}
                      </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Batch Summary View (When finished) */}
          {batchSummary && (
            <div className="p-6 rounded-2xl bg-slate-850 border border-emerald-500/40 shadow-xl space-y-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto shadow-lg">
                <Sparkles className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-100">Batch Print Queue Completed</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Successfully spooled {batchSummary.successfulFiles} of {batchSummary.totalFiles} documents across{" "}
                  {batchSummary.completedOrders} customer orders.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 pt-2">
                <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700">
                  <div className="text-lg font-bold text-slate-100">{batchSummary.completedOrders}</div>
                  <div className="text-[11px] text-slate-400">Orders Processed</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700">
                  <div className="text-lg font-bold text-emerald-400">{batchSummary.successfulFiles}</div>
                  <div className="text-[11px] text-slate-400">Files Succeeded</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700">
                  <div className="text-lg font-bold text-rose-400">{batchSummary.failedFiles}</div>
                  <div className="text-[11px] text-slate-400">Files Failed</div>
                </div>
              </div>
            </div>
          )}

          {/* Spooled Files Timeline List */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-300 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-slate-400" />
                Dispatched Documents Stream
              </span>
              <span className="text-slate-400 font-mono text-[11px]">
                {completedList.length} processed
              </span>
            </div>

            {completedList.length === 0 && !currentFile && (
              <div className="text-center py-6 text-xs text-slate-500">
                Initializing print queue...
              </div>
            )}

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {completedList.map((item, idx) => (
                <div
                  key={`${item.orderId}-${item.fileId}-${idx}`}
                  className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                    item.stage === "FAILED"
                      ? "bg-rose-950/20 border-rose-500/30 text-rose-200"
                      : "bg-slate-800/60 border-slate-700/60 text-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {item.stage === "FAILED" ? (
                      <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-100 truncate">{item.filename}</div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1.5 font-mono">
                        <span>#{item.pickupCode} ({item.customerName})</span>
                        <span>•</span>
                        <span>{item.targetPrinter}</span>
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    {item.stage === "FAILED" ? (
                      <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 text-[10px] font-bold">
                        FAILED
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                        ✓ PRINTED
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 border-t border-slate-800 flex items-center justify-between bg-slate-900/90 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {!batchSummary && spoolerState?.isActive && (
              <>
                {spoolerState.isPaused ? (
                  <button
                    onClick={handleTogglePause}
                    disabled={isProcessingControl}
                    className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950/40 transition"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Resume All
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => handleGracefulPause("CARTRIDGE_RELOAD")}
                      disabled={isProcessingControl || spoolerState.pauseRequested || isGracefulPending}
                      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition ${
                        spoolerState.pauseRequested || isGracefulPending
                          ? "bg-amber-500/30 text-amber-200 border-2 border-amber-400 ring-2 ring-amber-500/40 animate-pulse font-bold shadow-[0_0_14px_rgba(245,158,11,0.5)]"
                          : "bg-slate-800 hover:bg-slate-700 text-amber-300 border-amber-500/30"
                      }`}
                      title="Completes the current page cleanly before holding queue for toner/cartridge/paper replacement"
                    >
                      <Pause className="w-3.5 h-3.5" />
                      {spoolerState.pauseRequested || isGracefulPending ? "Pausing after Page..." : "Cartridge Pause"}
                    </button>

                    <button
                      onClick={() => handleEmergencyJam()}
                      disabled={isProcessingControl}
                      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition ${
                        spoolerState.isJammed
                          ? "bg-red-600 hover:bg-red-500 text-white font-bold border-red-400 shadow-[0_0_15px_rgba(239,68,68,0.8)] ring-2 ring-red-400 animate-pulse"
                          : "bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border-rose-500/40"
                      }`}
                      title="Instantly halts stuck driver process on paper jam or printer error"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {spoolerState.isJammed ? "Paper Jam Active" : "Paper Jam"}
                    </button>
                  </>
                )}

                <button
                  onClick={() => setIsRerouteOpen(!isRerouteOpen)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition ${
                    isRerouteOpen
                      ? "bg-cyan-500/20 border-cyan-500 text-cyan-300"
                      : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300"
                  }`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Hardware Reroute {isRerouteOpen ? "▲" : "▼"}
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!batchSummary && spoolerState?.isActive && (
              <button
                onClick={handleCancel}
                disabled={isProcessingControl}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 rounded-xl transition border border-rose-500/30"
              >
                <Square className="w-3.5 h-3.5" />
                Stop Batch
              </button>
            )}

            <button
              onClick={onClose}
              className="px-5 py-2 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl transition border border-slate-700"
            >
              {batchSummary ? "Close Monitor" : "Minimize"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
