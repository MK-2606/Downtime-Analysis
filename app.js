"use strict";

const BLE = {
  service: "d7f6a001-0d55-4d38-8f24-7c9f2b4a0001",
  telemetry: "d7f6a002-0d55-4d38-8f24-7c9f2b4a0001",
  command: "d7f6a003-0d55-4d38-8f24-7c9f2b4a0001",
  logs: "d7f6a004-0d55-4d38-8f24-7c9f2b4a0001",
  config: "d7f6a005-0d55-4d38-8f24-7c9f2b4a0001",
  wifi: "d7f6a006-0d55-4d38-8f24-7c9f2b4a0001",
  sync: "d7f6a007-0d55-4d38-8f24-7c9f2b4a0001",
  deviceInfo: "d7f6a008-0d55-4d38-8f24-7c9f2b4a0001",
};

// Stoppage-reason catalog. Codes are the contract with the firmware
// (EventRecord.reasonCode); 0 always means unassigned. Keep in sync with any
// reporting/MQTT consumer that maps codes back to labels.
const REASON_CODES = [
  { code: 0, label: "Unassigned" },
  { code: 1, label: "Planned break" },
  { code: 2, label: "Material shortage" },
  { code: 3, label: "Tool / die change" },
  { code: 4, label: "Breakdown / fault" },
  { code: 5, label: "Setup / changeover" },
  { code: 6, label: "Quality check" },
  { code: 7, label: "No operator" },
  { code: 8, label: "Blocked (downstream)" },
  { code: 9, label: "Starved (upstream)" },
  { code: 10, label: "Other" },
];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const state = {
  device: null,
  server: null,
  service: null,
  characteristics: {},
  connected: false,
  demo: false,
  demoTimer: null,
  logs: [],
  trend: [],
  deviceInfo: {
    deviceId: "--",
    bleName: "Not selected",
    deviceName: "Downtime Monitor",
    location: "Not available",
    machineId: "Not assigned",
    firmwareName: "--",
    firmwareVersion: "--",
    hardware: "ESP32-WROOM-D",
  },
  durations: {
    ACTIVE: 0,
    IDLE: 0,
  },
  currentState: "IDLE",
  lastDurationTick: Date.now(),
  syncProgress: 0,
  openEventId: 0,
  openDurationSec: 0,
};

const els = {
  secureBadge: document.querySelector("#secureBadge"),
  bleSupportBadge: document.querySelector("#bleSupportBadge"),
  connectionBadge: document.querySelector("#connectionBadge"),
  connectButton: document.querySelector("#connectButton"),
  disconnectButton: document.querySelector("#disconnectButton"),
  deviceName: document.querySelector("#deviceName"),
  deviceConnState: document.querySelector("#deviceConnState"),
  deviceIdValue: document.querySelector("#deviceIdValue"),
  deviceModel: document.querySelector("#deviceModel"),
  advertisedNameValue: document.querySelector("#advertisedNameValue"),
  installedLocationValue: document.querySelector("#installedLocationValue"),
  associatedMachineValue: document.querySelector("#associatedMachineValue"),
  firmwareValue: document.querySelector("#firmwareValue"),
  hardwareValue: document.querySelector("#hardwareValue"),
  currentValue: document.querySelector("#currentValue"),
  machineState: document.querySelector("#machineState"),
  stateReason: document.querySelector("#stateReason"),
  rtcTime: document.querySelector("#rtcTime"),
  rtcDate: document.querySelector("#rtcDate"),
  logCount: document.querySelector("#logCount"),
  syncStatusText: document.querySelector("#syncStatusText"),
  healthBanner: document.querySelector("#healthBanner"),
  healthBannerTitle: document.querySelector("#healthBannerTitle"),
  healthBannerText: document.querySelector("#healthBannerText"),
  lastUpdate: document.querySelector("#lastUpdate"),
  activeDuration: document.querySelector("#activeDuration"),
  idleDuration: document.querySelector("#idleDuration"),
  machineIdInput: document.querySelector("#machineIdInput"),
  thresholdInput: document.querySelector("#thresholdInput"),
  debounceInput: document.querySelector("#debounceInput"),
  readConfigButton: document.querySelector("#readConfigButton"),
  saveConfigButton: document.querySelector("#saveConfigButton"),
  syncRtcButton: document.querySelector("#syncRtcButton"),
  scanWifiButton: document.querySelector("#scanWifiButton"),
  syncCloudButton: document.querySelector("#syncCloudButton"),
  wifiState: document.querySelector("#wifiState"),
  wifiSelect: document.querySelector("#wifiSelect"),
  wifiPasswordInput: document.querySelector("#wifiPasswordInput"),
  wifiPasswordToggle: document.querySelector("#wifiPasswordToggle"),
  connectWifiButton: document.querySelector("#connectWifiButton"),
  syncProgressBar: document.querySelector("#syncProgressBar"),
  syncDetail: document.querySelector("#syncDetail"),
  requestLogsButton: document.querySelector("#requestLogsButton"),
  exportLogsButton: document.querySelector("#exportLogsButton"),
  clearSyncedButton: document.querySelector("#clearSyncedButton"),
  logsTableBody: document.querySelector("#logsTableBody"),
  clearEventsButton: document.querySelector("#clearEventsButton"),
  eventList: document.querySelector("#eventList"),
  eventTemplate: document.querySelector("#eventTemplate"),
  currentGauge: document.querySelector("#currentGauge"),
  trendCanvas: document.querySelector("#trendCanvas"),
  runtimeCanvas: document.querySelector("#runtimeCanvas"),
  analysisStartDate: document.querySelector("#analysisStartDate"),
  analysisEndDate: document.querySelector("#analysisEndDate"),
  analysisDaySelect: document.querySelector("#analysisDaySelect"),
  analysisDowntime: document.querySelector("#analysisDowntime"),
  analysisRuntime: document.querySelector("#analysisRuntime"),
  analysisStoppages: document.querySelector("#analysisStoppages"),
  analysisAvailability: document.querySelector("#analysisAvailability"),
  hourlyDowntimeChart: document.querySelector("#hourlyDowntimeChart"),
  lossByReasonChart: document.querySelector("#lossByReasonChart"),
  analysisDataNote: document.querySelector("#analysisDataNote"),
};

function init() {
  updatePlatformBadges();
  bindEvents();
  loadLocalConfig();
  renderAll();
  logEvent("Dashboard ready");
}

