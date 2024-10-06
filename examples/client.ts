// examples/client.ts
import { RMQClient } from '../src/RMQClient';

(async () => {
    try {
        const client = await RMQClient.connect({
            uri: 'amqp://user:drypkZ13j0L24zcf@localhost',
            appName: 'my-service',
        });

        // Отправка сообщения для создания пользователя
        const userResponse = await client.send<{ status: string; userId: number }>('create.user', {
            name: 'John Doe',
        });
        console.log('Ответ от сервера на create.user:', userResponse);

        // Отправка сообщения для обновления пользователя
        const updateResponse = await client.send<{ status: string }>('update.user', {
            userId: userResponse.userId,
            name: 'Jane Doe',
        });
        console.log('Ответ от сервера на update.user:', updateResponse);

        // Закрываем клиентское соединение
        await client.close();
    } catch (error) {
        console.error('Ошибка в клиенте:', error);
    }
})();
