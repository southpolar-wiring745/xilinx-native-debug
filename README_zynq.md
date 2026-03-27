# Xilinx Native Debug: Zynq / XSDB Support Guide

This document covers the Xilinx-specific features of Xilinx Native Debug.

## Overview

The extension provides a debugger type: `xsdb-gdb`.

It combines:

- **XSDB** for board initialization tasks (connect, target select, loadhw, PS init, FPGA program, reset)
- **GDB** for software debugging (attach, breakpoints, stepping, variables, call stack)

This is intended for Zynq-7000, Zynq UltraScale+, Versal, and FPGA-only flows.

## Prerequisites

- Installed Xilinx tools with `xsdb` / `xsdb.bat`
- Running and reachable `hw_server` (or allow XSDB to launch/connect automatically)
- A valid hardware platform export (`.hdf` or `.xsa`)
- Bitstream file (`.bit` / `.pdi`) when PL programming is required
- Processor init script (`ps7_init.tcl` / `psu_init.tcl`) when needed
- Target GDB server endpoint (for example `extended-remote localhost:3000`)

## Launch Configuration (`xsdb-gdb`)

Example:

```json
{
  "type": "xsdb-gdb",
  "request": "attach",
  "name": "Debug Zynq-7000 Application",

  "xsdbPath": "C:/Xilinx/SDK/2019.1/bin/xsdb.bat",
  "hwServerUrl": "tcp:127.0.0.1:3121",

  "initTargetFilter": "APU*",
  "targetFilter": "ARM*#0",
  "jtagCableName": "Digilent JTAG-SMT1 210203859289A",

  "bitstreamPath": "./hw_platform/top_wrapper.bit",
  "ltxPath": "./hw_platform/top_wrapper.ltx",
  "hwDesignPath": "./hw_platform/system.hdf",
  "loadhwMemRanges": ["0x40000000 0xbfffffff"],
  "psInitScript": "./hw_platform/ps7_init.tcl",

  "forceMemAccess": true,
  "stopBeforePsInit": true,
  "resetType": "processor",
  "boardFamily": "zynq7000",
  "keepXsdbAlive": true,

  "gdbpath": "C:/msys64/mingw64/bin/gdb-multiarch.exe",
  "target": "extended-remote localhost:3000",
  "executable": "./build/app.elf",
  "cwd": "${workspaceRoot}",

  "stopAtConnect": true,
  "autorun": [
    "set print pretty on",
    "set confirm off",
    "file ./build/app.elf"
  ]
}
```

## Xilinx-Specific Fields

- `xsdbPath`: path to XSDB executable (`xsdb` or `xsdb.bat`)
- `hwServerUrl`: optional explicit `hw_server` URL
- `initTargetFilter`: first target for platform init phase (often `APU*`)
- `targetFilter`: final CPU target for runtime debug (for example `ARM*#0`)
- `jtagCableName`: optional cable filter (`jtag_cable_name`)
- `bitstreamPath`: PL bitstream path
- `ltxPath`: probes file path (reserved / informational for flow compatibility)
- `hwDesignPath`: hardware design export (`.hdf` / `.xsa`)
- `loadhwMemRanges`: optional memory ranges passed to `loadhw`
- `psInitScript`: path to PS init Tcl script
- `forceMemAccess`: runs `configparams force-mem-access 1` during init and resets to `0`
- `stopBeforePsInit`: runs `stop` before PS init sequence
- `resetType`: `processor`, `system`, or `none`
- `boardFamily`: `zynq7000`, `zynqmp`, `versal`, `fpga`, `auto`
- `keepXsdbAlive`: keep XSDB process alive during GDB debug session
- `xsdbAutorun`: additional XSDB commands after built-in init steps

## Runtime XSDB Commands

Commands are available from Command Palette:

- `XSDB: Program FPGA Bitstream`
- `XSDB: Reset Board`
- `XSDB: Read Memory`
- `XSDB: Write Memory`
- `XSDB: Send Command`

In Debug Console, prefix with `xsdb:`:

```text
xsdb: mrd 0xF8000000 10
xsdb: targets
xsdb: rst -processor
```

## Recommended Attach Behavior

For attach sessions, do **not** run GDB `load` unless your remote target supports program loading through that GDB connection.

Typical safe `autorun` for attach:

- `set print pretty on`
- `set confirm off`
- `file ./build/app.elf`

### Grouped Register View (`registerPreset`)

The XSDB Registers scope in the Variables panel groups ARM registers by
category instead of a flat list. Set `registerPreset` in your launch config:

| Preset | Contents |
| ------ | -------- |
| `"minimal"` | GP regs (r0–r12), SP/LR/PC, CPSR |
| `"core"` *(default)* | All non-banked registers (GP, SP/LR/PC, Status, plus board-specific) |
| `"all"` | Everything including banked modes (FIQ/IRQ/SVC/ABT/UND), VFP/NEON, CP15 |

