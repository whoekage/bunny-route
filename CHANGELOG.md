# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-01-12

### Added
- **Automatic reconnection** with exponential backoff and jitter
  - Configurable via `reconnect` options: `enabled`, `maxAttempts`, `initialDelayMs`, `maxDelayMs`, `backoffMultiplier`
  - Connection events: `connected`, `disconnected`, `reconnecting`, `reconnected`, `error`
- **Connection timeout** (`connectionTimeoutMs`) - prevents hanging connections (default: 10s)
- **Biome** linter and formatter
- **Vitest** with Testcontainers for integration testing
- Test coverage threshold (80%)

### Fixed
- Resource leak when connection established after timeout

### Changed
- Simplified `RMQConnectionManager` to simple singleton (removed Map-based multi-instance)

## [0.2.0] - 2024-10-20

### Added
- Initial reconnection support (experimental)

## [0.1.11] - 2024-10-19

### Added
- Middleware support for RMQServer

## [0.1.10] - 2024-10-18

### Added
- Nest.js compatibility for microservices

## [0.1.0] - 2024-10-11

### Added
- Initial release
- RMQServer for consuming messages
- RMQClient for publishing messages with RPC support
- Retry mechanism with dead-letter queues
- Express-style routing with `server.on(routingKey, handler)`
