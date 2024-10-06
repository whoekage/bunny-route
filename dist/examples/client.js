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
// examples/client.ts
const RMQClient_1 = require("../src/RMQClient");
(() => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const client = yield RMQClient_1.RMQClient.connect({
            uri: 'amqp://user:drypkZ13j0L24zcf@localhost',
            appName: 'my-service',
        });
        // Отправка сообщения для создания пользователя
        const userResponse = yield client.send('create.user', {
            name: 'John Doe',
        });
        console.log('Ответ от сервера на create.user:', userResponse);
        // Отправка сообщения для обновления пользователя
        const updateResponse = yield client.send('update.user', {
            userId: userResponse.userId,
            name: 'Jane Doe',
        });
        console.log('Ответ от сервера на update.user:', updateResponse);
        // Закрываем клиентское соединение
        yield client.close();
    }
    catch (error) {
        console.error('Ошибка в клиенте:', error);
    }
}))();
