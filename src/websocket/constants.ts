/** Default HTTP path for WebSocket upgrades, matching the AHP client examples. */
export const WEBSOCKET_DEFAULT_PATH = "/";

/** Interval between server-initiated liveness pings. */
export const WEBSOCKET_HEARTBEAT_INTERVAL_MS = 30_000;

/** Maximum accepted frame payload, guarding against oversized client frames. */
export const WEBSOCKET_MAX_PAYLOAD_BYTES = 1_048_576;

/** Close code sent when a client sends an unsupported (binary) frame. */
export const WEBSOCKET_CLOSE_UNSUPPORTED_DATA = 1003;

/** Close code sent when the server shuts a connection down. */
export const WEBSOCKET_CLOSE_GOING_AWAY = 1001;

/** Upper bound on graceful shutdown before resources are force-closed. */
export const WEBSOCKET_SHUTDOWN_TIMEOUT_MS = 5_000;

/** HTTP status answered for ordinary (non-upgrade) requests. */
export const WEBSOCKET_HTTP_UPGRADE_REQUIRED = 426;
