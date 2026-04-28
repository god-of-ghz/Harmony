import { useAppStore } from '../store/appStore';

// TODO [VISION:V1] Multi-Token Architecture — When the client transitions to per-node
// tokens (tokenMap in appStore), apiFetch should auto-resolve the correct token based
// on the URL being fetched. Extract the base URL from `input`, look up the matching
// token from `useAppStore.getState().tokenMap[baseUrl]`, and inject it into the
// Authorization header automatically. This would eliminate the need for every call
// site to manually pass `Bearer ${currentAccount.token}`.
// See also: appStore.ts (Account interface), ChatArea.tsx (WS auth).
export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await fetch(input, init);
    
    if (response.status === 401) {
        try {
            const clone = response.clone();
            const text = await clone.text();
            
            if (text.includes('Primary server unreachable')) {
                const state = useAppStore.getState();
                const account = state.currentAccount;
                const primaryUrl = account?.primary_server_url || (state.connectedServers[0]?.url) || 'your primary server';
                
                state.setPrimaryOfflineMessage(
                    `Your primary server (${primaryUrl}) is currently unreachable. Some features may be limited. Your session will resume when it comes back online.`
                );
            }
        } catch (e) {
            console.error("Failed to parse 401 response in apiFetch:", e);
        }
    }
    
    return response;
};