function bindEvents() {
  els.connectButton.addEventListener("click", connectDevice);
  els.disconnectButton.addEventListener("click", disconnectDevice);
  els.readConfigButton.addEventListener("click", readConfig);
  els.saveConfigButton.addEventListener("click", saveConfig);
  els.syncRtcButton.addEventListener("click", syncRtc);
  els.scanWifiButton.addEventListener("click", scanWifi);
  els.connectWifiButton.addEventListener("click", connectWifi);
  els.wifiPasswordToggle.addEventListener("click", toggleWifiPassword);
  els.syncCloudButton.addEventListener("click", syncCloud);
  els.requestLogsButton.addEventListener("click", requestLogs);
  els.exportLogsButton.addEventListener("click", exportLogs);
  els.clearSyncedButton.addEventListener("click", clearSyncedLogs);
  els.clearEventsButton.addEventListener("click", () => {
    els.eventList.replaceChildren();
    logEvent("Event console cleared");
  });

  window.addEventListener("resize", renderCharts);
  els.analysisStartDate.addEventListener("change", () => { validateAnalysisDates(); renderAnalysis(); });
  els.analysisEndDate.addEventListener("change", () => { validateAnalysisDates(); renderAnalysis(); });
  els.analysisDaySelect.addEventListener("change", renderHourlyAnalysis);
  document.querySelector("#exportAnalysisCsv").addEventListener("click", exportAnalysisCsv);
  document.querySelector("#exportAnalysisPdf").addEventListener("click", () => window.print());
}

function updatePlatformBadges() {
  if (window.isSecureContext) {
    setBadge(els.secureBadge, "Secure context", "on");
  } else {
    setBadge(els.secureBadge, "HTTPS required", "off");
  }

  if ("bluetooth" in navigator) {
    setBadge(els.bleSupportBadge, "WebBLE available", "on");
  } else {
    setBadge(els.bleSupportBadge, "WebBLE unavailable", "warn");
  }
}

async function connectDevice() {
  if (!("bluetooth" in navigator)) {
    logEvent("Web Bluetooth is not available in this browser");
    return;
  }

  try {
    setConnectionUi("connecting");
    logEvent("Opening Bluetooth device picker");

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: "EF-", services: [BLE.service] },
        { services: [BLE.service] },
        { namePrefix: "DTM-" },
        { namePrefix: "Downtime" },
      ],
      optionalServices: [BLE.service],
    });

    state.device = device;
    state.device.addEventListener("gattserverdisconnected", handleDisconnect);
    els.deviceName.textContent = device.name || "ESP32 Downtime Monitor";
    handleDeviceInfoMessage({
      bleName: device.name || "ESP32 Downtime Monitor",
    });

    state.server = await device.gatt.connect();
    state.service = await state.server.getPrimaryService(BLE.service);

    await cacheCharacteristics();
    await startNotifications();
    await readInitialValues();

    state.connected = true;
    state.lastDurationTick = Date.now();
    setConnectionUi("connected");
    logEvent("Connected to ESP32 BLE service");
  } catch (error) {
    setConnectionUi("disconnected");
    logEvent(`BLE connection failed: ${error.message}`);
  }
}

async function cacheCharacteristics() {
  state.characteristics.deviceInfo = await optionalCharacteristic(BLE.deviceInfo);
  state.characteristics.telemetry = await optionalCharacteristic(BLE.telemetry);
  state.characteristics.command = await optionalCharacteristic(BLE.command);
  state.characteristics.logs = await optionalCharacteristic(BLE.logs);
  state.characteristics.config = await optionalCharacteristic(BLE.config);
  state.characteristics.wifi = await optionalCharacteristic(BLE.wifi);
  state.characteristics.sync = await optionalCharacteristic(BLE.sync);
}

async function optionalCharacteristic(uuid) {
  try {
    return await state.service.getCharacteristic(uuid);
  } catch (error) {
    logEvent(`Characteristic missing: ${uuid.slice(0, 8)}`);
    return null;
  }
}

async function startNotifications() {
  await startCharacteristicNotifications(
    state.characteristics.deviceInfo,
    handleDeviceInfoMessage
  );
  await startCharacteristicNotifications(
    state.characteristics.telemetry,
    handleTelemetryMessage
  );
  await startCharacteristicNotifications(state.characteristics.logs, handleLogMessage);
  await startCharacteristicNotifications(state.characteristics.wifi, handleWifiMessage);
  await startCharacteristicNotifications(state.characteristics.sync, handleSyncMessage);
}

async function startCharacteristicNotifications(characteristic, handler) {
  if (!characteristic || !characteristic.properties.notify) {
    return;
  }

  characteristic.addEventListener("characteristicvaluechanged", (event) => {
    const text = decodeValue(event.target.value);
    handler(text);
  });
  await characteristic.startNotifications();
}

async function readInitialValues() {
  await readJsonCharacteristic(state.characteristics.deviceInfo, handleDeviceInfoMessage);
  await readJsonCharacteristic(state.characteristics.telemetry, handleTelemetryMessage);
  await readJsonCharacteristic(state.characteristics.config, handleConfigMessage);
  await readJsonCharacteristic(state.characteristics.logs, handleLogMessage);
  await readJsonCharacteristic(state.characteristics.sync, handleSyncMessage);
}

async function readJsonCharacteristic(characteristic, handler) {
  if (!characteristic || !characteristic.properties.read) {
    return;
  }

  try {
    const value = await characteristic.readValue();
    const text = decodeValue(value);
    if (text) {
      handler(text);
    }
  } catch (error) {
    logEvent(`Read failed: ${error.message}`);
  }
}

function disconnectDevice() {
  if (state.device?.gatt?.connected) {
    state.device.gatt.disconnect();
  }
  handleDisconnect();
}

function handleDisconnect() {
  state.connected = false;
  state.server = null;
  state.service = null;
  state.characteristics = {};
  setConnectionUi("disconnected");
  if (!state.demo) {
    els.deviceName.textContent = "Not selected";
    resetDeviceInfo();
  }
  logEvent("BLE disconnected");
}

function setConnectionUi(mode) {
  if (mode === "connected") {
    setBadge(els.connectionBadge, "Connected", "on");
    setConnChip("Connected", "on");
    els.connectButton.disabled = true;
    els.disconnectButton.disabled = false;
    return;
  }

  if (mode === "connecting") {
    setBadge(els.connectionBadge, "Connecting", "warn");
    setConnChip("Connecting", "warn");
    els.connectButton.disabled = true;
    els.disconnectButton.disabled = true;
    return;
  }

  setBadge(els.connectionBadge, "Disconnected", "off");
  setConnChip("Disconnected", "off");
  els.connectButton.disabled = false;
  els.disconnectButton.disabled = true;
}

