import settings from '../config/remote-data.json';
import { createRemoteData } from './remote-data';

const CACHE_KEY = 'tolkRemoteData';
// Production remains disabled until hosting and release have been approved.
export const remoteData = createRemoteData({
  indexUrl: (import.meta.env.DEV ? settings.dev : settings.prod).indexUrl,
  refreshMs: settings.refreshMs,
  timeoutMs: settings.timeoutMs,
  read: async () => (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY],
  write: async (value) => {
    await chrome.storage.local.set({ [CACHE_KEY]: value });
  },
});
