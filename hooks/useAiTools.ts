import { useCallback } from 'react';
import {
  fetchModels as fetchModelsImpl,
  testConnection as testConnectionImpl,
  type ConnectionTestConfig,
  type ConnectionTestResult,
} from '@/services/ai/apiTools';
import {
  clearApiErrorReports as clearApiErrorReportsImpl,
  loadApiErrorReports as loadApiErrorReportsImpl,
  type ApiErrorReport,
} from '@/services/ai/apiErrorReportService';
import { devLog, devLogError } from '@/utils/devLog';

export type { ConnectionTestConfig, ConnectionTestResult } from '@/services/ai/apiTools';
export type { ApiErrorReport } from '@/services/ai/apiErrorReportService';

/**
 * 通用 AI 工具动作。
 *
 * [FACT] 这里原先还有三个文生图专用动作（测试连接、取模型列表、取 ComfyUI 工作流候选），
 * 它们绑在旧的 `文生图API配置` 上。旧生成层已退役，这三件事现在由文生图设置面板
 * 直接用 `services/ai/imageGen/comfyClient` 完成，不再经这里中转。
 */
export interface AiToolsActions {
  fetchModels: (config: ConnectionTestConfig) => Promise<string[]>;
  testConnection: (config: ConnectionTestConfig) => Promise<ConnectionTestResult>;
  loadApiErrorReports: () => Promise<ApiErrorReport[]>;
  clearApiErrorReports: () => Promise<void>;
}

export function useAiTools(): AiToolsActions {
  const fetchModels = useCallback(async (config: ConnectionTestConfig) => {
    try {
      const list = await fetchModelsImpl(config);
      devLog('ui', 'ai-tools-fetch-models', { count: list.length, provider: config.provider });
      return list;
    } catch (err) {
      devLogError('ui', 'ai-tools-fetch-models-failed', err, { provider: config.provider });
      throw err;
    }
  }, []);

  const testConnection = useCallback(async (config: ConnectionTestConfig) => {
    try {
      const result = await testConnectionImpl(config);
      devLog('ui', 'ai-tools-test-connection', { ok: result.ok, provider: config.provider });
      return result;
    } catch (err) {
      devLogError('ui', 'ai-tools-test-connection-failed', err, { provider: config.provider });
      throw err;
    }
  }, []);

  const loadApiErrorReports = useCallback(async () => {
    try {
      const reports = await loadApiErrorReportsImpl();
      devLog('ui', 'ai-tools-load-error-reports', { count: reports.length });
      return reports;
    } catch (err) {
      devLogError('ui', 'ai-tools-load-error-reports-failed', err);
      throw err;
    }
  }, []);

  const clearApiErrorReports = useCallback(async () => {
    try {
      await clearApiErrorReportsImpl();
      devLog('ui', 'ai-tools-clear-error-reports', {});
    } catch (err) {
      devLogError('ui', 'ai-tools-clear-error-reports-failed', err);
      throw err;
    }
  }, []);

  return {
    fetchModels,
    testConnection,
    loadApiErrorReports,
    clearApiErrorReports,
  };
}
