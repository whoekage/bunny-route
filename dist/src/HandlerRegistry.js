"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HandlerRegistry = void 0;
class HandlerRegistry {
    constructor() {
        this.handlers = new Map();
    }
    register(routingKey, handler, options = {}) {
        this.handlers.set(routingKey, { handler, options });
    }
    getHandler(routingKey) {
        return this.handlers.get(routingKey);
    }
    getRoutingKeys() {
        return Array.from(this.handlers.keys());
    }
}
exports.HandlerRegistry = HandlerRegistry;
