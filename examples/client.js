// examples/client.ts
const { RMQClient, RMQTimeoutError } = require('../dist');

(async () => {
        const client = new RMQClient({
            uri: 'amqp://user:drypkZ13j0L24zcf@localhost',
            appName: 'my-service',
        })
        await client.connect();
        // Отправка сообщения для создания пользователя
        try {
            const userResponse = await client.send('update.user', {
                name: 'John Doe',
            }, {
                timeout: null,
            });
            console.log('Ответ от сервера на update.user:', userResponse);
            
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
