# PrintDrop Retail Core — Shopkeeper Operations Manual & Feature Guide
> **Version:** 1.0.0 (Production Release)  
> **Target Audience:** Xerox & Digital Print Shop Owners, Operators, and Cashiers  
> **Software Module:** Desktop Core Engine (Windows 10 / 11 64-bit)  
> **Last Updated:** November 2026

---

## Table of Contents
1. [Introduction & Architectural Highlights](#1-introduction--architectural-highlights)
2. [1-Minute Quick Start Guide](#2-1-minute-quick-start-guide)
3. [Countertop Hotspot & QR Code Setup](#3-countertop-hotspot--qr-code-setup)
4. [Live Mobile Web Upload Engine (Zero-App Customer Experience)](#4-live-mobile-web-upload-engine-zero-app-customer-experience)
5. [Order Management, Preflight Billing & Express Calculation](#5-order-management-preflight-billing--express-calculation)
6. [WYSIWYG Print Preview Canvas & Sheet Inspection](#6-wysiwyg-print-preview-canvas--sheet-inspection)
7. [Intelligent Multi-Printer Routing & Fallback Hub](#7-intelligent-multi-printer-routing--fallback-hub)
8. [Live Print Spooler Hub (Silent Automated Windows Printing)](#8-live-print-spooler-hub-silent-automated-windows-printing)
9. [Payment Settlement, Razorpay UPI & Standee BharatQR (Mode 19)](#9-payment-settlement-razorpay-upi--standee-bharatqr-mode-19)
10. [Corporate Portals & B2B Monthly Credit Accounts](#10-corporate-portals--b2b-monthly-credit-accounts)
11. [Station Licensing, Page Wallet & Smart Dual Metering](#11-station-licensing-page-wallet--smart-dual-metering)
12. [Offline Key Issuance & WhatsApp Dispatch](#12-offline-key-issuance--whatsapp-dispatch)
13. [Payment History Ledger & Official GST Tax Invoices](#13-payment-history-ledger--official-gst-tax-invoices)
14. [Disaster Recovery, Encrypted Backups & Excel Reports](#14-disaster-recovery-encrypted-backups--excel-reports)
15. [Frequently Asked Questions (FAQ) & Troubleshooting](#15-frequently-asked-questions-faq--troubleshooting)
16. [Keyboard Shortcuts & Operator Cheat Sheet](#16-keyboard-shortcuts--operator-cheat-sheet)
17. [Documentation Update Log & Feature Tracker](#17-documentation-update-log--feature-tracker)

---

## 1. Introduction & Architectural Highlights
**PrintDrop Retail Core** is a zero-latency, local-first counter automation software tailored for Xerox centers, cyber cafes, and commercial digital print shops. 

### Why PrintDrop?
- **Zero App Download for Customers:** Customers scan a QR code on your counter standee and upload PDFs, Word documents, Excel spreadsheets, photos, and posters directly from their phone browser (Safari, Chrome, Firefox).
- **Zero Internet Dependency (Offline LAN Mode):** Operates 100% locally through your shop's Wi-Fi router or Windows Mobile Hotspot. Even during total broadband internet outages, local printing and counter operations continue uninterrupted.
- **Smart CGNAT Bypass & Cloudflare Quick Tunnels:** For customers without Wi-Fi access or using mobile 4G/5G data, PrintDrop automatically initializes an encrypted Cloudflare Tunnel, giving your shop an instant public HTTPS upload address without static IP costs or router port-forwarding.
- **Automated Silent Headless Printing:** Spools print jobs via high-performance headless SumatraPDF directly to Windows print queues without interactive OS print popups.
- **Customer Privacy Protection:** Files are temporarily stored only on your PC's local storage and auto-purged following order completion.

---

## 2. 1-Minute Quick Start Guide
Follow this routine every morning when opening your shop:

1. **Turn on your Computer & Printers:** Ensure USB / Network cables are connected and paper trays are loaded.
2. **Launch PrintDrop Desktop App:** The application automatically starts the local HTTP receiver and checks Windows printer statuses.
3. **Display Countertop Standee:** Place your PrintDrop acrylic standee or printed BharatQR poster where walk-in customers can see it.
4. **Customer Scans QR Code:** Customer scans with their smartphone camera, selects their documents, sets desired color/duplex/copies, and taps "Send to Counter".
5. **Review & Print:** The order flashes on your screen with real-time billing. Inspect or preview with one click, then press **"Print Batch"**.
6. **Collect Payment:** Collect via UPI Standee QR, Razorpay Intent, or Cash, and hand over the prints.

---

## 3. Countertop Hotspot & QR Code Setup
PrintDrop generates high-resolution vector and raster QR codes linked to your counter:

### Network Interfaces
The app automatically detects all network adapters:
- **Wi-Fi LAN (e.g., `192.168.1.5:4000`):** Ideal when customers connect to your shop Wi-Fi or guest hotspot.
- **Tailscale / VPN:** For multi-branch print networks or remote university campus kiosks.
- **Cloudflare Public Tunnel:** Generates a public HTTPS link (e.g., `https://*.trycloudflare.com`) accessible from any cellular data network (Jio, Airtel, Vi).

### Printing Standee Posters
1. Open the top-right options and click **"Counter Standee"** or **"Poster"**.
2. Select your template (Compact Countertop Acrylic 4x6, Wall Banner A4, or Table Standee).
3. The poster embeds your Shop Name, Wi-Fi SSID, Password, and Counter Upload QR code.
4. Click **Print Poster** to produce your permanent counter standee.

---

## 4. Live Mobile Web Upload Engine (Zero-App Customer Experience)
The customer-facing portal runs as a progressive lightweight mobile web page:
- **Supported Formats:** PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, JPG, PNG, WEBP, TIFF, TXT.
- **Large File Chunking:** Uses 5MB client-side chunking to seamlessly upload files up to 500MB without RAM bottlenecks or Cloudflare 100MB body limits.
- **Instant Preflight Settings:** Customers can select Black & White vs Color, Single vs Double Sided, Page Ranges, and Copies directly on their phone before uploading.

---

## 5. Order Management, Preflight Billing & Express Calculation
When an order arrives, PrintDrop automatically calculates the exact bill based on your configured rate card.

### Dynamic Billing Formula:
- **Single-Sided (Simplex):** $\text{Simplex Pages} \times \text{Simplex Rate} \times \text{Copies}$
- **Double-Sided (Duplex):** $\lfloor \frac{\text{Pages}}{2} \rfloor \times \text{Duplex Sheet Discount Rate} \times \text{Copies} + (\text{Odd Page} \times \text{Simplex Rate})$
- **Multi-File Aggregation:** Different documents in the same order (e.g., 5 pages B&W + 2 pages Color) are calculated independently and summed into a consolidated counter bill.

### Order Status Lifecycle:
- `PENDING_REVIEW`: Newly received order awaiting operator inspection.
- `AWAITING_PRINT`: Operator verified files and queued them for spooling.
- `PRINTING`: Spooling active to physical hardware.
- `COMPLETED`: Finished printing, payment settled, archived in ledger.
- `REJECTED`: Invalid file, unreadable password-protected file, or customer cancelled.

---

## 6. WYSIWYG Print Preview Canvas & Sheet Inspection
Avoid printing mistakes and wasted paper using the interactive Canvas Preview:

1. Click on any file in an incoming order to open the **Print Preview Canvas**.
2. **Page Range Editing:** Enter custom ranges (e.g., `1-3, 5, 10-15`). Notice how the price and total sheet count recalculate instantly!
3. **Interactive Sheet Flip:** Flip through pages to inspect margins, orientation, and color vs black & white balance.
4. **Orientation & Rotation:** Rotate landscape spreadsheets or drawings by 90°, 180°, or 270°.
5. **Apply Settings:** Saves updated settings directly to the order and updates billing before sending to physical printers.

---

## 7. Intelligent Multi-Printer Routing & Fallback Hub
Under **Settings > Route Rules**, shopkeepers with multiple printers can automate job routing:

- **B&W Laser Queue:** Route all B&W A4/Legal simplex and duplex jobs to high-speed laser printers (e.g., HP LaserJet, Canon LBP).
- **Color Ink Tank Queue:** Route photo papers, brochures, and color PDFs to your ink tank printer (e.g., Epson EcoTank, Canon G-series).
- **Plotter / Large Format:** Route architectural blueprints and A3 drawings to wide-format printers.
- **Automatic Fallback:** If the primary B&W printer is offline or out of paper, PrintDrop can cascade print jobs to your secondary printer automatically.

---

## 8. Live Print Spooler Hub (Silent Automated Windows Printing)
The Spooler Hub manages the physical Windows print queue:
- **SumatraPDF Silent Execution:** Executes background headless spooling (`-print-to "PrinterName" -print-settings "..."`).
- **Zero OS Popups:** No interactive print prompts block your billing computer screen.
- **Pause & Resume Controls:** Temporarily hold batch spooling to reload paper trays or change toner cartridges without cancelling orders.
- **Re-spooling:** If a paper jam occurs mid-job, click on the specific file in the Spooler Hub to reprint only the remaining sheets.

---

## 9. Payment Settlement, Razorpay UPI & Standee BharatQR (Mode 19)
PrintDrop provides a complete financial settlement suite:

### 1. Counter Standee Standalone BharatQR (NPCI Mode 19)
- Static QR code printed on your desk standee.
- Customer scans using PhonePe, Google Pay, Paytm, or BHIM.
- Operator marks order as "Paid (UPI)" with 1 click.

### 2. Fast-Forward UPI Intent (Mobile Web Checkout)
- Customer clicks "Pay via UPI" on their smartphone screen.
- Pops Android native UPI app sheet (PhonePe, GPay, Paytm) with exact bill amount pre-filled.
- Zero manual payment amount errors!

### 3. Cash Settlement
- Quick mark-off for walk-in cash payments with automatic change calculation.

---

## 10. Corporate Portals & B2B Monthly Credit Accounts
For frequent corporate clients (colleges, advocate offices, architects, clinics):

1. Go to **Settings > Corporate Portals**.
2. Click **Add Corporate Account** and set a Business Name (e.g., "Apex Legal Chambers").
3. Assign a permanent 4-digit PIN (e.g., `5588`).
4. Give the client their custom upload link: `https://your-shop.printdrop.in/corp/apex-legal`.
5. Authorized staff enter their PIN to submit orders with company billing notes.
6. **Credit Tab (Khata):** Review monthly balances, generate PDF invoices, and export statements to Excel for end-of-month settlement.

---

## 11. Station Licensing, Page Wallet & Smart Dual Metering
PrintDrop offers transparent commercial plans:

### License Models:
1. **Model A: Pay-As-You-Go Page Wallet:**
   - Buy page packs (e.g., 5,000 pages for ₹749, 10,000 pages for ₹1,399).
   - **No Expiration Date:** Permanent lifetime quota that decrements only as you print.
2. **Model B: Unlimited Time Subscription:**
   - 30-Day Monthly (₹299), Quarterly (₹799), or Annual (₹2,499) Unlimited plans.
   - Print unlimited sheets with zero per-page deductions.
3. **Smart Priority Dual Metering:**
   - If you hold **both** an Unlimited Monthly Plan and a Page Wallet pack, PrintDrop automatically prioritizes the time plan.
   - Your Page Wallet balance remains 100% frozen in reserve and begins consuming only if your time subscription lapses!
4. **Trial Mode:**
   - New installations include a 14-day full-access trial. Purchasing any plan during the trial immediately activates your purchased plan.

---

## 12. Offline Key Issuance & WhatsApp Dispatch
If your billing computer is offline or in a restricted network:
1. Copy your **Hardware ID (HWID)** from the top-right license pill.
2. Send your HWID to your software provider via WhatsApp or Phone.
3. The provider issues a signed Base64 Activation Key.
4. In the app, open **Settings > Station License > Offline Key**, paste the key, and click **Activate Station**.
5. Your station immediately unlocks without internet!

---

## 13. Payment History Ledger & Official GST Tax Invoices
Under **Settings > Station License > Payment History**:
- View every license recharge and subscription payment made to date.
- Shows Transaction Date, Plan Purchased, Quota Granted, Bank UTR Reference, and Official Invoice Number.
- Click **"Print Tax Invoice"** anytime to view and print an official GST-compliant tax receipt and license certificate for your accounting records.

---

## 14. Disaster Recovery, Encrypted Backups & Excel Reports
Under **Settings > Backup & Restore**:
- **Encrypted Local Backups (`.pdropbak`):** Back up your pricing rate cards, corporate portal accounts, customer history, and print counter configurations in an AES-encrypted archive.
- **1-Click Restore:** Migrate or restore all settings onto a new computer in under 10 seconds.
- **Excel Ledger Export:** Export detailed daily, weekly, or monthly revenue reports (`.xlsx`) categorized by B&W, Color, Cash, and UPI.

---

## 15. Frequently Asked Questions (FAQ) & Troubleshooting

### Q1: Customer phone cannot open the upload page / Connection timed out?
> **Answer:**
> - Ensure the customer is connected to your shop's Wi-Fi network.
> - If the customer is on mobile 4G/5G data, make sure they scan the **Cloudflare Tunnel QR Code** rather than the local IP address.
> - Check that the Windows Firewall allows incoming connections on port `4000`.

### Q2: A document failed to print or printer shows "Offline"?
> **Answer:**
> - Open **Settings > Live Print Spooler** to verify the job status.
> - Check your printer's USB / LAN cable and ensure paper tray 1 is loaded.
> - If Windows print spooler is stuck, click "Restart Spooler" in Windows Services or reboot the printer.

### Q3: Can customers upload files when shop internet is completely down?
> **Answer:**
> - **YES!** PrintDrop hosts a local HTTP server directly on your Wi-Fi router or laptop hotspot (`http://192.168.x.x:4000`). Local Wi-Fi document transfers do not require an active internet connection.

### Q4: Customer uploaded a password-protected PDF. Can PrintDrop print it?
> **Answer:**
> - Password-protected documents cannot be rasterized silently without the key. In the Order Inspection modal, enter the client's PDF password, unlock the preview, and proceed with spooling.

### Q5: How do I transfer my license to a new billing computer?
> **Answer:**
> - PrintDrop licenses are cryptographically bound to your PC's Motherboard and CPU Hardware ID (HWID) to prevent unauthorized duplication.
> - Contact software support with your registered shop phone number and invoice. Your previous hardware token will be migrated to your new PC's HWID.

---

## 16. Keyboard Shortcuts & Operator Cheat Sheet

| Shortcut | Action Description |
| :--- | :--- |
| **`Esc`** | Close open modal, cancel preview, or exit full-page ledger |
| **`Double-Click Row`** | Immediately open full order inspection modal |
| **`Click License Pill`** | Open Station Hardware ID, plan status, and payment history |
| **`Alt + R`** | Refresh order list and check incoming uploads |

---

## 17. Documentation Update Log & Feature Tracker

| Version | Date | Key Modules Updated | Notes |
| :--- | :--- | :--- | :--- |
| **v1.0.0** | 14-Nov-2026 | Initial Core Release | Full offline Wi-Fi receiver, Cloudflare tunnels, SumatraPDF spooler, WYSIWYG canvas, BharatQR Mode 19, Smart Dual-Metering licensing, and in-app operator manual. |
| **v1.1.0** | *Upcoming* | Automatic WhatsApp Bill Receipt | Automatic delivery of tax invoices to customer phone numbers upon print completion. |

---
*PrintDrop Retail Core Engine &copy; 2026 TechnoSoft Solution. All rights reserved.*
