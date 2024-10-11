// examples/client.ts
import { RMQClient } from '../src/client';
import { RMQTimeoutError } from '../src/errors';

(async () => {
        const client = await RMQClient.connect({
            uri: 'amqp://user:drypkZ13j0L24zcf@localhost',
            appName: 'my-service',
        });

        // Отправка сообщения для создания пользователя
        try {
            const userResponse: any = await client.send('create.user', {
                name: 'John Doe',
            }, {
                timeout: null,
            });
            console.log('Ответ от сервера на create.user:', userResponse);
            
        } catch (error) {
            if (error instanceof RMQTimeoutError) {
                console.error('Время ожидания ответа истекло');
            } else {
                console.error('Ошибка при создании пользователя:', error);
            }
        }
        

        // Отправка сообщения для обновления пользователя
       

        // Закрываем клиентское соединение
        await client.close();
})();
