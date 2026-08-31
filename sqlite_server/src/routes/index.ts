import express from 'express';
import sqliteRoutes from './sqlite';

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({
    message: 'QueryBot SQLite Server',
    version: '1.0.0',
    endpoints: {
      'POST /upload-file': 'Upload a SQLite or CSV file',
      'POST /execute-query': 'Execute a read-only SQL query',
      'GET /get-schema/:uuid': 'Get schema text and structured table metadata',
      'GET /databases/:uuid': 'Check that a dataset still exists',
      'GET /databases/:uuid/preview/:table': 'Preview the first rows of a table',
      'DELETE /databases/:uuid': 'Delete a dataset',
      'GET /health': 'Health check',
    },
  });
});

router.use('/', sqliteRoutes);

export default router;
