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
// examples/server.ts
const RMQServer_1 = require("../src/RMQServer");
const app = new RMQServer_1.RMQServer({
    uri: 'amqp://user:drypkZ13j0L24zcf@localhost',
    appName: 'my-service',
    retryOptions: {
        maxRetries: 3,
        retryTTL: 5000,
        enabled: true,
    },
});
// Обработчик для создания пользователя с индивидуальными настройками повторных попыток
app.on('create.user', (context, reply) => __awaiter(void 0, void 0, void 0, function* () {
    const data = context.content;
    console.log('Создание пользователя с данными:', data);
    // Имитация ошибки для тестирования повторных попыток
    throw new Error('Случайная ошибка при создании пользователя');
    // const userId = Math.floor(Math.random() * 1000);
    // reply({ status: 'success', userId });
}), {
    maxRetries: 5,
    retryTTL: 2000,
    retryEnabled: true,
});
// Обработчик для обновления пользователя без повторных попыток
app.on('update.user', (context, reply) => __awaiter(void 0, void 0, void 0, function* () {
    const data = context.content;
    console.log('Обновление пользователя с данными:', data);
    // Логика обновления пользователя
    reply({ status: 'updated' });
}), {
    retryEnabled: false,
});
// Запуск сервера с опцией prefetch
app.listen({ prefetch: 10 }).catch((error) => {
    console.error('Ошибка при запуске сервера:', error);
});
