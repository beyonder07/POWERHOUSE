const { z, ZodError } = require('zod');

function formatZodError(error) {
  return error.issues.map((issue) => {
    const path = issue.path && issue.path.length > 0 ? issue.path.join('.') : 'payload';
    return `${path}: ${issue.message}`;
  }).join('; ');
}

function registerValidatedHandler(ipcMain, channel, schema, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      const parsed = schema ? schema.parse(payload) : payload;
      return await handler(event, parsed);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(`Invalid request for ${channel}: ${formatZodError(error)}`);
      }
      throw error;
    }
  });
}

module.exports = {
  z,
  registerValidatedHandler
};
