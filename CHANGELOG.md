# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-24

### Added
- **DebugAgent C++ Library**:
  - Independent of VoiceKit, LVGL, and M5Unified.
  - Zero dynamic allocations during runtime.
  - 8 KB circular buffer placed in ESP32-S3 PSRAM (`DEBUG_BUFFER_SIZE 8192`).
  - Thread-safe ring buffer with non-blocking drop policy and drop accounting.
  - Non-blocking TCP client state machine (`DISABLED`, `WAIT_WIFI`, `DISCONNECTED`, `CONNECTING`, `CONNECTED`, `BACKOFF`).
  - Strict update budget (target ≤ 100 µs average, ≤ 1 ms peak).
  - Monotonic sequence numbers and timestamping.
  - Complete compile-time disable via `#define DEBUG_AGENT_ENABLED 0` (zero RAM, zero sockets).
- **CoreS3 Demo Firmware (BasicDiagnostics)**:
  - M5Unified LCD UI in native landscape 320x240 (`M5.Display.setRotation(0)`).
  - Real-time display of local IP, server IP, connection state, SRAM/PSRAM, sent/dropped counts.
  - 3 touch buttons on screen: `LOG`, `WARN`, `ERROR`.
  - Periodic system metrics transmission (Heap, Min Heap, Max Alloc, PSRAM, RSSI).
  - Finite state machine simulation: `IDLE` -> `RUNNING` -> `PROCESSING` -> `IDLE`.
  - Custom evolving sine wave metrics for live chart testing.
- **Node.js Diagnostics Server**:
  - Raw TCP server on port 9000 handling NDJSON streams.
  - Robust NDJSON framing handling TCP fragmentation, packet coalescing, and line overflow protection.
  - WebSocket server on port 8080 broadcasting real-time logs and metrics.
  - Sequence gap detection calculating packets lost in transit.
  - Device manager tracking active devices, history, custom metrics, and dynamic states.
  - Diagnostic report generator exportable in Markdown/JSON for Antigravity.
- **Web Interface (Vanilla JS + Vite)**:
  - Technical dark theme optimized for technical debugging.
  - **Dashboard**: Real-time hardware status, memory meters, and canvas time-series charts (SRAM, PSRAM, RSSI).
  - **Console**: High-performance log stream with level filtering (TRACE to ERROR), dynamic category filtering, search, auto-scroll, pause, clipboard copy, TXT export, and JSON export.
  - **Variables & États**: Dynamic rendering of custom metrics and states without requiring UI code changes.
  - **Diagnostics**: Network throughput, invalid message tracking, buffer saturation, update latency, and diagnostic report exporter.
- **Simulator & Tooling**:
  - `tools/device-simulator.js` replicating CoreS3 over TCP with burst, error, malformed, and fragmentation test modes.
  - `Start-Monitor.bat` for one-click launch on Windows 11.
  - Automated test suite covering protocol parsing, buffer limits, TCP fragmentation, and Playwright UI tests.
