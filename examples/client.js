// examples/client.ts
const { RMQClient, RMQTimeoutError } = require('../dist');

(async () => {
        const client = new RMQClient({
            uri: 'amqp://user:drypkZ13j0L24zcf@localhost',
            appName: 'my-service',
        })
        await client.connect();
        // Sending a message to create a user
        const userCreateResponse = await client.send('create.user', {
            name: 'John Doe',
        }, {
            timeout: null,
        }).catch((error) => {
            console.error('Error sending create.user message:', error);
            return null;
        });
        console.log('Server response to create.user:', userCreateResponse);
        
        try {
            const userResponse = await client.send('update.user', {
                name: 'John Doe',
            }, {
                timeout: 1000,
            });
            console.log('Server response to update.user:', userResponse);
            
        } catch (error) {
            if (error instanceof RMQTimeoutError) {
                console.error('Response timeout exceeded');
            } else {
                console.error('Error creating user:', error);
            }
        }
        

        // Sending a message to delete the user
        const userDeleteResponse = await client.send('delete.user', {
            id: userCreateResponse.userId,
        }, {
            timeout: null,
        });
        console.log('Server response to delete.user:', userDeleteResponse);
        
        const userDeleteResponse2 = await client.send('delete.user', {
            id: null,
        }, {
            timeout: null,
        });
        console.log('Server response to delete.user:', userDeleteResponse2);

        // Closing the client connection
        await client.close();
})();
