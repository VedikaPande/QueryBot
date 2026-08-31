import { api } from './apiClient';
import type { ApiResponse } from '@/types/api';
import type {
  Dataset,
  DatasetProfile,
  DatasetSchema,
  QueryResult,
  TablePreview,
} from '@/types/dataset';

/**
 * Dataset endpoints.
 *
 * All calls go to the Flask API, which owns authentication and ownership
 * checks. The browser never addresses the SQLite service directly.
 */
export const DatasetAPI = {
  async list(): Promise<Dataset[]> {
    const { data } = await api.get<ApiResponse<{ datasets: Dataset[] }>>('/datasets');
    return data.data.datasets;
  },

  async upload(file: File, onProgress?: (percent: number) => void): Promise<Dataset> {
    const formData = new FormData();
    formData.append('file', file);

    const { data } = await api.post<ApiResponse<{ dataset: Dataset }>>('/datasets', formData, {
      // Let the browser set the multipart boundary itself.
      headers: { 'Content-Type': undefined },
      onUploadProgress: (event) => {
        if (onProgress && event.total) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      },
    });

    return data.data.dataset;
  },

  async getSchema(datasetUuid: string): Promise<DatasetSchema> {
    const { data } = await api.get<ApiResponse<DatasetSchema>>(`/datasets/${datasetUuid}/schema`);
    return data.data;
  },

  /**
   * Add another file to an existing dataset.
   *
   * Each file becomes a table in the same database, so a question can span them.
   */
  async addFile(
    datasetUuid: string,
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<{ dataset: Dataset; addedTables: string[] }> {
    const formData = new FormData();
    formData.append('file', file);

    const { data } = await api.post<ApiResponse<{ dataset: Dataset; addedTables: string[] }>>(
      `/datasets/${datasetUuid}/files`,
      formData,
      {
        headers: { 'Content-Type': undefined },
        onUploadProgress: (event) => {
          if (onProgress && event.total) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        },
      }
    );

    return data.data;
  },

  /** Per-column statistics, distributions, outliers and correlations. */
  async getProfile(datasetUuid: string): Promise<DatasetProfile> {
    const { data } = await api.get<ApiResponse<DatasetProfile>>(
      `/datasets/${datasetUuid}/profile`
    );
    return data.data;
  },

  async previewTable(datasetUuid: string, table: string): Promise<TablePreview> {
    const { data } = await api.get<ApiResponse<TablePreview>>(
      `/datasets/${datasetUuid}/preview/${encodeURIComponent(table)}`
    );
    return data.data;
  },

  async remove(datasetUuid: string): Promise<void> {
    await api.delete(`/datasets/${datasetUuid}`);
  },

  /** Run a SQL statement directly, backing the editable-SQL workflow. */
  async runQuery(datasetUuid: string, query: string): Promise<QueryResult> {
    const { data } = await api.post<ApiResponse<QueryResult>>('/langgraph/query', {
      databaseUuid: datasetUuid,
      query,
    });
    return data.data;
  },
};

export default DatasetAPI;
