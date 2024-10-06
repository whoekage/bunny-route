// examples/server.ts
import { RMQServer } from '../src/RMQServer';

const app = new RMQServer({
  uri: 'amqp://user:drypkZ13j0L24zcf@localhost',
  appName: 'my-service',
  retryOptions: {
    maxRetries: 3,
    retryTTL: 5000,
    enabled: true,
  },
});

// Обработчик для создания пользователя с индивидуальными настройками повторных попыток
app.on('create.user', async (context, reply) => {
    const data = context.content;
    console.log('Создание пользователя с данными:', data);

    // Имитация ошибки для тестирования повторных попыток
      throw new Error('Случайная ошибка при создании пользователя');

    // const userId = Math.floor(Math.random() * 1000);
    // reply({ status: 'success', userId });
  },
  {
    maxRetries: 5,
    retryTTL: 2000,
    retryEnabled: true,
  }
);

// Обработчик для обновления пользователя без повторных попыток
app.on('update.user', async (context, reply) => {
    const data = context.content;
    console.log('Обновление пользователя с данными:', data);

    // Логика обновления пользователя
    reply({ status: 'updated' });
  },
  {
    retryEnabled: false,
  }
);

// Запуск сервера с опцией prefetch
app.listen({ prefetch: 10 }).catch((error) => {
  console.error('Ошибка при запуске сервера:', error);
});