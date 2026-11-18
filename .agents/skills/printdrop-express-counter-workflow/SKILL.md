---
name: printdrop-express-counter-workflow
description: >
  Retail print shop order lifecycle, preflight billing engine, and counter reconciliation runbook.
  Covers dynamic client-side preflight pricing calculation (B&W vs Color rates, duplex sheet discounts,
  copies multiplier), Sent Orders policy (Awaiting Printing vs Payment Due deferral), multi-modal
  payment settlement (Razorpay UPI, Counter Standee BharatQR Mode 19, Cash), and customer privacy erasure.
---

# PrintDrop Express Counter Workflow & Preflight Billing Engine

## Purpose & Scope

This skill provides an **end-to-end design and operational runbook for retail walk-in printing, copy shop counters, and document centers**. It details the exact state-machine policies for document staging, real-time cost estimation, shopkeeper approval gates, deferred payment collection, and customer token identification.

---

## Quick Reference & Pitfall Table

| Problem / Pitfall | Root Cause | Permanent Production Solution |
| :--- | :--- | :--- |
| **Customer pays via UPI, but shopkeeper rejects printing** | Allowing customers to pay in the "Sent Orders" stage before the shopkeeper inspects and approves the job. | **Payment Deferral Policy**: Sent Orders tab strictly displays `⏳ Awaiting Printing` and hides payment buttons. Payment is unlocked only in the **Printed Jobs** tab once pages are physically printed. |
| **Customer shocked by counter bill after printing** | Lack of preflight transparency during file selection. | Compute dynamic real-time file costs on each Draft card (`Cost: ₹XX.XX`) immediately updating when copies or Color/B&W toggle changes. |
| **Shopkeeper cannot match printed papers to customer** | Customer names/numbers not collected during walk-in staging. | Auto-generate an 8-character unique Pickup Code (`#8952`) displayed on customer screen and top of printed job banner. |
| **Customer fears shopkeeper will keep personal documents** | Staged files remain accessible on shop PC indefinitely. | Customer-controlled file purge: Provide an instant "Erase Files from Counter PC" button wiping staged files immediately after payment. |

---

## §1: The 3-Stage Express Counter State Machine

```
┌────────────────────────┐      ┌────────────────────────┐      ┌────────────────────────┐
│     STAGE 1: DRAFTS    │      │  STAGE 2: SENT ORDERS  │      │ STAGE 3: PRINTED JOBS  │
│ (Customer Phone / PC)  │      │   (Shopkeeper Queue)   │      │   (Payment & Pickup)   │
├────────────────────────┤      ├────────────────────────┤      ├────────────────────────┤
│ • Multi-file staging   │      │ • Order #XXXX created  │      │ • Physical prints done │
│ • Live Preflight Cost  │ ───> │ • Awaiting Approval    │ ───> │ • Status: Payment Due  │
│ • B&W / Color toggle   │      │ • Awaiting Printing    │      │ • Multi-Modal Payment: │
│ • Estimated Total Bill │      │ • NO payment button    │      │   UPI, QR Scan, Cash   │
└────────────────────────┘      └────────────────────────┘      └────────────────────────┘
```

---

## §2: Preflight Pricing Engine Formulation

### Pricing Rate Card Structure
```json
{
  "bw_single_sided": 3.0,
  "bw_double_sided_per_sheet": 5.0,
  "color_single_sided": 10.0,
  "color_double_sided_per_sheet": 18.0,
  "legal_surcharge": 2.0,
  "a3_multiplier": 2.0
}
```

### Mathematical Formula for File Cost:
$$\text{Effective Sheets} = \begin{cases} \lceil \text{Pages} / 2 \rceil & \text{if Duplex} \\ \text{Pages} & \text{if Simplex} \end{cases}$$