### Peripheral Watch

Watch hardware peripheral registers directly in the Variables panel via
XSDB `mrd` reads. Two complementary views are available:

1. **Peripherals** scope — built-in presets for common Zynq-7000 / ZynqMP
   peripherals (SLCR, DDRC, TTC, UART, GIC, SCU). Automatically selected
   based on `boardFamily`.

2. **Peripheral Watch** scope — user-defined address watches configured in
   `launch.json`:

```json
"peripheralWatch": [
  { "name": "SLCR_LOCK_STA", "address": "0xF800000C" },
  { "name": "UART0_SR", "address": "0xE000002C" },
  { "name": "DDR_Region", "address": "0x00100000", "count": 4 }
]
```

### Breakpoint Auto-Reapply (`breakpointAutoReapply`)

After an XSDB board reset (`rst -processor` / `rst -system`) the GDB
breakpoint table is re-validated automatically. This avoids stale or
lost breakpoints after reset/re-init cycles. Enabled by default;
set `"breakpointAutoReapply": false` to disable.

If breakpoints fail to resolve after a reset, the debug console will
show a warning message with the details.

### FreeRTOS Awareness (`freertosAwareness`)

When enabled, detects FreeRTOS task lists from ELF symbols and shows a
**FreeRTOS Tasks** scope in the Variables panel:

```json
"freertosAwareness": true
```

Each task shows:

- Task name
- State (Running / Ready / Blocked / Suspended)
- Priority
- Stack high watermark (minimum free stack words)
- TCB address

Requirements:

- ELF must contain FreeRTOS symbols (`pxCurrentTCB`, `pxReadyTasksLists`, etc.)
- Target must be halted (stopped) when the scope is read
- Works with both AArch32 (Cortex-A9) and AArch64 (Cortex-A53)

### Linker Map File Annotation (`mapFilePath`)

Point to a GNU ld `.map` file to annotate memory addresses with symbol names:

```json
"mapFilePath": "./build/app.map"
```

When active, register values and peripheral watch addresses will show
the nearest symbol name alongside the hex value (e.g.,
`0x00100080  main+0x10`).

### XSDB Command Tracing (`xsdbTraceCommands`)

Enable a command-level trace log for XSDB diagnostics:

```json
"xsdbTraceCommands": true
```

View the trace in the debug console:

```text
xsdb: trace
```

Each entry shows timestamp, latency in ms, success/error, and the XSDB
command that was executed. Useful for diagnosing slow init sequences or
intermittent connection issues.

### Path Validation (Fail-Fast)

Before starting XSDB, all configured file paths are checked for
existence:

- `bitstreamPath`
- `hwDesignPath`
- `psInitScript`
- `initScript`
- `ltxPath`

If any file is missing, the debug session aborts immediately with a
clear error listing which paths were not found. This catches typos and
missing build artifacts early instead of failing mid-init.

## Troubleshooting (Xilinx)

### FPGA does not program

- Verify `bitstreamPath` is valid relative to `cwd`
- Verify cable filtering is correct (`jtagCableName`)
- Test manual XSDB command:
  - `xsdb: fpga -file ./hw_platform/top_wrapper.bit`
- Ensure target selection order is correct:
  - init target (`APU*`) first
  - CPU target (`ARM*#0`) before reset/debug

### `Load failed` after `Reading symbols ...`

This usually means **GDB remote load failed**, not XSDB init failure.

- Remove `load` from GDB `autorun` in attach mode
- Keep only `file <elf>` for symbols
- Use XSDB for board/program init stage

### Wrong target selected

- Use `jtagCableName` to avoid selecting another connected board
- Use wildcard filters (`APU*`, `ARM*#0`) instead of strict names

## Notes

- `xsdb-gdb` is companion mode (XSDB init + GDB debugging).
- Standalone XSDB debugging mode (`xsdb`) is planned for future work.

## Recipes

### Zynq-7000: Bare-Metal Debug (ZedBoard / PYNQ)

```json
{
  "type": "xsdb-gdb",
  "request": "attach",
  "name": "Zynq-7000 Bare Metal",
  "xsdbPath": "C:/Xilinx/SDK/2019.1/bin/xsdb.bat",
  "bitstreamPath": "./hw_platform/top_wrapper.bit",
  "hwDesignPath": "./hw_platform/system.hdf",
  "psInitScript": "./hw_platform/ps7_init.tcl",
  "initTargetFilter": "APU*",
  "targetFilter": "ARM*#0",
  "forceMemAccess": true,
  "stopBeforePsInit": true,
  "resetType": "processor",
  "boardFamily": "zynq7000",
  "gdbpath": "arm-none-eabi-gdb",
  "target": "extended-remote localhost:3000",
  "executable": "./build/app.elf",
  "remote": true,
  "cwd": "${workspaceRoot}",
  "stopAtConnect": true,
  "autorun": [
    "set print pretty on",
    "set confirm off",
    "file ./build/app.elf"
  ]
}
```

