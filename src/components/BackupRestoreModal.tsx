import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  ShieldCheck,
  FileSpreadsheet,
  Lock,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Download,
  UploadCloud,
  FileCheck,
  Clock,
  HardDrive,
  Settings,
  X,
  RefreshCw,
} from 'lucide-react';

interface BackupManifest {
  backupVersion: string;
  createdAt: string;
  appVersion: string;
  machineName: string;
  totalOrdersCount: number;
  completedOrdersCount: number;
  totalRevenue: number;
  totalCash: number;
  totalUpi: number;
  totalCreditDue: number;
  corporateClientsCount: number;
  includesDocuments: boolean;
  databaseSha256: string;
}

interface BackupConfig {
  customBackupPath: string | null;
  autoBackupDaily: boolean;
  autoBackupTime: string;
  autoBackupPassword: string | null;
  retentionCount: number;
  lastBackupAt: string | null;
  lastBackupFile: string | null;
}

interface BackupResult {
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  manifest: BackupManifest;
}

interface BackupFileInfo {
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  createdAt: string;
  isExcel: boolean;
}

interface BackupRestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshOrders?: () => void;
}

export const BackupRestoreModal: React.FC<BackupRestoreModalProps> = ({
  isOpen,
  onClose,
  onRefreshOrders,
}) => {
  const [activeTab, setActiveTab] = useState<'create' | 'restore' | 'settings'>('create');

  // Create Backup state
  const [format, setFormat] = useState<'pdropbak' | 'excel'>('pdropbak');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [includeDocuments, setIncludeDocuments] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState<BackupResult | { excelPath: string } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Restore state
  const [restoreFilePath, setRestoreFilePath] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [showRestorePassword, setShowRestorePassword] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewManifest, setPreviewManifest] = useState<BackupManifest | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreSuccessMsg, setRestoreSuccessMsg] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);

  // Config & History state
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [existingBackups, setExistingBackups] = useState<BackupFileInfo[]>([]);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [configBackupMsg, setConfigBackupMsg] = useState<string | null>(null);
  const [isConfigBusy, setIsConfigBusy] = useState(false);

  const handleExportShopConfig = async () => {
    setIsConfigBusy(true);
    setConfigBackupMsg(null);
    try {
      const [savedPath, count] = await invoke<[string, number]>('export_shop_config_backup');
      setConfigBackupMsg(`✅ Exported ${count} configuration settings to: ${savedPath}`);
    } catch (err: any) {
      if (String(err) !== 'Export cancelled.') {
        setConfigBackupMsg(`❌ Export failed: ${err}`);
      }
    } finally {
      setIsConfigBusy(false);
    }
  };

  const handleImportShopConfig = async () => {
    setIsConfigBusy(true);
    setConfigBackupMsg(null);
    try {
      const count = await invoke<number>('import_shop_config_backup');
      setConfigBackupMsg(`✅ Restored ${count} configuration settings! Reloading station settings...`);
      await loadConfigAndBackups();
      if (onRefreshOrders) onRefreshOrders();
    } catch (err: any) {
      if (String(err) !== 'Import cancelled.') {
        setConfigBackupMsg(`❌ Restore failed: ${err}`);
      }
    } finally {
      setIsConfigBusy(false);
    }
  };
  const [showAutoPassword, setShowAutoPassword] = useState(false);
  const [settingsSuccessMsg, setSettingsSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadConfigAndBackups();
      setCreateSuccess(null);
      setCreateError(null);
      setRestoreSuccessMsg(null);
      setRestoreError(null);
    }
  }, [isOpen]);

  const loadConfigAndBackups = async () => {
    try {
      setIsLoadingConfig(true);
      const cfg = await invoke<BackupConfig>('get_backup_config');
      setConfig(cfg);
      const list = await invoke<BackupFileInfo[]>('list_existing_backups');
      setExistingBackups(list);
    } catch (err) {
      console.error('Failed to load backup config or listing:', err);
    } finally {
      setIsLoadingConfig(false);
    }
  };

  const handlePickFolder = async () => {
    try {
      const selected = await invoke<string | null>('pick_backup_folder');
      if (selected && config) {
        const updated: BackupConfig = { ...config, customBackupPath: selected };
        await invoke('save_backup_config', { config: updated });
        setConfig(updated);
        const list = await invoke<BackupFileInfo[]>('list_existing_backups');
        setExistingBackups(list);
      }
    } catch (err) {
      console.error('Failed to pick folder:', err);
    }
  };

  const handlePickRestoreFile = async () => {
    try {
      const selected = await invoke<string | null>('pick_backup_file');
      if (selected) {
        setRestoreFilePath(selected);
        setPreviewManifest(null);
        setRestoreError(null);
      }
    } catch (err) {
      console.error('Failed to pick file:', err);
    }
  };

  const handleCreateBackup = async () => {
    setCreateError(null);
    setCreateSuccess(null);

    if (!password.trim()) {
      setCreateError('Password is mandatory for securing this backup.');
      return;
    }

    if (password !== confirmPassword) {
      setCreateError('Passwords do not match. Please verify both fields.');
      return;
    }

    if (password.length < 4) {
      setCreateError('Password must be at least 4 characters long.');
      return;
    }

    try {
      setIsCreating(true);
      if (format === 'pdropbak') {
        const result = await invoke<BackupResult>('create_system_backup', {
          password: password.trim(),
          includeDocuments,
          customPath: config?.customBackupPath || null,
        });
        setCreateSuccess(result);
        setPassword('');
        setConfirmPassword('');
      } else {
        const excelPath = await invoke<string>('export_excel_backup', {
          password: password.trim(),
          customPath: config?.customBackupPath || null,
        });
        setCreateSuccess({ excelPath });
        setPassword('');
        setConfirmPassword('');
      }
      await loadConfigAndBackups();
    } catch (err: any) {
      setCreateError(err?.toString() || 'Failed to create backup.');
    } finally {
      setIsCreating(false);
    }
  };

  const handlePreviewRestore = async () => {
    setRestoreError(null);
    setRestoreSuccessMsg(null);
    setPreviewManifest(null);

    if (!restoreFilePath.trim()) {
      setRestoreError('Please select a backup file (.pdropbak) first.');
      return;
    }

    if (!restorePassword.trim()) {
      setRestoreError('Please enter the decryption password for this backup.');
      return;
    }

    try {
      setIsPreviewing(true);
      const manifest = await invoke<BackupManifest>('preview_backup_file', {
        filePath: restoreFilePath.trim(),
        password: restorePassword.trim(),
      });
      setPreviewManifest(manifest);
    } catch (err: any) {
      setRestoreError(err?.toString() || 'Failed to decrypt backup. Please check your password.');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleExecuteRestore = async () => {
    setRestoreError(null);
    setRestoreSuccessMsg(null);

    if (!window.confirm('Are you sure you want to restore this backup? A safety rollback snapshot of your current data will be created automatically before restoring.')) {
      return;
    }

    try {
      setIsRestoring(true);
      const manifest = await invoke<BackupManifest>('restore_system_backup', {
        filePath: restoreFilePath.trim(),
        password: restorePassword.trim(),
      });
      setRestoreSuccessMsg(`System restored successfully! Restored ${manifest.totalOrdersCount} print orders (${manifest.completedOrdersCount} completed) and ${manifest.corporateClientsCount} corporate accounts.`);
      setPreviewManifest(null);
      setRestorePassword('');
      if (onRefreshOrders) {
        onRefreshOrders();
      }
    } catch (err: any) {
      setRestoreError(err?.toString() || 'Restore failed.');
    } finally {
      setIsRestoring(false);
    }
  };

  const handleRollback = async () => {
    if (!window.confirm('Roll back to the previous safety snapshot? This will revert any data restored since the last backup operation.')) {
      return;
    }

    try {
      setIsRollingBack(true);
      const path = await invoke<string>('rollback_safety_snapshot');
      setRestoreSuccessMsg(`Database successfully rolled back to pre-restore snapshot: ${path}`);
      setRestoreError(null);
      if (onRefreshOrders) {
        onRefreshOrders();
      }
    } catch (err: any) {
      setRestoreError(err?.toString() || 'Rollback failed: No safety snapshot found.');
    } finally {
      setIsRollingBack(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!config) return;
    try {
      await invoke('save_backup_config', { config });
      setSettingsSuccessMsg('Backup configuration saved successfully.');
      setTimeout(() => setSettingsSuccessMsg(null), 3000);
    } catch (err: any) {
      console.error('Failed to save settings:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div 
        className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl border border-slate-700/80 shadow-2xl text-slate-100 overflow-hidden"
        style={{ backgroundColor: '#0f172a', opacity: 1 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-lg shadow-emerald-950/40">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Backup & Restore Center
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  AES-256-GCM Encrypted
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Production-grade encrypted archives (.pdropbak), multi-tab Excel reports, and instant disaster recovery
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 px-6 pt-3 pb-2 border-b border-slate-800 bg-slate-900/50 shrink-0">
          <button
            onClick={() => setActiveTab('create')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
              activeTab === 'create'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Download className="w-4 h-4" />
            Create Secure Backup
          </button>
          <button
            onClick={() => setActiveTab('restore')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
              activeTab === 'restore'
                ? 'bg-teal-600 text-white shadow-md shadow-teal-950/50'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <UploadCloud className="w-4 h-4" />
            Restore & Disaster Recovery
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
              activeTab === 'settings'
                ? 'bg-slate-700 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Settings className="w-4 h-4" />
            Destination & Storage Settings
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: CREATE BACKUP */}
          {activeTab === 'create' && (
            <div className="space-y-6 max-w-3xl mx-auto">
              {/* Format Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Select Backup Format
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div
                    onClick={() => setFormat('pdropbak')}
                    className={`cursor-pointer p-4 rounded-xl border-2 transition relative flex flex-col justify-between ${
                      format === 'pdropbak'
                        ? 'border-emerald-500 bg-emerald-950/20 shadow-lg shadow-emerald-950/30'
                        : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="p-2 rounded-lg bg-emerald-600/30 text-emerald-400 border border-emerald-500/40">
                          <ShieldCheck className="w-5 h-5" />
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase">
                          Recommended
                        </span>
                      </div>
                      <h4 className="font-semibold text-sm text-white">Full Encrypted Archive (.pdropbak)</h4>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        Complete system state snapshot (Orders, Financial Ledger, Corporate Portals, Rates, Routing). Restorable with 1-click in disaster recovery.
                      </p>
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-800/80 text-[11px] text-emerald-400 flex items-center gap-1">
                      <Lock className="w-3.5 h-3.5" /> AES-256-GCM + PBKDF2 Password Protected
                    </div>
                  </div>

                  <div
                    onClick={() => setFormat('excel')}
                    className={`cursor-pointer p-4 rounded-xl border-2 transition relative flex flex-col justify-between ${
                      format === 'excel'
                        ? 'border-teal-500 bg-teal-950/20 shadow-lg shadow-teal-950/30'
                        : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="p-2 rounded-lg bg-teal-600/30 text-teal-400 border border-teal-500/40">
                          <FileSpreadsheet className="w-5 h-5" />
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30 uppercase">
                          CA & Audit
                        </span>
                      </div>
                      <h4 className="font-semibold text-sm text-white">Financial Audit Spreadsheet (.xlsx)</h4>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        Clean multi-tab Microsoft Excel workbook: Financial KPIs, Print Jobs Ledger, Itemized Documents, and Corporate Accounts.
                      </p>
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-800/80 text-[11px] text-teal-400 flex items-center gap-1">
                      <Lock className="w-3.5 h-3.5" /> Sheet-Protected with Password
                    </div>
                  </div>
                </div>
              </div>

              {/* Mandatory Password Form */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/80 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Lock className="w-4 h-4 text-emerald-400" />
                    <span>Mandatory Encryption Password</span>
                  </div>
                  <span className="text-xs text-amber-400/90 font-medium">Required for both .pdropbak and .xlsx</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Enter Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Choose a strong password..."
                        className="w-full pl-3 pr-10 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Confirm Password</label>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat password..."
                      className={`w-full px-3 py-2 rounded-lg bg-slate-950 border text-sm text-white focus:outline-none ${
                        confirmPassword && confirmPassword !== password
                          ? 'border-rose-500'
                          : 'border-slate-700 focus:border-emerald-500'
                      }`}
                    />
                  </div>
                </div>

                {password && confirmPassword && password !== confirmPassword && (
                  <p className="text-xs text-rose-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> Passwords do not match.
                  </p>
                )}
              </div>

              {/* Options */}
              {format === 'pdropbak' && (
                <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="incDocs"
                    checked={includeDocuments}
                    onChange={(e) => setIncludeDocuments(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                  <label htmlFor="incDocs" className="cursor-pointer">
                    <div className="text-xs font-semibold text-slate-200">
                      Include stored document files (.dat / .pdf)
                    </div>
                    <div className="text-[11px] text-slate-400 leading-normal mt-0.5">
                      By default, PrintDrop archives all financial transactions, pickup PINs, order settings, and shop configurations in an instant, lightweight file. Check this only if you want to bundle customer print files.
                    </div>
                  </label>
                </div>
              )}

              {/* Destination folder info */}
              <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                <div className="flex items-center gap-1.5 truncate mr-2">
                  <Folder className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="truncate">
                    Destination: <strong className="text-slate-300">{config?.customBackupPath || 'Default (%APPDATA%/PrintDrop/backups)'}</strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handlePickFolder}
                  className="text-emerald-400 hover:text-emerald-300 font-medium shrink-0 flex items-center gap-1"
                >
                  <FolderOpen className="w-3.5 h-3.5" /> Change
                </button>
              </div>

              {/* Status Alerts */}
              {createError && (
                <div className="p-3.5 rounded-xl border border-rose-800/80 bg-rose-950/40 text-rose-300 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{createError}</span>
                  </div>
                  <button onClick={() => setCreateError(null)} className="text-rose-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {createSuccess && (
                <div className="p-4 rounded-xl border border-emerald-800/80 bg-emerald-950/40 text-emerald-200 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-emerald-300">
                    <CheckCircle2 className="w-4 h-4" />
                    {'fileName' in createSuccess ? 'Backup created successfully!' : 'Excel report generated successfully!'}
                  </div>
                  {'fileName' in createSuccess && (
                    <div className="text-slate-300 space-y-1 pl-6">
                      <div>File: <strong className="text-white">{createSuccess.fileName}</strong></div>
                      <div>Path: <span className="font-mono text-[11px] text-slate-400">{createSuccess.filePath}</span></div>
                      <div>Size: <strong className="text-white">{(createSuccess.fileSizeBytes / 1024).toFixed(1)} KB</strong></div>
                      <div>Total Orders Archived: <strong className="text-white">{createSuccess.manifest.totalOrdersCount}</strong></div>
                    </div>
                  )}
                  {'excelPath' in createSuccess && (
                    <div className="text-slate-300 pl-6">
                      <div>Saved to: <span className="font-mono text-[11px] text-slate-400">{createSuccess.excelPath}</span></div>
                    </div>
                  )}
                </div>
              )}

              {/* Action Button */}
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleCreateBackup}
                  disabled={isCreating}
                  className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition shadow-lg ${
                    format === 'pdropbak'
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-950/50'
                      : 'bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 shadow-teal-950/50'
                  } disabled:opacity-50`}
                >
                  {isCreating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Generating Secure Archive...
                    </>
                  ) : format === 'pdropbak' ? (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      Create Encrypted Backup Now
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="w-4 h-4" />
                      Export Financial Excel Now
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: RESTORE & DISASTER RECOVERY */}
          {activeTab === 'restore' && (
            <div className="space-y-6 max-w-3xl mx-auto">
              <div className="p-4 rounded-xl border border-teal-800/40 bg-teal-950/20 text-xs text-teal-200 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-teal-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-teal-300">Automatic Pre-Restore Safety Checkpoint</div>
                  <div className="text-slate-300 text-[11px] mt-0.5 leading-relaxed">
                    PrintDrop automatically creates an un-modified safety backup of your current database before any restore operation. If you ever restore an unintended archive, click the Rollback button below to revert instantly.
                  </div>
                </div>
              </div>

              {/* File Selector */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/80 space-y-4">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  1. Select Encrypted Backup File (.pdropbak)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={restoreFilePath}
                    onChange={(e) => setRestoreFilePath(e.target.value)}
                    placeholder="Path to .pdropbak archive file..."
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white font-mono text-xs focus:outline-none focus:border-teal-500"
                  />
                  <button
                    type="button"
                    onClick={handlePickRestoreFile}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white flex items-center gap-1.5 border border-slate-700"
                  >
                    <FolderOpen className="w-4 h-4" /> Browse
                  </button>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">2. Decryption Password</label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showRestorePassword ? 'text' : 'password'}
                        value={restorePassword}
                        onChange={(e) => setRestorePassword(e.target.value)}
                        placeholder="Enter password used to encrypt this backup..."
                        className="w-full pl-3 pr-10 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-teal-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRestorePassword(!showRestorePassword)}
                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white"
                      >
                        {showRestorePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handlePreviewRestore}
                      disabled={isPreviewing || !restoreFilePath || !restorePassword}
                      className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-xs font-semibold text-white flex items-center gap-1.5 disabled:opacity-50 shadow-md shadow-teal-950/40"
                    >
                      {isPreviewing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileCheck className="w-4 h-4" />}
                      Verify & Preview
                    </button>
                  </div>
                </div>
              </div>

              {/* Status Alerts */}
              {restoreError && (
                <div className="p-3.5 rounded-xl border border-rose-800/80 bg-rose-950/40 text-rose-300 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{restoreError}</span>
                  </div>
                  <button onClick={() => setRestoreError(null)} className="text-rose-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {restoreSuccessMsg && (
                <div className="p-4 rounded-xl border border-emerald-800/80 bg-emerald-950/40 text-emerald-200 text-xs flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{restoreSuccessMsg}</span>
                </div>
              )}

              {/* Verified Backup Preview Card */}
              {previewManifest && (
                <div className="p-5 rounded-xl border border-emerald-500/50 bg-slate-900/90 shadow-xl space-y-4 animate-fade-in">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-emerald-600 text-white">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-white">Backup Verified & Integrity Confirmed</h4>
                        <div className="text-[11px] text-slate-400">Created {new Date(previewManifest.createdAt).toLocaleString()} on {previewManifest.machineName}</div>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      PrintDrop v{previewManifest.appVersion}
                    </span>
                  </div>

                  {/* Metrics Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Total Orders</div>
                      <div className="text-lg font-bold text-white mt-0.5">{previewManifest.totalOrdersCount}</div>
                      <div className="text-[10px] text-emerald-400">{previewManifest.completedOrdersCount} completed</div>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Total Revenue</div>
                      <div className="text-lg font-bold text-white mt-0.5">₹{previewManifest.totalRevenue.toFixed(2)}</div>
                      <div className="text-[10px] text-slate-400">Cash: ₹{previewManifest.totalCash} | UPI: ₹{previewManifest.totalUpi}</div>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Credit / Due</div>
                      <div className="text-lg font-bold text-amber-300 mt-0.5">₹{previewManifest.totalCreditDue.toFixed(2)}</div>
                      <div className="text-[10px] text-slate-400">Outstanding balance</div>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Corporate Portals</div>
                      <div className="text-lg font-bold text-indigo-300 mt-0.5">{previewManifest.corporateClientsCount}</div>
                      <div className="text-[10px] text-slate-400">
                        {previewManifest.includesDocuments ? 'Includes Files' : 'Data Only'}
                      </div>
                    </div>
                  </div>

                  {/* Execute Button */}
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-[11px] text-slate-400 font-mono">
                      SHA256: {previewManifest.databaseSha256.substring(0, 16)}...
                    </span>
                    <button
                      type="button"
                      onClick={handleExecuteRestore}
                      disabled={isRestoring}
                      className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-sm font-bold text-white shadow-lg shadow-teal-950/50 flex items-center gap-2 disabled:opacity-50"
                    >
                      {isRestoring ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Restoring Live Database...
                        </>
                      ) : (
                        <>
                          <RotateCcw className="w-4 h-4" />
                          Confirm & Restore System Now
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Disaster Recovery Rollback Guard */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-200">Accidentally restored wrong data?</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Click rollback to restore the automatic safety checkpoint taken immediately before the last restore.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRollback}
                  disabled={isRollingBack}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-amber-300 border border-amber-500/40 flex items-center gap-1.5 transition disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {isRollingBack ? 'Reverting...' : 'Rollback to Previous State'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: SETTINGS & EXISTING BACKUPS */}
          {activeTab === 'settings' && (
            <div className="space-y-6 max-w-3xl mx-auto">
              {/* Configuration Form */}
              <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/80 space-y-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-emerald-400" />
                  Backup Location & Retention Policy
                </h3>

                {/* Custom Path */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Shopkeeper-Defined Backup Folder
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={config?.customBackupPath || ''}
                      onChange={(e) => setConfig(config ? { ...config, customBackupPath: e.target.value } : null)}
                      placeholder="e.g. D:\PrintDrop_Backups (Leave blank for default AppData)"
                      className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={handlePickFolder}
                      className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white border border-slate-700 flex items-center gap-1.5"
                    >
                      <FolderOpen className="w-4 h-4" /> Browse
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    You can specify an external USB Drive (e.g. E:\Backups) or local D: drive folder to safeguard data against computer hard drive failure.
                  </p>
                </div>

                {/* Auto Backup & Retention Settings */}
                <div className="space-y-4 pt-1">
                  {/* Daily Automatic Backup Card */}
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3.5">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        id="autoDaily"
                        checked={config?.autoBackupDaily ?? true}
                        onChange={(e) => setConfig(config ? { ...config, autoBackupDaily: e.target.checked } : null)}
                        className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-900 text-emerald-600 focus:ring-0 cursor-pointer"
                      />
                      <label htmlFor="autoDaily" className="cursor-pointer flex-1">
                        <div className="text-xs font-bold text-white flex items-center justify-between">
                          <span>Daily Automatic Backup Schedule</span>
                          {config?.autoBackupDaily && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              Active at {config.autoBackupTime || "21:00"}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Automatically generates an encrypted snapshot once per day at your chosen time without manual intervention.
                        </div>
                      </label>
                    </div>

                    {config?.autoBackupDaily && (
                      <div className="pl-7 space-y-3 pt-2 border-t border-slate-800/80 animate-fade-in">
                        {/* Custom Time Selector & Presets */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-emerald-400" />
                            Daily Custom Backup Time
                          </label>
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="time"
                              value={config?.autoBackupTime || "21:00"}
                              onChange={(e) => setConfig(config ? { ...config, autoBackupTime: e.target.value } : null)}
                              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                            />
                            <div className="flex items-center gap-1.5 text-[11px]">
                              {[
                                { label: "8:00 PM", val: "20:00" },
                                { label: "9:00 PM (Default)", val: "21:00" },
                                { label: "10:00 PM", val: "22:00" },
                                { label: "11:00 PM", val: "23:00" },
                              ].map((preset) => (
                                <button
                                  key={preset.val}
                                  type="button"
                                  onClick={() => setConfig(config ? { ...config, autoBackupTime: preset.val } : null)}
                                  className={`px-2 py-1 rounded text-[10px] font-medium transition border ${
                                    (config?.autoBackupTime || "21:00") === preset.val
                                      ? "bg-emerald-600/30 text-emerald-300 border-emerald-500/60 font-semibold"
                                      : "bg-slate-900 text-slate-400 border-slate-800 hover:text-white hover:bg-slate-800"
                                  }`}
                                >
                                  {preset.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Auto-Backup Encryption Password */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              <Lock className="w-3.5 h-3.5 text-emerald-400" />
                              Auto-Backup Encryption Password
                            </span>
                            <span className="text-[10px] text-amber-400 font-normal">Required for background encryption</span>
                          </label>
                          <div className="relative max-w-md">
                            <input
                              type={showAutoPassword ? "text" : "password"}
                              value={config?.autoBackupPassword || ""}
                              onChange={(e) => setConfig(config ? { ...config, autoBackupPassword: e.target.value } : null)}
                              placeholder="Enter password to secure silent auto-backups..."
                              className="w-full pl-3 pr-10 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500"
                            />
                            <button
                              type="button"
                              onClick={() => setShowAutoPassword(!showAutoPassword)}
                              className="absolute right-2.5 top-2 text-slate-400 hover:text-white"
                            >
                              {showAutoPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-1">
                            Stored locally to automatically encrypt scheduled daily backups in the background without prompting while you are serving customers.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Retention Limit Card */}
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-white">Retention Limit (Snapshots to Keep)</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Older snapshots beyond this count are automatically cleaned to prevent disk storage bloat.
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={config?.retentionCount ?? 10}
                        onChange={(e) => setConfig(config ? { ...config, retentionCount: parseInt(e.target.value) || 10 } : null)}
                        className="w-20 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white text-center font-bold focus:outline-none focus:border-emerald-500"
                      />
                      <span className="text-xs text-slate-400">files</span>
                    </div>
                  </div>
                </div>

                {settingsSuccessMsg && (
                  <p className="text-xs text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {settingsSuccessMsg}
                  </p>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={handleSaveSettings}
                    className="px-5 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-xs font-semibold text-white transition"
                  >
                    Save Preferences
                  </button>
                </div>
              </div>

              {/* 1-Click Configuration Backup & Restore (Settings Only) */}
              <div className="p-5 rounded-xl border border-indigo-900/50 bg-indigo-950/20 space-y-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Settings className="w-4 h-4 text-indigo-400" />
                    1-Click Configuration Backup &amp; Restore
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Export or restore only shop settings (Pricing Rate Card, UPI/Razorpay, Printer Routing, Guest Wi-Fi &amp; Static QR URL) without touching orders, ledger, or machine license.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleExportShopConfig}
                    disabled={isConfigBusy}
                    className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    <span>1-Click Export Config (.json)</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleImportShopConfig}
                    disabled={isConfigBusy}
                    className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <RotateCcw className="w-4 h-4 text-emerald-400" />
                    <span>1-Click Restore Config (.json)</span>
                  </button>
                </div>

                {configBackupMsg && (
                  <div className="text-xs text-slate-200 bg-slate-950/70 border border-slate-800 rounded-lg px-3 py-2">
                    {configBackupMsg}
                  </div>
                )}
              </div>

              {/* Detected Backups on Disk */}
              <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/80 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Clock className="w-4 h-4 text-teal-400" />
                    Detected Backups on Disk ({existingBackups.length})
                  </h3>
                  <button
                    onClick={loadConfigAndBackups}
                    disabled={isLoadingConfig}
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingConfig ? "animate-spin" : ""}`} /> Refresh
                  </button>
                </div>

                {existingBackups.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    No existing backup files found in destination folder.
                  </p>
                ) : (
                  <div className="max-h-60 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded-lg">
                    {existingBackups.map((b, idx) => (
                      <div key={idx} className="p-3 flex items-center justify-between text-xs hover:bg-slate-800/40 transition">
                        <div className="flex items-center gap-2.5 truncate mr-2">
                          {b.isExcel ? (
                            <FileSpreadsheet className="w-4 h-4 text-teal-400 shrink-0" />
                          ) : (
                            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                          )}
                          <div className="truncate">
                            <div className="font-semibold text-white truncate">{b.fileName}</div>
                            <div className="text-[10px] text-slate-400">{b.createdAt} • {(b.fileSizeBytes / 1024).toFixed(1)} KB</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {!b.isExcel && (
                            <button
                              type="button"
                              onClick={() => {
                                setRestoreFilePath(b.filePath);
                                setActiveTab('restore');
                              }}
                              className="px-2.5 py-1 rounded bg-teal-950 text-teal-300 hover:bg-teal-900 border border-teal-800/70 text-[11px] font-medium"
                            >
                              Restore
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>SQLite WAL Engine Protected</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
