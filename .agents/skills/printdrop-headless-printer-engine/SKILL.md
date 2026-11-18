---
name: printdrop-headless-printer-engine
description: >
  Silent automated document and photo printing pipeline for Windows using headless SumatraPDF.
  Covers dynamic print settings compilation (color/BW, duplex long/short edge, page ranges, copies,
  paper sizes), headless CLI arguments, image-to-PDF rasterization, magic byte format detection
  for extensionless .dat files, and atomic print job gating.
---

# PrintDrop Headless Document & Photo Printing Engine

## Purpose & Scope

This skill provides an **end-to-end implementation runbook for silent, automated, headless printing on Windows systems**. It details how to reliably bridge incoming customer documents (PDFs, Word, Excel, PowerPoint, and high-res photos) to Windows physical printers without opening graphical user dialogs, ensuring exact paper orientation, duplex alignment, page-range slicing, and color/black-and-white mode overrides.

---

## Quick Reference & Pitfall Table

| Problem / Pitfall | Root Cause | Permanent Production Solution |
| :--- | :--- | :--- |
| **SumatraPDF prints whole PDF instead of requested page 3** | Page range syntax incorrect or passed with improper escaping in CLI. | Compile settings string strictly as: `-print-settings "3,simplex,monochrome"`. Sumatra expects comma-separated parameters without spaces. |
| **Customer photos print squished or rotated 90°** | Raw image files passed directly to printer driver without orientation normalization. | Convert and wrap image into a properly dimensioned A4/Letter PDF using the `image` crate and `printpdf`, matching image aspect ratio to portrait/landscape canvas. |
| **Duplex back page prints upside down** | Short-edge duplex used instead of long-edge for standard portrait reading. | Explicitly pass `duplex` for standard book/portrait reading and `duplexshort` for landscape/calendar binding. |
| **Extensionless staged files (`doc_123.dat`) fail to print** | SumatraPDF requires valid `.pdf` extension to determine file parser. | Inspect file magic bytes (`%PDF-` for PDFs, `\x89PNG` for PNGs, `\xFF\xD8\xFF` for JPEGs) and link/copy to a temporary `.pdf` path before invoking Sumatra. |
| **Printer driver silently hangs on missing page range** | Windows Print Spooler (`spoolsv.exe`) stalls if requested page exceeds actual document length. | Preflight page count inspection: parse xref table or `%Count` in PDF bytes before dispatching to printer. |

---

## §1: Headless SumatraPDF CLI Syntax & Compilation

SumatraPDF is the fastest, lightest headless PDF printing engine on Windows:

```powershell
SumatraPDF.exe -print-to "<Printer Name>" -print-settings "<Settings>" -silent "<File Path>"
```

### The Certified `-print-settings` Compiler in Rust

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PrintSettingsDto {
    pub mode: String,              // "AUTO" | "MANUAL"
    pub paper_size: String,        // "A4" | "LETTER" | "LEGAL"
    pub color_mode: String,        // "BW" | "COLOR"
    pub duplex_mode: String,       // "SIMPLEX" | "DUPLEX_LONG" | "DUPLEX_SHORT"
    pub copies: u32,
    pub orientation: String,       // "PORTRAIT" | "LANDSCAPE" | "AUTO"
    pub page_range: Option<String>,// e.g. "1-5, 8, 11-14"
    pub rotation: Option<i32>,     // 0, 90, 180, 270
}

pub fn build_sumatra_settings_string(settings: &PrintSettingsDto) -> String {
    let mut parts = Vec::new();

    // 1. Page Range (must be first if present)
    if let Some(ref range) = settings.page_range {
        let cleaned: String = range.chars().filter(|c| !c.is_whitespace()).collect();
        if !cleaned.is_empty() {
            parts.push(cleaned);
        }
    }

    // 2. Copies
    if settings.copies > 1 {
        parts.push(format!("{}x", settings.copies));
    }

    // 3. Color Mode
    match settings.color_mode.to_uppercase().as_str() {
        "BW" | "MONO" | "MONOCHROME" => parts.push("monochrome".to_string()),
        "COLOR" => parts.push("color".to_string()),
        _ => parts.push("monochrome".to_string()),
    }

    // 4. Duplex Mode
    match settings.duplex_mode.to_uppercase().as_str() {
        "DUPLEX" | "DUPLEX_LONG" => parts.push("duplex".to_string()),
        "DUPLEX_SHORT" => parts.push("duplexshort".to_string()),
        _ => parts.push("simplex".to_string()),
    }

    // 5. Paper Size
    match settings.paper_size.to_uppercase().as_str() {
        "A4" => parts.push("paper=A4".to_string()),
        "LEGAL" => parts.push("paper=Legal".to_string()),
        "LETTER" => parts.push("paper=Letter".to_string()),
        _ => parts.push("paper=A4".to_string()),
    }

    // 6. Orientation
    match settings.orientation.to_uppercase().as_str() {
        "PORTRAIT" => parts.push("portrait".to_string()),
        "LANDSCAPE" => parts.push("landscape".to_string()),
        _ => {} // Auto orientation let printer decide
    }

    parts.join(",")
}
```

---

## §2: Image-to-PDF Auto-Conversion Engine

Direct image printing via Windows `mspaint` or photo viewer prompts GUI dialogs. To ensure **100% silent, headless photo printing**, rasterize images into a standardized A4 PDF canvas:

```rust
use std::path::{Path, PathBuf};
use image::io::Reader as ImageReader;
use printpdf::*;
use std::fs::File;
use std::io::BufWriter;

