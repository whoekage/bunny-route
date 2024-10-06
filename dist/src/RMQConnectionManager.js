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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RMQConnectionManager = void 0;
// /src/RMQConnectionManager.ts
const amqplib_1 = __importDefault(require("amqplib"));
class RMQConnectionManager {
    constructor(uri) {
        this.channels = [];
        this.uri = uri;
    }
    static getInstance(uri) {
        if (!RMQConnectionManager.instance) {
            RMQConnectionManager.instance = new RMQConnectionManager(uri);
        }
        return RMQConnectionManager.instance;
    }
    getConnection() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.connection) {
                this.connection = yield amqplib_1.default.connect(this.uri);
            }
            return this.connection;
        });
    }
    createChannel() {
        return __awaiter(this, void 0, void 0, function* () {
            const connection = yield this.getConnection();
            const channel = yield connection.createChannel();
            this.channels.push(channel);
            return channel;
        });
    }
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            for (const channel of this.channels) {
                yield channel.close();
            }
            if (this.connection) {
                yield this.connection.close();
            }
        });
    }
}
exports.RMQConnectionManager = RMQConnectionManager;
