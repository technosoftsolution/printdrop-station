use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrintSettingsDto {
    pub mode: String,                  // "AUTO" | "MANUAL"
    pub paper_size: String,            // "A4" | "LETTER" | "LEGAL"
    pub color_mode: String,            // "BW" | "COLOR"
    pub duplex_mode: String,           // "SIMPLEX" | "DUPLEX_LONG_EDGE" | "DUPLEX_SHORT_EDGE"
    pub copies: u32,                   // 1..=100
    pub orientation: String,           // "AUTO" | "PORTRAIT" | "LANDSCAPE"
    pub page_range: Option<String>,    // e.g. "1-5, 8"
    pub rotation: Option<u32>,         // 0 | 90 | 180 | 270
    #[serde(default)]
    pub target_printer: Option<String>, // Optional manual printer override per file
}

impl Default for PrintSettingsDto {
    fn default() -> Self {
        Self {
            mode: "AUTO".to_string(),
            paper_size: "A4".to_string(),
            color_mode: "BW".to_string(),
            duplex_mode: "SIMPLEX".to_string(),
            copies: 1,
            orientation: "AUTO".to_string(),
            page_range: None,
            rotation: Some(0),
            target_printer: None,
        }
    }
}

impl PrintSettingsDto {
    pub fn validate(&self) -> Result<(), String> {
        if self.copies < 1 || self.copies > 100 {
            return Err("Copies count must be between 1 and 100".to_string());
        }

        let valid_modes = ["AUTO", "MANUAL"];
        if !valid_modes.contains(&self.mode.to_uppercase().as_str()) {
            return Err(format!("Invalid mode: '{}'. Must be AUTO or MANUAL", self.mode));
        }

        let valid_sizes = ["A4", "LETTER", "LEGAL", "A3", "PLOTTER"];
        if !valid_sizes.contains(&self.paper_size.to_uppercase().as_str()) {
            return Err(format!("Unsupported paper size: '{}'", self.paper_size));
        }

        let valid_colors = ["BW", "COLOR"];
        if !valid_colors.contains(&self.color_mode.to_uppercase().as_str()) {
            return Err(format!("Unsupported color mode: '{}'", self.color_mode));
        }

        let valid_duplex = ["SIMPLEX", "DUPLEX_LONG_EDGE", "DUPLEX_SHORT_EDGE"];
        if !valid_duplex.contains(&self.duplex_mode.to_uppercase().as_str()) {
            return Err(format!("Unsupported duplex mode: '{}'", self.duplex_mode));
        }

        let valid_orientation = ["AUTO", "PORTRAIT", "LANDSCAPE"];
        if !valid_orientation.contains(&self.orientation.to_uppercase().as_str()) {
            return Err(format!("Unsupported orientation: '{}'", self.orientation));
        }

        if let Some(ref range) = self.page_range {
            if range.len() > 50 {
                return Err("Page range string too long".to_string());
            }
        }

        if let Some(r) = self.rotation {
            if r != 0 && r != 90 && r != 180 && r != 270 {
                return Err(format!("Invalid rotation: {}°. Must be 0, 90, 180, or 270", r));
            }
        }

        Ok(())
    }

    pub fn to_summary(&self) -> String {
        let rot_suffix = match self.rotation {
            Some(90) => " • Rotated 90°",
            Some(180) => " • Rotated 180°",
            Some(270) => " • Rotated 270°",
            _ => "",
        };

        let page_range_suffix = match &self.page_range {
            Some(range) if !range.trim().is_empty() && !range.trim().eq_ignore_ascii_case("all") => {
                let r = range.trim();
                if r.chars().all(|c| c.is_ascii_digit()) {
                    format!(" • Page {}", r)
                } else {
                    format!(" • Pages {}", r)
                }
            }
            _ => String::new(),
        };

        if self.mode.to_uppercase() == "AUTO" {
            format!("Auto (Preserve layout, {} cop{}){}{}", self.copies, if self.copies == 1 { "y" } else { "ies" }, rot_suffix, page_range_suffix)
        } else {
            let duplex = match self.duplex_mode.as_str() {
                "DUPLEX_LONG_EDGE" | "DUPLEX_SHORT_EDGE" => "2-Sided",
                _ => "1-Sided",
            };
            let color = if self.color_mode == "COLOR" { "Color" } else { "B&W" };
            let orient_suffix = if self.orientation.eq_ignore_ascii_case("LANDSCAPE") { " • Landscape" } else { "" };
            format!("{} • {}{} • {} • {} cop{}{}{}", self.paper_size, color, orient_suffix, duplex, self.copies, if self.copies == 1 { "y" } else { "ies" }, rot_suffix, page_range_suffix)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings_valid() {
        let settings = PrintSettingsDto::default();
        assert!(settings.validate().is_ok());
        assert_eq!(settings.to_summary(), "Auto (Preserve layout, 1 copy)");
    }

    #[test]
    fn test_manual_settings_validation() {
        let mut settings = PrintSettingsDto {
            mode: "MANUAL".to_string(),
            paper_size: "A4".to_string(),
            color_mode: "COLOR".to_string(),
            duplex_mode: "DUPLEX_LONG_EDGE".to_string(),
            copies: 3,
            orientation: "PORTRAIT".to_string(),
            page_range: Some("1-10".to_string()),
            rotation: Some(0),
            target_printer: None,
        };
        assert!(settings.validate().is_ok());
        assert_eq!(settings.to_summary(), "A4 • Color • 2-Sided • 3 copies • Pages 1-10");

        // Invalid copies
        settings.copies = 0;
        assert!(settings.validate().is_err());
        settings.copies = 150;
        assert!(settings.validate().is_err());

        // Invalid paper size
        settings.copies = 2;
        settings.paper_size = "UNKNOWN_SIZE".to_string();
        assert!(settings.validate().is_err());
    }
}