function setConnChip(text, tone) {
  els.deviceConnState.textContent = text;
  els.deviceConnState.className = `conn-chip ${tone}`;
}

function setBadge(element, text, tone) {
  element.textContent = text;
  element.className = `badge ${tone}`;
}

function decodeValue(dataView) {
  const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
  return decoder.decode(bytes).trim();
}

function parseJsonMessage(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    logEvent(`Invalid JSON from ESP32: ${text.slice(0, 60)}`);
    return null;
  }
}

function handleDeviceInfoMessage(text) {
  const info = typeof text === "string" ? parseJsonMessage(text) : text;
  if (!info) {
    return;
  }

  state.deviceInfo = {
    ...state.deviceInfo,
    ...info,
    deviceId: info.deviceId || info.id || state.deviceInfo.deviceId,
    bleName: info.bleName || info.advertisedName || state.deviceInfo.bleName,
    deviceName: info.deviceName || info.model || state.deviceInfo.deviceName,
    location: info.location || info.installedLocation || state.deviceInfo.location,
    machineId: info.machineId || info.machine || state.deviceInfo.machineId,
    firmwareName: info.firmwareName || info.firmware || state.deviceInfo.firmwareName,
    firmwareVersion: info.firmwareVersion || info.version || state.deviceInfo.firmwareVersion,
    hardware: info.hardware || state.deviceInfo.hardware,
  };

  if (state.deviceInfo.bleName && state.deviceInfo.bleName !== "Not selected") {
    els.deviceName.textContent = state.deviceInfo.bleName;
  }

  if (state.deviceInfo.machineId && state.deviceInfo.machineId !== "Not assigned") {
    els.machineIdInput.value = state.deviceInfo.machineId;
  }

  renderDeviceInfo();
  if (state.deviceInfo.deviceId && state.deviceInfo.deviceId !== "--") {
    logEvent(`Device identified: ${state.deviceInfo.deviceId}`);
  }
}

function resetDeviceInfo() {
  state.deviceInfo = {
    deviceId: "--",
    bleName: "Not selected",
    deviceName: "Downtime Monitor",
    location: "Not available",
    machineId: "Not assigned",
    firmwareName: "--",
    firmwareVersion: "--",
    hardware: "ESP32-WROOM-D",
  };
  renderDeviceInfo();
}

function renderDeviceInfo() {
  const info = state.deviceInfo;
  els.deviceIdValue.textContent = info.deviceId || "--";
  els.deviceModel.textContent = info.deviceName || "Downtime Monitor";
  els.advertisedNameValue.textContent = info.bleName || "Not selected";
  els.installedLocationValue.textContent = info.location || "Not available";
  els.associatedMachineValue.textContent = info.machineId || "Not assigned";
  els.firmwareValue.textContent = [info.firmwareName, info.firmwareVersion]
    .filter((part) => part && part !== "--")
    .join(" ") || "--";
  els.hardwareValue.textContent = info.hardware || "ESP32-WROOM-D";
}

function handleTelemetryMessage(text) {
  const message = typeof text === "string" ? parseJsonMessage(text) : text;
  if (!message) {
    return;
  }

  const current = Number(message.currentA ?? message.current ?? 0);
  const machineState = normalizeMachineState(message.state);

  updateDurations(machineState);
  state.currentState = machineState;
  state.trend.push({
    at: Date.now(),
    current,
    state: machineState,
  });

  if (state.trend.length > 90) {
    state.trend.shift();
  }

  els.currentValue.textContent = formatNumber(current, 2);

  // The firmware distinguishes the committed state from the one it is voting
  // for during the debounce window; show that so the UI does not look frozen
  // while a transition is being confirmed.
  let reason = message.reason || stateReasonFor(machineState, current);
  if (message.pending && message.pending !== message.state && message.pendingSec) {
    reason = `${reason} (→ ${message.pending} in ${message.pendingSec}s)`;
  }
  setMachineState(machineState, reason);

  updateRtcFromTelemetry(message);
  updateHealthBanner(message);
  els.lastUpdate.textContent = `Updated ${new Date().toLocaleTimeString()}`;

  if (Number.isFinite(Number(message.logCount))) {
    els.logCount.textContent = String(message.logCount);
  }
  if (Number.isFinite(Number(message.logUnsynced))) {
    const pending = Number(message.logUnsynced);
    els.syncStatusText.textContent =
      pending > 0 ? `${pending} log(s) pending sync` : "All logs synced";
  }

  // Track the ongoing interval so its row can show a live-ticking duration and
  // stay reason-assignable while the machine is still in that state.
  const openId = Number(message.openEventId ?? 0);
  const openDur = Number(message.stateDurationSec ?? 0);
  const intervalChanged = openId !== state.openEventId;
  state.openEventId = openId;
  state.openDurationSec = openDur;
  if (state.logs.length) {
    if (intervalChanged) {
      // A new interval opened/closed: the table structure changed, rebuild it.
      renderLogs();
    } else {
      // Same interval, just a new second: touch only the ongoing duration cell so
      // an open reason dropdown is never torn down mid-selection.
      updateOpenDurationCell();
    }
  }

  renderCharts();
}

// The RTC comes across as an epoch plus an explicit validity flag; a device
// whose clock was never set reports rtcValid=false and epoch 0, which must read
// as "not set" rather than 1 January 1970.
function updateRtcFromTelemetry(message) {
  if (message.rtcValid === false || Number(message.epoch) === 0) {
    els.rtcTime.textContent = "Not set";
    els.rtcDate.textContent = "Send Sync RTC to set the clock";
    return;
  }
  if (Number.isFinite(Number(message.epoch)) && Number(message.epoch) > 0) {
    updateRtc(new Date(Number(message.epoch) * 1000).toISOString());
    return;
  }
  updateRtc(message.rtc || message.iso || new Date().toISOString());
}

