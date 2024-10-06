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
exports.RMQClient = void 0;
const RMQConnectionManager_1 = require("./RMQConnectionManager");
const uuid_1 = require("uuid");
const events_1 = require("events");
class RMQClient {
    constructor(options) {
        this.channel = null;
        this.replyQueue = null;
        this.appName = options.appName;
        this.connectionManager = RMQConnectionManager_1.RMQConnectionManager.getInstance(options.uri);
        this.responseEmitter = new events_1.EventEmitter();
        this.responseEmitter.setMaxListeners(0);
    }
    static connect(options) {
        return __awaiter(this, void 0, void 0, function* () {
            const client = new RMQClient(options);
            yield client.initialize();
            return client;
        });
    }
    initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            this.channel = yield this.connectionManager.createChannel();
            yield this.channel.assertExchange(this.appName, 'direct', { durable: true });
            this.replyQueue = yield this.channel.assertQueue('', { exclusive: true });
            this.channel.consume(this.replyQueue.queue, (msg) => {
                if (msg) {
                    const correlationId = msg.properties.correlationId;
                    const content = msg.content.toString();
                    this.responseEmitter.emit(correlationId, content);
                    this.channel.ack(msg);
                }
            }, { noAck: false });
        });
    }
    send(routingKey, message) {
        return __awaiter(this, void 0, void 0, function* () {
            const correlationId = (0, uuid_1.v4)();
            return new Promise((resolve, reject) => {
                this.responseEmitter.once(correlationId, (content) => {
                    const response = JSON.parse(content);
                    resolve(response);
                });
                this.channel.publish(this.appName, routingKey, Buffer.from(JSON.stringify(message)), {
                    replyTo: this.replyQueue.queue,
                    correlationId,
                    persistent: true,
                });
            });
        });
    }
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log({ channel: this.channel });
            if (this.channel) {
                try {
                    yield this.channel.close();
                    this.channel = null;
                }
                catch (error) {
                    console.log(error);
                    if (error instanceof Error && error.message !== 'Channel closed') {
                        throw error;
                    }
                }
            }
            // Не закрываем connectionManager здесь
        });
    }
}
exports.RMQClient = RMQClient;
