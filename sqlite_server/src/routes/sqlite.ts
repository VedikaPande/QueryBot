import express from 'express';
import { SqliteController } from '../controllers/SqliteController';
import { upload, handleUploadErrors } from '../middleware/upload';
import { requireServiceToken } from '../middleware/auth';

const router = express.Router();
const controller = new SqliteController();

// Every data endpoint requires the shared service token. Browsers reach this
// service only via the Flask API, which authenticates the user first.
router.use(requireServiceToken);

router.post('/upload-file', upload.single('file'), handleUploadErrors, controller.uploadFile);
router.post(
  '/databases/:uuid/files',
  upload.single('file'),
  handleUploadErrors,
  controller.addFile
);
router.post('/execute-query', controller.executeQuery);
router.get('/get-schema/:uuid', controller.getSchema);
router.get('/databases/:uuid', controller.headDatabase);
router.get('/databases/:uuid/profile', controller.profileDataset);
router.get('/databases/:uuid/preview/:table', controller.previewTable);
router.delete('/databases/:uuid', controller.deleteDatabase);

export default router;
