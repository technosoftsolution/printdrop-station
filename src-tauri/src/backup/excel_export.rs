use rusqlite::Connection;
use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook};
use std::path::Path;

pub fn generate_financial_excel_report(
    conn: &Connection,
    target_path: &Path,
    password: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let mut workbook = Workbook::new();

    // 1. Setup styles
    let title_format = Format::new()
        .set_bold()
        .set_font_size(16)
        .set_font_color(Color::RGB(0x0F172A));

    let subtitle_format = Format::new()
        .set_italic()
        .set_font_size(10)
        .set_font_color(Color::RGB(0x64748B));

    let header_format = Format::new()
        .set_bold()
        .set_font_size(11)
        .set_font_color(Color::White)
        .set_background_color(Color::RGB(0x0F172A))
        .set_align(FormatAlign::Center)
        .set_border(FormatBorder::Thin);

    let kpi_label_format = Format::new()
        .set_bold()
        .set_font_size(10)
        .set_background_color(Color::RGB(0xF1F5F9))
        .set_border(FormatBorder::Thin);

    let kpi_value_format = Format::new()
        .set_bold()
        .set_font_size(13)
        .set_align(FormatAlign::Right)
        .set_border(FormatBorder::Thin)
        .set_num_format("₹#,##0.00");

    let cell_format = Format::new()
        .set_font_size(10)
        .set_border(FormatBorder::Thin);

    let cell_center_format = Format::new()
        .set_font_size(10)
        .set_align(FormatAlign::Center)
        .set_border(FormatBorder::Thin);

    let currency_format = Format::new()
        .set_font_size(10)
        .set_align(FormatAlign::Right)
        .set_border(FormatBorder::Thin)
        .set_num_format("₹#,##0.00");

    let date_format = Format::new()
        .set_font_size(10)
        .set_align(FormatAlign::Center)
        .set_border(FormatBorder::Thin);

    // ==========================================
    // SHEET 1: Financial Summary & KPIs
    // ==========================================
    let sheet1 = workbook.add_worksheet();
    sheet1.set_name("Financial Summary")?;

    sheet1.write_with_format(0, 0, "PrintDrop — Financial & Operational Audit Report", &title_format)?;
    let timestamp_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sheet1.write_with_format(1, 0, format!("Generated on: {} | System Host: Local Desktop", timestamp_str), &subtitle_format)?;

    // Query high-level KPIs
    let total_orders: i64 = conn.query_row("SELECT count(*) FROM orders", [], |r| r.get(0)).unwrap_or(0);
    let completed_orders: i64 = conn.query_row("SELECT count(*) FROM orders WHERE status = 'COMPLETED'", [], |r| r.get(0)).unwrap_or(0);
    let total_revenue: f64 = conn.query_row(
        "SELECT coalesce(sum(total_amount), 0.0) FROM order_billings WHERE payment_status = 'PAID'",
        [],
        |r| r.get(0),
    ).unwrap_or(0.0);
    let cash_collections: f64 = conn.query_row(
        "SELECT coalesce(sum(total_amount), 0.0) FROM order_billings WHERE payment_status = 'PAID' AND payment_method = 'CASH'",
        [],
        |r| r.get(0),
    ).unwrap_or(0.0);
    let online_upi_collections: f64 = conn.query_row(
        "SELECT coalesce(sum(total_amount), 0.0) FROM order_billings WHERE payment_status = 'PAID' AND payment_method = 'ONLINE'",
        [],
        |r| r.get(0),
    ).unwrap_or(0.0);
    let credit_due: f64 = conn.query_row(
        "SELECT coalesce(sum(total_amount), 0.0) FROM order_billings WHERE payment_status IN ('UNPAID', 'CREDIT')",
        [],
        |r| r.get(0),
    ).unwrap_or(0.0);
    let corporate_count: i64 = conn.query_row("SELECT count(*) FROM corporate_clients", [], |r| r.get(0)).unwrap_or(0);

    // Render KPI Table
    let kpi_items: Vec<(&str, f64, bool)> = vec![
        ("Total Net Collections (Paid)", total_revenue, true),
        ("Cash Register Collections", cash_collections, true),
        ("Razorpay & BharatQR UPI Collections", online_upi_collections, true),
        ("Outstanding Balance / Credit Due", credit_due, true),
        ("Total Print Orders Processed", total_orders as f64, false),
        ("Successfully Completed Print Jobs", completed_orders as f64, false),
        ("Active Corporate Portals", corporate_count as f64, false),
    ];

    sheet1.write_with_format(3, 0, "Business Metric", &header_format)?;
    sheet1.write_with_format(3, 1, "Recorded Value", &header_format)?;

    let mut row_idx = 4;
    for (label, val, is_currency) in kpi_items {
        sheet1.write_with_format(row_idx, 0, label, &kpi_label_format)?;
        if is_currency {
            sheet1.write_with_format(row_idx, 1, val, &kpi_value_format)?;
        } else {
            sheet1.write_with_format(row_idx, 1, val as i64, &cell_center_format)?;
        }
        row_idx += 1;
    }

    sheet1.set_column_width(0, 38)?;
    sheet1.set_column_width(1, 24)?;

    if !password.trim().is_empty() {
        sheet1.protect_with_password(password);
    }

    // ==========================================
    // SHEET 2: Print Jobs Ledger
    // ==========================================
    let sheet2 = workbook.add_worksheet();
    sheet2.set_name("Print Jobs Ledger")?;

    let ledger_headers = [
        "Order Date & Time",
        "Order ID",
        "Customer Name",
        "Device / Phone",
        "Pickup PIN",
        "Job Status",
        "Total Bill",
        "Payment Status",
        "Payment Mode",
        "Paid Timestamp",
    ];

    for (c, h) in ledger_headers.iter().enumerate() {
        sheet2.write_with_format(0, c as u16, *h, &header_format)?;
    }

    let mut stmt = conn.prepare(
        "SELECT o.created_at, o.id, coalesce(o.customer_name, 'Walk-in Customer'), 
                coalesce(o.device_model, 'Desk PC'), coalesce(o.pickup_code, '----'), o.status,
                coalesce(b.total_amount, 0.0), coalesce(b.payment_status, 'UNPAID'), 
                coalesce(b.payment_method, 'NONE'), coalesce(b.paid_at, '-')
         FROM orders o
         LEFT JOIN order_billings b ON o.id = b.order_id
         ORDER BY o.created_at DESC"
    )?;

    let mut ledger_rows = stmt.query([])?;
    let mut row = 1;
    while let Some(r) = ledger_rows.next()? {
        let created_at: String = r.get(0)?;
        let order_id: String = r.get(1)?;
        let customer: String = r.get(2)?;
        let device: String = r.get(3)?;
        let pin: String = r.get(4)?;
        let status: String = r.get(5)?;
        let total: f64 = r.get(6)?;
        let pay_status: String = r.get(7)?;
        let pay_method: String = r.get(8)?;
        let paid_at: String = r.get(9)?;

        sheet2.write_with_format(row, 0, created_at, &date_format)?;
        sheet2.write_with_format(row, 1, order_id, &cell_center_format)?;
        sheet2.write_with_format(row, 2, customer, &cell_format)?;
        sheet2.write_with_format(row, 3, device, &cell_format)?;
        sheet2.write_with_format(row, 4, pin, &cell_center_format)?;
        sheet2.write_with_format(row, 5, status, &cell_center_format)?;
        sheet2.write_with_format(row, 6, total, &currency_format)?;
        sheet2.write_with_format(row, 7, pay_status, &cell_center_format)?;
        sheet2.write_with_format(row, 8, pay_method, &cell_center_format)?;
        sheet2.write_with_format(row, 9, paid_at, &date_format)?;
        row += 1;
    }

    sheet2.set_column_width(0, 20)?;
    sheet2.set_column_width(1, 16)?;
    sheet2.set_column_width(2, 22)?;
    sheet2.set_column_width(3, 20)?;
    sheet2.set_column_width(4, 12)?;
    sheet2.set_column_width(5, 16)?;
    sheet2.set_column_width(6, 14)?;
    sheet2.set_column_width(7, 16)?;
    sheet2.set_column_width(8, 14)?;
    sheet2.set_column_width(9, 20)?;

    if !password.trim().is_empty() {
        sheet2.protect_with_password(password);
    }

    // ==========================================
    // SHEET 3: Itemized Documents
    // ==========================================
    let sheet3 = workbook.add_worksheet();
    sheet3.set_name("Itemized Documents")?;

    let doc_headers = [
        "Order ID",
        "Document Name",
        "Pages Range",
        "Copies",
        "Duplex Mode",
        "Color Mode",
        "Paper Size",
        "Rotation",
        "File Size",
    ];

    for (c, h) in doc_headers.iter().enumerate() {
        sheet3.write_with_format(0, c as u16, *h, &header_format)?;
    }

    let mut doc_stmt = conn.prepare(
        "SELECT f.order_id, f.original_filename, coalesce(ps.page_range, 'All'), 
                coalesce(ps.copies, 1), coalesce(ps.duplex_mode, 'SIMPLEX'), 
                coalesce(ps.color_mode, 'BW'), coalesce(ps.paper_size, 'A4'), 
                coalesce(ps.rotation, 0), coalesce(fr.file_size_bytes, 0)
         FROM files f
         LEFT JOIN file_revisions fr ON f.id = fr.file_id
         LEFT JOIN print_settings ps ON fr.id = ps.file_revision_id
         ORDER BY f.created_at DESC"
    )?;

    let mut doc_rows = doc_stmt.query([])?;
    let mut doc_row = 1;
    while let Some(r) = doc_rows.next()? {
        let order_id: String = r.get(0)?;
        let filename: String = r.get(1)?;
        let pages: String = r.get(2)?;
        let copies: i64 = r.get(3)?;
        let duplex: String = r.get(4)?;
        let color: String = r.get(5)?;
        let paper: String = r.get(6)?;
        let rot: i64 = r.get(7)?;
        let size_bytes: i64 = r.get(8)?;
        let size_kb = (size_bytes as f64) / 1024.0;

        sheet3.write_with_format(doc_row, 0, order_id, &cell_center_format)?;
        sheet3.write_with_format(doc_row, 1, filename, &cell_format)?;
        sheet3.write_with_format(doc_row, 2, pages, &cell_center_format)?;
        sheet3.write_with_format(doc_row, 3, copies, &cell_center_format)?;
        sheet3.write_with_format(doc_row, 4, duplex, &cell_center_format)?;
        sheet3.write_with_format(doc_row, 5, color, &cell_center_format)?;
        sheet3.write_with_format(doc_row, 6, paper, &cell_center_format)?;
        sheet3.write_with_format(doc_row, 7, format!("{}°", rot), &cell_center_format)?;
        sheet3.write_with_format(doc_row, 8, format!("{:.1} KB", size_kb), &cell_center_format)?;
        doc_row += 1;
    }

    sheet3.set_column_width(0, 16)?;
    sheet3.set_column_width(1, 34)?;
    sheet3.set_column_width(2, 14)?;
    sheet3.set_column_width(3, 10)?;
    sheet3.set_column_width(4, 14)?;
    sheet3.set_column_width(5, 12)?;
    sheet3.set_column_width(6, 12)?;
    sheet3.set_column_width(7, 10)?;
    sheet3.set_column_width(8, 14)?;

    if !password.trim().is_empty() {
        sheet3.protect_with_password(password);
    }

    // ==========================================
    // SHEET 4: Corporate Portals
    // ==========================================
    let sheet4 = workbook.add_worksheet();
    sheet4.set_name("Corporate Portals")?;

    let corp_headers = [
        "Client ID",
        "Organization Name",
        "Billing Account / Terms",
        "Active Status",
        "Total Orders",
        "Total Billing (₹)",
        "Registered On",
    ];

    for (c, h) in corp_headers.iter().enumerate() {
        sheet4.write_with_format(0, c as u16, *h, &header_format)?;
    }

    let mut corp_stmt = conn.prepare(
        "SELECT c.id, c.name, coalesce(c.billing_account, 'Standard Monthly'), 
                c.is_active, c.created_at,
                (SELECT count(*) FROM orders WHERE corporate_client_id = c.id),
                (SELECT coalesce(sum(total_amount), 0.0) FROM order_billings WHERE corporate_client_id = c.id)
         FROM corporate_clients c
         ORDER BY c.created_at DESC"
    )?;

    let mut corp_rows = corp_stmt.query([])?;
    let mut c_row = 1;
    while let Some(r) = corp_rows.next()? {
        let cid: String = r.get(0)?;
        let cname: String = r.get(1)?;
        let billing: String = r.get(2)?;
        let active: bool = r.get(3)?;
        let created: String = r.get(4)?;
        let orders_cnt: i64 = r.get(5)?;
        let spent: f64 = r.get(6)?;

        sheet4.write_with_format(c_row, 0, cid, &cell_center_format)?;
        sheet4.write_with_format(c_row, 1, cname, &cell_format)?;
        sheet4.write_with_format(c_row, 2, billing, &cell_format)?;
        sheet4.write_with_format(c_row, 3, if active { "ACTIVE" } else { "INACTIVE" }, &cell_center_format)?;
        sheet4.write_with_format(c_row, 4, orders_cnt, &cell_center_format)?;
        sheet4.write_with_format(c_row, 5, spent, &currency_format)?;
        sheet4.write_with_format(c_row, 6, created, &date_format)?;
        c_row += 1;
    }

    sheet4.set_column_width(0, 16)?;
    sheet4.set_column_width(1, 26)?;
    sheet4.set_column_width(2, 24)?;
    sheet4.set_column_width(3, 14)?;
    sheet4.set_column_width(4, 14)?;
    sheet4.set_column_width(5, 18)?;
    sheet4.set_column_width(6, 20)?;

    if !password.trim().is_empty() {
        sheet4.protect_with_password(password);
    }

    // Save Workbook to target file
    workbook.save(target_path)?;

    Ok(target_path.to_string_lossy().to_string())
}
