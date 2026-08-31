import axios from 'axios';
import { api } from './apiClient';
import { config } from '@/config/env';
import type { ApiResponse } from '@/types/api';
import type {
  Dashboard,
  DashboardDetail,
  DashboardTile,
  TileSize,
  TileView,
} from '@/types/dashboard';

/** Dashboard endpoints. All owner operations require a session. */
export const DashboardAPI = {
  async list(): Promise<Dashboard[]> {
    const { data } = await api.get<ApiResponse<{ dashboards: Dashboard[] }>>('/dashboards');
    return data.data.dashboards;
  },

  async create(title: string): Promise<Dashboard> {
    const { data } = await api.post<ApiResponse<{ dashboard: Dashboard }>>('/dashboards', {
      title,
    });
    return data.data.dashboard;
  },

  async get(id: string): Promise<DashboardDetail> {
    const { data } = await api.get<ApiResponse<{ dashboard: DashboardDetail }>>(
      `/dashboards/${id}`
    );
    return data.data.dashboard;
  },

  async update(
    id: string,
    changes: { title?: string; description?: string; shared?: boolean }
  ): Promise<Dashboard> {
    const { data } = await api.patch<ApiResponse<{ dashboard: Dashboard }>>(
      `/dashboards/${id}`,
      changes
    );
    return data.data.dashboard;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/dashboards/${id}`);
  },

  /** Pin an analysis onto a dashboard. */
  async addTile(
    dashboardId: string,
    tile: { messageId: string; view?: TileView; size?: TileSize; title?: string }
  ): Promise<DashboardTile> {
    const { data } = await api.post<ApiResponse<{ tile: DashboardTile }>>(
      `/dashboards/${dashboardId}/tiles`,
      tile
    );
    return data.data.tile;
  },

  async updateTile(
    dashboardId: string,
    tileId: string,
    changes: { title?: string; view?: TileView; size?: TileSize }
  ): Promise<DashboardTile> {
    const { data } = await api.patch<ApiResponse<{ tile: DashboardTile }>>(
      `/dashboards/${dashboardId}/tiles/${tileId}`,
      changes
    );
    return data.data.tile;
  },

  async reorderTiles(dashboardId: string, tileIds: string[]): Promise<DashboardDetail> {
    const { data } = await api.patch<ApiResponse<{ dashboard: DashboardDetail }>>(
      `/dashboards/${dashboardId}/tiles/order`,
      { tileIds }
    );
    return data.data.dashboard;
  },

  async removeTile(dashboardId: string, tileId: string): Promise<void> {
    await api.delete(`/dashboards/${dashboardId}/tiles/${tileId}`);
  },

  /**
   * Fetch a publicly shared dashboard.
   *
   * Uses a bare axios call rather than the shared instance: the viewer has no
   * session, and the refresh interceptor would fire a pointless `/auth/refresh`
   * on the way to rendering a public page.
   */
  async getShared(token: string): Promise<DashboardDetail> {
    const { data } = await axios.get<ApiResponse<{ dashboard: DashboardDetail }>>(
      `${config.API_BASE_URL}/public/dashboards/${encodeURIComponent(token)}`
    );
    return data.data.dashboard;
  },

  /** The absolute URL to hand to someone else. */
  shareUrl(token: string): string {
    return `${window.location.origin}/shared/${token}`;
  },
};

export default DashboardAPI;