$$\text{Per-Sheet Rate} = \begin{cases} \text{Rate}_{\text{BW, Duplex}} & \text{if B\&W and Duplex} \\ \text{Rate}_{\text{BW, Simplex}} & \text{if B\&W and Simplex} \\ \text{Rate}_{\text{Color, Duplex}} & \text{if Color and Duplex} \\ \text{Rate}_{\text{Color, Simplex}} & \text{if Color and Simplex} \end{cases}$$

$$\text{File Total Cost} = \text{Effective Sheets} \times \text{Per-Sheet Rate} \times \text{Copies}$$

### JavaScript Preflight Implementation (`customer.html`)

```javascript
function calculateFileCost(fileObj, pricingRates) {
  const settings = fileObj.settings;
  const isColor = settings.colorMode === "COLOR";
  const isDuplex = settings.duplexMode.includes("DUPLEX");
  const copies = Math.max(1, settings.copies || 1);
  const pageCount = parsePageRangeCount(settings.pageRange) || fileObj.docInfo.pageCount || 1;

  let sheetCount = isDuplex ? Math.ceil(pageCount / 2) : pageCount;
  let unitRate = 3.0; // default fallback

  if (isColor) {
    unitRate = isDuplex ? (pricingRates.color_double_sided_per_sheet / 2) : pricingRates.color_single_sided;
  } else {
    unitRate = isDuplex ? (pricingRates.bw_double_sided_per_sheet / 2) : pricingRates.bw_single_sided;
  }

  return (sheetCount * unitRate * copies);
}
```

---

## §3: Action Row Layout & Interactive Toggles

To provide an intuitive UX on both mobile touchscreens and desktop screens, arrange file card action controls strictly in this order:

```html
<div class="file-actions-row">
  <!-- 1. Preview Button -->
  <button class="btn-preview" onclick="openPreview('${file.id}')">👁️ Preview</button>

  <!-- 2. One-Tap Color Mode Toggle Button -->
  <button class="btn-color-toggle" onclick="toggleColorMode('${file.id}')">
    ${isColor ? "🌈 Color" : "⬛ B&W"}
  </button>

  <!-- 3. Dynamic Cost Badge (Center) -->
  <span class="file-cost-badge">Cost: ₹${fileCost.toFixed(2)}</span>

  <!-- 4. Delete File Button -->
  <button class="btn-delete" onclick="removeFile('${file.id}')">🗑️</button>
</div>
```

---

## §4: Payment Settlement Multi-Modal Engine

When an order moves to **Printed Jobs**, activate the settlement modal supporting all counter checkout methods:

1. **⚡ 1-Tap Fast-Forward UPI Intent (`payWithRazorpay`)**:
   - Launches Razorpay's dedicated fast-forwarding UPI Link (`/i/` with `upi_link: true`).
   - Displays the animated horizontal flying rocket box and pops the native Android UPI sheet (PhonePe, GPay, Paytm, BHIM) directly without intermediate forms or mobile number prompts.
2. **📱 Show QR & Pay (2nd Mobile Handset / Laptop Web Flow)**:
   - Displays the Desktop Application's Front-Desk UPI Standee Razorpay QR Code (NPCI Mode 19) directly on the customer's screen with the exact bill amount prefilled.
   - Includes a **5-Minute Live Countdown Timer** (`05:00` ticking down second-by-second).
   - Features **Real-Time Payment Sensing**: Polls `/api/payment/razorpay/verify` every 2.5s. As soon as the user completes the payment on their 2nd phone, the modal senses the captured transaction, displays a verified checkmark, and automatically advances the order to `Payment Verified • Shredder Ready`.
3. **📷 Scan Standee (`startWalkInCounterQrScan`)**:
   - Opens the device's live camera viewfinder to scan the physical acrylic desk standee directly at the shop counter.
4. **💵 Cash / Offline Payment at Counter**:
   - Customer taps *"Pay Cash at Desk"*; shopkeeper clicks *"Mark Paid (Cash)"* in desktop dashboard.
