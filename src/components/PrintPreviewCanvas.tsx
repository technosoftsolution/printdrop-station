import React, { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { 
  ZoomIn, 
  ZoomOut, 
  ChevronLeft, 
  ChevronRight, 
  Printer, 
  Check, 
  FileSpreadsheet,
  RotateCcw,
  RotateCw,
  AlertTriangle
} from "lucide-react";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = "/static/pdf.worker.min.js";

interface PrintPreviewCanvasProps {
  fileId: string;
  filename: string;
  fileType: string;
  previewDataUrl?: string;
  previewUrl: string;
  excelMetadata?: any;
  initialSettings: {
    paperSize: string;
    colorMode: string;
    orientation: string;
    copies?: number;
    duplexMode?: string;
    rotation?: number;
    pageRange?: string;
  };
  onApplySettings?: (settings: {
    paperSize: string;
    colorMode: string;
    orientation: string;
    rotation: number;
    copies: number;
    duplexMode: string;
    pageRange?: string;
  }) => Promise<any> | void;
  onClose: () => void;
}

export const PrintPreviewCanvas: React.FC<PrintPreviewCanvasProps> = ({
  filename,
  fileType,
  previewDataUrl,
  previewUrl,
  excelMetadata,
  initialSettings,
  onApplySettings,
  onClose,
}) => {
  // Print simulation settings
  const [paperSize, setPaperSize] = useState<string>(initialSettings.paperSize || "A4");
  const [colorMode, setColorMode] = useState<string>(initialSettings.colorMode || "BW");
  const [orientation, setOrientation] = useState<string>(
    initialSettings.orientation === "AUTO" ? "PORTRAIT" : (initialSettings.orientation || "PORTRAIT")
  );
  const [copies, setCopies] = useState<number>(initialSettings.copies || 1);
  const [duplexMode, setDuplexMode] = useState<string>(initialSettings.duplexMode || "SIMPLEX");
  const [rotation, setRotation] = useState<number>(initialSettings.rotation || 0);
  const [pageRange, setPageRange] = useState<string>(initialSettings.pageRange || "");

  // Helper to determine if a specific 1-based page is in the active pageRange
  const isPageIncluded = (page: number, rangeStr: string, maxPages: number): boolean => {
    const trimmed = (rangeStr || "").trim();
    if (!trimmed || trimmed.toLowerCase() === "all") return true;
    const parts = trimmed.split(",");
    for (const part of parts) {
      const p = part.trim();
      if (!p) continue;
      if (p.includes("-")) {
        const [startStr, endStr] = p.split("-");
        const start = parseInt(startStr.trim(), 10);
        const end = parseInt(endStr.trim(), 10);
        if (!isNaN(start) && !isNaN(end)) {
          const s = Math.max(1, start);
          const e = Math.min(maxPages, end);
          if (page >= s && page <= e) return true;
        }
      } else {
        const single = parseInt(p, 10);
        if (!isNaN(single) && single === page) return true;
      }
    }
    return false;
  };

  // Helper to count how many pages will be printed
  const countSelectedPages = (rangeStr: string, maxPages: number): number => {
    const trimmed = (rangeStr || "").trim();
    if (!trimmed || trimmed.toLowerCase() === "all") return maxPages;
    const set = new Set<number>();
    const parts = trimmed.split(",");
    for (const part of parts) {
      const p = part.trim();
      if (!p) continue;
      if (p.includes("-")) {
        const [startStr, endStr] = p.split("-");
        const start = parseInt(startStr.trim(), 10);
        const end = parseInt(endStr.trim(), 10);
        if (!isNaN(start) && !isNaN(end)) {
          const s = Math.max(1, start);
          const e = Math.min(maxPages, end);
          for (let i = s; i <= e; i++) set.add(i);
        }
      } else {
        const single = parseInt(p, 10);
        if (!isNaN(single) && single >= 1 && single <= maxPages) {
          set.add(single);
        }
      }
    }
    return set.size > 0 ? set.size : maxPages;
  };

  // Zoom & page navigation state
  const [zoom, setZoom] = useState<number>(1.0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [settingsAppliedMsg, setSettingsAppliedMsg] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfDocRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);

  // Standard physical paper specifications and exact millimeter dimensions
  const getPaperSpec = () => {
    switch (paperSize) {
      case "A3":
        return {
          name: "A3",
          badge: "A3 (297 × 420 mm • 2× A4)",
          wMm: orientation === "LANDSCAPE" ? 420 : 297,
          hMm: orientation === "LANDSCAPE" ? 297 : 420,
          pixelWidth: orientation === "LANDSCAPE" ? 640 : 455,
          pixelHeight: orientation === "LANDSCAPE" ? 455 : 640,
        };
      case "LETTER":
        return {
          name: "Letter",
          badge: "Letter (8.5\" × 11\" • 216 × 279 mm)",
          wMm: orientation === "LANDSCAPE" ? 279.4 : 215.9,
          hMm: orientation === "LANDSCAPE" ? 215.9 : 279.4,
          pixelWidth: orientation === "LANDSCAPE" ? 430 : 332,
          pixelHeight: orientation === "LANDSCAPE" ? 332 : 430,
        };
      case "LEGAL":
        return {
          name: "Legal",
          badge: "Legal (8.5\" × 14\" • 216 × 356 mm)",
          wMm: orientation === "LANDSCAPE" ? 355.6 : 215.9,
          hMm: orientation === "LANDSCAPE" ? 215.9 : 355.6,
          pixelWidth: orientation === "LANDSCAPE" ? 548 : 332,
          pixelHeight: orientation === "LANDSCAPE" ? 332 : 548,
        };
      case "A4":
      default:
        return {
          name: "A4",
          badge: "A4 (210 × 297 mm • Standard)",
          wMm: orientation === "LANDSCAPE" ? 297 : 210,
          hMm: orientation === "LANDSCAPE" ? 210 : 297,
          pixelWidth: orientation === "LANDSCAPE" ? 457 : 323,
          pixelHeight: orientation === "LANDSCAPE" ? 323 : 457,
        };
    }
  };

  const paperSpec = getPaperSpec();

  // Load and render PDF using PDF.js
  useEffect(() => {
    if (fileType !== "pdf") {
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setErrorMsg(null);

    async function loadPdf() {
      try {
        let loadingTask: any;
        if (previewDataUrl && previewDataUrl.startsWith("data:")) {
          // Decode Base64 data URL into binary array
          const base64Data = previewDataUrl.split(",")[1];
          const binaryString = atob(base64Data);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          loadingTask = pdfjsLib.getDocument({ data: bytes });
        } else {
          loadingTask = pdfjsLib.getDocument(previewUrl);
        }

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error("Document canvas rendering timed out (8s). The document may be corrupted or too large."));
          }, 8000);
        });

        const pdfDoc: any = await Promise.race([loadingTask.promise, timeoutPromise]);
        if (!isMounted) return;

        pdfDocRef.current = pdfDoc;
        setTotalPages(pdfDoc.numPages);
        setCurrentPage(1);
        await renderPdfPage(pdfDoc, 1);
        setIsLoading(false);
      } catch (err: any) {
        if (!isMounted) return;
        console.error("PDF.js render error:", err);
        const reason = err?.message || "Failed to render PDF preview on canvas.";
        setErrorMsg(reason);
        setIsLoading(false);
      }
    }

    loadPdf();

    return () => {
      isMounted = false;
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
      }
    };
  }, [fileType, previewDataUrl, previewUrl]);

  // Render specific page when page changes
  async function renderPdfPage(pdfDoc: any, pageNum: number) {
    if (!pdfDoc || !canvasRef.current) return;
    try {
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch (_) {}
      }
      const page = await pdfDoc.getPage(pageNum);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;

      // Determine natural aspect ratio of the PDF page
      const naturalViewport = page.getViewport({ scale: 1.0 });
      const isNaturallyPortrait = naturalViewport.height >= naturalViewport.width;

      // When printing a portrait document onto landscape paper (or vice-versa),
      // standard printer drivers turn the page by 90° to fit the sheet orientation.
      let orientationAngle = 0;
      if (orientation === "LANDSCAPE" && isNaturallyPortrait) {
        orientationAngle = 90;
      } else if (orientation === "PORTRAIT" && !isNaturallyPortrait) {
        orientationAngle = 90;
      }

      // Render at high-DPI resolution for crisp text with accurate physical orientation and rotation
      const totalRotation = ((page.rotate || 0) + orientationAngle + (rotation || 0) + 360) % 360;
      const viewport = page.getViewport({ 
        scale: 2.0, 
        rotation: totalRotation 
      });
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const renderContext = {
        canvasContext: context,
        viewport,
      };

      const renderTask = page.render(renderContext);
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      renderTaskRef.current = null;
    } catch (e: any) {
      if (e?.name !== "RenderingCancelledException") {
        console.warn("Page render error:", e);
      }
    }
  }

  useEffect(() => {
    if (pdfDocRef.current && fileType === "pdf") {
      renderPdfPage(pdfDocRef.current, currentPage);
    }
  }, [orientation, rotation]);

  const handleNextPage = async () => {
    if (currentPage < totalPages && pdfDocRef.current) {
      const next = currentPage + 1;
      setCurrentPage(next);
      await renderPdfPage(pdfDocRef.current, next);
    }
  };

  const handlePrevPage = async () => {
    if (currentPage > 1 && pdfDocRef.current) {
      const prev = currentPage - 1;
      setCurrentPage(prev);
      await renderPdfPage(pdfDocRef.current, prev);
    }
  };

  const handleZoomIn = () => setZoom((prev) => Math.min(2.5, Math.round((prev + 0.2) * 10) / 10));
  const handleZoomOut = () => setZoom((prev) => Math.max(0.4, Math.round((prev - 0.2) * 10) / 10));
  const handleResetZoom = () => setZoom(1.0);

  const handleApply = async () => {
    if (!onApplySettings) return;
    setIsApplying(true);
    setApplyError(null);
    try {
      await onApplySettings({
        paperSize,
        colorMode,
        orientation,
        rotation,
        copies,
        duplexMode,
        pageRange: pageRange.trim() ? pageRange.trim() : undefined,
      });
      setSettingsAppliedMsg(true);
      setTimeout(() => setSettingsAppliedMsg(false), 3000);
    } catch (err: any) {
      console.error("Apply settings error:", err);
      setApplyError(err?.message || String(err));
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in font-sans">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-5xl w-full shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Top Header & Interactive Print Controls */}
        <div className="px-6 py-3.5 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-950 text-indigo-400 rounded-xl border border-indigo-800/60">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white max-w-sm truncate">{filename}</h3>
                <span className="text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800/60 px-2 py-0.5 rounded">
                  {fileType.toUpperCase()}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span>Simulated Output:</span>
                <span className="font-semibold text-slate-200">{copies} {copies === 1 ? "Copy" : "Copies"}</span>
                <span>&bull;</span>
                <span className="font-semibold text-slate-200">{duplexMode === "SIMPLEX" ? "1-Sided" : "2-Sided"}</span>
                <span>&bull;</span>
                <span className="font-semibold text-slate-200">{paperSize}</span>
                <span>&bull;</span>
                <span className="font-semibold text-slate-200">{orientation}</span>
                {rotation > 0 && (
                  <>
                    <span>&bull;</span>
                    <span className="font-semibold text-indigo-400 font-mono">Rotated {rotation}°</span>
                  </>
                )}
                <span>&bull;</span>
                <span className="font-semibold text-slate-200">{colorMode === "BW" ? "B&W Toner" : "Color"}</span>
                {pageRange && pageRange.trim() && pageRange.trim().toLowerCase() !== "all" && (
                  <>
                    <span>&bull;</span>
                    <span className="font-semibold text-emerald-400 font-mono bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/60 flex items-center gap-1">
                      📄 Target Pages: {pageRange.trim()} ({countSelectedPages(pageRange, totalPages)} of {totalPages} {countSelectedPages(pageRange, totalPages) === 1 ? "page" : "pages"})
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Interactive Print Setup Toggles */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Copies Stepper */}
            <div className="flex items-center bg-slate-900 px-1.5 py-0.5 rounded-xl border border-slate-800 text-xs">
              <span className="text-[11px] text-slate-400 font-semibold mr-1.5 pl-1">Copies:</span>
              <button
                type="button"
                onClick={() => setCopies((c) => Math.max(1, c - 1))}
                className="w-5 h-5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold flex items-center justify-center text-xs"
                title="Decrease copies"
              >
                -
              </button>
              <span className="w-6 text-center font-mono font-bold text-xs text-white">
                {copies}
              </span>
              <button
                type="button"
                onClick={() => setCopies((c) => Math.min(100, c + 1))}
                className="w-5 h-5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold flex items-center justify-center text-xs"
                title="Increase copies"
              >
                +
              </button>
            </div>

            {/* Duplex Toggle */}
            <div className="flex bg-slate-900 p-0.5 rounded-xl border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setDuplexMode("SIMPLEX")}
                className={`px-2 py-1 rounded-lg font-semibold text-[11px] transition ${
                  duplexMode === "SIMPLEX" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                }`}
                title="1-Sided (Simplex)"
              >
                1-Sided
              </button>
              <button
                type="button"
                onClick={() => setDuplexMode("DUPLEX_LONG_EDGE")}
                className={`px-2 py-1 rounded-lg font-semibold text-[11px] transition ${
                  duplexMode !== "SIMPLEX" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                }`}
                title="2-Sided (Duplex Long Edge)"
              >
                2-Sided
              </button>
            </div>

            {/* Orientation Toggle */}
            <div className="flex bg-slate-900 p-0.5 rounded-xl border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => {
                  setOrientation("PORTRAIT");
                  setRotation(0);
                }}
                className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                  orientation === "PORTRAIT" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                Portrait
              </button>
              <button
                type="button"
                onClick={() => {
                  setOrientation("LANDSCAPE");
                  setRotation(0);
                }}
                className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                  orientation === "LANDSCAPE" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                Landscape
              </button>
            </div>

            {/* Manual Rotation Controls */}
            <div className="flex items-center bg-slate-900 p-0.5 rounded-xl border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setRotation((r) => (r + 270) % 360)}
                className="px-2 py-1 rounded-lg font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition flex items-center gap-1"
                title="Rotate 90° Anticlockwise"
              >
                <RotateCcw className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-[11px]">⟲ 90°</span>
              </button>
              <div className="w-px h-4 bg-slate-800 my-auto"></div>
              <button
                type="button"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="px-2 py-1 rounded-lg font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition flex items-center gap-1"
                title="Rotate 90° Clockwise"
              >
                <RotateCw className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-[11px]">⟳ 90°</span>
              </button>
              {rotation > 0 && (
                <button
                  type="button"
                  onClick={() => setRotation(0)}
                  className="ml-1 px-1.5 py-0.5 bg-amber-950/80 text-amber-300 border border-amber-700/60 rounded text-[10px] font-mono font-bold hover:bg-amber-900 transition flex items-center gap-1"
                  title="Click to reset manual rotation to 0°"
                >
                  <span>↺ {rotation}°</span>
                  <span className="text-[9px] text-amber-400 font-normal underline">Reset</span>
                </button>
              )}
            </div>

            {/* Color Mode Toggle */}
            <div className="flex bg-slate-900 p-0.5 rounded-xl border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setColorMode("BW")}
                className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                  colorMode === "BW" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                B&W (Grayscale)
              </button>
              <button
                type="button"
                onClick={() => setColorMode("COLOR")}
                className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                  colorMode === "COLOR" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                Color
              </button>
            </div>

            {/* Paper Size Selector */}
            <select
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1 text-xs text-white focus:outline-none focus:border-indigo-500 font-semibold"
            >
              <option value="A4">A4</option>
              <option value="LETTER">Letter</option>
              <option value="LEGAL">Legal</option>
              <option value="A3">A3</option>
            </select>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-sm ml-1"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Toolbar: Zoom & Page Navigation & Range Selector */}
        <div className="px-6 py-2.5 bg-slate-950/80 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-3 flex-wrap">
            {fileType === "pdf" && totalPages > 1 && (
              <>
                {/* Page Navigation */}
                <div className="flex items-center gap-1.5 bg-slate-900 px-2.5 py-1 rounded-xl border border-slate-800 shadow-sm">
                  <button
                    type="button"
                    onClick={handlePrevPage}
                    disabled={currentPage <= 1}
                    className="p-1 hover:text-white disabled:opacity-40 transition"
                    title="Previous Page"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono text-[11px] font-bold text-slate-200">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={handleNextPage}
                    disabled={currentPage >= totalPages}
                    className="p-1 hover:text-white disabled:opacity-40 transition"
                    title="Next Page"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Page Range Selector Bar */}
                <div className="flex items-center gap-1.5 bg-slate-900/90 p-1 rounded-xl border border-slate-800 shadow-sm flex-wrap">
                  <span className="text-[10px] uppercase font-bold text-slate-400 px-1.5">Print Target:</span>
                  
                  {/* All Pages Button */}
                  <button
                    type="button"
                    onClick={() => setPageRange("")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                      !pageRange.trim() || pageRange.trim().toLowerCase() === "all"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-slate-800 text-slate-300 hover:text-white"
                    }`}
                  >
                    All Pages ({totalPages})
                  </button>

                  {/* 1-Click Print Only Current Page */}
                  <button
                    type="button"
                    onClick={() => setPageRange(String(currentPage))}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                      pageRange.trim() === String(currentPage)
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "bg-slate-800 text-slate-300 hover:text-white"
                    }`}
                    title={`Print only the page currently visible (Page ${currentPage})`}
                  >
                    <Printer className="w-3 h-3 text-emerald-300" />
                    <span>Only Page {currentPage}</span>
                  </button>

                  {/* Direct Page Pills if totalPages <= 8 */}
                  {totalPages <= 8 && (
                    <div className="flex items-center gap-1 border-l border-slate-700/60 pl-1.5 ml-0.5">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={async () => {
                            setPageRange(String(p));
                            if (p !== currentPage && pdfDocRef.current) {
                              setCurrentPage(p);
                              await renderPdfPage(pdfDocRef.current, p);
                            }
                          }}
                          className={`w-6 h-6 rounded-lg text-[11px] font-mono font-bold transition flex items-center justify-center ${
                            pageRange.trim() === String(p)
                              ? "bg-emerald-600 text-white ring-1 ring-emerald-400"
                              : "bg-slate-800/80 text-slate-400 hover:text-white"
                          }`}
                          title={`Select and jump to Page ${p}`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Custom Page Range Input */}
                  <div className="flex items-center gap-1 border-l border-slate-700/60 pl-1.5 ml-0.5">
                    <input
                      type="text"
                      value={pageRange}
                      onChange={(e) => setPageRange(e.target.value)}
                      placeholder="Range e.g. 2, 1-3"
                      className="w-28 bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-lg px-2 py-0.5 text-xs text-white placeholder-slate-500 font-mono"
                      title="Custom page range: e.g. 2 for single page, or 1-3, 5 for multiple pages"
                    />
                  </div>
                </div>
              </>
            )}

            <span className="text-[11px] text-slate-500 hidden xl:inline font-mono">
              Sheet: {paperSpec.wMm}mm × {paperSpec.hMm}mm
            </span>
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center gap-1.5 bg-slate-900 px-2 py-0.5 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-1 hover:text-white transition"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="font-mono text-[11px] px-1 hover:text-indigo-400 font-semibold"
              title="Reset Zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-1 hover:text-white transition"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Main Canvas Area: Virtual Paper Simulation */}
        <div className="flex-1 overflow-auto bg-slate-950 p-6 flex items-center justify-center min-h-[380px] max-h-[62vh] relative select-none">
          {isLoading && (
            <div className="absolute inset-0 z-20 bg-slate-950/85 backdrop-blur-sm flex flex-col items-center justify-center text-slate-400 text-xs">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3"></div>
              <span>Rendering Print Canvas...</span>
            </div>
          )}

          {errorMsg && (
            <div className="absolute inset-0 z-30 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center animate-fade-in">
              <div className="p-3.5 bg-rose-950/80 border border-rose-800/80 rounded-2xl mb-3 text-rose-400 shadow-lg shadow-rose-950/40">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <h4 className="text-sm font-bold text-white mb-1">Preview Generation Failed</h4>
              <p className="text-xs text-rose-300/90 max-w-md mb-4 leading-relaxed font-medium">
                {errorMsg}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition shadow-sm"
              >
                Close Preview
              </button>
            </div>
          )}

          <div
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "center center",
              transition: "transform 0.15s ease-out, width 0.2s ease, height 0.2s ease",
            }}
            className="flex items-center justify-center"
          >
              {/* Virtual Physical Paper Sheet */}
              <div
                style={{
                  width: `${paperSpec.pixelWidth}px`,
                  height: `${paperSpec.pixelHeight}px`,
                  filter: colorMode === "BW" ? "grayscale(100%) contrast(108%)" : "none",
                  transition: "width 0.28s cubic-bezier(0.4, 0, 0.2, 1), height 0.28s cubic-bezier(0.4, 0, 0.2, 1), filter 0.2s ease",
                }}
                className="bg-white rounded-sm shadow-2xl shadow-black border border-slate-300 relative flex flex-col items-center justify-center overflow-hidden p-3"
              >
                {/* Printable Margin Guidelines (Dashed line showing 5mm margin) */}
                <div className="absolute inset-2 border border-dashed border-sky-400/30 pointer-events-none rounded-sm"></div>

                {/* Visible Physical Paper Specification Watermark Badge */}
                <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-slate-900/85 backdrop-blur text-white text-[10px] font-semibold tracking-wide border border-slate-700/60 shadow pointer-events-none z-10 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                  <span>{paperSpec.badge}</span>
                </div>

                {/* Multi-Page Print Status Callout (Top Left) */}
                {fileType === "pdf" && totalPages > 1 && (
                  <div
                    className={`absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide border shadow pointer-events-none z-10 flex items-center gap-1.5 ${
                      isPageIncluded(currentPage, pageRange, totalPages)
                        ? "bg-emerald-950/90 text-emerald-300 border-emerald-700/80"
                        : "bg-amber-950/90 text-amber-300 border-amber-700/80"
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isPageIncluded(currentPage, pageRange, totalPages) ? "bg-emerald-400" : "bg-amber-400"
                      }`}
                    />
                    <span>
                      {isPageIncluded(currentPage, pageRange, totalPages)
                        ? `Page ${currentPage} of ${totalPages} (WILL PRINT • ${countSelectedPages(pageRange, totalPages)} total)`
                        : `Page ${currentPage} of ${totalPages} (SKIPPED • Target: ${pageRange.trim()})`}
                    </span>
                  </div>
                )}

                {/* Dimension Callout at Bottom Center */}
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-100/90 text-slate-500 text-[9px] font-mono pointer-events-none z-10 border border-slate-300">
                  {paperSpec.wMm} × {paperSpec.hMm} mm
                </div>

                {/* PDF Content on Canvas */}
                {fileType === "pdf" && (
                  <canvas
                    ref={canvasRef}
                    className="w-full h-full object-contain block"
                  />
                )}

                {/* Image Content */}
                {fileType === "image" && previewDataUrl && (
                  <div className="w-full h-full flex items-center justify-center overflow-hidden">
                    <img
                      src={previewDataUrl}
                      alt={filename}
                      style={{
                        transform: `rotate(${rotation}deg)`,
                        transition: "transform 0.2s ease-in-out",
                        maxWidth: (rotation === 90 || rotation === 270) ? `${paperSpec.pixelHeight - 24}px` : "100%",
                        maxHeight: (rotation === 90 || rotation === 270) ? `${paperSpec.pixelWidth - 24}px` : "100%",
                      }}
                      className="object-contain block pointer-events-none"
                    />
                  </div>
                )}

                {/* Excel Content View */}
                {fileType === "excel" && (
                  <div className="w-full h-full p-4 flex flex-col justify-between text-slate-800 text-left bg-emerald-50/40">
                    <div>
                      <div className="flex items-center gap-2 border-b border-emerald-300 pb-2 mb-3">
                        <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                        <div>
                          <h4 className="font-bold text-xs text-slate-900">{filename}</h4>
                          <span className="text-[10px] text-emerald-700 font-semibold">
                            Excel Sheet Simulation ({paperSize} &bull; {orientation})
                          </span>
                        </div>
                      </div>

                      {excelMetadata && excelMetadata.sheets && (
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {excelMetadata.sheets.map((s: any) => (
                            <div key={s.sheetIndex} className="p-2 bg-white rounded border border-emerald-200 text-[10px] shadow-sm">
                              <div className="flex justify-between font-bold text-slate-900">
                                <span>Sheet {s.sheetIndex}: {s.name}</span>
                                <span className={s.isEmpty ? "text-slate-400" : "text-emerald-700"}>
                                  {s.isEmpty ? "Empty" : `${s.rowCount}r × ${s.colCount}c`}
                                </span>
                              </div>
                              <div className="text-slate-600 mt-1 flex justify-between">
                                <span>{s.detectedOrientation} {s.fitToWidth ? `• Fit to Width (${s.fitToWidth})` : ""}</span>
                                <span className="font-mono text-slate-500">{s.printArea || "Full Sheet"}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="text-[10px] text-slate-500 text-center border-t border-emerald-200 pt-2 font-mono">
                      Page 1 of {excelMetadata?.populatedSheets || 1}
                    </div>
                  </div>
                )}

                {/* Other File Type Fallback */}
                {fileType !== "pdf" && fileType !== "image" && fileType !== "excel" && (
                  <div className="text-center p-6 text-slate-800">
                    <p className="font-bold text-xs">{filename}</p>
                    <p className="text-[11px] text-slate-500 mt-1">Ready for Print Spooler ({paperSize})</p>
                  </div>
                )}
              </div>
            </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-400">
              Interactive WYSIWYG Print Setup &bull; {copies} {copies === 1 ? "Copy" : "Copies"} &bull; {duplexMode === "SIMPLEX" ? "1-Sided" : "2-Sided"} &bull; {paperSize} &bull; {orientation} {rotation > 0 ? `(${rotation}°) ` : ""}&bull; {colorMode === "BW" ? "B&W" : "Color"}{pageRange.trim() && pageRange.trim().toLowerCase() !== "all" ? ` • Page ${pageRange.trim()}` : ""}
            </span>
            {settingsAppliedMsg && (
              <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1 animate-fade-in bg-emerald-950/80 border border-emerald-800/60 px-2 py-0.5 rounded-lg">
                <Check className="w-3.5 h-3.5" />
                <span>Applied to Settings ({paperSize}, {orientation}{rotation > 0 ? `, ${rotation}°` : ""}{pageRange.trim() && pageRange.trim().toLowerCase() !== "all" ? `, Target: ${pageRange.trim()}` : ", All Pages"})!</span>
              </span>
            )}
            {applyError && (
              <span className="text-xs text-red-400 font-semibold flex items-center gap-1 animate-fade-in bg-red-950/80 border border-red-800/60 px-2 py-0.5 rounded-lg">
                <span>Failed: {applyError}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleApply}
              disabled={isApplying}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition shadow-md shadow-indigo-950 flex items-center gap-1.5"
            >
              {isApplying ? (
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              <span>{isApplying ? "Saving..." : "Apply to Print Settings"}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
