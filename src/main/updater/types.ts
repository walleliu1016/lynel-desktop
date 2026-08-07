// 云服务检查更新响应
export interface CloudCheckResponse {
  hasUpdate: boolean;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  forceUpdate?: boolean;
  downloadUrl?: string;
  sha512?: string;
  size?: number;
}

// 内部统一检查结果
export interface CheckResult {
  hasUpdate: boolean;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  forceUpdate?: boolean;
  downloadUrl?: string;
  sha512?: string;
  size?: number;
}

// 更新状态（推送给前端）
export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'no-update';
  data?: {
    version?: string;
    percent?: number;
    speed?: number;
    error?: string;
    source?: 'startup' | 'scheduled' | 'manual';
  };
}

// 更新配置
export interface UpdateConfig {
  githubEnabled: boolean;
  httpEnabled: boolean;
  httpBaseUrl: string;
  channel: 'stable';
}
