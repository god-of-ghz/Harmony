import crypto from 'crypto';
import dbManager from '../database';

// Memory of when each server was last audited to avoid extreme overlapping runs.
const lastAuditMap = new Map<string, number>();

export const startAuditJob = () => {
    // Run an evaluation every 10 minutes (600,000 ms)
    setInterval(async () => {
        try {
            const servers = await dbManager.getAllLoadedServers();
            for (const server of servers) {
                const auditIntervalHours = server.audit_interval_hours || 24;
                const intervalMs = auditIntervalHours * 60 * 60 * 1000;
                const now = Date.now();
                const lastAudit = lastAuditMap.get(server.id) || 0;

                // Time to run an audit?
                if (now - lastAudit >= intervalMs) {
                    await performAuditForServer(server.id, auditIntervalHours);
                    lastAuditMap.set(server.id, now);
                }

                // Yield to Node Event Loop to prevent blocking WebSockets during this sweep
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        } catch (err) {
            console.error("Audit Job Sweep Error:", err);
        }
    }, 600000); // Check every 10 min
};

export const performAuditForServer = async (serverId: string, hours: number) => {
    try {
        const thresholdDateObj = new Date(Date.now() - (hours * 60 * 60 * 1000));
        const thresholdISO = thresholdDateObj.toISOString();
        
        // Grab daily batch
        const messages: any[] = await dbManager.allServerQuery(serverId, 
            `SELECT id, content, signature, timestamp FROM messages WHERE timestamp > ? ORDER BY timestamp ASC`, 
            [thresholdISO]
        );

        if (messages.length === 0) return;

        // Hash concatenation of all messages in order
        const hash = crypto.createHash('sha256');
        for (const msg of messages) {
            hash.update(`${msg.id}:${msg.timestamp}:${msg.content}:${msg.signature}`);
        }
        const digest = hash.digest('hex');

        // Append to immutable log
        await dbManager.runServerQuery(serverId, 
            `INSERT INTO integrity_audits (hash, target_date) VALUES (?, ?)`, 
            [digest, Date.now()]
        );
        console.log(`[AUDIT] Completed snapshot for ${serverId} (${messages.length} messages) -> ${digest}`);
    } catch (err) {
         console.error(`Audit failed for ${serverId}:`, err);
    }
};