// Reflects the firmware's analog front-end self-diagnosis. Silent when healthy;
// loud when the CT bias is wrong or the signal is clipping, because both make
// every current reading untrustworthy.
function updateHealthBanner(message) {
  const hasHealth =
    message.biasOk !== undefined ||
    message.clipped !== undefined ||
    message.adcReady !== undefined;
  if (!hasHealth) {
    return;
  }

  let tone = null;
  let text = "";

  if (message.adcReady === false) {
    tone = "bad";
    text = "ADS1115 not detected — check the I2C wiring at 0x48.";
  } else if (message.clipped) {
    tone = "bad";
    text = `Signal is clipping the ADC rail — readings under-report. ${
      message.biasMsg || ""
    }`.trim();
  } else if (message.biasOk === false) {
    tone = "warn";
    text =
      message.biasMsg ||
      "CT bias off-centre — current readings are not trustworthy yet.";
  }

  if (!tone) {
    els.healthBanner.className = "health-banner hidden";
    return;
  }

  els.healthBanner.className = `health-banner ${tone}`;
  els.healthBannerTitle.textContent =
    tone === "bad" ? "Front-end fault" : "Front-end check";
  els.healthBannerText.textContent = text;
}

function handleConfigMessage(text) {
  const config = typeof text === "string" ? parseJsonMessage(text) : text;
  if (!config) {
    return;
  }

  if (config.machineId) {
    els.machineIdInput.value = config.machineId;
  }
  if (config.deviceId || config.location || config.installedLocation) {
    handleDeviceInfoMessage(config);
  }
  if (Number.isFinite(Number(config.thresholdA))) {
    els.thresholdInput.value = config.thresholdA;
  }
  if (Number.isFinite(Number(config.debounceSec))) {
    els.debounceInput.value = config.debounceSec;
  }

  saveLocalConfig();
  logEvent("Configuration updated");
}

function handleLogMessage(text) {
  const message = typeof text === "string" ? parseJsonMessage(text) : text;
  if (!message) {
    return;
  }

  if (Array.isArray(message.records)) {
    // The firmware streams logs as MTU-sized pages: page 0 starts a fresh set,
    // later pages append. nextId is informational here because the device sends
    // the pages back to back without waiting to be asked for each one.
    const mapped = message.records.map(normalizeLogRecord);
    const page = Number(message.page ?? 0);
    if (page === 0) {
      state.logs = mapped;
    } else {
      for (const record of mapped) {
        upsertLog(record);
      }
    }
  } else if (message.record) {
    upsertLog(normalizeLogRecord(message.record));
  } else if (message.type === "clear") {
    state.logs = [];
  }

  renderLogs();
}

function handleWifiMessage(text) {
  const message = typeof text === "string" ? parseJsonMessage(text) : text;
  if (!message) {
    return;
  }

  if (message.status) {
    els.wifiState.textContent = message.status;
  }

  // When connected the firmware reports SSID/IP/NTP so the operator can see the
  // hotspot took and the clock was set over the network.
  if (message.connected) {
    const bits = [message.ssid, message.ip].filter(Boolean).join(" @ ");
    const ntp = message.ntpSynced ? " · RTC synced (NTP)" : "";
    logEvent(`Wi-Fi connected: ${bits}${ntp}`);
  }

  if (Array.isArray(message.networks)) {
    renderWifiNetworks(message.networks);
    if (message.networks.length) {
      logEvent(`Wi-Fi scan found ${message.networks.length} network(s)`);
    }
  }
}

function handleSyncMessage(text) {
  const message = typeof text === "string" ? parseJsonMessage(text) : text;
  if (!message) {
    return;
  }

  const progress = Number(message.progress ?? message.percent ?? 0);
  updateSyncProgress(progress, message.status || "Sync update");

  if (message.complete) {
    state.logs = state.logs.map((record) => ({ ...record, synced: true }));
    renderLogs();
  }
}

function normalizeMachineState(value) {
  // Two states now. Older three-state payloads (and demo/localStorage data)
  // collapse: only RUNNING/ACTIVE count as active, everything else is idle.
  const normalized = String(value || "IDLE").toUpperCase();
  if (normalized === "ACTIVE" || normalized === "RUNNING") {
    return "ACTIVE";
  }
  return "IDLE";
}

function setMachineState(machineState, reason) {
  els.machineState.textContent = machineState;
  els.machineState.className = `state-text ${machineState.toLowerCase()}`;
  els.stateReason.textContent = reason;
}

function stateReasonFor(machineState, current) {
  if (machineState === "ACTIVE") {
    return `Load detected at ${formatNumber(current, 2)} A`;
  }
  return "Below active threshold";
}

function updateRtc(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    els.rtcTime.textContent = String(value || "--:--:--");
    els.rtcDate.textContent = "RTC format pending";
    return;
  }

  els.rtcTime.textContent = date.toLocaleTimeString();
  els.rtcDate.textContent = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function updateDurations(nextState) {
  const now = Date.now();
  const elapsed = Math.max(0, Math.floor((now - state.lastDurationTick) / 1000));
  state.durations[state.currentState] += elapsed;
  state.lastDurationTick = now;
  state.currentState = nextState;
  renderDurations();
}

function renderDurations() {
  els.activeDuration.textContent = formatDuration(state.durations.ACTIVE);
  els.idleDuration.textContent = formatDuration(state.durations.IDLE);
}

async function sendCommand(command) {
  if (state.demo) {
    handleDemoCommand(command);
    return;
  }

  const commandChar = state.characteristics.command;
  if (!state.connected || !commandChar) {
    logEvent("Command not sent: BLE device is not connected");
    return;
  }

  try {
    const payload = encoder.encode(JSON.stringify(command));
    await commandChar.writeValue(payload);
    logEvent(`Command sent: ${command.cmd}`);
  } catch (error) {
    logEvent(`Command failed: ${error.message}`);
  }
}

async function readConfig() {
  if (state.demo) {
    handleConfigMessage(currentConfig());
    return;
  }

  await sendCommand({ cmd: "read_config" });
}

async function saveConfig() {
  const config = currentConfig();
  saveLocalConfig();
  await sendCommand({ cmd: "save_config", ...config });
}

async function syncRtc() {
  // Firmware sets the DS3231 from a Unix epoch (seconds); parsing ISO on the
  // device is not worth the code. iso is kept for the demo-mode display path.
  await sendCommand({
    cmd: "set_rtc",
    epoch: Math.floor(Date.now() / 1000),
    iso: new Date().toISOString(),
  });
}

async function scanWifi() {
  els.wifiState.textContent = "Scanning";
  await sendCommand({ cmd: "scan_wifi" });
}

function toggleWifiPassword() {
  const show = els.wifiPasswordInput.type === "password";
  els.wifiPasswordInput.type = show ? "text" : "password";
  els.wifiPasswordToggle.textContent = show ? "Hide" : "Show";
  els.wifiPasswordToggle.setAttribute("aria-pressed", String(show));
  els.wifiPasswordToggle.setAttribute(
    "aria-label",
    show ? "Hide password" : "Show password"
  );
}

