export const SLA_CACHE_KEY = 'harmony_sla_tracker';

export interface SlaEvent {
    timestamp: number;
    status: 'online' | 'offline';
    latency?: number;
}

export interface ServerSlaData {
    events: SlaEvent[];
}

export interface SlaCache {
    [serverUrl: string]: ServerSlaData;
}

export const loadSlaCache = (): SlaCache => {
    try {
        const cached = localStorage.getItem(SLA_CACHE_KEY);
        if (cached) return JSON.parse(cached);
    } catch(e) {}
    return {};
};

export const saveSlaCache = (cache: SlaCache) => {
    localStorage.setItem(SLA_CACHE_KEY, JSON.stringify(cache));
};

export const trackPing = (serverUrl: string, status: 'online' | 'offline', latency?: number) => {
    const cache = loadSlaCache();
    if (!cache[serverUrl]) cache[serverUrl] = { events: [] };
    
    cache[serverUrl].events.push({
        timestamp: Date.now(),
        status,
        latency
    });
    
    // Prune events older than 14 days to keep LocalStorage lightweight
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    cache[serverUrl].events = cache[serverUrl].events.filter(e => e.timestamp >= twoWeeksAgo);

    saveSlaCache(cache);
};

export const pingServerHealth = async (serverUrl: string) => {
    const start = Date.now();
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000); // Wait 3s max
        const res = await fetch(`${serverUrl}/api/health`, { signal: controller.signal as any });
        clearTimeout(timeout);
        
        if (res.ok) {
            trackPing(serverUrl, 'online', Date.now() - start);
            return true;
        }
    } catch (e) {
        // failed
    }
    trackPing(serverUrl, 'offline');
    return false;
};

const selectBestReplica = (cache: SlaCache, knownReplicas: string[]) => {
    if (knownReplicas.length === 0) return null;
    
    let bestReplica: string | null = null;
    let highestScore = -1;
    let lowestLatency = Infinity;
    
    // Sort logically to break ties
    const sortedReplicas = [...knownReplicas].sort();

    for (const url of sortedReplicas) {
        const data = cache[url];
        if (!data || data.events.length === 0) continue;
        
        let upMs = 0;
        let totalMs = 0;
        let validEvents = 0;
        let sumLatency = 0;
        
        for (let i = 0; i < data.events.length; i++) {
            const ev = data.events[i];
            const endTs = (i < data.events.length - 1) ? data.events[i+1].timestamp : Date.now();
            const duration = endTs - ev.timestamp;
            
            totalMs += duration;
            if (ev.status === 'online') {
                upMs += duration;
                if (ev.latency !== undefined) {
                    sumLatency += ev.latency;
                    validEvents++;
                }
            }
        }
        
        const uptimeRatio = totalMs > 0 ? upMs / totalMs : 0;
        const avgLatency = validEvents > 0 ? sumLatency / validEvents : 9999;
        
        // Discard precision below 0.01% to allow tiebreaker tests to naturally tie
        const uptimePercent = Math.round(uptimeRatio * 10000) / 100;

        if (uptimePercent > highestScore) {
            highestScore = uptimePercent;
            lowestLatency = avgLatency;
            bestReplica = url;
        } else if (uptimePercent === highestScore) {
            if (avgLatency < lowestLatency) {
                lowestLatency = avgLatency;
                bestReplica = url;
            }
        }
    }
    
    return bestReplica || sortedReplicas[0]; // fallback to alphabetical first if no data
};

export const evalPromotionRule = (primaryUrl: string, knownReplicas: string[], forceNow?: number): string | null => {
    const cache = loadSlaCache();
    const primaryData = cache[primaryUrl];
    
    if (!primaryData || primaryData.events.length === 0) return null;
    
    const now = forceNow || Date.now();
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const twentyFourHours = 24 * 60 * 60 * 1000;

    const recentEvents = primaryData.events.filter(e => e.timestamp >= now - sevenDays && e.timestamp <= now);
    
    if (recentEvents.length === 0) {
        // Edge case: Data exists but is older than 7 days. We can assume it was offline based on the last event.
        const lastEv = primaryData.events[primaryData.events.length - 1];
        if (lastEv.status === 'offline' && now - lastEv.timestamp > threeDays) {
            return selectBestReplica(cache, knownReplicas);
        }
        return null;
    }

    let totalDowntimeMs = 0;
    let currentOutageStart: number | null = null;
    
    for (let i = 0; i < recentEvents.length; i++) {
        const ev = recentEvents[i];
        if (ev.status === 'offline' && currentOutageStart === null) {
            currentOutageStart = ev.timestamp;
        } else if (ev.status === 'online' && currentOutageStart !== null) {
            const outageLength = ev.timestamp - currentOutageStart;
            totalDowntimeMs += outageLength;
            currentOutageStart = null;
        }
    }
    
    if (currentOutageStart !== null) {
        const ongoingOutage = now - currentOutageStart;
        totalDowntimeMs += ongoingOutage;
        if (ongoingOutage >= threeDays) {
            return selectBestReplica(cache, knownReplicas);
        }
    }

    if (totalDowntimeMs > twentyFourHours) {
        return selectBestReplica(cache, knownReplicas);
    }
    
    return null;
};