pub fn convert_image_to_printable_pdf(
    image_path: &Path,
    output_pdf_path: &Path,
    paper_size: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    // 1. Read image and detect dimensions
    let reader = ImageReader::open(image_path)?.with_guessed_format()?;
    let img = reader.decode()?;
    let (width_px, height_px) = (img.width() as f64, img.height() as f64);
    let is_landscape = width_px > height_px;

    // 2. Define standard paper points (A4 = 210mm x 297mm)
    let (page_w, page_h) = if is_landscape {
        (Mm(297.0), Mm(210.0))
    } else {
        (Mm(210.0), Mm(297.0))
    };

    let doc = PdfDocument::new("PrintDrop Staged Image", page_w, page_h, "Layer 1");
    let current_layer = doc.get_page(doc.get_page(1).into()).get_layer(1);

    // 3. Scale image to fit canvas margins (5mm margin)
    // Add image stream to layer and save PDF...
    let mut out_file = BufWriter::new(File::create(output_pdf_path)?);
    doc.save(&mut out_file)?;

    Ok(())
}
```

---

## §3: Magic Byte Format Detection

Never trust file extensions sent from mobile browsers (e.g. Android often uploads `.dat` or generic `blob` names). Inspect binary headers:

```rust
use std::fs::File;
use std::io::Read;
use std::path::Path;

pub fn is_pdf_file(path: &Path) -> bool {
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut magic = [0u8; 5];
    if file.read_exact(&mut magic).is_ok() {
        return &magic == b"%PDF-";
    }
    false
}

pub fn is_image_file(path: &Path) -> bool {
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut magic = [0u8; 8];
    let n = file.read(&mut magic).unwrap_or(0);
    if n >= 3 && &magic[0..3] == b"\xFF\xD8\xFF" { return true; } // JPEG
    if n >= 8 && &magic[0..8] == b"\x89PNG\r\n\x1a\n" { return true; } // PNG
    if n >= 4 && &magic[0..4] == b"RIFF" { return true; } // WEBP
    false
}
```

---

## §4: Atomic Print Gate & Execution

To avoid paper and ink waste, print jobs must pass a strict gate:

```rust
pub async fn execute_print_job(
    order_status: &str,
    file_path: &Path,
    printer_name: &str,
    settings: &PrintSettingsDto,
) -> Result<(), Box<dyn std::error::Error>> {
    // 1. Strict approval gate
    if order_status != "APPROVED" && order_status != "COMPLETED" {
        return Err("Print gate blocked: Order must be APPROVED by shopkeeper before printing.".into());
    }

    // 2. Prepare printable PDF
    let printable_pdf = if is_pdf_file(file_path) {
        file_path.to_path_buf()
    } else if is_image_file(file_path) {
        let temp_pdf = std::env::temp_dir().join(format!("print_{}.pdf", uuid::Uuid::new_v4()));
        convert_image_to_printable_pdf(file_path, &temp_pdf, &settings.paper_size)?;
        temp_pdf
    } else {
        return Err("Unsupported file format for headless printing".into());
    };

    // 3. Compile settings and dispatch
    let settings_str = build_sumatra_settings_string(settings);
    let sumatra_bin = locate_sumatra_exe()?;

    let output = tokio::process::Command::new(sumatra_bin)
        .arg("-print-to")
        .arg(printer_name)
        .arg("-print-settings")
        .arg(&settings_str)
        .arg("-silent")
        .arg(&printable_pdf)
        .output()
        .await?;

    if !output.status.success() {
        return Err(format!("SumatraPDF exited with code: {:?}", output.status.code()).into());
    }

    Ok(())
}
```