### Zynq-7000: FreeRTOS Debug with Peripheral Watch

```json
{
  "type": "xsdb-gdb",
  "request": "attach",
  "name": "Zynq-7000 FreeRTOS",
  "xsdbPath": "xsdb",
  "bitstreamPath": "./hw_platform/top_wrapper.bit",
  "hwDesignPath": "./hw_platform/system.hdf",
  "psInitScript": "./hw_platform/ps7_init.tcl",
  "initTargetFilter": "APU*",
  "targetFilter": "ARM*#0",
  "forceMemAccess": true,
  "stopBeforePsInit": true,
  "resetType": "processor",
  "boardFamily": "zynq7000",
  "gdbpath": "arm-none-eabi-gdb",
  "target": "extended-remote localhost:3000",
  "executable": "./build/freertos_app.elf",
  "remote": true,
  "cwd": "${workspaceRoot}",
  "stopAtConnect": true,
  "freertosAwareness": true,
  "registerPreset": "core",
  "mapFilePath": "./build/freertos_app.map",
  "peripheralWatch": [
    { "name": "UART0_SR", "address": "0xE000002C" },
    { "name": "GIC_IAR", "address": "0xF8F0010C" },
    { "name": "TTC0_CNT1", "address": "0xF8001018" }
  ],
  "autorun": [
    "set print pretty on",
    "set confirm off",
    "file ./build/freertos_app.elf"
  ]
}
```

### Zynq UltraScale+ (ZCU102)

```json
{
  "type": "xsdb-gdb",
  "request": "attach",
  "name": "ZCU102 Debug",
  "xsdbPath": "xsdb",
  "bitstreamPath": "./hw/design.bit",
  "hwDesignPath": "./hw/design.xsa",
  "psInitScript": "./hw/psu_init.tcl",
  "initTargetFilter": "APU*",
  "targetFilter": "Cortex-A53*#0",
  "forceMemAccess": true,
  "resetType": "processor",
  "boardFamily": "zynqmp",
  "gdbpath": "aarch64-none-elf-gdb",
  "target": "extended-remote localhost:3000",
  "executable": "./build/app.elf",
  "remote": true,
  "cwd": "${workspaceRoot}",
  "stopAtConnect": true,
  "registerPreset": "all",
  "autorun": [
    "set print pretty on",
    "set confirm off",
    "file ./build/app.elf"
  ]
}
```

### Multi-Board CI Configuration (JTAG Cable Filter)

```json
{
  "type": "xsdb-gdb",
  "request": "attach",
  "name": "Board A (SN 123456)",
  "xsdbPath": "xsdb",
  "bitstreamPath": "./hw/design.bit",
  "hwDesignPath": "./hw/system.hdf",
  "psInitScript": "./hw/ps7_init.tcl",
  "initTargetFilter": "APU*",
  "targetFilter": "ARM*#0",
  "jtagCableName": "Digilent JTAG-SMT1 123456",
  "boardFamily": "zynq7000",
  "gdbpath": "arm-none-eabi-gdb",
  "target": "extended-remote localhost:3000",
  "executable": "./build/app.elf",
  "remote": true,
  "cwd": "${workspaceRoot}",
  "xsdbTraceCommands": true
}
```

### FPGA-Only (MicroBlaze)

```json
{
  "type": "xsdb-gdb",
  "request": "attach",
  "name": "MicroBlaze Debug",
  "xsdbPath": "xsdb",
  "bitstreamPath": "./hw/design.bit",
  "boardFamily": "fpga",
  "resetType": "none",
  "gdbpath": "mb-gdb",
  "target": "extended-remote localhost:3000",
  "executable": "./build/mb_app.elf",
  "remote": true,
  "cwd": "${workspaceRoot}"
}
```

### Custom Init Script (Advanced)

```json
{
  "type": "xsdb-gdb",
  "request": "attach",
  "name": "Custom XSDB Flow",
  "xsdbPath": "xsdb",
  "initScript": "./scripts/custom_board_init.tcl",
  "gdbpath": "arm-none-eabi-gdb",
  "target": "extended-remote localhost:3000",
  "executable": "./build/app.elf",
  "remote": true,
  "cwd": "${workspaceRoot}",
  "xsdbAutorun": [
    "configparams force-mem-access 0",
    "targets"
  ]
}
```