async function connectWifi() {
  const ssid = els.wifiSelect.value.trim();
  const password = els.wifiPasswordInput.value;

  if (!ssid) {
    logEvent("Select a Wi-Fi network before connecting");
    return;
  }

  els.wifiState.textContent = "Connecting";
  await sendCommand({ cmd: "connect_wifi", ssid, password });
}

async function syncCloud() {
  updateSyncProgress(0, "Starting MQTT sync");
  await sendCommand({ cmd: "sync_mqtt" });
}

async function requestLogs() {
  await sendCommand({ cmd: "request_logs", offset: 0, limit: 100 });
}

async function clearSyncedLogs() {
  if (state.demo) {
    state.logs = state.logs.filter((record) => !record.synced);
    renderLogs();
    logEvent("Synced demo logs cleared");
    return;
  }

  await sendCommand({ cmd: "clear_synced" });
}

function currentConfig() {
  return {
    machineId: els.machineIdInput.value.trim() || "MACHINE-001",
    thresholdA: Number(els.thresholdInput.value),
    debounceSec: Number(els.debounceInput.value),
  };
}

function saveLocalConfig() {
  localStorage.setItem("downtimeWebBleConfig", JSON.stringify(currentConfig()));
}

function loadLocalConfig() {
  const rawConfig = localStorage.getItem("downtimeWebBleConfig");
  if (!rawConfig) {
    return;
  }

  try {
    handleConfigMessage(JSON.parse(rawConfig));
  } catch (error) {
    localStorage.removeItem("downtimeWebBleConfig");
  }
}

function renderWifiNetworks(networks) {
  const options = networks
    .map((network) => ({
      ssid: String(network.ssid || network),
      rssi: Number(network.rssi ?? -70),
      secure: Boolean(network.secure ?? true),
    }))
    .sort((a, b) => b.rssi - a.rssi);

  els.wifiSelect.replaceChildren();
  if (!options.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No networks found";
    els.wifiSelect.append(option);
    return;
  }

  for (const network of options) {
    const option = document.createElement("option");
    option.value = network.ssid;
    option.textContent = `${network.ssid} (${network.rssi} dBm)`;
    els.wifiSelect.append(option);
  }
}

function updateSyncProgress(percent, detail) {
  state.syncProgress = clamp(Number(percent), 0, 100);
  els.syncProgressBar.style.width = `${state.syncProgress}%`;
  els.syncDetail.textContent = detail;
  els.syncStatusText.textContent =
    state.syncProgress >= 100 ? "Last sync complete" : "Sync pending";
  logEvent(detail);
}

function normalizeLogRecord(record) {
  // Firmware records carry an epochStart in Unix seconds (0 when the RTC was
  // never set) plus a validity flag; fall back to any pre-formatted timestamp
  // from demo/localStorage sources.
  let timestamp = record.timestamp || record.at || null;
  const epochStart = Number(record.epochStart ?? 0);
  if (!timestamp && record.rtcValid !== false && epochStart > 0) {
    timestamp = new Date(epochStart * 1000).toISOString();
  }

  return {
    id: record.id ?? `${epochStart || Date.now()}-${record.state}`,
    timestamp: timestamp || "Time not set",
    machineId: record.machineId || currentConfig().machineId,
    state: normalizeMachineState(record.state),
    currentA: Number(record.currentA ?? record.current ?? 0),
    peakA: Number(record.peakA ?? record.currentA ?? record.current ?? 0),
    durationSec: Number(record.durationSec ?? record.duration ?? 0),
    reasonCode: Number(record.reasonCode ?? 0),
    open: Boolean(record.open),
    synced: Boolean(record.synced),
  };
}

function upsertLog(record) {
  const index = state.logs.findIndex((item) => item.id === record.id);
  if (index >= 0) {
    state.logs[index] = record;
  } else {
    state.logs.unshift(record);
  }
}

