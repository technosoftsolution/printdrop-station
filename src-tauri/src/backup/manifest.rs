use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub backup_version: String,
    pub created_at: String,
    pub app_version: String,
    pub machine_name: String,
    pub total_orders_count: usize,
    pub completed_orders_count: usize,
    pub total_revenue: f64,
    pub total_cash: f64,
    pub total_upi: f64,
    pub total_credit_due: f64,
    pub corporate_clients_count: usize,
    pub includes_documents: bool,
    pub database_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupConfig {
    pub custom_backup_path: Option<String>,
    pub auto_backup_daily: bool,
    pub auto_backup_time: String,
    pub auto_backup_password: Option<String>,
    pub retention_count: usize,
    pub last_backup_at: Option<String>,
    pub last_backup_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub file_path: String,
    pub file_name: String,
    pub file_size_bytes: u64,
    pub manifest: BackupManifest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFileInfo {
    pub file_name: String,
    pub file_path: String,
    pub file_size_bytes: u64,
    pub created_at: String,
    pub is_excel: bool,
}
