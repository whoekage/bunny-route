"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RMQServer = void 0;
const RMQConnectionManager_1 = require("./RMQConnectionManager");
const HandlerRegistry_1 = require("./HandlerRegistry");
class RMQServer {
    constructor(options) {
        var _a, _b, _c, _d, _e, _f;
        this.channel = null;
        this.appName = options.appName;
        this.connectionManager = RMQConnectionManager_1.RMQConnectionManager.getInstance(options.uri);
        this.handlerRegistry = new HandlerRegistry_1.HandlerRegistry();
        this.defaultRetryOptions = {
            maxRetries: (_b = (_a = options.retryOptions) === null || _a === void 0 ? void 0 : _a.maxRetries) !== null && _b !== void 0 ? _b : 3,
            retryTTL: (_d = (_c = options.retryOptions) === null || _c === void 0 ? void 0 : _c.retryTTL) !== null && _d !== void 0 ? _d : 5000,
            enabled: (_f = (_e = options.retryOptions) === null || _e === void 0 ? void 0 : _e.enabled) !== null && _f !== void 0 ? _f : true,
        };
        this.mainQueueName = `${this.appName}`;
        this.exchangeName = `${this.appName}`;
        this.retryExchangeName = `${this.exchangeName}.retry`;
        this.retryQueueName = `${this.mainQueueName}.retry`;
        this.dlqName = `${this.mainQueueName}.dlq`;
    }
    initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            this.channel = yield this.connectionManager.createChannel();
            // Declare the single exchange (shared by both main and retry queues)
            yield this.channel.assertExchange(this.exchangeName, 'direct', { durable: true });
            // DLQ (Dead Letter Queue) for failed messages that exceeded retry count
            yield this.channel.assertQueue(this.dlqName, { durable: true });
            // Retry Queue with TTL, re-routing back to the main exchange
            yield this.channel.assertQueue(this.retryQueueName, {
                durable: true,
                arguments: {
                    'x-dead-letter-exchange': this.exchangeName, // Route back to the main exchange
                },
                messageTtl: this.defaultRetryOptions.retryTTL,
            });
            // Bind Retry Queue to the same exchange (single exchange)
            yield this.channel.bindQueue(this.retryQueueName, this.exchangeName, '#');
            // Main Queue with dead letter configuration to forward failed messages to the retry queue
            yield this.channel.assertQueue(this.mainQueueName, {
                durable: true,
                arguments: {
                    'x-dead-letter-exchange': this.exchangeName, // Route to retry queue on failure
                    'x-dead-letter-routing-key': '#', // Same routing key for retry
                },
            });
            // Bind Main Queue to the single exchange
            for (const routingKey of this.handlerRegistry.getRoutingKeys()) {
                yield this.channel.bindQueue(this.mainQueueName, this.exchangeName, routingKey);
            }
        });
    }
    on(routingKey, handler, options = {}) {
        this.handlerRegistry.register(routingKey, handler, options);
    }
    listen(options) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.initialize();
            if (options === null || options === void 0 ? void 0 : options.prefetch) {
                this.channel.prefetch(options.prefetch);
            }
            yield this.channel.consume(this.mainQueueName, this.handleMessage.bind(this), { noAck: false });
            console.log(`RMQServer '${this.appName}' слушает сообщения...`);
        });
    }
    handleMessage(msg) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            if (msg) {
                const headers = msg.properties.headers || {};
                const retryCount = headers['x-retry-count'] ? parseInt(headers['x-retry-count']) : 0;
                const originalRoutingKey = msg.fields.routingKey;
                const registeredHandler = this.handlerRegistry.getHandler(originalRoutingKey);
                if (registeredHandler) {
                    const { handler, options } = registeredHandler;
                    const content = JSON.parse(msg.content.toString());
                    const context = { content, routingKey: originalRoutingKey };
                    const reply = (response) => {
                        if (msg.properties.replyTo && msg.properties.correlationId) {
                            this.channel.sendToQueue(msg.properties.replyTo, Buffer.from(JSON.stringify(response)), {
                                correlationId: msg.properties.correlationId,
                            });
                        }
                    };
                    const retryOptions = {
                        maxRetries: (_a = options.maxRetries) !== null && _a !== void 0 ? _a : this.defaultRetryOptions.maxRetries,
                        retryTTL: (_b = options.retryTTL) !== null && _b !== void 0 ? _b : this.defaultRetryOptions.retryTTL,
                        enabled: (_c = options.retryEnabled) !== null && _c !== void 0 ? _c : this.defaultRetryOptions.enabled,
                    };
                    try {
                        yield handler(context, reply);
                        this.channel.ack(msg); // Acknowledge successful processing
                    }
                    catch (error) {
                        console.error(`Error processing routingKey '${originalRoutingKey}':`, error);
                        if (retryOptions.enabled && retryCount < retryOptions.maxRetries) {
                            console.log({
                                retryOptions,
                                retryCount
                            });
                            headers['x-retry-count'] = retryCount + 1;
                            headers['x-original-routing-key'] = originalRoutingKey;
                            console.log(`Retrying message for the ${retryCount + 1} time...`);
                            console.log({ headers });
                            // Send message to the same exchange (back to retry queue)
                            const published = this.channel.publish(this.exchangeName, originalRoutingKey, msg.content, {
                                headers,
                                persistent: true,
                                expiration: retryOptions.retryTTL.toString(),
                            });
                            console.log({ published });
                            console.log(`Message sent to retry queue through the exchange: ${this.exchangeName} with routingKey: ${originalRoutingKey}`);
                            const queueInfo = yield this.channel.checkQueue(this.retryQueueName);
                            console.log(`Retry queue message count: ${queueInfo.messageCount}`);
                            this.channel.ack(msg); // Acknowledge the current message
                        }
                        else {
                            // Max retries reached, send to DLQ
                            yield this.sendToDLQ(msg);
                            this.channel.ack(msg); // Acknowledge message
                        }
                    }
                }
                else {
                    console.warn(`No handler for routingKey: ${originalRoutingKey}`);
                    this.channel.ack(msg); // Acknowledge to avoid looping
                }
            }
        });
    }
    sendToDLQ(msg) {
        return __awaiter(this, void 0, void 0, function* () {
            this.channel.sendToQueue(this.dlqName, msg.content, {
                headers: msg.properties.headers,
                persistent: true,
            });
            console.log(`Message sent to DLQ: ${this.dlqName}`);
        });
    }
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.channel) {
                try {
                    yield this.channel.close();
                    this.channel = null;
                }
                catch (error) {
                    if (error instanceof Error && error.message !== 'Channel closed') {
                        throw error;
                    }
                }
            }
        });
    }
}
exports.RMQServer = RMQServer;
