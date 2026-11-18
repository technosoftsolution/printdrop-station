use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;
use tracing::info;
use zip::ZipArchive;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcelSheetInfo {
    pub sheet_index: usize,
    pub name: String,
    pub is_empty: bool,
    pub dimension: Option<String>,
    pub row_count: usize,
    pub col_count: usize,
    pub has_user_print_setup: bool,
    pub detected_orientation: String,
    pub detected_paper_size: Option<String>,
    pub fit_to_width: Option<u32>,
    pub fit_to_height: Option<u32>,
    pub print_area: Option<String>,
    pub recommended_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcelMetadata {
    pub total_sheets: usize,
    pub populated_sheets: usize,
    pub sheets: Vec<ExcelSheetInfo>,
}

fn col_to_index(col_str: &str) -> usize {
    let mut result = 0;
    for c in col_str.chars() {
        if c.is_ascii_uppercase() {
            result = result * 26 + (c as usize - 'A' as usize + 1);
        }
    }
    result
}

fn parse_cell_ref(cell: &str) -> (usize, usize) {
    let col_str: String = cell.chars().take_while(|c| c.is_ascii_alphabetic()).collect();
    let row_str: String = cell.chars().skip_while(|c| c.is_ascii_alphabetic()).collect();
    let col = col_to_index(&col_str.to_ascii_uppercase());
    let row = row_str.parse::<usize>().unwrap_or(0);
    (col, row)
}

fn parse_dimension(dim: &str) -> (usize, usize) {
    let parts: Vec<&str> = dim.split(':').collect();
    if parts.len() == 2 {
        let (c1, r1) = parse_cell_ref(parts[0]);
        let (c2, r2) = parse_cell_ref(parts[1]);
        let rows = if r2 >= r1 { r2 - r1 + 1 } else { 0 };
        let cols = if c2 >= c1 { c2 - c1 + 1 } else { 0 };
        (rows, cols)
    } else if parts.len() == 1 {
        let (c, r) = parse_cell_ref(parts[0]);
        if c > 0 && r > 0 { (1, 1) } else { (0, 0) }
    } else {
        (0, 0)
    }
}

fn map_paper_size(code: &str) -> Option<String> {
    match code {
        "1" => Some("Letter".to_string()),
        "3" => Some("Tabloid".to_string()),
        "5" => Some("Legal".to_string()),
        "8" => Some("A3".to_string()),
        "9" => Some("A4".to_string()),
        "11" => Some("A5".to_string()),
        "12" => Some("B4".to_string()),
        "13" => Some("B5".to_string()),
        _ => None,
    }
}

pub fn inspect_excel_file<P: AsRef<Path>>(path: P) -> Result<ExcelMetadata, String> {
    let file = File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let reader = BufReader::new(file);
    let mut zip = ZipArchive::new(reader).map_err(|e| format!("Not a valid zip archive (.xlsx): {}", e))?;

    // 1. Read workbook rels to map rId to worksheet filename
    let mut rid_to_target = HashMap::new();
    if let Ok(mut rels_file) = zip.by_name("xl/_rels/workbook.xml.rels") {
        let mut rels_content = String::new();
        if rels_file.read_to_string(&mut rels_content).is_ok() {
            let mut xml_reader = Reader::from_str(&rels_content);
            xml_reader.config_mut().trim_text(true);
            let mut buf = Vec::new();
            while let Ok(event) = xml_reader.read_event_into(&mut buf) {
                match event {
                    Event::Empty(ref e) | Event::Start(ref e) if e.name().as_ref() == b"Relationship" => {
                        let mut id = String::new();
                        let mut target = String::new();
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"Id" {
                                id = String::from_utf8_lossy(&attr.value).to_string();
                            } else if attr.key.as_ref() == b"Target" {
                                target = String::from_utf8_lossy(&attr.value).to_string();
                            }
                        }
                        if !id.is_empty() && !target.is_empty() {
                            rid_to_target.insert(id, target);
                        }
                    }
                    Event::Eof => break,
                    _ => {}
                }
                buf.clear();
            }
        }
    }

    // 2. Read workbook.xml for sheet names, rIds, and Print Areas
    let mut sheets_manifest = Vec::new();
    let mut print_areas = HashMap::new(); // sheetIndex -> printArea string

    if let Ok(mut wb_file) = zip.by_name("xl/workbook.xml") {
        let mut wb_content = String::new();
        if wb_file.read_to_string(&mut wb_content).is_ok() {
            let mut xml_reader = Reader::from_str(&wb_content);
            xml_reader.config_mut().trim_text(true);
            let mut buf = Vec::new();
            let mut current_defined_name: Option<(String, Option<usize>)> = None;

            while let Ok(event) = xml_reader.read_event_into(&mut buf) {
                match event {
                    Event::Empty(ref e) | Event::Start(ref e) if e.name().as_ref() == b"sheet" => {
                        let mut name = String::new();
                        let mut r_id = String::new();
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"name" {
                                name = String::from_utf8_lossy(&attr.value).to_string();
                            } else if attr.key.as_ref() == b"r:id" {
                                r_id = String::from_utf8_lossy(&attr.value).to_string();
                            }
                        }
                        if !name.is_empty() {
                            sheets_manifest.push((name, r_id));
                        }
                    }
                    Event::Start(ref e) if e.name().as_ref() == b"definedName" => {
                        let mut dname = String::new();
                        let mut local_sheet_id = None;
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"name" {
                                dname = String::from_utf8_lossy(&attr.value).to_string();
                            } else if attr.key.as_ref() == b"localSheetId" {
                                local_sheet_id = String::from_utf8_lossy(&attr.value).parse::<usize>().ok();
                            }
                        }
                        current_defined_name = Some((dname, local_sheet_id));
                    }
                    Event::Text(ref e) => {
                        if let Some((ref dname, local_id)) = current_defined_name {
                            if dname == "_xlnm.Print_Area" {
                                let val = e.unescape().unwrap_or_default().to_string();
                                if let Some(idx) = local_id {
                                    print_areas.insert(idx, val);
                                }
                            }
                        }
                    }
                    Event::End(ref e) if e.name().as_ref() == b"definedName" => {
                        current_defined_name = None;
                    }
                    Event::Eof => break,
                    _ => {}
                }
                buf.clear();
            }
        }
    }

    // 3. For each sheet, parse the corresponding worksheet xml
    let mut sheet_results = Vec::new();
    let mut populated_count = 0;

    for (idx, (sheet_name, r_id)) in sheets_manifest.iter().enumerate() {
        let target_path = rid_to_target.get(r_id).map(|s| s.as_str()).unwrap_or("");
        let zip_internal_path = if target_path.starts_with('/') {
            target_path.trim_start_matches('/').to_string()
        } else if target_path.starts_with("worksheets/") {
            format!("xl/{}", target_path)
        } else if !target_path.is_empty() {
            format!("xl/{}", target_path)
        } else {
            format!("xl/worksheets/sheet{}.xml", idx + 1)
        };

        let mut dimension = None;
        let mut row_count = 0;
        let mut col_count = 0;
        let mut orientation = "UNSPECIFIED".to_string();
        let mut paper_size = None;
        let mut fit_to_width = None;
        let mut fit_to_height = None;
        let mut has_user_print_setup = false;

        if let Ok(mut sheet_file) = zip.by_name(&zip_internal_path) {
            let mut sheet_content = String::new();
            if sheet_file.read_to_string(&mut sheet_content).is_ok() {
                let mut xml_reader = Reader::from_str(&sheet_content);
                xml_reader.config_mut().trim_text(true);
                let mut buf = Vec::new();
                let mut has_sheet_data_rows = false;

                while let Ok(event) = xml_reader.read_event_into(&mut buf) {
                    match event {
                        Event::Empty(ref e) | Event::Start(ref e) if e.name().as_ref() == b"dimension" => {
                            for attr in e.attributes().flatten() {
                                if attr.key.as_ref() == b"ref" {
                                    let dim_str = String::from_utf8_lossy(&attr.value).to_string();
                                    let (r, c) = parse_dimension(&dim_str);
                                    row_count = r;
                                    col_count = c;
                                    dimension = Some(dim_str);
                                }
                            }
                        }
                        Event::Start(ref e) if e.name().as_ref() == b"row" => {
                            has_sheet_data_rows = true;
                        }
                        Event::Empty(ref e) | Event::Start(ref e) if e.name().as_ref() == b"pageSetup" => {
                            has_user_print_setup = true;
                            for attr in e.attributes().flatten() {
                                if attr.key.as_ref() == b"orientation" {
                                    orientation = String::from_utf8_lossy(&attr.value).to_uppercase();
                                } else if attr.key.as_ref() == b"paperSize" {
                                    let val = String::from_utf8_lossy(&attr.value);
                                    paper_size = map_paper_size(&val);
                                } else if attr.key.as_ref() == b"fitToWidth" {
                                    fit_to_width = String::from_utf8_lossy(&attr.value).parse::<u32>().ok();
                                } else if attr.key.as_ref() == b"fitToHeight" {
                                    fit_to_height = String::from_utf8_lossy(&attr.value).parse::<u32>().ok();
                                }
                            }
                        }
                        Event::Eof => break,
                        _ => {}
                    }
                    buf.clear();
                }

                if row_count == 0 && has_sheet_data_rows {
                    row_count = 1; // Fallback if dimension tag was omitted
                    col_count = 1;
                }
            }
        }

        let is_empty = row_count == 0 || col_count == 0;
        if !is_empty {
            populated_count += 1;
        }

        let print_area = print_areas.get(&idx).cloned();
        if print_area.is_some() {
            has_user_print_setup = true;
        }

        // Compute intelligent recommendation
        let recommended_action = if is_empty {
            "Empty Sheet — Recommended to Skip".to_string()
        } else if col_count > 8 && orientation != "LANDSCAPE" {
            format!("Wide Table ({} columns) — Landscape & Fit to 1 Page Wide Recommended", col_count)
        } else if has_user_print_setup {
            "Pre-configured Author Print Setup Detected".to_string()
        } else {
            "Standard Portrait Layout".to_string()
        };

        sheet_results.push(ExcelSheetInfo {
            sheet_index: idx + 1,
            name: sheet_name.clone(),
            is_empty,
            dimension,
            row_count,
            col_count,
            has_user_print_setup,
            detected_orientation: orientation,
            detected_paper_size: paper_size,
            fit_to_width,
            fit_to_height,
            print_area,
            recommended_action,
        });
    }

    info!("Inspected Excel workbook: {} sheets, {} populated.", sheet_results.len(), populated_count);

    Ok(ExcelMetadata {
        total_sheets: sheet_results.len(),
        populated_sheets: populated_count,
        sheets: sheet_results,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::{ExtendedFileOptions, FileOptions};

    #[test]
    fn test_col_to_index_and_dimension() {
        assert_eq!(col_to_index("A"), 1);
        assert_eq!(col_to_index("B"), 2);
        assert_eq!(col_to_index("Z"), 26);
        assert_eq!(col_to_index("AA"), 27);
        assert_eq!(col_to_index("AB"), 28);

        let (rows, cols) = parse_dimension("A1:G42");
        assert_eq!(rows, 42);
        assert_eq!(cols, 7);

        let (rows, cols) = parse_dimension("B5:N25");
        assert_eq!(rows, 21);
        assert_eq!(cols, 13);
    }

    #[test]
    fn test_synthetic_excel_inspection() {
        let temp_dir = std::env::temp_dir().join("printdrop_test_excel");
        let _ = std::fs::create_dir_all(&temp_dir);
        let test_file = temp_dir.join("test_workbook.xlsx");

        // Create synthetic .xlsx zip
        {
            let file = File::create(&test_file).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options = FileOptions::<ExtendedFileOptions>::default();

            // 1. xl/_rels/workbook.xml.rels
            zip.start_file("xl/_rels/workbook.xml.rels", options.clone()).unwrap();
            zip.write_all(br#"<?xml version="1.0" encoding="UTF-8"?>
            <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
                <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
            </Relationships>"#).unwrap();

            // 2. xl/workbook.xml
            zip.start_file("xl/workbook.xml", options.clone()).unwrap();
            zip.write_all(br#"<?xml version="1.0" encoding="UTF-8"?>
            <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                <sheets>
                    <sheet name="Sales Summary" sheetId="1" r:id="rId1"/>
                    <sheet name="Empty Sheet" sheetId="2" r:id="rId2"/>
                </sheets>
                <definedNames>
                    <definedName name="_xlnm.Print_Area" localSheetId="0">'Sales Summary'!$A$1:$J$50</definedName>
                </definedNames>
            </workbook>"#).unwrap();

            // 3. xl/worksheets/sheet1.xml (populated, wide table with pageSetup)
            zip.start_file("xl/worksheets/sheet1.xml", options.clone()).unwrap();
            zip.write_all(br#"<?xml version="1.0" encoding="UTF-8"?>
            <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
                <dimension ref="A1:J50"/>
                <sheetData>
                    <row r="1"/>
                </sheetData>
                <pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>
            </worksheet>"#).unwrap();

            // 4. xl/worksheets/sheet2.xml (empty sheet)
            zip.start_file("xl/worksheets/sheet2.xml", options).unwrap();
            zip.write_all(br#"<?xml version="1.0" encoding="UTF-8"?>
            <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
                <sheetData/>
            </worksheet>"#).unwrap();

            zip.finish().unwrap();
        }

        let meta = inspect_excel_file(&test_file).expect("Failed to parse test excel");
        assert_eq!(meta.total_sheets, 2);
        assert_eq!(meta.populated_sheets, 1);

        let sheet1 = &meta.sheets[0];
        assert_eq!(sheet1.name, "Sales Summary");
        assert_eq!(sheet1.is_empty, false);
        assert_eq!(sheet1.row_count, 50);
        assert_eq!(sheet1.col_count, 10);
        assert_eq!(sheet1.detected_orientation, "LANDSCAPE");
        assert_eq!(sheet1.detected_paper_size, Some("A4".to_string()));
        assert_eq!(sheet1.fit_to_width, Some(1));
        assert_eq!(sheet1.fit_to_height, Some(0));
        assert!(sheet1.has_user_print_setup);
        assert_eq!(sheet1.print_area, Some("'Sales Summary'!$A$1:$J$50".to_string()));

        let sheet2 = &meta.sheets[1];
        assert_eq!(sheet2.name, "Empty Sheet");
        assert_eq!(sheet2.is_empty, true);
        assert!(sheet2.recommended_action.contains("Skip"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
