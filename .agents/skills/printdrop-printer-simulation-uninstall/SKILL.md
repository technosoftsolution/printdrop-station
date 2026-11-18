---
name: printdrop-printer-simulation-uninstall
description: Exact step-by-step uninstallation and clean removal guide for the PrintDrop Virtual Hardware Simulation & Sandbox Environment. Use this runbook prior to building final production binaries (EXE/MSI) to ensure no mock printers, simulated delays, or testing presets remain in the shipped software.
---

# PrintDrop Simulation Environment Uninstallation Guide

## 1. Executive Summary

During Phase-I development, PrintDrop includes a **Virtual Hardware Simulation Sandbox** (`simulation.rs`) that allows testing multi-printer batch spooling, graceful pause, emergency paper jams, and cascading hardware reroutes without physical printers.

Before shipping or building the final production release, use this runbook to completely remove the simulation environment. All simulation code is isolated and tagged with `// === SIMULATION SANDBOX START ===` and `// === SIMULATION SANDBOX END ===` markers so removal takes less than 2 minutes.

---

## 2. Step-by-Step Clean Removal Checklist

Follow these 5 steps in order:

### Step 1: Delete `src-tauri/src/printer/simulation.rs`
Delete the dedicated simulation module file:
```powershell
Remove-Item -Path "src-tauri\src\printer\simulation.rs" -Force
```

---

### Step 2: Clean `src-tauri/src/printer/mod.rs`
Open [src-tauri/src/printer/mod.rs](file:///C:/Flutter_src/PrintDrop/src-tauri/src/printer/mod.rs):

1. **Remove module declaration** (near line 15):
   ```rust
   // DELETE THIS:
   // === SIMULATION SANDBOX START ===
   pub mod simulation;
   // === SIMULATION SANDBOX END ===
   ```

2. **Remove simulation helper methods from `PrinterManager`** (near line 215):
   ```rust
   // DELETE THIS ENTIRE BLOCK:
   // === SIMULATION SANDBOX START ===
   pub fn is_simulation_mode(&self) -> bool { ... }
   pub fn set_simulation_mode(&self, enabled: bool) -> Result<(), Box<dyn std::error::Error>> { ... }
   pub fn apply_simulation_routing_preset(&self) -> Result<PrinterRoutingConfig, Box<dyn std::error::Error>> { ... }
   // === SIMULATION SANDBOX END ===
   ```

3. **Revert `list_printers(&self)`** (near line 515):
   ```rust
   // Replace with clean standard system printer discovery:
   pub fn list_printers(&self) -> Vec<PrinterInfo> {
       list_system_printers()
   }
   ```

4. **Revert `print_single_file`** (near line 670):
   ```rust
   // DELETE THIS BLOCK:
   // === SIMULATION SANDBOX START ===
   if simulation::is_simulated_printer(printer_name) {
       return simulation::simulate_paged_print(...);
   }
   // === SIMULATION SANDBOX END ===
   ```

5. **Remove simulation unit tests** at the end of the file:
   ```rust
   // DELETE THIS BLOCK:
   // === SIMULATION SANDBOX START ===
   #[test]
   fn test_simulation_mode_and_virtual_printers_listing() { ... }
   #[test]
   fn test_simulated_paged_print_and_emergency_jam_interruption() { ... }
   // === SIMULATION SANDBOX END ===
   ```

---

### Step 3: Clean `src-tauri/src/commands.rs`
Open [src-tauri/src/commands.rs](file:///C:/Flutter_src/PrintDrop/src-tauri/src/commands.rs) and delete the tagged commands:
```rust
// DELETE THIS BLOCK:
// === SIMULATION SANDBOX START ===
#[tauri::command]
pub fn get_printer_simulation_mode(...) { ... }

#[tauri::command]
pub fn set_printer_simulation_mode(...) { ... }

#[tauri::command]
pub fn apply_simulation_routing_preset(...) { ... }
// === SIMULATION SANDBOX END ===
```

---

### Step 4: Clean `src-tauri/src/lib.rs`
Open [src-tauri/src/lib.rs](file:///C:/Flutter_src/PrintDrop/src-tauri/src/lib.rs) and remove the 3 command registrations from `tauri::generate_handler!`:
```rust
// DELETE THESE 3 LINES:
// === SIMULATION SANDBOX START ===
commands::get_printer_simulation_mode,
commands::set_printer_simulation_mode,
commands::apply_simulation_routing_preset,
// === SIMULATION SANDBOX END ===
```

---

### Step 5: Clean Frontend Components
1. In [src/components/PrinterRoutingModal.tsx](file:///C:/Flutter_src/PrintDrop/src/components/PrinterRoutingModal.tsx):
   - Remove `isSimulationMode` state, the `get_printer_simulation_mode` call, and the `handleApplySimulationPreset` helper.
   - Remove the `{isSimulationMode && ( ... )}` banner above the Master Toggle.
2. In [src/components/LivePrintSpoolerModal.tsx](file:///C:/Flutter_src/PrintDrop/src/components/LivePrintSpoolerModal.tsx):
   - Remove `{currentFile?.targetPrinter?.startsWith("[VIRTUAL]") && ( ... )}` badge from the header.

---

## 3. Post-Removal Verification Suite

Execute the standard verification commands to confirm the software compiles cleanly with zero orphaned references:

```powershell
# 1. Run all remaining printer tests (all tests should pass against physical / system drivers)
cargo test printer::tests --manifest-path src-tauri/Cargo.toml

# 2. Run the full backend test suite
cargo test --manifest-path src-tauri/Cargo.toml

# 3. Verify TypeScript build
npm run build
```

Expected result:
- All non-simulation unit tests pass (45+ tests).
- `npm run build` succeeds with zero errors.
- The compiled desktop app will only discover and interact with real physical printers installed on the shopkeeper's Windows OS.
