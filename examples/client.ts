// examples/client.ts
import { RMQClient } from '../src/client';

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
                timeout: 1000,
            });
            console.log('Ответ от сервера на create.user:', userResponse);
            
        } catch (error) {
            console.error('Ошибка при создании пользователя:', error);
        }
        

        // Отправка сообщения для обновления пользователя
       

        // Закрываем клиентское соединение
        await client.close();
})();
