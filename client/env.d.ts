declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}

interface DesktopUpdateState {
  supported: boolean;
  configured: boolean;
  status:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "up-to-date"
    | "error"
    | "unsupported";
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseDate: string | null;
  releaseNotes: string;
  downloadProgress: number;
  checkedAt: string | null;
  message: string;
}

interface Window {
  desktopUpdater?: {
    getState: () => Promise<DesktopUpdateState>;
    checkForUpdates: () => Promise<DesktopUpdateState>;
    downloadUpdate: () => Promise<DesktopUpdateState>;
    installUpdate: () => Promise<DesktopUpdateState>;
    onStateChange: (callback: (state: DesktopUpdateState) => void) => () => void;
  };
}
