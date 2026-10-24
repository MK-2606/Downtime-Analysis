# Downtime WebBLE

Static Web Bluetooth dashboard for the ESP32 downtime monitoring device.

The page is intended for GitHub Pages hosting and connects to the ESP32 over a
custom BLE GATT service. It includes a demo mode so the operator UI can be
reviewed before the ESP32 firmware implements the BLE service.

## BLE Contract

Service UUID:

```text
d7f6a001-0d55-4d38-8f24-7c9f2b4a0001
```

Characteristics:

```text
Telemetry  d7f6a002-0d55-4d38-8f24-7c9f2b4a0001  read, notify
Command    d7f6a003-0d55-4d38-8f24-7c9f2b4a0001  write
Logs       d7f6a004-0d55-4d38-8f24-7c9f2b4a0001  read, notify
Config     d7f6a005-0d55-4d38-8f24-7c9f2b4a0001  read, write
Wi-Fi      d7f6a006-0d55-4d38-8f24-7c9f2b4a0001  read, notify
Sync       d7f6a007-0d55-4d38-8f24-7c9f2b4a0001  read, notify
DeviceInfo d7f6a008-0d55-4d38-8f24-7c9f2b4a0001  read, notify
```

Messages are UTF-8 encoded JSON.

Device identity example:

```json
{
  "type": "device_info",
  "deviceId": "EF-001",
  "bleName": "EF-001",
  "deviceName": "Downtime Monitoring Device",
  "location": "Location not assigned",
  "machineId": "MACHINE-001",
  "firmwareName": "EF001_BLE_Identity",
  "firmwareVersion": "0.1.0",
  "hardware": "ESP32-WROOM-D"
}
```


## Downtime Analysis

The dashboard includes a client-side analysis section that reads the existing device log records. It provides a date-range filter, downtime/runtime/stoppage/availability summaries, hourly idle-duration bars, a downtime-by-reason breakdown, CSV export, and a print-to-PDF action (choose **Save as PDF** in the browser print dialog).

- Analysis uses closed log intervals with valid timestamps. Records whose RTC timestamp is invalid and currently open intervals are excluded from the charts and calculations.
- Downtime is the sum of `IDLE` interval durations; runtime is the sum of `ACTIVE` interval durations. Availability is runtime divided by recorded active + idle time.
- Reason labels use the existing `reasonCode` firmware contract in `app.js`; no mapping to unrelated reason categories is inferred.
- No sample analysis values are generated. The section stays empty until timestamped logs are received from the device.
- CSV and PDF export run in the browser and do not require a server or additional dependencies.
