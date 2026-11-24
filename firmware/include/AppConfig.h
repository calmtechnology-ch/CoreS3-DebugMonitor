#pragma once

// Centralized configuration for CoreS3-DebugMonitor
// To override credentials without modifying Git tracked files,
// create AppConfig.local.h in firmware/include/

#if __has_include("AppConfig.local.h")
#include "AppConfig.local.h"
#else
#define WIFI_SSID "Box_W7-096603"
#define WIFI_PASSWORD "xsqb4379xchd3677dy"

#define DEBUG_HOST "192.168.1.2"
#define DEBUG_PORT 9000

#define DEVICE_NAME "CoreS3-01"
#define APP_NAME "BasicDiagnostics"
#define APP_VERSION "0.1.0.1"
#endif
