const { MongoMemoryServer } = require('mongodb-memory-server');

async function start() {
  console.log('Starting Local Development MongoDB instance on port 27017...');
  const mongod = await MongoMemoryServer.create({
    instance: {
      port: 27017,
      dbName: 'hr_management'
    }
  });

  console.log(`Local MongoDB running at: ${mongod.getUri()}`);

  const cleanup = async () => {
    console.log('Stopping Local MongoDB...');
    await mongod.stop();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

start().catch(err => {
  console.error('Failed to start local Mongo daemon:', err);
  process.exit(1);
});