function sortedLogs() {
  // Newest first. Numeric firmware ids sort cleanly; demo/string ids fall back
  // to timestamp so both sources render sensibly.
  return [...state.logs].sort((a, b) => {
    if (typeof a.id === "number" && typeof b.id === "number") {
      return b.id - a.id;
    }
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
}

// Updates just the ongoing interval's duration text. Cheap enough to run every
// telemetry tick and, crucially, leaves the rest of the table (open dropdowns
// included) untouched.
function updateOpenDurationCell() {
  const cell = document.querySelector("#openDurationCell");
  if (cell) {
    cell.textContent = `${formatDuration(state.openDurationSec)} (ongoing)`;
  }
}

function renderLogs() {
  // Never rebuild the table out from under an operator mid-selection; defer and
  // let the next change (or their blur-triggered action) redraw it.
  const active = document.activeElement;
  if (active && active.classList && active.classList.contains("reason-select")) {
    return;
  }

  els.logCount.textContent = String(state.logs.length);
  els.logsTableBody.replaceChildren();

  if (!state.logs.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent = "No logs loaded";
    row.append(cell);
    els.logsTableBody.append(row);
    initializeAnalysisDates();
    renderAnalysis();
    return;
  }

  for (const record of sortedLogs().slice(0, 100)) {
    const ongoing = record.open || record.id === state.openEventId;
    const row = document.createElement("tr");

    appendCell(row, formatDateTime(record.timestamp));
    appendCell(row, record.machineId);
    appendCell(row, record.state);

    const peak = record.peakA > record.currentA
      ? ` (pk ${formatNumber(record.peakA, 1)})`
      : "";
    appendCell(row, `${formatNumber(record.currentA, 2)} A${peak}`);

    // An open interval has no final duration on flash; show the live value the
    // firmware reports for the current state instead.
    const duration = ongoing
      ? `${formatDuration(state.openDurationSec)} (ongoing)`
      : formatDuration(record.durationSec);
    const durationCell = appendCell(row, duration);
    // Tagged so the per-second tick can update this one cell in place instead of
    // rebuilding the whole table, which would collapse an open reason dropdown.
    if (ongoing) durationCell.id = "openDurationCell";

    row.append(buildReasonCell(record));

    const syncCell = document.createElement("td");
    const chip = document.createElement("span");
    chip.className = `sync-chip ${record.synced ? "synced" : "pending"}`;
    chip.textContent = record.synced ? "Synced" : "Pending";
    syncCell.append(chip);
    row.append(syncCell);

    els.logsTableBody.append(row);
  }
  initializeAnalysisDates();
  renderAnalysis();
}

// A stoppage-reason dropdown per interval. Only IDLE intervals are downtime
// worth annotating; ACTIVE (producing) intervals show a static label.
function buildReasonCell(record) {
  const cell = document.createElement("td");

  if (record.state === "ACTIVE") {
    cell.textContent = "—";
    return cell;
  }

  const select = document.createElement("select");
  select.className = "reason-select";
  if (record.reasonCode === 0) {
    select.classList.add("unassigned");
  }

  for (const reason of REASON_CODES) {
    const option = document.createElement("option");
    option.value = String(reason.code);
    option.textContent = reason.label;
    if (reason.code === record.reasonCode) {
      option.selected = true;
    }
    select.append(option);
  }

  select.addEventListener("change", () => {
    setLogReason(record.id, Number(select.value));
  });

  cell.append(select);
  return cell;
}

async function setLogReason(id, reasonCode) {
  // Update the in-memory record immediately so the dropdown stays responsive;
  // the firmware echoes confirmation over the Sync characteristic.
  const record = state.logs.find((item) => item.id === id);
  if (record) {
    record.reasonCode = reasonCode;
    record.synced = false; // reassigning a reason makes the record dirty again
  }
  renderLogs();
  renderAnalysis();

  if (state.demo) {
    logEvent(`Reason set for #${id}: ${reasonLabel(reasonCode)}`);
    return;
  }

  await sendCommand({ cmd: "set_reason", id, reasonCode });
}

function reasonLabel(code) {
  const match = REASON_CODES.find((reason) => reason.code === Number(code));
  return match ? match.label : "Unassigned";
}

function appendCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  row.append(cell);
  return cell;
}

function exportLogs() {
  if (!state.logs.length) {
    logEvent("No logs to export");
    return;
  }

  const header = [
    "timestamp",
    "machineId",
    "state",
    "currentA",
    "peakA",
    "durationSec",
    "reasonCode",
    "reason",
    "synced",
  ];
  const rows = sortedLogs().map((record) =>
    header
      .map((key) =>
        key === "reason" ? csvValue(reasonLabel(record.reasonCode)) : csvValue(record[key])
      )
      .join(",")
  );
  const blob = new Blob([[header.join(","), ...rows].join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `downtime-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  logEvent("CSV export created");
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function setDemoMode(enabled) {
  state.demo = enabled;

  if (enabled) {
    if (state.connected) {
      disconnectDevice();
    }
    state.durations = {
      ACTIVE: 0,
      IDLE: 0,
    };
    state.currentState = "IDLE";
    state.lastDurationTick = Date.now();
    handleDeviceInfoMessage({
      deviceId: "EF-001",
      bleName: "EF-001",
      deviceName: "Downtime Monitoring Device",
      location: "Demo factory bay",
      machineId: currentConfig().machineId,
      firmwareName: "EF001_BLE_Identity",
      firmwareVersion: "0.1.0",
      hardware: "ESP32-WROOM-D",
    });
    els.deviceName.textContent = "EF-001";
    setBadge(els.connectionBadge, "Demo active", "warn");
    els.connectButton.disabled = true;
    els.disconnectButton.disabled = true;
    seedDemoLogs();
    state.demoTimer = window.setInterval(nextDemoTelemetry, 1000);
    nextDemoTelemetry();
    logEvent("Demo mode enabled");
  } else {
    window.clearInterval(state.demoTimer);
    state.demoTimer = null;
    setConnectionUi("disconnected");
    els.deviceName.textContent = "Not selected";
    resetDeviceInfo();
    logEvent("Demo mode disabled");
  }
}

function seedDemoLogs() {
  const machineId = currentConfig().machineId;
  const now = Date.now();
  state.logs = [
    {
      id: 1,
      epochStart: Math.floor((now - 46 * 60 * 1000) / 1000),
      machineId,
      state: "ACTIVE",
      currentA: 5.62,
      peakA: 6.4,
      durationSec: 1440,
      reasonCode: 0,
      rtcValid: true,
      synced: false,
    },
    {
      id: 2,
      epochStart: Math.floor((now - 22 * 60 * 1000) / 1000),
      machineId,
      state: "IDLE",
      currentA: 0.12,
      peakA: 0.3,
      durationSec: 840,
      reasonCode: 2,
      rtcValid: true,
      synced: false,
    },
    {
      id: 3,
      epochStart: Math.floor((now - 8 * 60 * 1000) / 1000),
      machineId,
      state: "IDLE",
      currentA: 0.02,
      peakA: 0.1,
      durationSec: 480,
      reasonCode: 0,
      rtcValid: true,
      synced: false,
    },
  ].map(normalizeLogRecord);
  renderLogs();
}

function nextDemoTelemetry() {
  const sample = demoCurrentSample();
  handleTelemetryMessage({
    currentA: sample.current,
    state: sample.state,
    reason: sample.reason,
    epoch: Math.floor(Date.now() / 1000),
    rtcValid: true,
    adcReady: true,
    biasOk: true,
    clipped: false,
    logCount: state.logs.length,
    logUnsynced: state.logs.filter((record) => !record.synced).length,
  });
}

function demoCurrentSample() {
  const cycle = Math.floor(Date.now() / 1000) % 42;
  const noise = (Math.random() - 0.5) * 0.22;

  if (cycle < 26) {
    return {
      current: 5.2 + Math.sin(cycle / 2) * 0.6 + noise,
      state: "ACTIVE",
      reason: "Above active threshold",
    };
  }

  return {
    current: Math.max(0, 0.1 + noise),
    state: "IDLE",
    reason: "Below active threshold",
  };
}

function handleDemoCommand(command) {
  logEvent(`Demo command: ${command.cmd}`);

  if (command.cmd === "scan_wifi") {
    window.setTimeout(() => {
      handleWifiMessage({
        status: "Scan complete",
        networks: [
          { ssid: "Operator-Hotspot", rssi: -42, secure: true },
          { ssid: "Factory-Mobile", rssi: -61, secure: true },
          { ssid: "Maintenance-Phone", rssi: -74, secure: true },
        ],
      });
    }, 700);
  }

  if (command.cmd === "connect_wifi") {
    window.setTimeout(() => {
      handleWifiMessage({ status: `Connected to ${command.ssid}` });
    }, 900);
  }

  if (command.cmd === "sync_mqtt") {
    runDemoSync();
  }

  if (command.cmd === "request_logs") {
    renderLogs();
  }

  if (command.cmd === "save_config") {
    handleConfigMessage(command);
  }

  if (command.cmd === "set_rtc") {
    updateRtc(command.iso);
    logEvent("RTC set from browser clock");
  }

  if (command.cmd === "set_reason") {
    const record = state.logs.find((item) => item.id === command.id);
    if (record) {
      record.reasonCode = command.reasonCode;
      renderLogs();
    }
  }
}

function runDemoSync() {
  let progress = 0;
  const timer = window.setInterval(() => {
    progress += 20;
    updateSyncProgress(progress, `Publishing logs: ${progress}%`);

    if (progress >= 100) {
      window.clearInterval(timer);
      handleSyncMessage({ progress: 100, status: "MQTT sync complete", complete: true });
    }
  }, 500);
}

function analysisTimestamp(record) {
  if (!record.timestamp || record.timestamp === "Time not set") return null;
  const date = new Date(record.timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function initializeAnalysisDates() {
  if (els.analysisStartDate.value || els.analysisEndDate.value) return;
  const dates = state.logs.map(analysisTimestamp).filter(Boolean).map(date => localDateKey(date)).sort();
  if (!dates.length) return;
  els.analysisStartDate.value = dates[0];
  els.analysisEndDate.value = dates[dates.length - 1];
  populateAnalysisDays();
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validateAnalysisDates() {
  if (els.analysisStartDate.value && els.analysisEndDate.value && els.analysisStartDate.value > els.analysisEndDate.value) {
    const oldStart = els.analysisStartDate.value;
    els.analysisStartDate.value = els.analysisEndDate.value;
    els.analysisEndDate.value = oldStart;
  }
  populateAnalysisDays();
}

function filteredAnalysisLogs() {
  const start = els.analysisStartDate.value;
  const end = els.analysisEndDate.value;
  return state.logs.filter(record => {
    const date = analysisTimestamp(record);
    if (!date || record.open) return false;
    const key = localDateKey(date);
    if (start && key < start) return false;
    if (end && key > end) return false;
    return true;
  });
}

function formatAnalysisDuration(seconds) {
  const totalMinutes = Math.round(Math.max(0, seconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function reasonLabelForAnalysis(code) {
  const map = {
    0: "Unassigned", 1: "Planned break", 2: "Material shortage", 3: "Tool / die change",
    4: "Breakdown / fault", 5: "Setup / changeover", 6: "Quality check", 7: "No operator",
    8: "Blocked (downstream)", 9: "Starved (upstream)", 10: "Other"
  };
  return map[Number(code)] || "Other / Unknown";
}

function renderAnalysis() {
  if (!els.analysisDowntime) return;
  initializeAnalysisDates();
  const records = filteredAnalysisLogs();
  const idle = records.filter(record => record.state === "IDLE");
  const active = records.filter(record => record.state === "ACTIVE");
  const downtimeSec = idle.reduce((sum, record) => sum + Math.max(0, record.durationSec || 0), 0);
  const runtimeSec = active.reduce((sum, record) => sum + Math.max(0, record.durationSec || 0), 0);
  const recorded = downtimeSec + runtimeSec;
  els.analysisDowntime.textContent = records.length ? formatAnalysisDuration(downtimeSec) : "—";
  els.analysisRuntime.textContent = records.length ? formatAnalysisDuration(runtimeSec) : "—";
  els.analysisStoppages.textContent = records.length ? String(idle.length) : "—";
  els.analysisAvailability.textContent = recorded > 0 ? `${(runtimeSec / recorded * 100).toFixed(1)}%` : "—";
  els.analysisDataNote.textContent = records.length
    ? `Based on ${records.length} timestamped, closed log interval(s). Availability is calculated from recorded ACTIVE and IDLE durations; intervals with invalid timestamps and ongoing intervals are excluded.`
    : "No timestamped, closed device logs match this date range. Connect the device and refresh logs; no sample data is added.";
  populateAnalysisDays(records);
  renderHourlyAnalysis();
  renderReasonAnalysis(idle);
}

function populateAnalysisDays(records = filteredAnalysisLogs()) {
  if (!els.analysisDaySelect) return;
  const previous = els.analysisDaySelect.value;
  const dates = [...new Set(records.map(record => analysisTimestamp(record)).filter(Boolean).map(localDateKey))].sort();
  els.analysisDaySelect.replaceChildren();
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All selected days";
  els.analysisDaySelect.append(all);
  dates.forEach(date => {
    const option = document.createElement("option");
    option.value = date;
    option.textContent = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
    els.analysisDaySelect.append(option);
  });
  els.analysisDaySelect.value = dates.includes(previous) ? previous : "all";
}

function renderHourlyAnalysis() {
  if (!els.hourlyDowntimeChart) return;
  const selectedDay = els.analysisDaySelect.value;
  const records = filteredAnalysisLogs().filter(record => record.state === "IDLE");
  const buckets = Array(24).fill(0);
  records.forEach(record => {
    const date = analysisTimestamp(record);
    if (!date || (selectedDay !== "all" && localDateKey(date) !== selectedDay)) return;
    buckets[date.getHours()] += Math.max(0, record.durationSec || 0) / 60;
  });
  const max = Math.max(1, ...buckets);
  els.hourlyDowntimeChart.replaceChildren();
  if (!records.length || !buckets.some(value => value > 0)) {
    const empty = document.createElement("p"); empty.className = "analysis-empty";
    empty.textContent = "No downtime intervals for this selection.";
    els.hourlyDowntimeChart.append(empty); return;
  }
  buckets.forEach((minutes, hour) => {
    const wrap = document.createElement("div"); wrap.className = "hour-bar-wrap";
    const value = document.createElement("span"); value.className = "hour-bar-value";
    value.textContent = minutes >= 1 ? String(Math.round(minutes)) : "";
    const bar = document.createElement("div"); bar.className = "hour-bar";
    bar.style.height = `${minutes ? Math.max(2, minutes / max * 175) : 0}px`;
    bar.title = `${hour}:00 — ${minutes.toFixed(1)} minutes downtime`;
    const label = document.createElement("span"); label.className = "hour-bar-label";
    label.textContent = hour % 3 === 0 ? `${String(hour).padStart(2, "0")}:00` : "";
    wrap.append(value, bar, label); els.hourlyDowntimeChart.append(wrap);
  });
}

function renderReasonAnalysis(idleRecords) {
  els.lossByReasonChart.replaceChildren();
  if (!idleRecords.length) {
    const empty = document.createElement("p"); empty.className = "analysis-empty";
    empty.textContent = "No downtime records in this date range.";
    els.lossByReasonChart.append(empty); return;
  }
  const totals = new Map();
  idleRecords.forEach(record => {
    const label = reasonLabelForAnalysis(record.reasonCode);
    totals.set(label, (totals.get(label) || 0) + Math.max(0, record.durationSec || 0) / 60);
  });
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...sorted.map(item => item[1]));
  sorted.forEach(([label, minutes], index) => {
    const row = document.createElement("div"); row.className = "reason-row";
    const name = document.createElement("span"); name.className = "reason-name"; name.textContent = label;
    const track = document.createElement("div"); track.className = "reason-track";
    const fill = document.createElement("div"); fill.className = "reason-fill";
    fill.style.width = `${minutes / max * 100}%`;
    fill.style.background = ["#ef6b72", "#f4ae3d", "#f4ce36", "#45bf8a", "#55a8e8", "#9a78e8", "#83a1d5"][index % 7];
    track.append(fill);
    const duration = document.createElement("span"); duration.className = "reason-duration";
    duration.textContent = formatAnalysisDuration(minutes * 60);
    row.append(name, track, duration); els.lossByReasonChart.append(row);
  });
}

function exportAnalysisCsv() {
  const records = filteredAnalysisLogs();
  if (!records.length) { logEvent("No timestamped logs available for downtime analysis export"); return; }
  const rows = [["Timestamp", "Machine ID", "State", "Duration (seconds)", "Duration (minutes)", "Stoppage Reason", "Current (A)"], ...records.map(record => [record.timestamp, record.machineId, record.state, record.durationSec, (record.durationSec / 60).toFixed(2), record.state === "IDLE" ? reasonLabelForAnalysis(record.reasonCode) : "N/A", record.currentA])];
  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a"); link.href = url; link.download = `downtime-analysis-${els.analysisStartDate.value || "start"}-to-${els.analysisEndDate.value || "end"}.csv`;
  document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  logEvent("Downtime analysis CSV exported");
}

function renderAll() {
  renderDeviceInfo();
  setMachineState("IDLE", "Waiting for device");
  renderDurations();
  renderLogs();
  renderCharts();
  renderAnalysis();
}

function renderCharts() {
  drawCurrentGauge();
  drawTrendChart();
  drawRuntimeChart();
}

function drawCurrentGauge() {
  const canvas = els.currentGauge;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const latest = state.trend.at(-1)?.current ?? 0;
  const max = Math.max(10, Number(els.thresholdInput.value) * 3 || 10);
  const ratio = clamp(latest / max, 0, 1);

  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 16;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.strokeStyle = "#dce7ea";
  ctx.arc(width / 2, height - 8, 78, Math.PI, 0);
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = stateColor(state.currentState);
  ctx.arc(width / 2, height - 8, 78, Math.PI, Math.PI + Math.PI * ratio);
  ctx.stroke();

  ctx.fillStyle = "#65727a";
  ctx.font = "700 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${Math.round(ratio * 100)}% range`, width / 2, height - 14);
}

function drawTrendChart() {
  const canvas = els.trendCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = { top: 24, right: 24, bottom: 34, left: 48 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const samples = state.trend;
  const maxValue = Math.max(8, ...samples.map((sample) => sample.current), Number(els.thresholdInput.value) + 2);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfdfd";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#d8e1e5";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#65727a";
  ctx.font = "700 12px system-ui, sans-serif";
  ctx.textAlign = "right";

  for (let i = 0; i <= 4; i++) {
    const y = padding.top + chartHeight * (i / 4);
    const value = maxValue * (1 - i / 4);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(`${value.toFixed(1)}A`, padding.left - 8, y + 4);
  }

  drawThresholdLine(ctx, padding, chartWidth, chartHeight, maxValue, Number(els.thresholdInput.value), "#12805c", "Active");

  if (samples.length < 2) {
    ctx.fillStyle = "#65727a";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for current samples", width / 2, height / 2);
    return;
  }

  ctx.beginPath();
  samples.forEach((sample, index) => {
    const x = padding.left + chartWidth * (index / (samples.length - 1));
    const y = padding.top + chartHeight * (1 - sample.current / maxValue);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.strokeStyle = "#245fa8";
  ctx.lineWidth = 3;
  ctx.stroke();

  const latest = samples.at(-1);
  const latestX = padding.left + chartWidth;
  const latestY = padding.top + chartHeight * (1 - latest.current / maxValue);
  ctx.beginPath();
  ctx.fillStyle = stateColor(latest.state);
  ctx.arc(latestX, latestY, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawThresholdLine(ctx, padding, chartWidth, chartHeight, maxValue, value, color, label) {
  if (!Number.isFinite(value)) {
    return;
  }

  const y = padding.top + chartHeight * (1 - clamp(value / maxValue, 0, 1));
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padding.left, y);
  ctx.lineTo(padding.left + chartWidth, y);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = color;
  ctx.font = "800 12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(label, padding.left + 8, y - 6);
}

function drawRuntimeChart() {
  const canvas = els.runtimeCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 90;
  const total = state.durations.ACTIVE + state.durations.IDLE || 1;
  const parts = [
    { value: state.durations.ACTIVE, color: "#12805c" },
    { value: state.durations.IDLE, color: "#c43b35" },
  ];
  let start = -Math.PI / 2;

  ctx.clearRect(0, 0, width, height);
  for (const part of parts) {
    const angle = (part.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = part.color;
    ctx.fill();
    start += angle;
  }

  ctx.beginPath();
  ctx.fillStyle = "#ffffff";
  ctx.arc(centerX, centerY, 54, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#1d2528";
  ctx.font = "800 20px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(formatDuration(total), centerX, centerY - 2);
  ctx.fillStyle = "#65727a";
  ctx.font = "700 12px system-ui, sans-serif";
  ctx.fillText("total", centerX, centerY + 18);
}

function stateColor(machineState) {
  return machineState === "ACTIVE" ? "#12805c" : "#c43b35";
}

function logEvent(message) {
  const item = els.eventTemplate.content.firstElementChild.cloneNode(true);
  item.querySelector("time").textContent = new Date().toLocaleTimeString();
  item.querySelector("span").textContent = message;
  els.eventList.prepend(item);

  while (els.eventList.children.length > 80) {
    els.eventList.lastElementChild.remove();
  }
}

function formatNumber(value, decimals) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }
  return number.toFixed(decimals);
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hrs = Math.floor(safeSeconds / 3600);
  const mins = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  return [hrs, mins, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

init();
